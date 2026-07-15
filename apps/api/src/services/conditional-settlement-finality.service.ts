const DEFAULT_CONFIRMATIONS = 2;
const MIN_CONFIRMATIONS = 1;
const MAX_CONFIRMATIONS = 64;
export const CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS = 2;

export function conditionalSettlementConfirmationRetry() {
  return {
    after_seconds: CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS,
    reuse_transaction_hash: true,
    use_new_idempotency_key: true,
  } as const;
}

export type ConditionalSettlementFinalityResult =
  | {
      status: "confirmed";
      ready: true;
      required_confirmations: number;
      observed_confirmations: number;
      receipt_block_number: string;
      head_block_number: string;
      canonical_block_verified: true;
    }
  | {
      status: "pending";
      ready: false;
      reason: "INSUFFICIENT_CONFIRMATIONS";
      required_confirmations: number;
      observed_confirmations: number;
      receipt_block_number: string;
      head_block_number: string;
    }
  | {
      status: "unavailable";
      ready: false;
      reason:
        | "RECEIPT_BLOCK_MISSING"
        | "RECEIPT_BLOCK_HASH_MISSING"
        | "CHAIN_HEAD_UNAVAILABLE"
        | "CHAIN_HEAD_BEHIND_RECEIPT"
        | "CANONICAL_BLOCK_UNAVAILABLE"
        | "RECEIPT_BLOCK_NOT_CANONICAL"
        | "INVALID_CONFIRMATION_POLICY";
      required_confirmations: number | null;
      observed_confirmations: null;
      receipt_block_number: string | null;
      head_block_number: string | null;
    };

export function getConditionalSettlementRequiredConfirmations(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.HAGGLE_CONDITIONAL_SETTLEMENT_CONFIRMATIONS;
  if (raw === undefined || raw === "") return DEFAULT_CONFIRMATIONS;
  if (!/^\d+$/.test(raw))
    throw new Error("HAGGLE_CONDITIONAL_SETTLEMENT_CONFIRMATIONS must be an integer");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_CONFIRMATIONS || value > MAX_CONFIRMATIONS) {
    throw new Error(
      `HAGGLE_CONDITIONAL_SETTLEMENT_CONFIRMATIONS must be ${MIN_CONFIRMATIONS}..${MAX_CONFIRMATIONS}`,
    );
  }
  return value;
}

export async function evaluateConditionalSettlementFinality(input: {
  receiptBlockNumber: bigint | null | undefined;
  receiptBlockHash?: string | null;
  client: {
    getBlockNumber(): Promise<bigint>;
    getBlock(input: { blockNumber: bigint }): Promise<{ hash: string | null }>;
  };
  env?: NodeJS.ProcessEnv;
}): Promise<ConditionalSettlementFinalityResult> {
  let required: number;
  try {
    required = getConditionalSettlementRequiredConfirmations(input.env);
  } catch {
    return {
      status: "unavailable",
      ready: false,
      reason: "INVALID_CONFIRMATION_POLICY",
      required_confirmations: null,
      observed_confirmations: null,
      receipt_block_number: input.receiptBlockNumber?.toString() ?? null,
      head_block_number: null,
    };
  }

  if (input.receiptBlockNumber === null || input.receiptBlockNumber === undefined) {
    return {
      status: "unavailable",
      ready: false,
      reason: "RECEIPT_BLOCK_MISSING",
      required_confirmations: required,
      observed_confirmations: null,
      receipt_block_number: null,
      head_block_number: null,
    };
  }

  let head: bigint;
  try {
    head = await input.client.getBlockNumber();
  } catch {
    return {
      status: "unavailable",
      ready: false,
      reason: "CHAIN_HEAD_UNAVAILABLE",
      required_confirmations: required,
      observed_confirmations: null,
      receipt_block_number: input.receiptBlockNumber.toString(),
      head_block_number: null,
    };
  }

  if (head < input.receiptBlockNumber) {
    return {
      status: "unavailable",
      ready: false,
      reason: "CHAIN_HEAD_BEHIND_RECEIPT",
      required_confirmations: required,
      observed_confirmations: null,
      receipt_block_number: input.receiptBlockNumber.toString(),
      head_block_number: head.toString(),
    };
  }

  const observed = Number(head - input.receiptBlockNumber + 1n);
  const common = {
    required_confirmations: required,
    observed_confirmations: observed,
    receipt_block_number: input.receiptBlockNumber.toString(),
    head_block_number: head.toString(),
  };
  if (observed < required) {
    return { status: "pending", ready: false, reason: "INSUFFICIENT_CONFIRMATIONS", ...common };
  }

  if (!input.receiptBlockHash || !/^0x[0-9a-fA-F]{64}$/.test(input.receiptBlockHash)) {
    return {
      status: "unavailable",
      ready: false,
      reason: "RECEIPT_BLOCK_HASH_MISSING",
      required_confirmations: required,
      observed_confirmations: null,
      receipt_block_number: input.receiptBlockNumber.toString(),
      head_block_number: head.toString(),
    };
  }

  let canonicalBlock: { hash: string | null };
  try {
    canonicalBlock = await input.client.getBlock({ blockNumber: input.receiptBlockNumber });
  } catch {
    return {
      status: "unavailable",
      ready: false,
      reason: "CANONICAL_BLOCK_UNAVAILABLE",
      required_confirmations: required,
      observed_confirmations: null,
      receipt_block_number: input.receiptBlockNumber.toString(),
      head_block_number: head.toString(),
    };
  }
  if (
    !canonicalBlock.hash ||
    canonicalBlock.hash.toLowerCase() !== input.receiptBlockHash.toLowerCase()
  ) {
    return {
      status: "unavailable",
      ready: false,
      reason: "RECEIPT_BLOCK_NOT_CANONICAL",
      required_confirmations: required,
      observed_confirmations: null,
      receipt_block_number: input.receiptBlockNumber.toString(),
      head_block_number: head.toString(),
    };
  }
  return { status: "confirmed", ready: true, canonical_block_verified: true, ...common };
}

export async function runConditionalSettlementFinalityFixture() {
  const receiptHash = `0x${"ab".repeat(32)}`;
  const otherHash = `0x${"cd".repeat(32)}`;
  const evaluate = (
    receiptBlockNumber: bigint | undefined,
    head: bigint | Error,
    options: {
      receiptBlockHash?: string;
      canonicalHash?: string | null | Error;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) =>
    evaluateConditionalSettlementFinality({
      receiptBlockNumber,
      receiptBlockHash: options.receiptBlockHash,
      client: {
        getBlockNumber: async () => {
          if (head instanceof Error) throw head;
          return head;
        },
        getBlock: async () => {
          if (options.canonicalHash instanceof Error) throw options.canonicalHash;
          return { hash: options.canonicalHash ?? null };
        },
      },
      env: options.env,
    });
  const [
    oneShort,
    exact,
    headBehind,
    rpcFailure,
    missingBlock,
    invalidPolicy,
    missingHash,
    canonicalFailure,
    orphanedReceipt,
  ] = await Promise.all([
    evaluate(100n, 100n),
    evaluate(100n, 101n, { receiptBlockHash: receiptHash, canonicalHash: receiptHash }),
    evaluate(101n, 100n),
    evaluate(100n, new Error("private upstream RPC detail")),
    evaluate(undefined, 101n),
    evaluate(100n, 101n, { env: { HAGGLE_CONDITIONAL_SETTLEMENT_CONFIRMATIONS: "0" } }),
    evaluate(100n, 101n),
    evaluate(100n, 101n, {
      receiptBlockHash: receiptHash,
      canonicalHash: new Error("private canonical RPC detail"),
    }),
    evaluate(100n, 101n, { receiptBlockHash: receiptHash, canonicalHash: otherHash }),
  ]);
  const checks = {
    one_block_short_pending: oneShort.status === "pending" && oneShort.observed_confirmations === 1,
    exact_threshold_confirmed: exact.status === "confirmed" && exact.observed_confirmations === 2,
    head_behind_fail_closed:
      headBehind.status === "unavailable" && headBehind.reason === "CHAIN_HEAD_BEHIND_RECEIPT",
    rpc_failure_redacted:
      rpcFailure.status === "unavailable" &&
      rpcFailure.reason === "CHAIN_HEAD_UNAVAILABLE" &&
      !JSON.stringify(rpcFailure).includes("private upstream"),
    missing_receipt_block_fail_closed:
      missingBlock.status === "unavailable" && missingBlock.reason === "RECEIPT_BLOCK_MISSING",
    invalid_policy_fail_closed:
      invalidPolicy.status === "unavailable" &&
      invalidPolicy.reason === "INVALID_CONFIRMATION_POLICY",
    missing_receipt_hash_fail_closed:
      missingHash.status === "unavailable" && missingHash.reason === "RECEIPT_BLOCK_HASH_MISSING",
    canonical_lookup_failure_redacted:
      canonicalFailure.status === "unavailable" &&
      canonicalFailure.reason === "CANONICAL_BLOCK_UNAVAILABLE" &&
      !JSON.stringify(canonicalFailure).includes("private canonical"),
    orphaned_receipt_blocked:
      orphanedReceipt.status === "unavailable" &&
      orphanedReceipt.reason === "RECEIPT_BLOCK_NOT_CANONICAL",
  };
  return {
    pass: Object.values(checks).every(Boolean),
    policy: { default_confirmations: DEFAULT_CONFIRMATIONS },
    checks,
    scenarios: {
      oneShort,
      exact,
      headBehind,
      rpcFailure,
      missingBlock,
      invalidPolicy,
      missingHash,
      canonicalFailure,
      orphanedReceipt,
    },
  };
}
