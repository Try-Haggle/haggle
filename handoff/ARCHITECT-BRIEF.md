# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 18 — Shipping SLA Violation → Auto Dispute Creation

### Context
When a seller misses the shipping SLA deadline, the system should automatically open a dispute. Currently shipments.ts has SLA tracking and trust triggers, but no auto-dispute. dispute-core has `SHIPMENT_SLA_MISSED` reason code.

### Build Order

#### 1. Add auto-dispute logic to `apps/api/src/routes/shipments.ts`

In the `persistAndRespond` helper (or a new helper called after shipment event processing), check if the SLA is violated:

```ts
async function autoCreateDisputeOnSlaViolation(
  shipment: Shipment,
  db: Database,
) {
  // Only trigger on SLA-related statuses or when SLA check shows VIOLATED
  // Import SLA check functions from shipping-core
  // Import dispute creation from dispute service
  
  // Check if SLA is violated
  // If violated AND no existing dispute for this order → create one
  // Reason code: SHIPMENT_SLA_MISSED
  // opened_by: "system"
}
```

Call this after every shipment status update (inside `persistAndRespond`).

Read these first:
- `packages/shipping-core/src/sla-violation.ts` — what functions check SLA status
- `apps/api/src/services/dispute-record.service.ts` — createDisputeRecord
- `apps/api/src/routes/disputes.ts` — see how disputes are opened (pattern to follow)

### Flags
- Flag: Read shipping-core SLA functions to find the right one. Likely `checkSlaStatus` or similar.
- Flag: Only create dispute if one doesn't already exist for this order (check first).
- Flag: opened_by: "system" — this is an automated dispute.
- Flag: Don't import DisputeService class — use the service functions directly for DB operations.
- Flag: Non-critical — wrap in try/catch, don't fail the shipment update.

### Definition of Done
- [ ] Auto-dispute created when SLA violated
- [ ] No duplicate disputes (check existing first)
- [ ] System-initiated (opened_by: "system")
- [ ] Non-blocking (try/catch, shipment update still succeeds)

---

## Step 19 — Settlement Release Flow Endpoints

### Context
payment-core has a complete settlement release system (2-phase: product release + buffer release). But the API doesn't expose endpoints for the buyer review flow:
- Buyer confirms receipt → product funds released
- 14-day buffer period → remaining funds released
- Buyer disputes during review → funds held

### Build Order

Read first:
- `apps/api/src/routes/settlement-releases.ts` — existing endpoints
- `apps/api/src/services/settlement-release.service.ts` — existing service
- `packages/payment-core/src/settlement-release.ts` — the pure logic functions

Then check what endpoints already exist and what's missing. Add:

```
POST /settlement-releases/:orderId/buyer-confirm
  → buyerConfirmReceipt(release) → update DB → release product funds

POST /settlement-releases/:orderId/complete-buffer
  → completeBufferRelease(release) → update DB → release remaining funds

GET /settlement-releases/:orderId
  → get current release status (if not already exists)
```

### Flags
- Flag: Read existing files FULLY before adding — some of these may already exist.
- Flag: Import functions from @haggle/payment-core (buyerConfirmReceipt, completeBufferRelease, etc.)
- Flag: Use requireAuth on mutation endpoints.

### Definition of Done
- [ ] Buyer can confirm receipt → product release
- [ ] Buffer release endpoint for admin/cron
- [ ] Get release status endpoint

---

## Step 20 — API Integration Tests (supertest)

### Context
We have 830+ unit tests but 0 API route tests. Add supertest-based integration tests for the 3 critical flows: payment, shipment, dispute.

### Build Order

#### 1. Setup test infrastructure

Create `apps/api/src/__tests__/setup.ts`:
- Build a test Fastify app using createServer()
- Mock the database (use in-memory or mock the db parameter)
- Export the app for tests

#### 2. Test files

**`apps/api/src/__tests__/payments.test.ts`** (~10 tests):
- GET /payments/:id returns 404 for unknown
- POST /payments/prepare requires auth (401 without token)
- POST /payments/webhooks/x402 rejects missing signature
- POST /payments/webhooks/x402 processes settlement.confirmed
- POST /payments/webhooks/x402 handles unknown event type

**`apps/api/src/__tests__/disputes.test.ts`** (~10 tests):
- POST /disputes validates schema
- GET /disputes/:id returns 404
- POST /disputes/:id/escalate prevents T3+ escalation
- POST /disputes/deposits/expire returns count
- POST /disputes/:id/deposit rejects non-PENDING

**`apps/api/src/__tests__/shipments.test.ts`** (~8 tests):
- POST /shipments validates schema
- GET /shipments/:id returns 404
- POST /shipments/:id/event records event

### Flags
- Flag: The real challenge is mocking the database. Since all services take `db: Database`, we need either a mock DB or to use a real test database.
- Flag: For MVP, mock the service functions at the import level (vi.mock) rather than the full DB.
- Flag: Add `supertest` and `@types/supertest` to apps/api devDependencies.
- Flag: vitest can run these — add a test script to apps/api/package.json if not present.
- Flag: These tests verify route-level behavior (validation, auth, status codes), not business logic (already tested in core packages).

### Definition of Done
- [ ] Test setup with mock DB
- [ ] ~25+ integration tests across 3 files
- [ ] `pnpm --filter @haggle/api test` passes
- [ ] Tests verify auth, validation, status codes

---

## Execution Order
Step 18 + 19 in parallel (small, additive), then Step 20 (bigger).

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
