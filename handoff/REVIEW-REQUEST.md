# Review Request — Step 12: API Client Utility + Auth Token Injection
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

Centralized API client for the Next.js frontend. Two modules: `api-client.ts` (browser, Client Components) and `api-server.ts` (SSR, Server Components). Both automatically inject Supabase JWT into outgoing API requests. All 6 page files updated to use the new clients. Zero hardcoded `API_URL` remains in any page file.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `apps/web/src/lib/api-client.ts` | 1-82 | NEW — `apiClient()` with Supabase JWT injection, `ApiError` class, `api` convenience object (`get/post/patch/delete`). `skipAuth` option for public endpoints. |
| `apps/web/src/lib/api-server.ts` | 1-82 | NEW — `apiServer()` base, `serverApi` convenience object (`get/post`), `apiServerFireAndForget()` for non-critical POSTs. Server-side Supabase client (cookie-based auth). |
| `apps/web/src/app/(app)/sell/dashboard/page.tsx` | 1-4, 40-60 | MODIFIED — removed `API_URL`, replaced 2 raw fetches with `serverApi.post` (claim) and `serverApi.get` (listings). |
| `apps/web/src/app/(app)/buy/dashboard/page.tsx` | 1-4, 31-41 | MODIFIED — removed `API_URL`, replaced 1 raw fetch with `serverApi.get` (viewed listings). |
| `apps/web/src/app/(app)/sell/listings/[id]/page.tsx` | 1-4, 40-50 | MODIFIED — removed `API_URL`, replaced 1 raw fetch with `serverApi.get` (listing detail). |
| `apps/web/src/app/(app)/sell/listings/new/new-listing-wizard.tsx` | 5-8, 331-368, 450-470 | MODIFIED — removed `API_URL`, replaced 3 raw fetches with `api.post`/`api.patch`. Added try/catch to `ensureDraft` and `patchDraft`. |
| `apps/web/src/app/(app)/settings/settings-content.tsx` | 5, 53-54, 158-174 | MODIFIED — removed `API_URL`, replaced manual session+fetch DELETE with `api.delete`. Error handling via `ApiError`. |
| `apps/web/src/app/l/[publicId]/page.tsx` | 1-3, 29-36, 57-66 | MODIFIED — removed `API_URL`, public listing uses `serverApi.get` with `skipAuth: true`, view tracking uses `apiServerFireAndForget`. |

## Key Areas to Scrutinize

1. **`apiClient` throws on non-2xx** (`api-client.ts:51-54`) — The `ApiError` throw means pages that previously parsed error response bodies (like the wizard's publish validation errors) need careful handling. The wizard uses `.catch(() => null)` for publish since validation errors may come as 200+`ok:false` OR as 4xx. Richard should verify the publish endpoint's actual HTTP status on validation failure.

2. **Server-side `apiServer` uses `next: { revalidate: 0 }`** (`api-server.ts:43`) — This disables Next.js fetch caching for all server-side API calls. The original pages used `cache: "no-store"` which is equivalent. Verify this is the correct caching strategy for all server pages.

3. **`apiServerFireAndForget` takes pre-built headers** (`api-server.ts:70-81`) — This is a deviation from the brief's original `apiServer` design. It accepts headers directly instead of internally creating a Supabase client. This avoids a redundant `createClient()` call in the public listing page where the session is already available. Richard should verify the auth headers are correctly constructed at the call site (`l/[publicId]/page.tsx:58-65`).

4. **Non-null assertions in wizard** (`new-listing-wizard.tsx:486-487`) — `data.publicId!` and `data.shareUrl!` after the `data.ok` guard. These are safe if the API contract guarantees these fields on success, but worth a glance.

5. **Settings delete error handling** (`settings-content.tsx:162-170`) — Changed from manual `res.ok` check + `body.error` parsing to `ApiError` catch. The error message field mapping (`err.message`) should produce the same user-visible text as before.

## Open Questions

1. The `serverApi.post` was added beyond the brief's spec (brief only had GET-only `apiServer`). The sell dashboard's claim endpoint requires a server-side POST. Is a `serverApi` convenience object the right pattern, or should this use the raw `apiServer` function with method override?

2. Should the `apiServerFireAndForget` helper internally create its own Supabase client for auth (simpler API, one extra `createClient` call) or accept pre-built headers (current approach, avoids redundant work)?

## Verification

```
pnpm --filter @haggle/web typecheck   — 0 errors
grep -r "API_URL\|localhost:3001" apps/web/src/app/   — 0 matches
```
