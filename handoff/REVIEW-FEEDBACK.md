# Review Feedback — Step 12
Date: 2026-04-04
Ready for Builder: YES

## Must Fix

None.

## Should Fix

- `api-server.ts:73-86` — `apiServerFireAndForget` accepts pre-built headers instead of resolving auth internally. This works but creates a split pattern: `serverApi.get`/`serverApi.post` handle auth internally, while `apiServerFireAndForget` pushes that responsibility to the caller. The call site at `l/[publicId]/page.tsx:58-65` correctly constructs the headers, but any future caller must remember to build them manually. Consider adding an overload that accepts `skipAuth?: boolean` and resolves headers internally, keeping the current signature as a secondary option. Not blocking — only one call site exists today.

- `api-server.ts:31-50` — The brief specified `apiServer` as a simple GET-only function (`apiServer<T>(path: string): Promise<T>`). Bob extended it with `ApiServerOptions` (method, body, skipAuth) and added `serverApi.post`. This was necessary because the sell dashboard's claim endpoint requires a server-side POST. The extension is clean and follows the same convenience pattern as the client-side `api` object. Logging as a spec deviation that was justified by implementation need. No action required.

- `new-listing-wizard.tsx:486-487` — `data.publicId!` and `data.shareUrl!` non-null assertions after the `data.ok` guard. These are safe only if the API contract guarantees `publicId` and `shareUrl` are present when `ok: true`. The publish endpoint at `drafts.ts:106` returns `{ ok: true, ...result }` where `result` comes from `publishDraft`. If `publishDraft` ever returns without those fields, the wizard will set `undefined` into `publishResult`. Low risk — the contract is stable — but a defensive fallback (`data.publicId ?? ""`) would be cleaner than a non-null assertion.

- `new-listing-wizard.tsx:458` — `.catch(() => null)` on the publish `api.post` call. This silently swallows all non-2xx errors (including network failures and 400s from `drafts.ts:110`). The subsequent `if (!data)` check on line 460 handles this with a generic "Failed to publish" message. The 400 response body (`{ ok: false, error: message }`) is lost. In practice, the most common failure path is the 200+`ok:false` validation error (line 101 of drafts.ts) which is correctly handled. The 400 path losing its error message is acceptable for MVP. No action required.

## Escalate to Architect

- **`serverApi.post` addition** — The brief specified `apiServer` as GET-only. Bob added `serverApi.post` because the sell dashboard claim endpoint requires a server-side POST. The implementation is clean. Arch should confirm this is the intended pattern for future server-side mutations, or if server-side POSTs should use the raw `apiServer` function with method override instead.

- **`apiServerFireAndForget` caller-managed auth** — The brief did not specify a fire-and-forget helper. Bob added it for the public listing view tracking. The current design requires callers to build auth headers manually. Arch should decide if this helper should manage its own auth (simpler API, one extra `createClient()` call per invocation) or keep the current caller-managed approach (avoids redundant work when the session is already available).

## Cleared

8 files reviewed against the Step 12 brief.

**api-client.ts**: Matches the brief exactly. `ApiError` class with status and code. `apiClient` function attaches Supabase JWT via `createClient().auth.getSession()`. `skipAuth` option skips token injection. Non-2xx responses throw `ApiError` with parsed body. `api` convenience object exposes `get`, `post`, `patch`, `delete`. `API_URL` centralized from env var with localhost fallback. Correct.

**api-server.ts**: Extended beyond the brief (GET-only to GET+POST+fire-and-forget). `getAuthHeaders` helper creates server-side Supabase client and extracts JWT. `apiServer` base function uses `next: { revalidate: 0 }` (equivalent to the original `cache: "no-store"`). `serverApi` convenience object with `get` and `post`. `apiServerFireAndForget` for non-blocking POSTs. Error handling throws simple `Error` (not `ApiError`) — matches the brief's server-side pattern. Correct.

**sell/dashboard/page.tsx**: Server Component. Uses `serverApi.post` for claim and `serverApi.get` for listings. Error handling preserved — try/catch with fallback to `{ ok: false, error: "network_error" }` for claim, empty array for listings. No `API_URL` reference. Correct.

**buy/dashboard/page.tsx**: Server Component. Uses `serverApi.get` for viewed listings. Error handling preserved — try/catch with empty array fallback. No `API_URL` reference. Correct.

**sell/listings/[id]/page.tsx**: Server Component. Uses `serverApi.get` for listing detail. Error handling preserved — try/catch with null fallback, redirect to dashboard on not-found. No `API_URL` reference. Correct.

**new-listing-wizard.tsx**: Client Component ("use client"). Uses `api.post` for draft creation, `api.patch` for draft updates, `api.post` for publish. `ensureDraft` and `patchDraft` wrapped in try/catch with user-facing error messages. Publish uses `.catch(() => null)` to handle network/4xx failures gracefully while preserving 200+`ok:false` validation error parsing. No `API_URL` reference. Correct.

**settings-content.tsx**: Client Component ("use client"). Uses `api.delete` for account deletion. Error handling uses `ApiError` instanceof check with fallback message. `signOut` and redirect preserved after successful delete. No `API_URL` reference. Correct.

**l/[publicId]/page.tsx**: Server Component. Uses `serverApi.get` with `skipAuth: true` for public listing fetch. Uses `apiServerFireAndForget` with manually constructed auth headers for view tracking. Auth header construction at lines 58-65 correctly reads session and sets Bearer token. `notFound()` on fetch failure or missing listing. No `API_URL` reference. Correct.

No hardcoded `API_URL` in any page file (verified via grep). Marketing `landing.tsx` untouched per brief. Server/Client component boundary respected: all 4 page files (RSC) use `serverApi`, both "use client" files use `api`. Public page uses `skipAuth: true`. No breaking changes to UI behavior.
