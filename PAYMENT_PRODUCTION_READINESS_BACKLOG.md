# Payment Production Readiness Backlog

Last updated: 2026-05-11

## Current Architecture Summary

- API routes live mainly in `apps/api/src/routes/payments.ts`.
- Core payment domain logic lives in `packages/payment-core/src`.
- Persistent payment tables are defined in `packages/db/src/schema/payments.ts`.
- Supported rails are `x402` and `stripe`.
- Stripe is currently modeled as Crypto Onramp for fiat/card-to-USDC, not as a direct merchant card capture flow.
- x402 and conditional settlement paths use provider callbacks, on-chain receipts, and local payment intent updates.
- Existing DB states are `CREATED`, `QUOTED`, `AUTHORIZED`, `SETTLEMENT_PENDING`, `SETTLED`, `FAILED`, and `CANCELED`.
- Provider event idempotency is stored in `webhook_idempotency` through `packages/db/src/schema/webhook-idempotency.ts`.
- Ownership is enforced through `requirePaymentOwner`, `requireOrderOwner`, and related middleware in `apps/api/src/middleware/ownership.ts`.
- Current code should not touch raw PAN, CVV, or card expiry directly. Stripe card collection is provider-hosted/tokenized through Onramp client secrets. The app does touch wallet addresses, Stripe Onramp session IDs/client secrets, provider event IDs, provider references, and x402 payment payload metadata.

## PCI Scope Assumptions

- Haggle should stay out of raw card data scope: no PAN, CVV, or card expiry should be accepted by API schemas, logged, persisted, sent to analytics, or stored in browser storage.
- Stripe-hosted/tokenized Onramp is the expected card entry point. The frontend may receive a Stripe `client_secret` because Stripe requires it for hosted/embedded checkout, but it must be treated as a short-lived payment token and never logged or stored in `localStorage`.
- x402 payloads and wallet addresses are payment-sensitive even when not PCI cardholder data.
- Human compliance review is still required before launch, including PCI SAQ applicability, Stripe Onramp terms, money transmission/escrow analysis, refund operations, and a QSA/legal review of whether the product flow creates custody or stored-value obligations.

## Discovered Risks Ordered By Severity

### P0: Operational State Model Does Not Match Required Production States

- Risk: Required states are `pending`, `authorized`, `captured`, `canceled`, `refunded`, `partially_refunded`, `failed`, `disputed`, and `expired`, but persisted states currently use a legacy uppercase model with no explicit `refunded`, `partially_refunded`, `disputed`, or `expired`.
- Acceptance criteria:
  - A canonical production state machine exists and rejects impossible transitions.
  - DB migration plan maps legacy states to canonical states.
  - Existing APIs never let clients force final success.
  - Human-approved migration plan exists before changing production tables.
- Files likely affected:
  - `packages/payment-core/src/state-machine.ts`
  - `packages/payment-core/src/types.ts`
  - `packages/db/src/schema/payments.ts`
  - `apps/api/src/routes/payments.ts`
  - `apps/api/src/jobs/payment-intent-expiry.ts`
- Requires decision before proceeding:
  - Whether to migrate DB status enum values directly or add a new canonical status column first.

### P0: Admin Capture/Cancel/Refund Semantics Need Explicit Protection And Audit

- Risk: Direct mutation endpoints exist for authorize, settlement-pending, settle, fail, cancel, and refund. They are guarded in production for non-admins, but admin-only operational intent, audit records, and reason capture are not consistently modeled.
- Acceptance criteria:
  - Admin-only operations require admin auth, reason, and correlation ID.
  - Audit event is emitted with actor, payment/order IDs, previous state, next state, reason, provider event ID when applicable, timestamp, and request ID.
  - Buyer routes cannot act as final provider truth.
- Files likely affected:
  - `apps/api/src/routes/payments.ts`
  - `apps/api/src/routes/admin.ts`
  - `apps/api/src/services/admin-action-log.service.ts`
  - `packages/db/src/schema/admin-ops.ts`
- Requires decision before proceeding:
  - Which admin roles may perform refund/cancel/capture and whether dual approval is needed.

### P0: Webhook Replay/Ordering Guarantees Are Partial

- Risk: x402 and Stripe event IDs are stored after successful processing, but out-of-order events are mostly handled by local state transitions rather than provider reconciliation. x402 signature has no timestamp freshness header in the current helper.
- Acceptance criteria:
  - Webhook signatures use raw body.
  - Unsigned, expired, malformed, wrong-environment, and replayed events are rejected or ignored idempotently.
  - Out-of-order event handling reconciles against provider state before local correction.
- Files likely affected:
  - `apps/api/src/routes/payments.ts`
  - `apps/api/src/payments/stripe-onramp.ts`
  - `apps/api/src/payments/facilitator-client.ts`
  - `packages/db/src/schema/webhook-idempotency.ts`
- Requires decision before proceeding:
  - x402 provider header contract for timestamp, environment, and event IDs.

### P1: Idempotency Is Present But Not Uniform

- Risk: `/payments/prepare`, quote retry, settlement retry, and webhooks have idempotency behavior, but authorize/capture/cancel/refund/direct mutation idempotency keys are not uniformly accepted and persisted.
- Acceptance criteria:
  - Create payment, authorize, capture, cancel, refund, and webhook processing all accept deterministic idempotency keys or derive safe keys.
  - Duplicate request bodies return the prior result.
  - Conflicting duplicate keys are rejected.
  - DB constraints or transactional locking prevent double capture, double refund, and duplicate fulfillment.
- Files likely affected:
  - `apps/api/src/routes/payments.ts`
  - `apps/api/src/services/payment-record.service.ts`
  - `packages/db/src/schema/payments.ts`
  - `packages/db/drizzle/*`
- Requires decision before proceeding:
  - Whether to add a generic `payment_idempotency_keys` table.

### P1: Sensitive Payment Data Redaction Needs A Shared Guard

- Risk: Code avoids printing secrets in many paths, but there is no shared redaction helper for provider errors, webhook payloads, payment tokens, or client secrets. Some `console.error` calls could serialize provider errors.
- Acceptance criteria:
  - Shared sanitizer redacts PAN-like keys, CVV, card expiry, bank account fields, `client_secret`, tokens, signatures, authorization headers, and provider payment method IDs.
  - Errors returned to clients are generic.
  - Analytics/browser storage policy is documented.
- Files likely affected:
  - `packages/payment-core/src`
  - `apps/api/src/routes/payments.ts`
  - `apps/web/src`
- Requires decision before proceeding:
  - Logging backend and alerting vendor field allowlist.

### P1: Reconciliation Path Is Missing As An Operational Workflow

- Risk: There is no complete job or admin workflow comparing local state with provider state and reporting drift.
- Acceptance criteria:
  - Reconciliation detects locally paid/provider-not-captured, provider-captured/local-unpaid, refund mismatch, and orphan provider payment.
  - Output includes actionable payment/order IDs and recommended operator action.
  - Corrections require audit logging.
- Files likely affected:
  - `apps/api/src/jobs`
  - `apps/api/src/routes/admin.ts`
  - `packages/payment-core/src`
- Requires decision before proceeding:
  - Provider APIs available for sandbox and production reconciliation.

### P1: Retry/Unknown Response Behavior Needs Central Policy

- Risk: Provider timeout/unknown responses must not become success or trigger duplicate charges. Retry classification is not centralized.
- Acceptance criteria:
  - Retryable and non-retryable provider errors are classified centrally.
  - Bounded exponential backoff exists.
  - Unknown outcomes are marked pending/reconciliation-needed, never captured locally.
- Files likely affected:
  - `apps/api/src/payments/*`
  - `packages/payment-core/src`
- Requires decision before proceeding:
  - Maximum retry count and alert thresholds per provider.

### P2: Metrics And Alerts Are Not Fully Defined

- Risk: Payment failures, webhook failures, duplicate webhooks, stuck payments, refund failures, and reconciliation drift need metric names and alert thresholds.
- Acceptance criteria:
  - Metric names and dimensions are documented.
  - Alerts are wired in the chosen observability system.
  - Sensitive data is excluded from dimensions.
- Files likely affected:
  - `apps/api/src/routes/payments.ts`
  - `apps/api/src/jobs/*`
  - observability configuration outside this repo
- Requires decision before proceeding:
  - Metrics backend and alert routing.

## Test Plan

- Unit:
  - Production state machine allows only valid transitions.
  - Impossible transitions fail: capture after cancellation, refund before capture, duplicate capture, client-forced success.
  - Idempotency helper behavior for duplicate and conflicting requests.
  - Sensitive payment fields are redacted recursively.
  - Provider errors are classified retryable/non-retryable.
  - Reconciliation mismatches are detected.
- Integration:
  - Stripe webhook signature validation with valid, missing, malformed, and expired signatures.
  - Duplicate x402 and Stripe events are idempotent.
  - Out-of-order events do not blindly overwrite safer local state.
  - Cross-user payment/order access returns 403.
- E2E:
  - Happy path using mocks/sandbox only: prepare, quote, authorize/provider confirmation, captured, fulfillment created.
  - Failure/recovery path using mocks/sandbox only: provider timeout or missing settlement record, then reconciliation/manual correction.

## Rollout, Monitoring, Rollback, And Manual Reconciliation

- Required environment variables, without printing values:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_MODE`
  - `HAGGLE_X402_MODE`
  - `HAGGLE_X402_WEBHOOK_SECRET`
  - `HAGGLE_X402_NETWORK`
  - `HAGGLE_X402_USDC_ASSET_ADDRESS`
  - `HAGGLE_X402_FACILITATOR_URL`
  - `HAGGLE_X402_API_KEY_ID`
  - `HAGGLE_X402_API_KEY_SECRET`
  - `HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS`
  - `HAGGLE_BASE_RPC_URL`
- Rollout steps:
  - Deploy code in sandbox/test mode first.
  - Run unit/integration/E2E mock tests.
  - Validate webhook signatures in provider sandbox.
  - Enable metrics and alert dashboards.
  - Run reconciliation in report-only mode.
  - Human review signs off before production credentials or webhook endpoint changes.
- Monitoring checklist:
  - Payment failure rate.
  - Webhook failure rate.
  - Duplicate webhook count.
  - Stuck pending/authorized/unknown payments.
  - Refund failure count.
  - Reconciliation drift count.
  - Admin override count.
- Rollback plan:
  - Disable real rails through environment flags.
  - Revert to mock/sandbox-only flows.
  - Pause direct admin capture/refund actions.
  - Keep webhook handlers acknowledging duplicates only if needed to avoid provider retry storms.
- Manual reconciliation procedure:
  - Identify affected payment/order IDs.
  - Query provider state in sandbox or production provider console.
  - Compare local intent, authorization, settlement, refund, and order state.
  - Record mismatch, reason, provider reference, and operator.
  - Apply correction only through audited admin tooling.
  - Verify post-correction fulfillment/refund state and alert resolution.

## Implement Now Without Production Credentials Or Destructive Changes

- Add canonical production state machine utilities without changing persisted DB enums.
- Add recursive sensitive payment data redaction helper.
- Add provider error retry classification and bounded backoff helper.
- Add reconciliation mismatch detector for future job/admin use.
- Harden Stripe webhook signature verification with timestamp freshness checks.
- Add focused unit tests for the new safe utilities and webhook signature expiry.

