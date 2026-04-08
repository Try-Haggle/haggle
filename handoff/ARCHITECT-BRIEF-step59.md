# ARCHITECT-BRIEF — Step 59: Next.js Admin UI

**Author:** Arch
**Date:** 2026-04-08
**Target:** Bob
**Depends on:** Steps 55–58 (admin API complete, 349 tests green)

---

## 1. Split decision — **Part A / Part B**

Estimated scope: ~12 files, ~5–6h. Split to keep reviews tight:

- **Part A — Scaffold + Read-only Inbox** (layout, auth guard, API wrapper extensions, summary cards, tabs, tables, detail drawer read path, smoke tests for routing/guard). ~7 files, ~3h.
- **Part B — Mutations + Promotion Rules** (action buttons with optimistic updates, PromotionRulesTable CRUD, tag-promote job trigger, tests for optimistic flow). ~5 files, ~2–3h.

Bob should ship Part A first, get Richard's review, then Part B.

---

## 2. Existing infrastructure (good news)

Already in place — **do not recreate**:

- `apps/web/src/lib/api-client.ts` — `api.get/post/patch/delete` already injects Supabase Bearer token via `createClient()` + `getSession()`. Just use it.
- `apps/web/src/lib/supabase/{client,server}.ts` — SSR + browser Supabase helpers.
- `apps/web/src/app/(app)/layout.tsx` — reference auth guard pattern (server component, `supabase.auth.getUser()` → `redirect('/claim')`).
- Tailwind v4 + Next 15 App Router + React 19.

**Missing:** No test infrastructure in `apps/web` (no vitest, no testing-library). See §7.

---

## 3. File list

### Part A (scaffold + read)
| Path | Purpose |
|---|---|
| `apps/web/src/app/(app)/admin/layout.tsx` | Server component. Re-check `getUser()` + verify `user.app_metadata.role === 'admin'` (or `user_metadata.role`); redirect to `/` on fail. Wraps children in admin chrome. |
| `apps/web/src/app/(app)/admin/page.tsx` | Client component `"use client"`. Renders `<SummaryCards />` + `<InboxTabs />`. |
| `apps/web/src/lib/admin-api.ts` | Thin typed wrapper around `api.*` for admin endpoints. Exports `adminApi.inbox.summary()`, `.list(type, {limit, offset, status?})`, `.detail(type, id)`, `.actions.tagApprove(id)`, etc. Also types (`InboxSummary`, `InboxItem`, `TagDetail`, …). |
| `apps/web/src/components/admin/SummaryCards.tsx` | Client. Fetches `/admin/inbox/summary` on mount, shows 3 cards (tags pending, disputes open, payments flagged). |
| `apps/web/src/components/admin/InboxTabs.tsx` | Client. Tab switcher + hosts `<InboxTable />` per tab. Owns selected `type` + `selectedId` state; renders `<DetailDrawer />`. |
| `apps/web/src/components/admin/InboxTable.tsx` | Client. Paginated table (limit/offset useState). Row click → sets `selectedId`. |
| `apps/web/src/components/admin/DetailDrawer.tsx` | Client. Fetches detail on `selectedId` change. Slide-in panel. Part A: read-only body + close button. Part B adds action buttons. |
| `apps/web/src/__tests__/admin/guard.test.tsx` | Smoke tests (see §8). |

### Part B (mutations + rules)
| Path | Purpose |
|---|---|
| `apps/web/src/components/admin/ActionButtons.tsx` | Per-type action set; calls `adminApi.actions.*` with optimistic updates. |
| `apps/web/src/app/(app)/admin/promotion-rules/page.tsx` | PromotionRulesTable host page. |
| `apps/web/src/components/admin/PromotionRulesTable.tsx` | Client. GET list, inline edit (PUT), delete, "Run tag-promote job" button (POST `/admin/jobs/tag-promote`) + last run status (`GET .../last`). |
| `apps/web/src/components/admin/MergeDialog.tsx` | Modal for tag-merge (needs target tag id input). |
| `apps/web/src/__tests__/admin/optimistic.test.tsx` | Optimistic rollback test. |

### Modifications
- `apps/web/package.json` — add dev deps (§7).
- `apps/web/vitest.config.ts` — **new**, minimal config (§7).
- `apps/web/src/lib/api-client.ts` — **no change** (already good).

---

## 4. Key design decisions

| Decision | Rationale |
|---|---|
| **Admin role check in server layout, not middleware** | Matches existing `(app)/layout.tsx` pattern. Middleware adds complexity for one route subtree. Server component redirect is simpler and Richard already reviewed the pattern. |
| **Reuse `api.*` wrapper as-is** | Already injects Bearer token via Supabase session. Zero changes needed. `admin-api.ts` is a pure typing layer. |
| **useState/useEffect, no React Query** | Per requirements. Admin UI has low concurrency; manual state is fine and keeps bundle small. |
| **Optimistic updates via functional setState + rollback on error** | No React Query = implement by hand. Pattern in §5. |
| **Detail drawer fetches on selection, not preloaded** | Keeps list endpoint responses small. |
| **No route-level splitting for inbox types** | Single `/admin` page with tabs → simpler state, shared drawer. Promotion rules is separate page since it's a different domain. |

### Where does the admin role live?

Supabase stores it in `user.app_metadata.role` (set server-side, not user-editable) — this matches how `requireAdmin` in the API side validates. Bob: **confirm with Richard** that `app_metadata.role === 'admin'` is the contract; if the API side reads a different field, align to it. Fallback order in UI guard: `app_metadata.role || user_metadata.role`.

---

## 5. Pseudo-code for trickiest parts

### 5.1 Admin auth guard (`apps/web/src/app/(app)/admin/layout.tsx`)

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/claim");

  const role = (user.app_metadata as any)?.role ?? (user.user_metadata as any)?.role;
  if (role !== "admin") redirect("/"); // or /dashboard

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin Console</h1>
        <nav className="flex gap-4 text-sm">
          <a href="/admin">Inbox</a>
          <a href="/admin/promotion-rules">Promotion Rules</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
```

### 5.2 `admin-api.ts` typed wrapper

```ts
import { api } from "./api-client";

export type InboxType = "tag" | "dispute" | "payment";
export interface InboxSummary { tags: number; disputes: number; payments: number }
export interface InboxItem { id: string; title: string; status: string; createdAt: string }

export const adminApi = {
  inbox: {
    summary: () => api.get<InboxSummary>("/admin/inbox/summary"),
    list: (type: InboxType, p: { limit?: number; offset?: number; status?: string } = {}) => {
      const qs = new URLSearchParams();
      if (p.limit) qs.set("limit", String(p.limit));
      if (p.offset) qs.set("offset", String(p.offset));
      if (p.status) qs.set("status", p.status);
      const suffix = qs.toString() ? `?${qs}` : "";
      // route map: tag -> tags, dispute -> disputes, payment -> payments
      const seg = type === "tag" ? "tags" : type === "dispute" ? "disputes" : "payments";
      return api.get<{ items: InboxItem[]; total: number }>(`/admin/inbox/${seg}${suffix}`);
    },
    detail: (type: InboxType, id: string) =>
      api.get<Record<string, unknown>>(`/admin/inbox/${type}/${id}`),
  },
  actions: {
    tagApprove:  (id: string) => api.post(`/admin/actions/tag-approve`,  { id }),
    tagReject:   (id: string) => api.post(`/admin/actions/tag-reject`,   { id }),
    tagMerge:    (id: string, targetId: string) =>
      api.post(`/admin/actions/tag-merge`, { id, targetId }),
    disputeEscalate: (id: string) => api.post(`/admin/actions/dispute-escalate`, { id }),
    disputeResolve:  (id: string, outcome: string) =>
      api.post(`/admin/actions/dispute-resolve`, { id, outcome }),
    paymentMarkReview: (id: string) => api.post(`/admin/actions/payment-mark-review`, { id }),
  },
  promotionRules: {
    list:   () => api.get("/admin/promotion-rules"),
    get:    (category: string) => api.get(`/admin/promotion-rules/${category}`),
    put:    (category: string, body: unknown) => api.patch(`/admin/promotion-rules/${category}`, body), // or api.post if PUT not in wrapper
    delete: (category: string) => api.delete(`/admin/promotion-rules/${category}`),
  },
  jobs: {
    runTagPromote: () => api.post("/admin/jobs/tag-promote"),
    lastTagPromote: () => api.get("/admin/jobs/tag-promote/last"),
  },
};
```

**Note to Bob:** `api-client.ts` doesn't expose `PUT`. Either add `put` method to `api` object (preferred, one-line change), or use `apiClient(path, { method: "PUT", body })` directly inside `admin-api.ts`. Pick the cleaner one.

### 5.3 Optimistic update pattern (tag approve)

```tsx
// inside InboxTable.tsx
const [items, setItems] = useState<InboxItem[]>([]);
const [error, setError] = useState<string | null>(null);

async function handleApprove(id: string) {
  const snapshot = items;                          // 1. snapshot
  setItems(prev => prev.filter(i => i.id !== id)); // 2. optimistic remove
  setError(null);
  try {
    await adminApi.actions.tagApprove(id);         // 3. mutate
    // optional: refetch summary counts
  } catch (e) {
    setItems(snapshot);                            // 4. rollback
    setError(e instanceof Error ? e.message : "Action failed");
  }
}
```

Same shape for reject / escalate / resolve / markReview. For `tag-merge` show the `MergeDialog` first, then apply optimistic remove.

---

## 6. Component hierarchy

```
(app)/admin/layout.tsx              [server, role guard]
 └── (app)/admin/page.tsx           [client]
      ├── <SummaryCards />          [fetches /summary]
      └── <InboxTabs>               [owns: type, selectedId]
           ├── <InboxTable type />  [owns: items, limit, offset]
           │    └── <ActionButtons item /> (Part B)
           └── <DetailDrawer type id onClose />

(app)/admin/promotion-rules/page.tsx
 └── <PromotionRulesTable />        [list + edit + job trigger]
```

---

## 7. Test infrastructure (currently missing)

`apps/web/package.json` has **no vitest, no testing-library**. Bob must add:

```jsonc
// devDependencies additions
"vitest": "^2.1.0",
"@vitejs/plugin-react": "^4.3.0",
"@testing-library/react": "^16.1.0",
"@testing-library/jest-dom": "^6.6.0",
"@testing-library/user-event": "^14.5.0",
"jsdom": "^25.0.0"
```

Add script: `"test": "vitest run"`, `"test:watch": "vitest"`.

**`apps/web/vitest.config.ts`** (new):

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

**`apps/web/src/__tests__/setup.ts`**:

```ts
import "@testing-library/jest-dom/vitest";
```

Server components (`layout.tsx`) are hard to unit-test — **test the role-check logic as a pure function** extracted to `admin-api.ts` or a `guard.ts` helper, not via rendering the layout.

---

## 8. Minimum test set (7 smoke tests)

Split: 4 in Part A, 3 in Part B.

### Part A — `src/__tests__/admin/inbox.test.tsx`
1. **`isAdminRole()` helper** — returns true for `{app_metadata: {role: 'admin'}}`, false for missing/other.
2. **`<SummaryCards />`** — mocks `adminApi.inbox.summary` → renders 3 counts.
3. **`<InboxTable />`** — mocks list endpoint → renders rows + pagination next/prev updates offset.
4. **`<DetailDrawer />`** — opens on `selectedId`, fetches detail, closes on close click.

### Part B — `src/__tests__/admin/actions.test.tsx`
5. **Optimistic approve success** — row disappears before promise resolves; stays gone on resolve.
6. **Optimistic approve failure** — row returns after reject; error message shown.
7. **PromotionRulesTable job trigger** — clicking "Run" calls `jobs.runTagPromote` and refetches `lastTagPromote`.

Mock `@/lib/admin-api` via `vi.mock()`. No network. No Supabase mocking needed (don't test the server layout directly).

---

## 9. Verification commands

```bash
# Typecheck
pnpm --filter @haggle/web typecheck

# Tests (after Part A adds vitest)
pnpm --filter @haggle/web test

# Dev run
pnpm --filter @haggle/web dev
# → visit http://localhost:3000/admin with an admin-role Supabase session

# Build
pnpm --filter @haggle/web build
```

Manual QA checklist for Richard:
- [ ] Non-admin user hitting `/admin` → redirected.
- [ ] Logged-out → redirected to `/claim`.
- [ ] Each inbox tab loads + paginates.
- [ ] Detail drawer shows fetched payload.
- [ ] Each action button succeeds → row removed; rollback on API error (can test by stopping API).
- [ ] Promotion rules CRUD works, job trigger shows last-run timestamp.

---

## 10. Open questions for Bob to confirm with Richard

1. **Role field location** — `user.app_metadata.role` vs `user_metadata.role`? Must match whatever `requireAdmin` on API reads. Guard should mirror exactly.
2. **Promotion rules PUT** — does the API accept PATCH as an alias? If not, add `put` to `api-client.ts`.
3. **Tag-merge UX** — how does admin pick the merge target? Free-text id input is acceptable for MVP; a searchable picker is Phase 2.

---

**End of brief. Bob — start with Part A. Do not start Part B until Richard signs off on Part A.**
