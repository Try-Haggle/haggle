import { REASON_CODE_REGISTRY, type DisputeReasonCode } from "./reason-codes.js";
import type { DisputeCostResult, DisputeTier } from "./types.js";
import { getEscalationPeriod, getReviewerCount } from "./dispute-cost.js";

export type ModuleActorRole = "buyer" | "seller";

export type ModuleTransactionStatus =
  | "APPROVED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "FULFILLMENT_PENDING"
  | "FULFILLMENT_ACTIVE"
  | "DELIVERED"
  | "IN_DISPUTE"
  | "REFUNDED"
  | "CLOSED"
  | "CANCELED";

const MODULE_TRANSACTION_STATUSES: readonly ModuleTransactionStatus[] = [
  "APPROVED",
  "PAYMENT_PENDING",
  "PAID",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_ACTIVE",
  "DELIVERED",
  "IN_DISPUTE",
  "REFUNDED",
  "CLOSED",
  "CANCELED",
];

export interface DisputeModuleConfig {
  tier1_rate: number;
  tier2_rate: number;
  tier3_rate: number;
  tier1_min_cents: number;
  tier2_min_cents: number;
  tier3_min_cents: number;
  reviewer_share: number;
  platform_share: number;
  allowed_open_statuses: ModuleTransactionStatus[];
  use_shared_pool: boolean;
  haggle_network_fee_rate: number;
  ai_plaintiff_enabled: boolean;
  ai_defendant_enabled: boolean;
  ai_expert_witness_enabled: boolean;
}

export type DisputeModuleConfigInput = Partial<DisputeModuleConfig>;

export const DEFAULT_DISPUTE_MODULE_CONFIG: DisputeModuleConfig = {
  tier1_rate: 0.005,
  tier2_rate: 0.02,
  tier3_rate: 0.05,
  tier1_min_cents: 300,
  tier2_min_cents: 1_200,
  tier3_min_cents: 3_000,
  reviewer_share: 0.70,
  platform_share: 0.30,
  allowed_open_statuses: [
    "PAID",
    "FULFILLMENT_PENDING",
    "FULFILLMENT_ACTIVE",
    "DELIVERED",
    "IN_DISPUTE",
  ],
  use_shared_pool: true,
  haggle_network_fee_rate: 0,
  ai_plaintiff_enabled: true,
  ai_defendant_enabled: true,
  ai_expert_witness_enabled: true,
};

export interface ModuleTransactionSnapshot {
  platform_id: string;
  external_order_id: string;
  buyer_actor_id: string;
  seller_actor_id: string;
  amount_minor: number;
  currency: string;
  status: ModuleTransactionStatus;
  metadata?: Record<string, unknown>;
}

export interface ModuleOpenDisputeRequest {
  requester_actor_id: string;
  reason_code: DisputeReasonCode;
  summary: string;
  client_request_id?: string;
}

export type ModuleOpenDisputeDecision =
  | {
      ok: true;
      opened_by: ModuleActorRole;
      transaction: ModuleTransactionSnapshot;
      config: DisputeModuleConfig;
    }
  | {
      ok: false;
      error:
        | "INVALID_CONFIG"
        | "INVALID_TRANSACTION"
        | "FORBIDDEN"
        | "ORDER_NOT_DISPUTABLE";
      message: string;
    };

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isModuleTransactionStatus(value: unknown): value is ModuleTransactionStatus {
  return typeof value === "string" && (MODULE_TRANSACTION_STATUSES as readonly string[]).includes(value);
}

function isDisputeReasonCode(value: unknown): value is DisputeReasonCode {
  return typeof value === "string" && value in REASON_CODE_REGISTRY;
}

export function normalizeDisputeModuleConfig(
  input: DisputeModuleConfigInput = {},
): DisputeModuleConfig {
  const config = {
    ...DEFAULT_DISPUTE_MODULE_CONFIG,
    ...input,
    allowed_open_statuses: input.allowed_open_statuses
      ? [...input.allowed_open_statuses]
      : [...DEFAULT_DISPUTE_MODULE_CONFIG.allowed_open_statuses],
  };

  const positiveFields: Array<keyof Pick<
    DisputeModuleConfig,
    | "tier1_rate"
    | "tier2_rate"
    | "tier3_rate"
    | "tier1_min_cents"
    | "tier2_min_cents"
    | "tier3_min_cents"
  >> = [
    "tier1_rate",
    "tier2_rate",
    "tier3_rate",
    "tier1_min_cents",
    "tier2_min_cents",
    "tier3_min_cents",
  ];

  for (const field of positiveFields) {
    if (!finitePositive(config[field])) {
      throw new Error(`${field} must be positive`);
    }
  }

  if (!finiteNonNegative(config.haggle_network_fee_rate)) {
    throw new Error("haggle_network_fee_rate must be non-negative");
  }

  if (config.reviewer_share < 0 || config.platform_share < 0) {
    throw new Error("reviewer_share and platform_share must be non-negative");
  }

  const totalShare = config.reviewer_share + config.platform_share;
  if (Math.abs(totalShare - 1) > 0.000001) {
    throw new Error("reviewer_share + platform_share must equal 1");
  }

  if (config.allowed_open_statuses.length === 0) {
    throw new Error("allowed_open_statuses must not be empty");
  }
  for (const status of config.allowed_open_statuses) {
    if (!isModuleTransactionStatus(status)) {
      throw new Error(`invalid allowed_open_status: ${String(status)}`);
    }
  }

  return config;
}

export function computeModuleDisputeCost(
  amount_minor: number,
  tier: DisputeTier,
  configInput: DisputeModuleConfigInput = {},
): DisputeCostResult {
  if (!finitePositive(amount_minor)) {
    throw new Error("amount_minor must be positive");
  }
  const config = normalizeDisputeModuleConfig(configInput);
  const escalation_period_hours = getEscalationPeriod(amount_minor);

  if (tier === 1) {
    return {
      tier,
      cost_cents: Math.max(Math.round(amount_minor * config.tier1_rate), config.tier1_min_cents),
      reviewer_count: null,
      escalation_period_hours,
    };
  }

  if (tier === 2) {
    return {
      tier,
      cost_cents: Math.max(Math.round(amount_minor * config.tier2_rate), config.tier2_min_cents),
      reviewer_count: getReviewerCount(amount_minor, 2),
      escalation_period_hours,
    };
  }

  return {
    tier,
    cost_cents: Math.max(Math.round(amount_minor * config.tier3_rate), config.tier3_min_cents),
    reviewer_count: getReviewerCount(amount_minor, 3),
    escalation_period_hours,
  };
}

export function decideModuleDisputeOpen(
  transaction: ModuleTransactionSnapshot,
  request: ModuleOpenDisputeRequest,
  configInput: DisputeModuleConfigInput = {},
): ModuleOpenDisputeDecision {
  let config: DisputeModuleConfig;
  try {
    config = normalizeDisputeModuleConfig(configInput);
  } catch (error) {
    return {
      ok: false,
      error: "INVALID_CONFIG",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (
    !nonEmptyString(transaction.platform_id) ||
    !nonEmptyString(transaction.external_order_id) ||
    !nonEmptyString(transaction.buyer_actor_id) ||
    !nonEmptyString(transaction.seller_actor_id) ||
    !finitePositive(transaction.amount_minor) ||
    !nonEmptyString(transaction.currency) ||
    !isModuleTransactionStatus(transaction.status)
  ) {
    return {
      ok: false,
      error: "INVALID_TRANSACTION",
      message: "transaction snapshot is incomplete or invalid",
    };
  }

  if (!isDisputeReasonCode(request.reason_code) || !nonEmptyString(request.summary)) {
    return {
      ok: false,
      error: "INVALID_TRANSACTION",
      message: "reason_code and summary are required",
    };
  }

  let openedBy: ModuleActorRole | null = null;
  if (request.requester_actor_id === transaction.buyer_actor_id) {
    openedBy = "buyer";
  } else if (request.requester_actor_id === transaction.seller_actor_id) {
    openedBy = "seller";
  }

  if (!openedBy) {
    return {
      ok: false,
      error: "FORBIDDEN",
      message: "requester is not a party to this transaction",
    };
  }

  if (!config.allowed_open_statuses.includes(transaction.status)) {
    return {
      ok: false,
      error: "ORDER_NOT_DISPUTABLE",
      message: `transaction is not disputable in ${transaction.status} state`,
    };
  }

  return {
    ok: true,
    opened_by: openedBy,
    transaction,
    config,
  };
}
