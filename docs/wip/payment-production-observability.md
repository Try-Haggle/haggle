# Payment Production Observability

Status: backend-neutral emitter implemented; alert backend wiring remains pending until the production observability platform is chosen.

This document defines the payment metrics and alert rules that can be implemented without provider credentials. The code-level allowlist lives in `apps/api/src/payments/observability.ts` and defaults to a no-op sink until a backend adapter is installed. Do not include PAN, CVV, card expiry, bank account data, Stripe client secrets, webhook signatures, authorization headers, x402 payload bodies, wallet tokens, or provider payment tokens in metric names, labels, logs, traces, or alert payloads.

## Safe Dimensions

Allowed dimensions:

- `provider`: `stripe`, `x402`
- `rail`: `stripe`, `x402`
- `environment`: `test`, `live`
- `operation`: `prepare`, `authorize`, `capture`, `settlement_pending`, `cancel`, `refund`, `fail`, `webhook`, `reconciliation`
- `event_type`: coarse provider event type only, never raw payload
- `failure_type`: allowlisted error class such as `signature_invalid`, `environment_mismatch`, `provider_timeout`, `state_transition_invalid`
- `idempotency_result`: `new`, `duplicate`, `conflict`, `in_progress`, `required_missing`
- `reconciliation_type`: allowlisted drift type from the reconciliation detector
- `status`: `pending`, `authorized`, `unknown`

Never use user IDs, emails, order IDs, payment intent IDs, provider references, transaction hashes, wallet addresses, webhook signatures, or raw error messages as metric labels. Those belong in redacted audit logs, not high-cardinality metrics.

## Metrics

| Metric | Type | Dimensions | Source |
| --- | --- | --- | --- |
| `payment.operation.started` | counter | `provider`, `rail`, `operation`, `environment` | Payment mutation entrypoints |
| `payment.operation.completed` | counter | `provider`, `rail`, `operation`, `environment` | Successful mutation/provider completion |
| `payment.operation.failed` | counter | `provider`, `rail`, `operation`, `environment`, `failure_type` | Safe failure responses and provider errors |
| `payment.operation.duration_ms` | histogram | `provider`, `rail`, `operation`, `environment` | Around provider and state mutation calls |
| `payment.idempotency.result` | counter | `operation`, `idempotency_result`, `environment` | Idempotency reservation/replay paths |
| `payment.webhook.received` | counter | `provider`, `event_type`, `environment` | After raw-body signature validation succeeds |
| `payment.webhook.rejected` | counter | `provider`, `failure_type`, `environment` | Signature, timestamp, malformed, wrong-environment rejection |
| `payment.webhook.duplicate` | counter | `provider`, `event_type`, `environment` | Processed provider event replay |
| `payment.webhook.processing_failed` | counter | `provider`, `event_type`, `failure_type`, `environment` | Handler failures before processed marker is stored |
| `payment.reconciliation.finding` | counter | `provider`, `reconciliation_type`, `environment` | Report-only reconciliation output |
| `payment.reconciliation.drift_open` | gauge | `provider`, `reconciliation_type`, `environment` | Current unresolved drift count |
| `payment.stuck.count` | gauge | `rail`, `status`, `environment` | Pending/authorized/unknown state age scan |
| `payment.refund.failed` | counter | `provider`, `rail`, `failure_type`, `environment` | Refund executor failures |
| `payment.admin_override` | counter | `operation`, `environment` | Audited admin state mutations |

## Alert Rules

Initial thresholds should be conservative and adjusted after sandbox traffic establishes a baseline.

| Alert | Severity | Rule |
| --- | --- | --- |
| `payment_webhook_rejection_spike` | page | `payment.webhook.rejected` > 5 in 10 minutes for one provider |
| `payment_webhook_processing_failure` | page | any `payment.webhook.processing_failed` for `live` |
| `payment_duplicate_webhook_spike` | ticket | `payment.webhook.duplicate` > 20 in 30 minutes for one provider |
| `payment_failure_rate_high` | page | `payment.operation.failed / payment.operation.started` > 5% over 15 minutes and at least 20 operations |
| `payment_stuck_authorized` | page | any `authorized` payment older than 30 minutes in `live` |
| `payment_stuck_pending` | ticket | any `pending` payment older than 2 hours in `live` |
| `payment_refund_failure` | page | any `payment.refund.failed` in `live` |
| `payment_reconciliation_critical_drift` | page | any critical reconciliation finding in `live` |
| `payment_reconciliation_warning_drift` | ticket | warning reconciliation findings remain open for 24 hours |
| `payment_admin_override` | ticket | any admin override in `live`; page if more than 3 in 1 hour |

## Runbook Links To Create Before Launch

- Provider sandbox webhook validation procedure.
- Manual reconciliation procedure with provider console screenshots.
- Admin refund/cancel/capture approval policy.
- Rollback procedure for disabling real rails through environment flags.
- Customer support scripts for pending, failed, captured, refunded, and disputed states.

## Current Keyless Implementation

- `apps/api/src/payments/observability.ts` validates metric names, dimensions, label values, and metric values before emission.
- The default sink is no-op, so local/test environments do not require Datadog, Prometheus, Sentry, or provider credentials.
- Payment routes emit backend-neutral metric events for direct mutation idempotency results, provider webhook received/rejected/duplicate/processing-failed outcomes, and production admin overrides.
- Unsafe labels are dropped without serializing the unsafe label value.
- Report-only job `payment-reconciliation-report` (env `ENABLE_PAYMENT_RECONCILIATION_REPORT_JOB`) emits `payment.reconciliation.finding` and `payment.reconciliation.drift_open` for local ledger drift; optional provider compare stays off unless snapshots exist.

## Remaining Backend Decision

The metric contract above is backend-neutral. Before production launch, choose the observability backend and wire the emitter sink to it. The implementation must keep the dimension allowlist in this document and continue using redacted audit logs for high-cardinality identifiers.
