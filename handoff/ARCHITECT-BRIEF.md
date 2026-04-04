# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 15 — x402 Webhook Event Processing

### Context
`POST /payments/webhooks/x402` currently validates the signature then echoes the payload. It needs to process events and update payment state.

### What x402 Facilitator Sends
The x402 facilitator (Coinbase CDP) sends webhook callbacks for:
- `settlement.confirmed` — on-chain settlement verified
- `settlement.failed` — settlement failed
- `payment.expired` — payment authorization expired

### Build Order

#### 1. Add webhook event processing to `apps/api/src/routes/payments.ts`

Replace the x402 webhook stub (lines ~536-549) with:

```ts
app.post("/payments/webhooks/x402", async (request, reply) => {
  try {
    requireWebhookSignature(request.headers as Record<string, unknown>, "x402");
  } catch (error) {
    return reply.code(400).send({ error: "INVALID_X402_WEBHOOK", message: ... });
  }

  const body = request.body as { event_type?: string; payment_intent_id?: string; [key: string]: unknown };
  const eventType = body.event_type;
  const paymentIntentId = body.payment_intent_id;

  if (!eventType || !paymentIntentId) {
    return reply.code(400).send({ error: "MISSING_WEBHOOK_FIELDS" });
  }

  const intent = await getPaymentIntentById(db, paymentIntentId);
  if (!intent) {
    // Ignore events for unknown intents (idempotent)
    return reply.send({ accepted: true, action: "ignored", reason: "unknown_intent" });
  }

  try {
    switch (eventType) {
      case "settlement.confirmed": {
        // If not already settled, settle now
        if (intent.status !== "SETTLED") {
          const result = await service.settleIntent(intent);
          await updateStoredPaymentIntent(db, result.intent, result.metadata);
          if (result.value) {
            await createPaymentSettlementRecord(db, result.value);
          }
          // Trust triggers
          if (result.trust_triggers.length > 0) {
            await applyTrustTriggers(db, {
              order_id: result.intent.order_id,
              buyer_id: result.intent.buyer_id,
              seller_id: result.intent.seller_id,
              triggers: result.trust_triggers,
            });
          }
        }
        return reply.send({ accepted: true, action: "settled" });
      }

      case "settlement.failed": {
        if (intent.status !== "FAILED" && intent.status !== "SETTLED") {
          const result = service.failIntent(intent);
          await updateStoredPaymentIntent(db, result.intent);
          if (result.trust_triggers.length > 0) {
            await applyTrustTriggers(db, {
              order_id: result.intent.order_id,
              buyer_id: result.intent.buyer_id,
              seller_id: result.intent.seller_id,
              triggers: result.trust_triggers,
            });
          }
        }
        return reply.send({ accepted: true, action: "failed" });
      }

      case "payment.expired": {
        if (intent.status !== "CANCELED" && intent.status !== "SETTLED") {
          const result = service.cancelIntent(intent);
          await updateStoredPaymentIntent(db, result.intent);
        }
        return reply.send({ accepted: true, action: "expired" });
      }

      default:
        return reply.send({ accepted: true, action: "ignored", reason: "unknown_event" });
    }
  } catch (error) {
    // Log but don't fail — webhooks must return 200 to avoid retries
    console.error("Webhook processing error:", error);
    return reply.send({ accepted: true, action: "error", message: String(error) });
  }
});
```

### Flags
- Flag: Webhooks MUST return 200 (or reply.send) even on processing errors. Otherwise the facilitator retries.
- Flag: Idempotent — if already settled/failed, skip the action.
- Flag: The `service` variable is already available in the closure (created at line ~189).
- Flag: Import `createPaymentSettlementRecord` if not already imported at the top.
- Flag: Do NOT change the Stripe webhook — leave it as stub.
- Flag: No auth required on webhook endpoints (they use signature verification instead).

### Definition of Done
- [ ] x402 webhook processes settlement.confirmed, settlement.failed, payment.expired
- [ ] Idempotent (no double-settle)
- [ ] Always returns 200
- [ ] Trust triggers fired on settle/fail

---

## Step 16 — Dispute Escalation (T1→T2→T3 + Deposit)

### Context
Disputes can currently be opened and resolved, but there's no escalation flow. The dispute-core package has tier-based costs (T1/T2/T3) and deposit logic. This step adds:
- `POST /disputes/:id/escalate` — escalate to next tier
- Auto-create deposit requirement on T2/T3 escalation
- Deposit deadline enforcement

### Build Order

#### 1. Check what dispute-core exports for escalation

Read `packages/dispute-core/src/index.ts` to find:
- `computeDisputeCost` or similar — tier-based cost calculation
- `createDepositRequirement` — deposit amount for T2/T3
- Any escalation-related functions

#### 2. Add `POST /disputes/:id/escalate` to `apps/api/src/routes/disputes.ts`

```ts
const escalateSchema = z.object({
  escalated_by: z.enum(["buyer", "seller", "system"]),
  reason: z.string().optional(),
});

app.post<{ Params: { id: string } }>("/disputes/:id/escalate", async (request, reply) => {
  const { id } = request.params;
  const parsed = escalateSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "INVALID_ESCALATE_REQUEST", issues: parsed.error.issues });
  }

  const dispute = await getDisputeById(db, id);
  if (!dispute) {
    return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
  }

  // Determine current tier from metadata or default to T1
  const currentTier = (dispute.metadata as any)?.tier ?? 1;
  if (currentTier >= 3) {
    return reply.code(400).send({ error: "MAX_TIER_REACHED", message: "Cannot escalate beyond T3" });
  }

  const nextTier = currentTier + 1;

  // Compute cost for next tier using dispute-core
  // Import computeDisputeCost (or equivalent)
  const amount = dispute.refundAmountMinor 
    ? parseInt(String(dispute.refundAmountMinor)) 
    : 0;
  const cost = computeDisputeCost(nextTier, amount);

  // Update dispute metadata with new tier
  await updateDisputeRecord(db, {
    ...dispute,
    metadata: { ...(dispute.metadata as Record<string, unknown>), tier: nextTier, escalated_by: parsed.data.escalated_by },
  });

  // For T2/T3: create deposit requirement
  let deposit = null;
  if (nextTier >= 2) {
    const depositReq = createDepositRequirement(nextTier, amount);
    deposit = await createDeposit(db, {
      disputeId: id,
      tier: nextTier,
      amountCents: depositReq.amount_cents,
      deadlineHours: depositReq.deadline_hours,
      deadlineAt: new Date(Date.now() + depositReq.deadline_hours * 60 * 60 * 1000),
    });
  }

  return reply.send({
    dispute_id: id,
    previous_tier: currentTier,
    new_tier: nextTier,
    cost,
    deposit,
  });
});
```

#### 3. Add `POST /disputes/deposits/expire` — Admin/cron endpoint

```ts
app.post("/disputes/deposits/expire", async (request, reply) => {
  // Find PENDING deposits past deadline and forfeit them
  const expired = await getPendingExpiredDeposits(db);
  let forfeited = 0;
  for (const deposit of expired) {
    await updateDepositStatus(db, deposit.id, "FORFEITED", { resolvedAt: new Date() });
    forfeited++;
  }
  return reply.send({ forfeited_count: forfeited });
});
```

### Flags
- Flag: Read dispute-core index.ts to find REAL function names for cost calculation and deposit.
- Flag: Import createDeposit, getPendingExpiredDeposits, updateDepositStatus from dispute-deposit service.
- Flag: The `computeDisputeCost` function signature may differ — check actual exports.
- Flag: Register /disputes/deposits/expire BEFORE /:id routes to avoid collision.
- Flag: Deposit amounts are in cents. Dispute refundAmountMinor is in minor units (same as cents for USD).

### Definition of Done
- [ ] POST /disputes/:id/escalate implemented
- [ ] Auto-creates deposit on T2/T3 escalation
- [ ] POST /disputes/deposits/expire for cron
- [ ] Max tier validation (can't exceed T3)
- [ ] Uses real dispute-core functions

---

## Step 17 — Drizzle Migration Generation

### Context
We have 12+ tables in `packages/db/src/schema/` but no SQL migration files. This step generates the initial migration.

### Build Order

#### 1. Check Drizzle config

Read `packages/db/drizzle.config.ts` (or similar) to see migration setup.
If none exists, create one:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
```

#### 2. Generate migration

```bash
cd packages/db
npx drizzle-kit generate
```

This creates SQL files in `packages/db/drizzle/`.

#### 3. If drizzle-kit is not installed, add to devDependencies

```bash
pnpm --filter @haggle/db add -D drizzle-kit
```

### Flags
- Flag: This is a GENERATION step, not an application step. We don't run migrations (no DB connection).
- Flag: If drizzle-kit can't be installed or fails, create the migration SQL manually based on schema files.
- Flag: The migration SQL should be checked into git.

### Definition of Done
- [ ] drizzle.config.ts exists in packages/db
- [ ] Migration SQL files generated
- [ ] Migration files checked in

---

## Execution Order
Step 15 + 16 in parallel (Bob), then Step 17.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
