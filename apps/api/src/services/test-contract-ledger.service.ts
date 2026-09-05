/**
 * In-memory fake-money Stage 1 test-contract ledger.
 * No real money, no PAN, no chain custody — product-invariant simulator only.
 */
import { createHash } from "node:crypto";
import {
  createFundedTestContractEntry,
  isTestContractReleaseBlocked,
  lockTestContractForDispute as lockEntry,
  releaseTestContractToSeller,
  resolveTestContractDispute,
  type SerializedTestContract,
  serializeTestContract,
  type TestContractLedgerEntry,
  type TestContractOutcome,
} from "@haggle/payment-core";

const ledger = new Map<string, TestContractLedgerEntry>();

export type { SerializedTestContract, TestContractLedgerEntry, TestContractOutcome };

export { isTestContractReleaseBlocked, serializeTestContract };

function settlementIdForOrder(orderId: string): string {
  return `test_settlement_${createHash("sha256").update(orderId).digest("hex").slice(0, 24)}`;
}

export function getTestContractByOrderId(orderId: string): TestContractLedgerEntry | undefined {
  return ledger.get(orderId);
}

export function fundTestContract(params: {
  order_id: string;
  amount_minor: number;
  currency?: "USDC";
  payment_intent_id?: string;
  buyer_id?: string;
  seller_id?: string;
  now?: string;
}):
  | { ok: true; entry: TestContractLedgerEntry; idempotent: boolean }
  | { ok: false; error: "TEST_CONTRACT_ALREADY_FUNDED"; entry: TestContractLedgerEntry } {
  const existing = ledger.get(params.order_id);
  if (existing) {
    const sameTerms =
      existing.amount_minor === params.amount_minor &&
      existing.currency === (params.currency ?? "USDC") &&
      existing.payment_intent_id === params.payment_intent_id;
    if (sameTerms) {
      return { ok: true, entry: existing, idempotent: true };
    }
    return { ok: false, error: "TEST_CONTRACT_ALREADY_FUNDED", entry: existing };
  }

  const entry = createFundedTestContractEntry({
    settlement_id: settlementIdForOrder(params.order_id),
    order_id: params.order_id,
    amount_minor: params.amount_minor,
    currency: params.currency ?? "USDC",
    payment_intent_id: params.payment_intent_id,
    buyer_id: params.buyer_id,
    seller_id: params.seller_id,
    now: params.now,
  });
  ledger.set(entry.order_id, entry);
  return { ok: true, entry, idempotent: false };
}

/**
 * Auto-lock fake-money escrow when an L1 dispute opens.
 * No-op when there is no funded test contract for the order (non–fake-money path).
 */
export function lockTestContractForDisputeOpen(
  orderId: string,
  disputeId: string,
  now = new Date().toISOString(),
):
  | { locked: false; reason: "NO_TEST_CONTRACT" }
  | { locked: true; idempotent: boolean; entry: TestContractLedgerEntry }
  | { locked: false; reason: "NOT_LOCKABLE"; message: string; entry: TestContractLedgerEntry } {
  const existing = ledger.get(orderId);
  if (!existing) {
    return { locked: false, reason: "NO_TEST_CONTRACT" };
  }
  try {
    const result = lockEntry(existing, disputeId, now);
    ledger.set(orderId, result.entry);
    return { locked: true, idempotent: result.idempotent, entry: result.entry };
  } catch (error) {
    return {
      locked: false,
      reason: "NOT_LOCKABLE",
      message: error instanceof Error ? error.message : String(error),
      entry: existing,
    };
  }
}

export function releaseTestContract(params: { order_id: string; summary?: string; now?: string }):
  | { ok: true; entry: TestContractLedgerEntry; idempotent: boolean }
  | { ok: false; error: "TEST_CONTRACT_NOT_FUNDED" }
  | {
      ok: false;
      error: "TEST_CONTRACT_NOT_RELEASABLE";
      message: string;
      entry: TestContractLedgerEntry;
    } {
  const existing = ledger.get(params.order_id);
  if (!existing) {
    return { ok: false, error: "TEST_CONTRACT_NOT_FUNDED" };
  }
  try {
    const result = releaseTestContractToSeller(existing, params.summary, params.now);
    ledger.set(params.order_id, result.entry);
    return { ok: true, entry: result.entry, idempotent: result.idempotent };
  } catch (error) {
    return {
      ok: false,
      error: "TEST_CONTRACT_NOT_RELEASABLE",
      message: error instanceof Error ? error.message : String(error),
      entry: existing,
    };
  }
}

export function resolveTestContract(params: {
  order_id: string;
  dispute_id?: string;
  outcome: TestContractOutcome;
  refund_amount_minor?: number;
  summary?: string;
  now?: string;
}):
  | { ok: true; entry: TestContractLedgerEntry; idempotent: boolean }
  | { ok: false; error: "TEST_CONTRACT_NOT_FUNDED" }
  | {
      ok: false;
      error: "TEST_CONTRACT_DISPUTE_MISMATCH" | "TEST_CONTRACT_NOT_RESOLVABLE";
      message: string;
      entry: TestContractLedgerEntry;
    } {
  const existing = ledger.get(params.order_id);
  if (!existing) {
    return { ok: false, error: "TEST_CONTRACT_NOT_FUNDED" };
  }
  try {
    const result = resolveTestContractDispute(
      existing,
      {
        dispute_id: params.dispute_id,
        outcome: params.outcome,
        refund_amount_minor: params.refund_amount_minor,
        summary: params.summary,
      },
      params.now,
    );
    ledger.set(params.order_id, result.entry);
    return { ok: true, entry: result.entry, idempotent: result.idempotent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = message.includes("does not match")
      ? "TEST_CONTRACT_DISPUTE_MISMATCH"
      : "TEST_CONTRACT_NOT_RESOLVABLE";
    return {
      ok: false,
      error: errorCode,
      message,
      entry: existing,
    };
  }
}

/** Test helper — clears the in-memory fake-money ledger between cases. */
export function resetTestContractLedgerForTests(): void {
  ledger.clear();
}
