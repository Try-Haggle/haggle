/**
 * Fake-money Stage 1 test-contract ledger (pure state machine).
 *
 * Simulates escrow fund → L1 dispute lock → resolve/release without real money,
 * PAN, or chain custody. Used by the API in-memory ledger and payment-test tools.
 */

export type TestContractStatus =
  | "FUNDED"
  | "DISPUTED"
  | "RELEASED_TO_SELLER"
  | "REFUNDED_TO_BUYER"
  | "PARTIAL_REFUND"
  | "ESCALATED_MANUAL_REVIEW";

export type TestContractOutcome =
  | "buyer_favor"
  | "seller_favor"
  | "partial_refund"
  | "no_action"
  | "escalate";

export type TestContractEventType = "funded" | "released" | "dispute_locked" | "resolved";

export interface TestContractEvent {
  type: TestContractEventType;
  at: string;
  detail: Record<string, unknown>;
}

export interface TestContractLedgerEntry {
  settlement_id: string;
  order_id: string;
  payment_intent_id?: string;
  buyer_id?: string;
  seller_id?: string;
  amount_minor: number;
  currency: "USDC";
  status: TestContractStatus;
  dispute_id?: string;
  outcome?: TestContractOutcome;
  refund_amount_minor?: number;
  seller_release_amount_minor?: number;
  summary?: string;
  created_at: string;
  updated_at: string;
  events: TestContractEvent[];
}

export interface TestContractInvariantChecks {
  funded_before_shipping_or_release: boolean;
  dispute_blocks_buyer_confirm: boolean;
  terminal_money_effect: boolean;
}

export interface SerializedTestContract extends TestContractLedgerEntry {
  invariant_checks: TestContractInvariantChecks;
}

export function createFundedTestContractEntry(params: {
  settlement_id: string;
  order_id: string;
  amount_minor: number;
  currency?: "USDC";
  payment_intent_id?: string;
  buyer_id?: string;
  seller_id?: string;
  now?: string;
}): TestContractLedgerEntry {
  const now = params.now ?? new Date().toISOString();
  return {
    settlement_id: params.settlement_id,
    order_id: params.order_id,
    payment_intent_id: params.payment_intent_id,
    buyer_id: params.buyer_id,
    seller_id: params.seller_id,
    amount_minor: params.amount_minor,
    currency: params.currency ?? "USDC",
    status: "FUNDED",
    created_at: now,
    updated_at: now,
    events: [
      {
        type: "funded",
        at: now,
        detail: {
          amount_minor: params.amount_minor,
          currency: params.currency ?? "USDC",
          payment_intent_id: params.payment_intent_id,
        },
      },
    ],
  };
}

/**
 * L1 dispute lock: FUNDED → DISPUTED. Idempotent for the same dispute_id.
 * Throws when the entry cannot be locked (already released / resolved / other dispute).
 */
export function lockTestContractForDispute(
  entry: TestContractLedgerEntry,
  disputeId: string,
  now = new Date().toISOString(),
): { entry: TestContractLedgerEntry; idempotent: boolean } {
  if (entry.status === "DISPUTED" && entry.dispute_id === disputeId) {
    return { entry, idempotent: true };
  }
  if (entry.status !== "FUNDED") {
    throw new Error(`Cannot lock dispute from ${entry.status}`);
  }
  return {
    entry: {
      ...entry,
      status: "DISPUTED",
      dispute_id: disputeId,
      updated_at: now,
      events: [
        ...entry.events,
        {
          type: "dispute_locked",
          at: now,
          detail: { dispute_id: disputeId },
        },
      ],
    },
    idempotent: false,
  };
}

export function releaseTestContractToSeller(
  entry: TestContractLedgerEntry,
  summary?: string,
  now = new Date().toISOString(),
): { entry: TestContractLedgerEntry; idempotent: boolean } {
  if (entry.status === "RELEASED_TO_SELLER") {
    return { entry, idempotent: true };
  }
  if (entry.status !== "FUNDED") {
    throw new Error(`Cannot release from ${entry.status}`);
  }
  return {
    entry: {
      ...entry,
      status: "RELEASED_TO_SELLER",
      outcome: "seller_favor",
      refund_amount_minor: 0,
      seller_release_amount_minor: entry.amount_minor,
      summary: summary ?? "Buyer confirmed successful delivery",
      updated_at: now,
      events: [
        ...entry.events,
        {
          type: "released",
          at: now,
          detail: { seller_release_amount_minor: entry.amount_minor },
        },
      ],
    },
    idempotent: false,
  };
}

export function resolveTestContractDispute(
  entry: TestContractLedgerEntry,
  data: {
    dispute_id?: string;
    outcome: TestContractOutcome;
    refund_amount_minor?: number;
    summary?: string;
  },
  now = new Date().toISOString(),
): { entry: TestContractLedgerEntry; idempotent: boolean } {
  if (data.dispute_id && entry.dispute_id && data.dispute_id !== entry.dispute_id) {
    throw new Error("Resolution dispute_id does not match the locked dispute");
  }

  if (entry.status !== "DISPUTED") {
    if (entry.outcome === data.outcome) {
      return { entry, idempotent: true };
    }
    throw new Error(`Cannot resolve from ${entry.status}`);
  }

  const money = resolveMoneyEffect(entry, data);
  return {
    entry: {
      ...entry,
      status: money.status,
      outcome: data.outcome,
      refund_amount_minor: money.refund_amount_minor,
      seller_release_amount_minor: money.seller_release_amount_minor,
      summary: data.summary,
      dispute_id: data.dispute_id ?? entry.dispute_id,
      updated_at: now,
      events: [
        ...entry.events,
        {
          type: "resolved",
          at: now,
          detail: {
            outcome: data.outcome,
            refund_amount_minor: money.refund_amount_minor,
            seller_release_amount_minor: money.seller_release_amount_minor,
          },
        },
      ],
    },
    idempotent: false,
  };
}

function resolveMoneyEffect(
  entry: TestContractLedgerEntry,
  data: { outcome: TestContractOutcome; refund_amount_minor?: number },
): Pick<TestContractLedgerEntry, "status" | "refund_amount_minor" | "seller_release_amount_minor"> {
  if (data.outcome === "buyer_favor") {
    return {
      status: "REFUNDED_TO_BUYER",
      refund_amount_minor: entry.amount_minor,
      seller_release_amount_minor: 0,
    };
  }
  if (data.outcome === "seller_favor" || data.outcome === "no_action") {
    return {
      status: "RELEASED_TO_SELLER",
      refund_amount_minor: 0,
      seller_release_amount_minor: entry.amount_minor,
    };
  }
  if (data.outcome === "partial_refund") {
    const refund = Math.min(
      data.refund_amount_minor ?? Math.floor(entry.amount_minor / 2),
      entry.amount_minor,
    );
    return {
      status: "PARTIAL_REFUND",
      refund_amount_minor: refund,
      seller_release_amount_minor: entry.amount_minor - refund,
    };
  }
  return {
    status: "ESCALATED_MANUAL_REVIEW",
    refund_amount_minor: 0,
    seller_release_amount_minor: 0,
  };
}

export function serializeTestContract(entry: TestContractLedgerEntry): SerializedTestContract {
  return {
    ...entry,
    invariant_checks: {
      funded_before_shipping_or_release: true,
      dispute_blocks_buyer_confirm:
        entry.status === "DISPUTED" || entry.status === "ESCALATED_MANUAL_REVIEW",
      terminal_money_effect:
        entry.status === "RELEASED_TO_SELLER" ||
        entry.status === "REFUNDED_TO_BUYER" ||
        entry.status === "PARTIAL_REFUND",
    },
  };
}

/** True when fake-money escrow must not release to seller (L1 lock or escalation). */
export function isTestContractReleaseBlocked(entry: TestContractLedgerEntry): boolean {
  return entry.status === "DISPUTED" || entry.status === "ESCALATED_MANUAL_REVIEW";
}
