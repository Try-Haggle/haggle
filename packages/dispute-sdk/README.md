# @haggle/dispute-sdk

Server-side TypeScript SDK for platforms that want to use Haggle as a dispute resolution service.

Haggle owns reviewer assignment, review scoring, dispute policy, and settlement output generation. Your platform sends trusted transaction snapshots, opens or previews cases, receives typed case/cost responses, and can verify signed dispute webhooks with the SDK.

## Install

```bash
pnpm add @haggle/dispute-sdk
```

This package is intended for server runtimes only. Do not bundle it into browsers, mobile apps, widgets, or any client where your platform secret could be exposed.

## Quick Start

```ts
import { HaggleDisputeClient, type ModuleDisputeCaseInput } from "@haggle/dispute-sdk";

const disputes = new HaggleDisputeClient({
  baseUrl: "https://api.haggle.com",
  platformId: "platform_1",
  secret: process.env.HAGGLE_DISPUTE_SECRET!,
  timeoutMs: 10_000,
});

const input: ModuleDisputeCaseInput = {
  transaction: {
    platform_id: "platform_1",
    external_order_id: "order_123",
    buyer_actor_id: "buyer_1",
    seller_actor_id: "seller_1",
    amount_minor: 50000,
    currency: "USD",
    status: "DELIVERED",
  },
  request: {
    requester_actor_id: "buyer_1",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    summary: "Battery condition was materially different.",
    client_request_id: "order_123-dispute-open",
  },
};

const preview = await disputes.previewCase(input, {
  idempotencyKey: "preview:order_123",
});

const created = await disputes.createCase(input, {
  idempotencyKey: "open:order_123",
});

const escalation = await disputes.createEscalation(created.dispute.id, {
  external_order_id: "order_123",
  requester_actor_id: "buyer_1",
  reason: "Requesting panel review.",
}, {
  idempotencyKey: "escalate:order_123:t2",
});
```

## Integration Model

The SDK talks to Haggle's module API:

- `POST /modules/disputes/v1/cases/preview`
- `POST /modules/disputes/v1/cases`
- `POST /modules/disputes/v1/cases/:id/escalations/preview`
- `POST /modules/disputes/v1/cases/:id/escalations`
- `POST /modules/disputes/v1/cases/:id/status`

Your server is responsible for sending a trusted transaction snapshot. Haggle derives `opened_by` from `requester_actor_id`, `buyer_actor_id`, and `seller_actor_id`; callers do not submit role fields.

```ts
type ModuleDisputeCaseInput = {
  transaction: {
    platform_id: string;
    external_order_id: string;
    buyer_actor_id: string;
    seller_actor_id: string;
    amount_minor: number;
    currency: string;
    status: "APPROVED" | "PAYMENT_PENDING" | "PAID" | "FULFILLMENT_PENDING" |
      "FULFILLMENT_ACTIVE" | "DELIVERED" | "IN_DISPUTE" | "REFUNDED" |
      "CLOSED" | "CANCELED";
    metadata?: Record<string, unknown>;
  };
  request: {
    requester_actor_id: string;
    reason_code: DisputeReasonCode;
    summary: string;
    client_request_id?: string;
  };
};
```

## Authentication

Every request is signed with HMAC-SHA256. The SDK signs the exact JSON body it sends:

```text
<timestamp>.<method>.<path>.<sha256(rawBody)>
```

The SDK adds these headers:

- `x-haggle-module-platform-id`
- `x-haggle-module-timestamp`
- `x-haggle-module-signature`
- `x-haggle-idempotency-key`

Secrets shorter than 16 characters are rejected before a request is sent.

Before signing `previewCase` or `createCase`, the SDK validates that the transaction snapshot matches the configured platform, requester is a transaction party, amount/status/reason code are valid, and the body is JSON serializable. Validation failures throw `HaggleDisputeValidationError` before any request is sent.

## Transport Security

The client requires HTTPS by default:

```ts
new HaggleDisputeClient({
  baseUrl: "https://api.haggle.com",
  platformId: "platform_1",
  secret: process.env.HAGGLE_DISPUTE_SECRET!,
});
```

Plain HTTP is blocked unless you explicitly opt in:

```ts
new HaggleDisputeClient({
  baseUrl: "http://localhost:8787",
  platformId: "platform_1",
  secret: process.env.HAGGLE_DISPUTE_SECRET!,
  allowInsecureHttp: true,
});
```

Requests use `redirect: "error"` so signed headers are not forwarded through redirects. Requests also time out after `timeoutMs`, defaulting to 10 seconds.

`baseUrl` must be a clean API origin or base path. The SDK rejects URLs that include username/password credentials, query strings, or fragments.

Use `redactModuleHeaders` before logging signed headers:

```ts
import { redactModuleHeaders } from "@haggle/dispute-sdk";

const signed = disputes.buildSignedRequest("POST", "/modules/disputes/v1/cases", input, {
  idempotencyKey: "open:order_123",
});

console.log(redactModuleHeaders(signed.headers));
```

## Idempotency

Pass a stable idempotency key for each create workflow:

```ts
await disputes.createCase(input, {
  idempotencyKey: `open:${input.transaction.external_order_id}`,
});
```

Haggle scopes idempotency keys to your platform and binds each key to the canonical request body. Reusing the same key with a different body returns `IDEMPOTENCY_KEY_REUSED`.

## Error Handling

Local input validation failures throw `HaggleDisputeValidationError`, API failures throw `HaggleDisputeApiError`, and malformed success responses throw `HaggleDisputeResponseValidationError`:

```ts
import {
  HaggleDisputeApiError,
  HaggleDisputeResponseValidationError,
  HaggleDisputeValidationError,
} from "@haggle/dispute-sdk";

try {
  await disputes.createCase(input, { idempotencyKey: "open:order_123" });
} catch (error) {
  if (error instanceof HaggleDisputeValidationError) {
    console.error(error.issues);
    return;
  }

  if (error instanceof HaggleDisputeApiError) {
    console.error(error.status, error.code, error.requestId, error.body);
    return;
  }

  if (error instanceof HaggleDisputeResponseValidationError) {
    console.error(error.issues, error.body);
  }
}
```

Common errors:

- `MISSING_MODULE_AUTH`
- `INVALID_MODULE_SIGNATURE`
- `PLATFORM_MISMATCH`
- `ORDER_NOT_DISPUTABLE`
- `ACTIVE_MODULE_DISPUTE_EXISTS`
- `IDEMPOTENCY_KEY_REUSED`

## Money And Settlement

`previewCase` returns tiered dispute costs and the server-resolved revenue split summary:

```ts
const preview = await disputes.previewCase(input, { idempotencyKey: "preview:order_123" });

for (const cost of preview.costs) {
  console.log(cost.tier, cost.cost_cents, cost.reviewer_count);
}

console.log(preview.config.reviewer_share, preview.config.platform_share);
```

Haggle-owned systems handle reviewer assignment, reviewer payment policy, platform share policy, and final outcome generation. The SDK includes `SettlementInstruction` and webhook verification helpers for signed settlement outputs.

Escalation helpers keep Tier 2/3 calls signed and typed:

```ts
const preview = await disputes.previewEscalation(created.dispute.id, {
  external_order_id: "order_123",
  requester_actor_id: "buyer_1",
}, {
  idempotencyKey: "preview-escalate:order_123:t2",
});

const escalation = await disputes.createEscalation(created.dispute.id, {
  external_order_id: "order_123",
  requester_actor_id: "buyer_1",
  to_tier: 2,
}, {
  idempotencyKey: "escalate:order_123:t2",
});

const status = await disputes.getCaseStatus(created.dispute.id, {
  external_order_id: "order_123",
}, {
  idempotencyKey: "status:order_123",
});
```

The platform still cannot choose reviewer identity, reviewer count, vote weight, final outcome, or settlement amounts.

## Webhook Verification

When Haggle sends dispute status or settlement webhooks, verify the raw body before using the payload:

```ts
import {
  validateSettlementInstructionWebhookData,
  validateSettlementInstruction,
  verifyDisputeWebhook,
  type SettlementInstructionWebhookData,
} from "@haggle/dispute-sdk";

const event = verifyDisputeWebhook<SettlementInstructionWebhookData>({
  rawBody,
  secret: process.env.HAGGLE_DISPUTE_WEBHOOK_SECRET!,
  timestamp: req.headers["x-haggle-webhook-timestamp"],
  signature: req.headers["x-haggle-webhook-signature"],
  eventId: req.headers["x-haggle-webhook-id"],
  platformId: "platform_1",
});

if (event.type === "dispute.settlement.instruction") {
  const issues = validateSettlementInstructionWebhookData(event.data, {
    disputeId: event.dispute_id,
  });
  if (issues.length > 0) throw new Error("Invalid settlement instruction");

  const instruction = event.data.settlement_instruction;
  if (instruction.action === "refund_buyer") {
    // Apply refund in your own payment ledger.
  }
}
```

Use the exact raw HTTP body for verification. Re-serialized JSON will not match the signature.

## Advanced

Use `buildSignedRequest` when you need to send requests through your own HTTP stack:

```ts
const signed = disputes.buildSignedRequest(
  "POST",
  "/modules/disputes/v1/cases",
  input,
  { idempotencyKey: "open:order_123" },
);

await customHttpClient.post("/modules/disputes/v1/cases", signed.body, {
  headers: signed.headers,
});
```

See [docs/integration-guide.md](./docs/integration-guide.md) for a more detailed implementation checklist.
