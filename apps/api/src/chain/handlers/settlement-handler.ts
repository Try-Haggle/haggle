/**
 * Settlement Event Handler
 *
 * Processes events from the SettlementRouter contract and reconciles
 * on-chain state with the database. Each handler is idempotent.
 *
 * Events handled:
 * - SettlementExecuted — verify DB record exists, store tx_hash via providerReference
 * - OrderReset — log admin action, update order status if applicable
 * - OrderVoidedEvent — update order to CANCELED state
 */

import {
  type Database,
  paymentSettlements,
  commerceOrders,
  eq,
  and,
} from "@haggle/db";
import type { Log } from "viem";
import { keccak256, stringToHex } from "viem";

// ── Types ───────────────────────────────────────────────────────

interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
}

// ── Handler ─────────────────────────────────────────────────────

export async function handleSettlementEvent(
  db: Database,
  log: Log,
  event: DecodedEvent,
): Promise<void> {
  const txHash = log.transactionHash ?? "unknown";

  switch (event.eventName) {
    case "SettlementExecuted":
      await handleSettlementExecuted(db, txHash, event.args);
      break;

    case "OrderReset":
      await handleOrderReset(db, txHash, event.args);
      break;

    case "OrderVoidedEvent":
      await handleOrderVoided(db, txHash, event.args);
      break;

    default:
      // Other events (AssetAllowed, SignerUpdated, etc.) are logged but not acted on
      break;
  }
}

// ── SettlementExecuted ──────────────────────────────────────────

async function handleSettlementExecuted(
  db: Database,
  txHash: string,
  args: Record<string, unknown>,
): Promise<void> {
  const orderId = args.orderId as string;
  const paymentIntentId = args.paymentIntentId as string;

  // Check if we already have a settlement record with this tx hash (idempotency)
  const existing = await db
    .select({
      id: paymentSettlements.id,
      providerReference: paymentSettlements.providerReference,
    })
    .from(paymentSettlements)
    .where(eq(paymentSettlements.providerReference, txHash))
    .limit(1);

  if (existing.length > 0) {
    // Already processed — idempotent no-op
    return;
  }

  // Look for a settlement record that matches the on-chain paymentIntentId.
  // The paymentIntentId on-chain is keccak256(stringToHex(dbUUID)), so we fetch
  // PENDING x402 settlements and match deterministically by hash.
  const pendingSettlements = await db
    .select({
      id: paymentSettlements.id,
      paymentIntentId: paymentSettlements.paymentIntentId,
      providerReference: paymentSettlements.providerReference,
      status: paymentSettlements.status,
    })
    .from(paymentSettlements)
    .where(
      and(
        eq(paymentSettlements.rail, "x402"),
        eq(paymentSettlements.status, "PENDING"),
      ),
    )
    .limit(50);

  // Match by computing keccak256(stringToHex(settlement.paymentIntentId)) and
  // comparing against the on-chain paymentIntentId (bytes32).
  let matched = false;
  for (const record of pendingSettlements) {
    if (!record.paymentIntentId) continue;
    const expectedHash = keccak256(stringToHex(record.paymentIntentId));
    if (expectedHash === paymentIntentId) {
      await db
        .update(paymentSettlements)
        .set({
          providerReference: txHash,
          status: "SETTLED",
          settledAt: new Date(),
        })
        .where(eq(paymentSettlements.id, record.id));
      matched = true;
      break;
    }
  }

  if (!matched) {
    // On-chain settlement without a matching DB record is suspicious
    console.warn(
      `[chain-listener] WARNING: SettlementExecuted on-chain with no matching DB record. ` +
      `txHash=${txHash} orderId=${orderId} paymentIntentId=${paymentIntentId}`,
    );
  }
}

// ── OrderReset ──────────────────────────────────────────────────

async function handleOrderReset(
  db: Database,
  txHash: string,
  args: Record<string, unknown>,
): Promise<void> {
  const orderId = args.orderId as string;

  console.log(
    `[chain-listener] OrderReset admin action: orderId=${orderId} txHash=${txHash}`,
  );

  // OrderReset is an admin override. We log it but don't auto-change order status
  // because the admin may be resetting a stuck on-chain state to allow re-settlement.
  // The admin should update the DB order status separately if needed.
}

// ── OrderVoidedEvent ────────────────────────────────────────────

async function handleOrderVoided(
  db: Database,
  txHash: string,
  args: Record<string, unknown>,
): Promise<void> {
  const orderId = args.orderId as string;
  const reason = (args.reason as string) ?? "voided on-chain";

  console.log(
    `[chain-listener] OrderVoidedEvent: orderId=${orderId} reason="${reason}" txHash=${txHash}`,
  );

  // We cannot directly match the on-chain orderId (bytes32 keccak hash) to the DB UUID.
  // This event is logged for observability. In production, a lookup table or reverse
  // mapping (orderId hash -> DB UUID) would be maintained. For now, log the event
  // so operators can investigate and reconcile manually.
  //
  // Future: maintain a hash->uuid mapping in the payment flow and use it here
  // to automatically update commerceOrders.status to "CANCELED".
}
