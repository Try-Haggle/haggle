import {
  HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
  HAGGLE_DISPUTE_REGISTRY_ABI,
  HAGGLE_SETTLEMENT_ROUTER_ABI,
} from "@haggle/contracts";
import { keccak256, padHex, stringToHex, type Address, type Hex } from "viem";
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

function toBytes32(value: string): Hex {
  return keccak256(stringToHex(value));
}

function toPolicyBytes32(value: string): Hex {
  const normalized = value.startsWith("sha256:") ? `0x${value.slice("sha256:".length)}` : value;
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return normalized as Hex;
  }
  return toBytes32(value);
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

  async quote(request: Omit<SettlementRouterExecutionRequest, "quote_id" | "signature" | "deadline" | "signer_nonce">): Promise<SettlementRouterQuote> {
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

  /**
   * Initiates a refund for a settled payment.
   *
   * MVP: Admin-manual process. Records refund intent and returns a pending result.
   * The actual on-chain USDC transfer is handled manually by the Haggle ops team.
   *
   * TODO(post-mvp): Implement on-chain direct transfer via a RefundRouter contract
   * that allows the Haggle relayer to push USDC back to the buyer's wallet.
   */
  async refund(params: {
    payment_intent_id: string;
    order_id: string;
    buyer_wallet: string;
    amount_minor: bigint;
    currency: string;
    reason_code: string;
  }): Promise<{
    status: "REFUND_PENDING";
    refund_id: string;
    payment_intent_id: string;
    message: string;
  }> {
    const refundId = `refund_${params.payment_intent_id}_${Date.now()}`;
    return {
      status: "REFUND_PENDING",
      refund_id: refundId,
      payment_intent_id: params.payment_intent_id,
      message: "Admin will process manually",
    };
  }

  async execute(request: SettlementRouterExecutionRequest): Promise<SettlementRouterExecutionResult> {
    // Build the SettlementParams tuple matching the Solidity struct exactly.
    const params = {
      orderId: toBytes32(request.order_id),
      paymentIntentId: toBytes32(request.payment_intent_id),
      buyer: request.buyer_wallet.wallet_address as Address,
      seller: request.seller_wallet.wallet_address as Address,
      sellerWallet: request.seller_wallet.wallet_address as Address,
      feeWallet: request.haggle_fee_wallet.wallet_address as Address,
      asset: this.assetAddress,
      grossAmount: BigInt(request.gross_amount.amount_minor),
      sellerAmount: BigInt(request.seller_amount.amount_minor),
      feeAmount: BigInt(request.haggle_fee_amount.amount_minor),
      deadline: request.deadline,
      signerNonce: request.signer_nonce,
    };

    const { request: prepared } = await this.publicClient.simulateContract({
      address: this.address,
      abi: HAGGLE_SETTLEMENT_ROUTER_ABI,
      functionName: "executeSettlement",
      account: this.walletClient.account,
      args: [params, request.signature],
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

export class ViemConditionalSettlementContract implements ConditionalSettlementContract {
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
    readonly address: Address,
    private readonly publicClient: any,
    private readonly walletClient: any,
  ) {}

  async createAndFund(request: ConditionalSettlementCreateRequest): Promise<ConditionalSettlementResult> {
    const params = {
      orderId: toPolicyBytes32(request.order_id),
      paymentIntentId: toPolicyBytes32(request.payment_intent_id),
      approvalPolicyHash: toPolicyBytes32(request.approval_policy_hash),
      agreementHash: toPolicyBytes32(request.agreement_hash),
      listingHash: toPolicyBytes32(request.listing_hash),
      grantNonce: toPolicyBytes32(request.grant_nonce),
      buyer: request.buyer_wallet.wallet_address as Address,
      seller: request.seller_wallet.wallet_address as Address,
      asset: request.asset_address as Address,
      grossAmount: BigInt(request.gross_amount.amount_minor),
      expiresAt: request.expires_at_unix,
      signerNonce: request.signer_nonce,
    };

    const settlementId = await this.publicClient.readContract({
      address: this.address,
      abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
      functionName: "computeSettlementId",
      args: [params],
    }).catch(() => toPolicyBytes32(`${request.order_id}:${request.payment_intent_id}:${request.approval_policy_hash}`));

    const { request: prepared } = await this.publicClient.simulateContract({
      address: this.address,
      abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
      functionName: "createAndFund",
      account: this.walletClient.account,
      args: [params, request.signature],
    });

    const txHash = await this.walletClient.writeContract(prepared);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      settlement_id: settlementId,
      contract_reference: txHash,
      tx_hash: txHash,
      status: receipt.status === "success" ? "FUNDED" : "FAILED",
      updated_at: nowIso(),
    };
  }

  async release(request: ConditionalSettlementReleaseRequest): Promise<ConditionalSettlementResult> {
    const params = {
      settlementId: toPolicyBytes32(request.settlement_id),
      sellerWallet: request.seller_wallet.wallet_address as Address,
      feeWallet: request.haggle_fee_wallet.wallet_address as Address,
      sellerAmount: BigInt(request.seller_amount.amount_minor),
      feeAmount: BigInt(request.haggle_fee_amount.amount_minor),
      deadline: request.deadline,
      signerNonce: request.signer_nonce,
    };

    const receipt = await this.write("release", [params, request.signature]);
    return {
      settlement_id: request.settlement_id,
      contract_reference: receipt.transactionHash,
      tx_hash: receipt.transactionHash,
      status: receipt.status === "success" ? "RELEASED" : "FAILED",
      updated_at: nowIso(),
    };
  }

  async refund(request: ConditionalSettlementRefundRequest): Promise<ConditionalSettlementResult> {
    const params = {
      settlementId: toPolicyBytes32(request.settlement_id),
      deadline: request.deadline,
      signerNonce: request.signer_nonce,
    };

    const receipt = await this.write("refund", [params, request.signature]);
    return {
      settlement_id: request.settlement_id,
      contract_reference: receipt.transactionHash,
      tx_hash: receipt.transactionHash,
      status: receipt.status === "success" ? "REFUNDED" : "FAILED",
      updated_at: nowIso(),
    };
  }

  async expire(settlementId: string): Promise<ConditionalSettlementResult> {
    const receipt = await this.write("expire", [toPolicyBytes32(settlementId)]);
    return {
      settlement_id: settlementId,
      contract_reference: receipt.transactionHash,
      tx_hash: receipt.transactionHash,
      status: receipt.status === "success" ? "REFUNDED" : "FAILED",
      updated_at: nowIso(),
    };
  }

  async raiseDispute(settlementId: string, evidenceHash: string): Promise<ConditionalSettlementResult> {
    const receipt = await this.write("raiseDispute", [toPolicyBytes32(settlementId), toPolicyBytes32(evidenceHash)]);
    return {
      settlement_id: settlementId,
      contract_reference: receipt.transactionHash,
      tx_hash: receipt.transactionHash,
      status: receipt.status === "success" ? "DISPUTED" : "FAILED",
      updated_at: nowIso(),
    };
  }

  private async write(functionName: string, args: unknown[]) {
    const { request } = await this.publicClient.simulateContract({
      address: this.address,
      abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
      functionName,
      account: this.walletClient.account,
      args,
    });
    const txHash = await this.walletClient.writeContract(request);
    return this.publicClient.waitForTransactionReceipt({ hash: txHash });
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
