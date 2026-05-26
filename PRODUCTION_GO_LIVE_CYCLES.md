# Production Go-Live Cycles

Last updated: 2026-05-12

## Scope

This backlog tracks backend, security, compliance, and operational readiness for the payment -> shipping -> dispute flow. UI/UX work is intentionally out of scope for these cycles.

Each cycle follows:

1. Design the smallest production-readiness slice.
2. Implement only work that does not require production credentials, destructive migrations, real charges, real labels, or provider account changes.
3. Review gaps with tests and static checks.
4. Convert remaining gaps into the next cycle.

## Cycle 1: Report-Only Reconciliation Guardrails

### Design

Provider sandbox verification is still blocked on provider credentials and account setup, so this cycle adds local report-only reconciliation utilities that can run against mocked or fetched provider snapshots later.

The first slice covers:

- payment/provider reconciliation already present in `packages/payment-core/src/production-readiness.ts`
- shipping/provider reconciliation drift detection
- dispute finalization financial side-effect drift detection

### Acceptance Criteria

- Detect provider/local shipment drift:
  - provider delivered but local not delivered
  - local terminal but provider not terminal
  - label purchased at provider but no local label/QR asset
  - label created for a non-fulfillable order
  - orphan provider shipment
  - return shipment state mismatch
- Detect dispute finalization drift:
  - buyer-favor resolution without completed refund
  - partial refund mismatch
  - seller-favor/no-action resolution without settlement release
  - resolved dispute attached to a non-terminal order
  - missing finalization marker
  - duplicate finalization attempts
  - return required before refund
- Findings must include severity, IDs, message, and recommended operator action.
- Tests must not call Stripe, x402, EasyPost, or live carrier systems.

### Files Affected

- `packages/shipping-core/src/production-readiness.ts`
- `packages/shipping-core/src/__tests__/production-readiness.test.ts`
- `packages/dispute-core/src/production-readiness.ts`
- `packages/dispute-core/src/__tests__/production-readiness.test.ts`
- `packages/dispute-core/src/index.ts`

### Review Result

Implemented and validated with focused unit tests:

- `@haggle/shipping-core` production-readiness tests
- `@haggle/dispute-core` production-readiness tests
- API production reconciliation report service test
- admin route wiring test for `POST /admin/reconciliation/report`

## Remaining Cycles

### Cycle 2: Admin/Job Reconciliation Entry Points

Status: partially implemented.

- Added a report-only admin route: `POST /admin/reconciliation/report`.
- The route is admin-gated and writes an audit summary with `reconciliation.report`.
- The route does not mutate payment, order, shipment, refund, or dispute state.
- Current input is explicit snapshot payloads. It does not yet collect provider snapshots directly.

- Add report-only API/job entry points that collect local snapshots and accept provider snapshots from injected adapters.
- Keep correction actions manual and audited.
- Do not auto-mutate payment, order, shipment, refund, or dispute state.

Remaining:

- Add DB local snapshot collectors.
- Add provider adapter interfaces for sandbox/provider state fetches.
- Add cron/report-only job wrapper.

### Cycle 3: Provider Sandbox E2E

- Stripe/x402 sandbox payment happy path and failure/recovery path.
- EasyPost test label/QR/tracking webhook path.
- Dispute refund/release/return path with mocked or sandbox provider adapters.

Requires human decision:

- sandbox credentials
- webhook test endpoint
- provider account/environment choices

### Cycle 4: Concurrency And Idempotency Stress

- Real DB transaction/lock tests for create payment, capture, refund, label purchase, webhook duplicate, and dispute finalization.
- Concurrent tab and retry simulations.

### Cycle 5: Operational Observability

- Metrics and alert names for failures, stuck states, duplicate webhooks, dead letters, and reconciliation drift.
- Alert routing and dashboards require the selected observability backend.

Requires human decision:

- metrics backend
- alert routing
- production incident escalation policy

### Cycle 6: Compliance And Policy Sign-Off

- PCI scope review.
- Shipping terms, prohibited items, insurance/liability, return policy.
- Dispute policy and reviewer/legal review.

Requires human/QSA/legal review before production launch.
