# Fake Money + Fake Address E2E Test Plan

Date: 2026-06-30

## Purpose

Stage 1 validates Haggle's state flow without real money movement or real carrier delivery. Shipping should still use the real EasyPost test API whenever `EASYPOST_API_KEY` is configured, so rate, shipment preparation, and label creation exercise the same provider boundary used later.

This is not a launch readiness test. It is the first closed loop for the team before real-money or real-address rehearsals.

## Stage 1 Scope

Happy path:

```text
Fake negotiated agreement
-> settlement approval
-> mock/test payment intent
-> settled payment
-> test contract ledger funded
-> fake buyer address saved
-> EasyPost test rate and label
-> manual test shipment events
-> delivered state
-> buyer receipt confirmation
-> product release state
```

Level 1 dispute path:

```text
Fake negotiated agreement
-> settlement approval
-> mock/test payment intent
-> settled payment
-> test contract ledger funded
-> fake buyer address saved
-> EasyPost test rate and label
-> manual test shipment events
-> delivered state
-> buyer review phase
-> buyer opens a level 1 dispute
-> test contract ledger locks the settlement
-> order locked as IN_DISPUTE
-> DeepSeek L1 decision
-> admin dispute resolution
-> test contract ledger records refund/release effect
```

## Required Inputs

| Input | Stage 1 value |
| --- | --- |
| Money | mock or testnet only |
| Buyer/seller users | local UUID-shaped test users |
| Address | EasyPost-safe test addresses |
| Parcel | fixed test parcel dimensions and weight |
| Carrier | EasyPost test API key through Haggle API |
| Label | test label only |
| Tracking | manual local events or EasyPost test tracker |
| Contract | Haggle API in-memory test contract ledger |

## Test Contract Simulator

Stage 1 uses a Haggle API in-memory ledger to simulate the contract money gate. This is not a blockchain transaction and does not prove wallet balances. It exists so the team can verify the product invariant before real contract rehearsal:

```text
fund(order, payment intent, amount)
-> lock dispute(order, dispute id)
-> resolve(order, AI/admin outcome)
-> visible money effect: buyer refund, seller release, partial refund, or manual escalation
```

The simulator is intentionally narrow. It should only answer whether the app flow funded before fulfillment, blocked release after dispute, and produced a final refund/release direction after resolution. Real token custody, signatures, relayer behavior, and chain reconciliation belong to the later real-money test stage.

## Success Criteria

- Payment reaches a settled or equivalent test state.
- A commerce order exists and remains tied to the payment intent.
- A settlement release record exists for the order.
- A shipment exists for the same order.
- The shipment reaches `DELIVERED`.
- Delivery starts the buyer review phase.
- Buyer confirmation moves product release to `RELEASED`.
- In the dispute path, buyer confirmation is skipped and the order moves to `IN_DISPUTE`.
- In the dispute path, the dispute opens as `OPEN` with tier `1`.
- The response log shows which steps are Haggle-only and which call EasyPost.

## Stage 1 Test Run Checks

The dashboard now treats a test run as more than a sequence of successful HTTP calls. Each run should produce a visible PASS/WARN/FAIL report for these eight checks:

1. API sequence completion: every expected Haggle API step returns a successful response.
2. Fake payment and order linkage: settlement approval, payment intent, commerce order, and release gate can be traced together.
2-1. Test contract escrow: the simulated contract ledger is funded for the same order before shipping/dispute resolution.
3. EasyPost test shipping: rate, shipment preparation, label purchase, and label/QR availability are visible through Haggle's API boundary.
4. Sequential shipment state: manual test events move the shipment into delivered or buyer-review-ready state before dispute or release.
5. L1 dispute and order lock: dispute creation returns a tier 1 dispute and the order is no longer releasable by buyer confirmation.
6. DeepSeek L1 decision: AI assessment returns a machine outcome plus an operator-readable judgment document.
7. Resolution money effect: applying the AI resolution returns an explicit refund/release direction and the test contract ledger records the same final money effect.
8. Retry and idempotency guards: duplicate dispute open and buyer confirm during dispute are rejected or idempotently mapped to the existing dispute.

Warnings are acceptable in Stage 1 only when the missing item is intentionally manual, such as camera capture evidence. Failures mean the team should not use the run as evidence that the fake-money/fake-address loop is ready.

Implementation notes:

- The AI judge step is retried in the dashboard because a real LLM provider can occasionally return an output that fails schema or platform validation.
- Buyer confirmation is blocked by active dispute lookup as well as order status. This protects the release path even if order status propagation lags behind dispute creation.
- The duplicate dispute guard accepts either an idempotent replay of the existing dispute or a conflict response that prevents a second active dispute.

## Known Gaps Before Stage 2

- Product release and weight buffer release are separate. Stage 1 only requires product release; buffer/contract split remains a later readiness check.
- QR label form is optional and should not be a pass/fail condition.
- EasyPost test labels prove API integration but do not prove a real carrier will accept a package.
- Payment provider reconciliation and real wallet balances are not proven in this stage.
- Shipping price deltas are only visible as data; real buyer refund/seller deduction policy is not executed here.

## Dashboard Entry Point

Use `docs/tools/payment-fulfillment-test-console.html`, Shipping tab.

- `Run Fake E2E` validates the happy path through buyer confirmation.
- `Run L1 Dispute` validates the dispute path through `OPEN / T1` and `IN_DISPUTE`.
- `Run Dispute + AI` validates L1 dispute creation, seeded buyer/seller evidence, DeepSeek adjudication, and lock/idempotency guards.
- `Run AI + Resolve` validates the same flow plus the admin resolution endpoint and the visible refund/release effect in the test contract ledger.
- The Dispute tab shows `결제 · 배송 · 분쟁 테스트 런 리포트`, which records the latest PASS/WARN/FAIL checks in localStorage for operator review.

The button must call existing API routes instead of implementing separate business rules in the dashboard. The dashboard is an operator surface, not a payment or shipping rules engine. Shipping requests must go to Haggle's local API and let the API call EasyPost; do not switch this flow to the legacy local EasyPost proxy or mock carrier path.
