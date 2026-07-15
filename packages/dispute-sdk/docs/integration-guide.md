# Haggle Dispute SDK Integration Guide

This guide is for platform backend engineers integrating Haggle disputes as a service.

## 1. Integration Boundary

Run the SDK only from your backend. Your backend should:

- authenticate your own users;
- load trusted transaction state from your database;
- translate that state into `ModuleDisputeCaseInput`;
- call Haggle with your platform secret;
- store returned Haggle dispute ids next to your platform order ids.

Do not let browsers or mobile clients call Haggle module APIs directly.

For production, use an HTTPS Haggle endpoint. The SDK rejects plain HTTP unless `allowInsecureHttp: true` is set for local development.

The SDK also rejects malformed dispute inputs before signing. Treat `HaggleDisputeValidationError` as an integration bug or stale local order snapshot, not as a user-facing Haggle policy decision.

## 2. Required Platform Data

Each dispute request needs a trusted transaction snapshot:

| Field | Source | Notes |
| --- | --- | --- |
| `platform_id` | Haggle platform registry | Must match the signed platform id. |
| `external_order_id` | Your order database | Stable id visible to your backend. |
| `buyer_actor_id` | Your identity system | Stable buyer actor id. |
| `seller_actor_id` | Your identity system | Stable seller actor id. |
| `amount_minor` | Your ledger/order system | Minor currency units, for example cents. |
| `currency` | Your ledger/order system | ISO-like currency code such as `USD`. |
| `status` | Your order state machine | Must be disputable under your Haggle platform policy. |
| `metadata` | Optional backend context | Keep this compact and non-sensitive. |

The requester is supplied separately:

| Field | Source | Notes |
| --- | --- | --- |
| `requester_actor_id` | Your authenticated user/session | Haggle derives buyer/seller role from this. |
| `reason_code` | Your dispute UI/workflow | Must be a supported Haggle reason code. |
| `summary` | User or support workflow | Human-readable opening evidence. |
| `client_request_id` | Optional platform workflow id | Useful for your logs, not the HMAC idempotency key. |

## 3. Preview Before Create

Use `previewCase` to show costs and confirm role derivation before opening a case:

```ts
const preview = await disputes.previewCase(input, {
  idempotencyKey: `preview:${input.transaction.external_order_id}`,
});
```

Preview does not create a case. It still requires a valid idempotency key so your integration uses one contract from the start.

## 4. Create A Case

Use a stable idempotency key tied to your platform workflow:

```ts
const created = await disputes.createCase(input, {
  idempotencyKey: `open:${input.transaction.external_order_id}`,
});
```

On success, persist:

- `created.dispute.id`
- `created.dispute.status`
- `created.platform_id`
- `created.external_order_id`
- `created.idempotency_key`
- `created.idempotent`

If `idempotent` is `true`, the case already existed and the response is a replay of the original successful create request.

## 5. Escalate And Track Tiers

Use escalation helpers for Tier 2/3 movement. Haggle computes tier cost, reviewer count, and seller deposit requirement; your platform only supplies the dispute id, external order id, and requesting actor.

```ts
const preview = await disputes.previewEscalation(created.dispute.id, {
  external_order_id: created.external_order_id,
  requester_actor_id: "buyer_1",
}, {
  idempotencyKey: `preview-escalate:${created.external_order_id}:t2`,
});

const escalation = await disputes.createEscalation(created.dispute.id, {
  external_order_id: created.external_order_id,
  requester_actor_id: "buyer_1",
  to_tier: preview.new_tier,
}, {
  idempotencyKey: `escalate:${created.external_order_id}:t${preview.new_tier}`,
});

const status = await disputes.getCaseStatus(created.dispute.id, {
  external_order_id: created.external_order_id,
}, {
  idempotencyKey: `status:${created.external_order_id}`,
});
```

Persist the returned tier, current tier cost, seller deposit requirement, and case status in your backend if your UI needs to show progress.

## 6. Idempotency Rules

Haggle binds each idempotency key to:

- your `platform_id`;
- the canonical request fingerprint;
- the resulting Haggle dispute id.

Expected outcomes:

| Situation | Result |
| --- | --- |
| Same key, same request body | Original case is returned with `idempotent: true`. |
| Same key, different request body | `IDEMPOTENCY_KEY_REUSED`. |
| Different key, same active platform order | `ACTIVE_MODULE_DISPUTE_EXISTS`. |
| Retry after network timeout | Use the same key and same body. |

Use separate keys for separate workflows, for example `open:order_123`, `escalate:order_123:t2`, and `status:order_123`.

## 7. Error Handling

Catch `HaggleDisputeValidationError` for local SDK validation failures, `HaggleDisputeApiError` for Haggle API responses, and `HaggleDisputeResponseValidationError` when a successful response does not match the request context:

```ts
import {
  HaggleDisputeApiError,
  HaggleDisputeResponseValidationError,
  HaggleDisputeValidationError,
} from "@haggle/dispute-sdk";

const idempotencyKey = `open:${input.transaction.external_order_id}`;

try {
  await disputes.createCase(input, { idempotencyKey });
} catch (error) {
  if (error instanceof HaggleDisputeValidationError) {
    // Fix the local transaction snapshot or integration mapping before retrying.
    console.error(error.issues);
    return;
  }

  if (error instanceof HaggleDisputeResponseValidationError) {
    // Treat as a protocol/integration incident. Preserve request id logs if available.
    console.error(error.issues, error.body);
    return;
  }

  if (error instanceof HaggleDisputeApiError) {
    switch (error.code) {
      case "IDEMPOTENCY_KEY_REUSED":
        // Alert or mark the workflow as invalid. Do not retry with mutated body.
        break;
      case "ACTIVE_MODULE_DISPUTE_EXISTS":
        // Surface existing-dispute state in your product.
        break;
      case "ORDER_NOT_DISPUTABLE":
        // Refresh local order state and block the dispute open action.
        break;
      default:
        // Retry only if your job policy treats the status as transient.
        break;
    }
  }
}
```

## 8. Reviewer And Money Boundary

Haggle controls:

- reviewer pool selection;
- reviewer scoring and aggregation;
- reviewer payout policy;
- platform/reviewer split policy;
- final settlement instruction generation.

Your platform controls:

- your own user authentication;
- source-of-truth order state;
- user-facing dispute entry points;
- applying final settlement instructions to your own payment/ledger system.

The SDK exposes `SettlementInstructionWebhookData` and signed webhook verification helpers. Do not infer final money movement from `previewCase` or escalation responses; those are only cost and policy summaries.

## 9. Operational Checklist

- Store the platform secret in a server-side secret manager.
- Rotate secrets by platform, not globally. During rotation, Haggle can accept both `current` and temporary `previous` secrets; deploy SDK clients with the new current secret, then remove the old secret after retry queues have drained.
- Log `external_order_id`, Haggle dispute id, idempotency key, and Haggle request id.
- Never log the platform secret or full HMAC signature; use `redactModuleHeaders` if signed headers must appear in diagnostics.
- Keep the SDK default redirect behavior. Redirects are treated as errors so signed headers are not forwarded to another host.
- Set `timeoutMs` to match your job retry policy. The default is 10 seconds.
- Keep `baseUrl` clean. Do not put credentials, query strings, or fragments in the API URL.
- Register only public HTTPS webhook URLs with Haggle. Localhost, private network, link-local, metadata-service, and reserved IP targets are rejected by default.
- Use deterministic idempotency keys for retryable jobs.
- Keep metadata compact and avoid payment credentials, addresses, private messages, or authentication documents.
- Treat `platform_id` mismatch as an integration bug.

### Secret Rotation

The SDK signs each request with one secret. When rotating:

1. Ask Haggle to register the new secret as `current` while keeping the old one as `previous`.
2. Deploy your backend with the new SDK secret.
3. Keep retrying timed-out requests with their original idempotency keys and unchanged bodies.
4. After old workers and retry queues have drained, ask Haggle to remove the previous secret.

Do not rotate by changing `platform_id`; idempotency and dispute ownership are scoped to the existing platform id.

## 10. Webhook Receiving

Use `verifyDisputeWebhook` on the exact raw HTTP body before parsing or applying any dispute output:

```ts
import { verifyDisputeWebhook } from "@haggle/dispute-sdk";

const event = verifyDisputeWebhook({
  rawBody,
  secret: process.env.HAGGLE_DISPUTE_WEBHOOK_SECRET!,
  timestamp: req.headers["x-haggle-webhook-timestamp"],
  signature: req.headers["x-haggle-webhook-signature"],
  eventId: req.headers["x-haggle-webhook-id"],
  platformId: "platform_1",
});
```

For settlement instructions, validate the nested instruction payload before applying it:

```ts
import {
  validateSettlementInstructionWebhookData,
  type SettlementInstructionWebhookData,
} from "@haggle/dispute-sdk";

if (event.type === "dispute.settlement.instruction") {
  const data = event.data as SettlementInstructionWebhookData;
  const issues = validateSettlementInstructionWebhookData(data, {
    disputeId: event.dispute_id,
  });
  if (issues.length > 0) {
    throw new Error("Invalid settlement instruction");
  }

  if (data.settlement_instruction.action === "refund_buyer") {
    // Apply refund in your own payment/ledger system.
  }
}
```

Do not apply settlement instructions from unsigned, stale, mismatched, or malformed webhook events.

## 11. Manual Signing

For custom HTTP clients, build a signed request without sending it:

```ts
const signed = disputes.buildSignedRequest(
  "POST",
  "/modules/disputes/v1/cases",
  input,
  { idempotencyKey: `open:${input.transaction.external_order_id}` },
);
```

The generated `body` string is the exact body used for HMAC signing. Send that exact string as the HTTP request body.
