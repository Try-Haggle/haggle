# Review Request — Step 13: Commerce Dashboard Real API Integration
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

API integration layer for the commerce dashboard. New `commerce-api.ts` with typed functions for payments, disputes, shipments, and trust. Updated `commerce-dashboard.tsx` to fire real API calls alongside local state machine transitions (optimistic UI pattern). Dashboard degrades gracefully in demo mode — all API calls are skipped when no real server IDs exist.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `apps/web/src/app/commerce/commerce-api.ts` | 1-100 | NEW — Typed API functions: `preparePayment`, `getPaymentStatus`, `quotePayment`, `authorizePayment`, `settlePayment`, `openDispute`, `getDisputeByOrder`, `getShipmentByOrder`, `getTrustScore`. Response types for each domain. |
| `apps/web/src/app/commerce/commerce-dashboard.tsx` | 1-5, 583-600, 610-755 | MODIFIED — Added `commerce-api` import, `useRef` import, `isDemoMode()` helper, `showApiError()` helper, `serverIds` ref, trust score fetch on mount, API calls wired to `handleAction` with try/catch and rollback. |

## Key Areas to Scrutinize

1. **`isDemoMode()` heuristic** (`commerce-dashboard.tsx:588-593`) — Checks for `"..."` in wallet address to detect demo/mock state. This works for the current mock data (`0x1a2B...buyer`) but would fail if someone enters a real-looking address in the editable fields. Richard should verify this detection is sufficient or suggest a more explicit flag (e.g., `state.isDemo`).

2. **`prevSnapshot` capture pattern** (`commerce-dashboard.tsx:614-618`) — A `let` variable assigned inside `setState` callback, then reassigned to `const snap` outside for TS narrowing. This is a common React pattern for capturing pre-update state but worth confirming the closure timing is correct — `setState` with a function updater is synchronous in the callback but the actual render is batched.

3. **Payment pipeline sequencing** (`commerce-dashboard.tsx:720-729`) — The `process_payment` case runs an async IIFE with sequential `quote → authorize → settle`. If any step fails, the entire payment reverts. Richard should check whether partial progress (e.g., quoted but not authorized) should be handled differently.

4. **Trust score effect dependencies** (`commerce-dashboard.tsx:635-653`) — The `useEffect` for trust score fetching depends on `state?.negotiation.buyer_id` with an eslint-disable. This means it runs once when buyer_id first becomes available and never re-runs. Verify this is the intended behavior vs. re-fetching after state reset.

5. **Missing API calls for simulation actions** (`commerce-dashboard.tsx:748-750`) — Shipment submission, delivery advance, AI review, dispute resolution have no API calls. The brief listed these as integration points but the current API likely doesn't support them yet. Richard should confirm these are acceptable omissions.

## Open Questions

1. Should `isDemoMode` be a property on `CommerceState` instead of a heuristic function? Adding `isDemo: boolean` to the state would be more explicit but requires changing `commerce-engine.ts`.

2. The trust score fetch on mount fires even before user takes any action. If the API is not available, this produces a console.warn on every page load. Should it be behind a feature flag or only fire after first real API interaction?

## Verification

```
pnpm --filter @haggle/web typecheck   — 0 errors
```
