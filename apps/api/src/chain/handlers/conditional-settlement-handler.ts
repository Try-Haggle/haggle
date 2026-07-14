/**
 * Conditional Settlement Event Handler
 *
 * Reconciles buyer-funded escrow events with payment_intents.provider_context.
 * This is deliberately context-only: payment state transitions still happen
 * through payment APIs so release/refund policy checks remain centralized.
 */

import {
  type Database,
  eq,
  paymentIntents,
} from "@haggle/db";
import type { Log } from "viem";

interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHex(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function normalizeAddress(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function stringifyUint(value: unknown): string | undefined {
  return typeof value === "bigint" || typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined;
}

function getConditionalSettlementContext(providerContext: unknown): Record<string, unknown> {
  if (!isRecord(providerContext)) return {};
  const context = providerContext.conditional_settlement;
  return isRecord(context) ? context : {};
}

function matchesSettlementId(providerContext: unknown, settlementId: string): boolean {
  const context = getConditionalSettlementContext(providerContext);
  const expected = normalizeHex(settlementId);
  const direct = normalizeHex(context.settlement_id);
  if (expected && direct === expected) return true;

  const lookup = isRecord(context.chain_lookup) ? context.chain_lookup : {};
  return normalizeHex(lookup.settlement_id) === expected;
}

async function findPaymentIntentBySettlementId(
  db: Database,
  settlementId: string,
): Promise<{ id: string; providerContext: Record<string, unknown> | null } | null> {
  const rows = await db
    .select({
      id: paymentIntents.id,
      providerContext: paymentIntents.providerContext,
    })
    .from(paymentIntents)
    .limit(200);

  return rows.find((row) => matchesSettlementId(row.providerContext, settlementId)) ?? null;
}

function mergeConditionalSettlementContext(
  providerContext: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base = providerContext ?? {};
  const current = getConditionalSettlementContext(base);
  return {
    ...base,
    conditional_settlement: {
      ...current,
      ...patch,
    },
  };
}

async function updateConditionalSettlementContext(
  db: Database,
  paymentIntentId: string,
  providerContext: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(paymentIntents)
    .set({
      providerContext: mergeConditionalSettlementContext(providerContext, patch),
      updatedAt: new Date(),
    })
    .where(eq(paymentIntents.id, paymentIntentId));
}

export async function handleConditionalSettlementEvent(
  db: Database,
  log: Log,
  event: DecodedEvent,
): Promise<void> {
  const txHash = log.transactionHash ?? "unknown";
  const settlementId = normalizeHex(event.args.settlementId);

  if (!settlementId) {
    return;
  }

  const row = await findPaymentIntentBySettlementId(db, settlementId);
  if (!row) {
    console.warn(
      `[chain-listener] WARNING: ${event.eventName} for conditional settlement without matching payment intent. ` +
      `settlementId=${settlementId} txHash=${txHash}`,
    );
    return;
  }

  switch (event.eventName) {
    case "SettlementFunded":
      await updateConditionalSettlementContext(db, row.id, row.providerContext, {
        settlement_id: settlementId,
        funding_tx_hash: txHash,
        status: "FUNDING_CONFIRMED",
        confirmed_at: new Date().toISOString(),
        order_id_hash: normalizeHex(event.args.orderId),
        payment_intent_id_hash: normalizeHex(event.args.paymentIntentId),
        approval_policy_hash: normalizeHex(event.args.approvalPolicyHash),
        buyer_wallet: normalizeAddress(event.args.buyer),
        seller_wallet: normalizeAddress(event.args.seller),
        asset: normalizeAddress(event.args.asset),
        gross_amount_minor: stringifyUint(event.args.grossAmount),
      });
      break;

    case "SettlementReleased":
      await updateConditionalSettlementContext(db, row.id, row.providerContext, {
        settlement_id: settlementId,
        release_tx_hash: txHash,
        status: "RELEASE_CONFIRMED",
        release_confirmed_at: new Date().toISOString(),
        release_seller_wallet: normalizeAddress(event.args.sellerWallet),
        release_fee_wallet: normalizeAddress(event.args.feeWallet),
        release_seller_amount_minor: stringifyUint(event.args.sellerAmount),
        release_fee_amount_minor: stringifyUint(event.args.feeAmount),
      });
      break;

    case "SettlementRefunded":
      await updateConditionalSettlementContext(db, row.id, row.providerContext, {
        settlement_id: settlementId,
        refund_tx_hash: txHash,
        status: "REFUND_CONFIRMED",
        refund_confirmed_at: new Date().toISOString(),
      });
      break;

    case "SettlementDisputed":
      await updateConditionalSettlementContext(db, row.id, row.providerContext, {
        settlement_id: settlementId,
        status: "DISPUTED",
        dispute_evidence_hash: event.args.evidenceHash,
        disputed_at: new Date().toISOString(),
      });
      break;

    default:
      break;
  }
}
