import { createId } from "./id.js";
import type {
  ConditionalSettlementContract,
  ConditionalSettlementCreateRequest,
  ConditionalSettlementRefundRequest,
  ConditionalSettlementReleaseRequest,
  ConditionalSettlementResult,
  DisputeAnchorRecord,
  DisputeRegistryContract,
  SettlementRouterContract,
  SettlementRouterExecutionRequest,
  SettlementRouterExecutionResult,
  SettlementRouterQuote,
} from "./x402-contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class ScaffoldSettlementRouterContract implements SettlementRouterContract {
  readonly capabilities = {
    supports_fee_split: true,
    supports_dispute_anchor: false,
    supports_reservation_binding: true,
  } as const;

  constructor(
    readonly network: string,
    readonly asset: "USDC",
  ) {}

  async quote(
    request: Omit<
      SettlementRouterExecutionRequest,
      "quote_id" | "signature" | "deadline" | "signer_nonce"
    >,
  ): Promise<SettlementRouterQuote> {
    return {
      quote_id: createId("router_quote"),
      network: this.network,
      asset: this.asset,
      gross_amount: request.gross_amount,
      seller_amount: request.seller_amount,
      haggle_fee_amount: request.haggle_fee_amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async execute(
    _request: SettlementRouterExecutionRequest,
  ): Promise<SettlementRouterExecutionResult> {
    return {
      execution_id: createId("router_exec"),
      router_reference: createId("router_ref"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "PENDING",
    };
  }
}

export class DisabledSettlementRouterContract implements SettlementRouterContract {
  readonly capabilities = {
    supports_fee_split: true,
    supports_dispute_anchor: false,
    supports_reservation_binding: true,
  } as const;

  constructor(
    readonly network: string,
    readonly asset: "USDC",
    private readonly reason = "server-side settlement router execution is disabled",
  ) {}

  async quote(
    request: Omit<
      SettlementRouterExecutionRequest,
      "quote_id" | "signature" | "deadline" | "signer_nonce"
    >,
  ): Promise<SettlementRouterQuote> {
    return {
      quote_id: createId("router_quote"),
      network: this.network,
      asset: this.asset,
      gross_amount: request.gross_amount,
      seller_amount: request.seller_amount,
      haggle_fee_amount: request.haggle_fee_amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async execute(
    _request: SettlementRouterExecutionRequest,
  ): Promise<SettlementRouterExecutionResult> {
    throw new Error(`SETTLEMENT_ROUTER_EXECUTION_DISABLED:${this.reason}`);
  }
}

export class ScaffoldDisputeRegistryContract implements DisputeRegistryContract {
  constructor(readonly network: string) {}

  async anchor(record: DisputeAnchorRecord): Promise<DisputeAnchorRecord> {
    return {
      ...record,
      anchored_at: nowIso(),
      onchain_reference: createId("dispute_anchor"),
    };
  }
}

export class ScaffoldConditionalSettlementContract implements ConditionalSettlementContract {
  readonly capabilities = {
    supports_policy_hash_binding: true,
    supports_expiry_refund: true,
    supports_signed_release: true,
    supports_signed_refund: true,
    supports_dispute_lock: true,
  } as const;

  constructor(
    readonly network: string,
    readonly asset: "USDC",
    readonly address?: string,
  ) {}

  async createAndFund(
    request: ConditionalSettlementCreateRequest,
  ): Promise<ConditionalSettlementResult> {
    return {
      settlement_id: `conditional_${request.order_id}_${request.payment_intent_id}`,
      contract_reference: createId("conditional_fund"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "PENDING",
      updated_at: nowIso(),
    };
  }

  async release(
    request: ConditionalSettlementReleaseRequest,
  ): Promise<ConditionalSettlementResult> {
    return {
      settlement_id: request.settlement_id,
      contract_reference: createId("conditional_release"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "RELEASED",
      updated_at: nowIso(),
    };
  }

  async refund(request: ConditionalSettlementRefundRequest): Promise<ConditionalSettlementResult> {
    return {
      settlement_id: request.settlement_id,
      contract_reference: createId("conditional_refund"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "REFUNDED",
      updated_at: nowIso(),
    };
  }

  async expire(settlementId: string): Promise<ConditionalSettlementResult> {
    return {
      settlement_id: settlementId,
      contract_reference: createId("conditional_expire"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "REFUNDED",
      updated_at: nowIso(),
    };
  }

  async raiseDispute(
    settlementId: string,
    _evidenceHash: string,
  ): Promise<ConditionalSettlementResult> {
    return {
      settlement_id: settlementId,
      contract_reference: createId("conditional_dispute"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "DISPUTED",
      updated_at: nowIso(),
    };
  }
}
