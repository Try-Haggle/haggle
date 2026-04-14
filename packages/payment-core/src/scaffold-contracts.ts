import { createId } from "./id.js";
import type {
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

  async quote(request: Omit<SettlementRouterExecutionRequest, "quote_id" | "signature" | "deadline" | "signer_nonce">): Promise<SettlementRouterQuote> {
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

  async execute(_request: SettlementRouterExecutionRequest): Promise<SettlementRouterExecutionResult> {
    return {
      execution_id: createId("router_exec"),
      router_reference: createId("router_ref"),
      tx_hash: `0x${createId().replaceAll("-", "")}`,
      status: "PENDING",
    };
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
