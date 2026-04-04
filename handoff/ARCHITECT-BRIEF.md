# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 13 — Commerce Dashboard Real API Integration

### Context
`/commerce` page has a `commerce-engine.ts` with state machines copied from @haggle/* packages. The `commerce-dashboard.tsx` runs mock data in-browser. This step replaces mock flows with real API calls where possible, while keeping the local state machines for UI transitions (they update instantly for UX, then sync with the server).

### Strategy: Optimistic UI + Server Sync
Keep the local state machines for instant UI feedback. Add API calls that fire alongside state transitions:
1. User clicks action → local state updates instantly (optimistic)
2. API call fires in background
3. If API fails → revert local state + show error

### Build Order

#### 1. Create `apps/web/src/app/commerce/commerce-api.ts` — API integration layer

This file maps commerce actions to API calls:

```ts
import { api } from "@/lib/api-client";

// Payment actions
export async function preparePayment(approvalId: string) {
  return api.post<{ payment: unknown }>("/api/payments/prepare", {
    approval_id: approvalId,
  });
}

export async function getPaymentStatus(paymentId: string) {
  return api.get<{ payment: unknown }>(`/api/payments/${paymentId}`);
}

export async function quotePayment(paymentId: string) {
  return api.post<unknown>(`/api/payments/${paymentId}/quote`);
}

export async function authorizePayment(paymentId: string) {
  return api.post<unknown>(`/api/payments/${paymentId}/authorize`);
}

export async function settlePayment(paymentId: string) {
  return api.post<unknown>(`/api/payments/${paymentId}/settle`);
}

// Dispute actions
export async function openDispute(orderId: string, reasonCode: string, openedBy: string) {
  return api.post<{ dispute: unknown }>("/api/disputes", {
    order_id: orderId,
    reason_code: reasonCode,
    opened_by: openedBy,
  });
}

export async function getDisputeByOrder(orderId: string) {
  return api.get<{ dispute: unknown }>(`/api/disputes/order/${orderId}`);
}

// Shipment actions
export async function getShipmentByOrder(orderId: string) {
  return api.get<{ shipment: unknown }>(`/api/shipments/order/${orderId}`);
}

// Trust
export async function getTrustScore(userId: string) {
  return api.get<{ trust_score: unknown }>(`/api/trust/${userId}`);
}
```

#### 2. Update `commerce-dashboard.tsx` — Wire up API calls

Read the full file first. Then add API integration:

For each user action (button click) that transitions state:
1. Keep the local `dispatch()` for instant UI update
2. Add `try { await commerceApi.xxx() } catch { revert }` after dispatch
3. On page load, fetch real data if an order ID exists in URL/state

Specific integration points:
- **"Prepare Payment" button** → call `preparePayment()`, store returned payment ID
- **"Quote" step** → call `quotePayment()`
- **"Authorize" step** → call `authorizePayment()`
- **"Settle" step** → call `settlePayment()`
- **"Open Dispute" button** → call `openDispute()`
- **Page load** → if order has payment, call `getPaymentStatus()` to sync
- **Trust score display** → call `getTrustScore()` for both parties

### Flags
- Flag: Read `commerce-dashboard.tsx` FULLY before any changes. It's complex with reducers.
- Flag: Do NOT remove local state machines. They provide instant UI feedback.
- Flag: API calls are additive — they sync state but don't replace local transitions.
- Flag: If API isn't available (dev mode, no env), the dashboard should still work with local-only state (graceful degradation).
- Flag: Use `try/catch` around every API call. Never let an API error crash the UI.
- Flag: The dashboard may be in demo mode (no real order). Skip API calls if no real order/payment IDs.

### Definition of Done
- [ ] commerce-api.ts created with typed API functions
- [ ] commerce-dashboard.tsx fires API calls on key actions
- [ ] Graceful degradation — works without API (demo mode)
- [ ] Error handling — API failures show toast, don't crash
- [ ] Trust score fetched for display

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
