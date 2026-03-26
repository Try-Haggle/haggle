import { HAGGLE_DISPUTE_REGISTRY_ABI, HAGGLE_SETTLEMENT_ROUTER_ABI } from "@haggle/contracts";
import { keccak256, padHex, stringToHex, type Address, type Hex } from "viem";
import type {
  DisputeAnchorRecord,
  DisputeRegistryContract,
  SettlementRouterContract,
  SettlementRouterExecutionRequest,
  SettlementRouterExecutionResult,
  SettlementRouterQuote,
} from "./x402-contracts.js";

function toBytes32(value: string): Hex {
  return keccak256(stringToHex(value));
}

function zeroBytes32(): Hex {
  return padHex("0x0", { size: 32 });
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ViemSettlementRouterContract implements SettlementRouterContract {
  readonly capabilities = {
    supports_fee_split: true,
    supports_dispute_anchor: false,
    supports_reservation_binding: true,
  } as const;

  constructor(
    readonly network: string,
    readonly asset: "USDC",
    private readonly address: Address,
    private readonly publicClient: any,
    private readonly walletClient: any,
    private readonly assetAddress: Address,
  ) {}

  async quote(request: Omit<SettlementRouterExecutionRequest, "quote_id" | "approval_snapshot_hash">): Promise<SettlementRouterQuote> {
    return {
      quote_id: `router_quote_${request.payment_intent_id}`,
      network: this.network,
      asset: this.asset,
      gross_amount: request.gross_amount,
      seller_amount: request.seller_amount,
      haggle_fee_amount: request.haggle_fee_amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async execute(request: SettlementRouterExecutionRequest): Promise<SettlementRouterExecutionResult> {
    const { request: prepared } = await this.publicClient.simulateContract({
      address: this.address,
      abi: HAGGLE_SETTLEMENT_ROUTER_ABI,
      functionName: "executeSettlement",
      account: this.walletClient.account,
      args: [
        toBytes32(request.order_id),
        toBytes32(request.payment_intent_id),
        request.buyer_wallet.wallet_address as Address,
        request.seller_wallet.wallet_address as Address,
        request.seller_wallet.wallet_address as Address,
        request.haggle_fee_wallet.wallet_address as Address,
        this.assetAddress,
        BigInt(request.gross_amount.amount_minor),
        BigInt(request.seller_amount.amount_minor),
        BigInt(request.haggle_fee_amount.amount_minor),
        request.approval_snapshot_hash.startsWith("0x")
          ? (request.approval_snapshot_hash as Hex)
          : toBytes32(request.approval_snapshot_hash),
        request.reservation_id ? toBytes32(request.reservation_id) : zeroBytes32(),
      ],
    });

    const txHash = await this.walletClient.writeContract(prepared);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      execution_id: txHash,
      router_reference: txHash,
      tx_hash: txHash,
      status: receipt.status === "success" ? "SETTLED" : "FAILED",
      settled_at: receipt.status === "success" ? nowIso() : undefined,
    };
  }
}

export class ViemDisputeRegistryContract implements DisputeRegistryContract {
  constructor(
    readonly network: string,
    private readonly address: Address,
    private readonly publicClient: any,
    private readonly walletClient: any,
  ) {}

  async anchor(record: DisputeAnchorRecord): Promise<DisputeAnchorRecord> {
    const evidence = record.evidence_root_hash && record.evidence_root_hash.startsWith("0x")
      ? (record.evidence_root_hash as Hex)
      : record.evidence_root_hash
        ? toBytes32(record.evidence_root_hash)
        : zeroBytes32();
    const resolution = record.resolution_hash && record.resolution_hash.startsWith("0x")
      ? (record.resolution_hash as Hex)
      : record.resolution_hash
        ? toBytes32(record.resolution_hash)
        : zeroBytes32();

    const { request } = await this.publicClient.simulateContract({
      address: this.address,
      abi: HAGGLE_DISPUTE_REGISTRY_ABI,
      functionName: "anchorDispute",
      account: this.walletClient.account,
      args: [
        toBytes32(record.order_id),
        toBytes32(record.dispute_case_id),
        evidence,
        resolution,
      ],
    });

    const txHash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      ...record,
      anchored_at: nowIso(),
      onchain_reference: receipt.transactionHash,
    };
  }
}
