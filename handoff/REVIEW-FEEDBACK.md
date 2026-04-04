# Review Feedback — Step 13
Date: 2026-04-04
Ready for Builder: YES

## Must Fix

None.

## Should Fix

- `commerce-api.ts:74-85` — `openDispute` signature has 4 parameters (`orderId`, `reasonCode`, `description`, `openedBy`), but the brief specified 3 (`orderId`, `reasonCode`, `openedBy`). Bob added `description` as a separate parameter and sends it in the request body. The dashboard call site at `commerce-dashboard.tsx:735-739` correctly passes all 4 args. This is a signature deviation from the brief. The addition is reasonable — a dispute without a description is not useful — but the brief's signature used `unknown` return types and 3 params. Log as spec deviation. No action required unless Arch wants strict adherence.

- `commerce-api.ts:11-46` — The brief specified `unknown` for all response type fields (`{ payment: unknown }`, `{ dispute: unknown }`, `{ trust_score: unknown }`). Bob replaced these with typed interfaces (`PaymentResponse`, `DisputeResponse`, `ShipmentResponse`, `TrustScoreResponse`) with specific fields. This is strictly better than `unknown` — it gives the dashboard type-safe access to `res.payment.id` and `res.trust_score.settlement_reliability`. Noting as positive drift. No action required.

- `commerce-dashboard.tsx:591-592` — `isDemoMode` checks `!address.startsWith("0x") || address.includes("...")`. Bob flagged this himself in the review request. The mock addresses in `commerce-engine.ts` use the `0x1a2B...buyer` format, so the `"..."` check works. But if someone edits the buyer wallet address field (which is editable in APPROVAL phase) to remove the `"..."`, the heuristic breaks and API calls would fire against a non-existent server. Low risk in practice — there is no real API server in demo mode anyway, so the calls would fail and be caught by try/catch. But an explicit `isDemo` flag on state would be cleaner. Escalating below since it touches `commerce-engine.ts` which is out of scope for this step.

- `commerce-dashboard.tsx:718-727` — Payment pipeline runs `quote -> authorize -> settle` sequentially in an async IIFE. If `quotePayment` succeeds but `authorizePayment` fails, the full local state reverts to pre-payment. The server-side payment is now in a "quoted" state while the UI shows pre-payment. This is acceptable for MVP — the next "Process Payment" click would re-run the whole pipeline. But in production, partial server state will need reconciliation (e.g., check payment status before re-running). No action required now.

- `commerce-dashboard.tsx:755` — `useCallback` has an empty dependency array `[]`. The callback reads `serverIds.current` (ref — stable) and calls `setState` with updater function (stable). `isDemoMode` is a module-level function (stable). `showApiError` is module-level (stable). `commerceApi` is a module import (stable). `createInitialState` is imported (stable). All dependencies are stable, so the empty array is correct. No issue.

- `commerce-dashboard.tsx:696-709` — The `buyer_approve`/`seller_approve` case calls `preparePayment` conditionally, checking `snap.approval_state`. The brief says to call `preparePayment()` on the "Prepare Payment" button, but there is no separate "Prepare Payment" button — the flow goes from approval directly to payment phase. Bob wired `preparePayment` to fire when the last approval completes (transitioning to PAYMENT phase). This is a reasonable interpretation. The condition at line 699 (`snap.approval_state === "MUTUALLY_ACCEPTABLE" || snap.approval_state === "AWAITING_SELLER_APPROVAL"`) will match on either approval click, but `preparePayment` only fires if `serverIds.current.orderId` exists — which it never does in demo mode. In non-demo mode with a real orderId, this could fire `preparePayment` twice (once on buyer approve, once on seller approve). The second call would be redundant. Low risk — the API should be idempotent. No action required.

- `commerce-dashboard.tsx:620-645` — Trust score fetch on mount. The `useEffect` depends on `state?.negotiation.buyer_id` with an eslint-disable. If `isDemoMode` returns true (which it will for the default mock state), the effect returns early and no API call fires. Correct behavior. The eslint-disable is justified — `seller_id` does not need to be in the deps because it is always set alongside `buyer_id` in `createInitialState`. Acceptable.

## Escalate to Architect

- **`isDemoMode` heuristic vs explicit flag** — The current `isDemoMode` function at `commerce-dashboard.tsx:587-593` uses wallet address string inspection. Bob raised this in the review request as an open question. Adding `isDemo: boolean` to `CommerceState` in `commerce-engine.ts` would be more reliable, but that file is not in scope for this step. Arch should decide: (a) add `isDemo` to the engine state in a follow-up step, (b) accept the heuristic as sufficient for MVP, or (c) expand this step's scope to include the engine change.

- **Missing API calls for simulation actions** — `commerce-dashboard.tsx:749-751` explicitly skips API calls for `submit_shipping`, `advance_shipment`, `delivery_exception`, `start_ai_review`, `resolve_dispute`. The brief listed shipment and dispute resolution as integration points. Bob's comment says "No API calls for" these actions. If the API endpoints do not exist yet, this is correct — you cannot call what does not exist. Arch should confirm these endpoints are deferred to a later step, or if they were expected in this step.

## Cleared

2 files reviewed against the Step 13 brief.

**commerce-api.ts**: 9 exported async functions matching the brief's specified set: `preparePayment`, `getPaymentStatus`, `quotePayment`, `authorizePayment`, `settlePayment`, `openDispute`, `getDisputeByOrder`, `getShipmentByOrder`, `getTrustScore`. All use the `api` import from `@/lib/api-client` as specified. Endpoints match the brief's URL patterns exactly. Return types are stronger than the brief's `unknown` — typed interfaces with specific fields. `openDispute` has one extra parameter (`description`) beyond the brief. No unauthorized endpoints. Correct.

**commerce-dashboard.tsx**: Optimistic UI pattern implemented correctly — local `dispatch` (via `setState` updater) fires first for instant UI, then API calls fire in background, with `revert()` on failure. `isDemoMode` guard skips all API calls when no real server IDs exist. Every API call is wrapped in try/catch or `.catch()` — no unhandled promise rejections, no UI crashes on API failure. Trust score fetch fires on mount via `useEffect` with `Promise.allSettled` (non-blocking, handles partial failure). Local state machines (`commerce-engine.ts` imports) are fully preserved — all 11 action cases in `handleAction` still dispatch through the local engine functions. `serverIds` ref tracks API-assigned IDs across renders without triggering re-renders. Reset action clears `serverIds`. No removal of any existing UI components or local state logic. Correct.
