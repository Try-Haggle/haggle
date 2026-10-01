import { createPublicClient, encodeFunctionData, http, isAddress } from "viem";
import { base, baseSepolia } from "viem/chains";
import { uuidToBytes32 } from "../chain/dispute-anchoring.js";
import { getRelayerConfig, relayTransaction } from "../payments/gas-relayer.js";
import { resolveSettlementAssetAddress } from "../payments/settlement-asset.js";

const escrowAbi = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "operator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tiers",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [
      { type: "address" },
      { type: "address" },
      { type: "uint128" },
      { type: "uint64" },
      { type: "uint8" },
      { type: "bool" },
      { type: "bool" },
    ],
  },
  {
    type: "function",
    name: "openTier",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      { type: "uint8" },
      { type: "address" },
      { type: "address" },
      { type: "uint128" },
      { type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fundFor",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint8" }, { type: "uint8" }, { type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "startReview",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeSellerDefault",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "uint8" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeCase",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "caseFinalized",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "caseSellerWon",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "caseSellerDefault",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "accruedFees",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const allowanceAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type EscrowParty = "buyer" | "seller";

function escrowAddress(): `0x${string}` {
  const value = process.env.HAGGLE_DISPUTE_BOND_ESCROW_ADDRESS;
  if (!value || !isAddress(value)) throw new Error("DISPUTE_BOND_ESCROW_NOT_CONFIGURED");
  return value;
}

function publicClient() {
  const rpc = process.env.HAGGLE_BASE_RPC_URL;
  if (!rpc) throw new Error("HAGGLE_BASE_RPC_URL_NOT_CONFIGURED");
  const chain = process.env.HAGGLE_X402_NETWORK === "base-sepolia" ? baseSepolia : base;
  return createPublicClient({ chain, transport: http(rpc) });
}

function toUsdcMinor(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("INVALID_REVIEW_FEE");
  return BigInt(cents) * 10_000n;
}

export async function readBondTier(disputeId: string, tier: 2 | 3) {
  const client = publicClient();
  const address = escrowAddress();
  const [asset, operator, record] = await Promise.all([
    client.readContract({ address, abi: escrowAbi, functionName: "asset" }),
    client.readContract({ address, abi: escrowAbi, functionName: "operator" }),
    client.readContract({
      address,
      abi: escrowAbi,
      functionName: "tiers",
      args: [uuidToBytes32(disputeId), tier],
    }),
  ]);
  if (asset.toLowerCase() !== resolveSettlementAssetAddress().toLowerCase()) {
    throw new Error("DISPUTE_BOND_ESCROW_ASSET_MISMATCH");
  }
  const relayer = getRelayerConfig();
  if (!relayer.enabled || operator.toLowerCase() !== relayer.address.toLowerCase()) {
    throw new Error("DISPUTE_BOND_OPERATOR_MISMATCH");
  }
  return {
    buyer: record[0],
    seller: record[1],
    feeMinor: record[2],
    deadline: record[3],
    state: Number(record[4]),
    buyerFunded: record[5],
    sellerFunded: record[6],
  };
}

export async function ensureBondTierOpen(params: {
  disputeId: string;
  tier: 2 | 3;
  buyerWallet: string;
  sellerWallet: string;
  feeCents: number;
  deadline: Date;
}) {
  if (!isAddress(params.buyerWallet) || !isAddress(params.sellerWallet)) {
    throw new Error("REVIEW_PARTY_WALLET_MISSING");
  }
  const expectedFee = toUsdcMinor(params.feeCents);
  const current = await readBondTier(params.disputeId, params.tier);
  if (current.state !== 0) {
    if (
      current.buyer.toLowerCase() !== params.buyerWallet.toLowerCase() ||
      current.seller.toLowerCase() !== params.sellerWallet.toLowerCase() ||
      current.feeMinor !== expectedFee
    )
      throw new Error("REVIEW_BOND_QUOTE_MISMATCH");
    return current;
  }
  const deadline = BigInt(Math.floor(params.deadline.getTime() / 1000));
  const tx = await relayTransaction({
    to: escrowAddress(),
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: "openTier",
      args: [
        uuidToBytes32(params.disputeId),
        params.tier,
        params.buyerWallet as `0x${string}`,
        params.sellerWallet as `0x${string}`,
        expectedFee,
        deadline,
      ],
    }),
  });
  const opened = await readBondTier(params.disputeId, params.tier);
  if (opened.state !== 1) throw new Error("REVIEW_BOND_TIER_OPEN_UNCONFIRMED");
  return { ...opened, txHash: tx.txHash };
}

export async function reviewBondApproval(params: {
  disputeId: string;
  tier: 2 | 3;
  party: EscrowParty;
  wallet: string;
  feeCents: number;
}) {
  const review = await readBondTier(params.disputeId, params.tier);
  if (review.state !== 1 || review.feeMinor !== toUsdcMinor(params.feeCents)) {
    throw new Error("REVIEW_BOND_QUOTE_UNAVAILABLE");
  }
  const expectedWallet = params.party === "buyer" ? review.buyer : review.seller;
  if (expectedWallet.toLowerCase() !== params.wallet.toLowerCase()) {
    throw new Error("REVIEW_BOND_WALLET_MISMATCH");
  }
  return {
    spender_address: escrowAddress(),
    token_address: resolveSettlementAssetAddress(),
    amount_wei: review.feeMinor.toString(),
    chain_id: process.env.HAGGLE_X402_NETWORK === "base-sepolia" ? 84532 : 8453,
  };
}

export async function fundReviewBond(params: {
  disputeId: string;
  tier: 2 | 3;
  party: EscrowParty;
  wallet: string;
  feeCents: number;
}) {
  const approval = await reviewBondApproval(params);
  const before = await readBondTier(params.disputeId, params.tier);
  if (params.party === "buyer" ? before.buyerFunded : before.sellerFunded) {
    return { alreadyFunded: true, txHash: null };
  }
  const relayer = getRelayerConfig();
  if (!relayer.enabled) throw new Error("DISPUTE_BOND_RELAYER_NOT_CONFIGURED");
  const allowance = await publicClient().readContract({
    address: approval.token_address,
    abi: allowanceAbi,
    functionName: "allowance",
    args: [params.wallet as `0x${string}`, approval.spender_address],
  });
  if (allowance < toUsdcMinor(params.feeCents)) throw new Error("REVIEW_BOND_ALLOWANCE_TOO_LOW");
  const tx = await relayTransaction({
    to: escrowAddress(),
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: "fundFor",
      args: [
        uuidToBytes32(params.disputeId),
        params.tier,
        params.party === "buyer" ? 0 : 1,
        params.wallet as `0x${string}`,
      ],
    }),
  });
  const after = await readBondTier(params.disputeId, params.tier);
  if (!(params.party === "buyer" ? after.buyerFunded : after.sellerFunded)) {
    throw new Error("REVIEW_BOND_FUNDING_UNCONFIRMED");
  }
  return { alreadyFunded: false, txHash: tx.txHash };
}

export async function startFundedReview(disputeId: string, tier: 2 | 3) {
  const review = await readBondTier(disputeId, tier);
  if (review.state === 2) return { alreadyStarted: true, txHash: null };
  if (review.state !== 1 || !review.buyerFunded || !review.sellerFunded) {
    throw new Error("REVIEW_BONDS_INCOMPLETE");
  }
  const tx = await relayTransaction({
    to: escrowAddress(),
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: "startReview",
      args: [uuidToBytes32(disputeId), tier],
    }),
  });
  const after = await readBondTier(disputeId, tier);
  if (after.state !== 2) throw new Error("REVIEW_START_UNCONFIRMED");
  return { alreadyStarted: false, txHash: tx.txHash };
}

export async function finalizeReviewBonds(disputeId: string, sellerWon: boolean) {
  const client = publicClient();
  const address = escrowAddress();
  const key = uuidToBytes32(disputeId);
  const alreadyFinalized = await client.readContract({
    address,
    abi: escrowAbi,
    functionName: "caseFinalized",
    args: [key],
  });
  let txHash: string | null = null;
  if (!alreadyFinalized) {
    const tx = await relayTransaction({
      to: address,
      data: encodeFunctionData({
        abi: escrowAbi,
        functionName: "finalizeCase",
        args: [key, sellerWon],
      }),
    });
    txHash = tx.txHash;
  }
  const [finalized, recordedSellerWon, feeMinor] = await Promise.all([
    client.readContract({ address, abi: escrowAbi, functionName: "caseFinalized", args: [key] }),
    client.readContract({ address, abi: escrowAbi, functionName: "caseSellerWon", args: [key] }),
    client.readContract({ address, abi: escrowAbi, functionName: "accruedFees", args: [key] }),
  ]);
  if (!finalized || recordedSellerWon !== sellerWon || feeMinor % 10_000n !== 0n) {
    throw new Error("REVIEW_BOND_SETTLEMENT_UNCONFIRMED");
  }
  return { txHash, feeCents: Number(feeMinor / 10_000n) };
}

export async function finalizeSellerDefaultBonds(disputeId: string, tier: 2 | 3) {
  const client = publicClient();
  const address = escrowAddress();
  const key = uuidToBytes32(disputeId);
  const alreadyFinalized = await client.readContract({
    address,
    abi: escrowAbi,
    functionName: "caseFinalized",
    args: [key],
  });
  let txHash: string | null = null;
  if (!alreadyFinalized) {
    const review = await readBondTier(disputeId, tier);
    if (review.state !== 1 || !review.buyerFunded || review.sellerFunded) {
      throw new Error("SELLER_NONPAYMENT_NOT_PROVEN_ON_CHAIN");
    }
    const tx = await relayTransaction({
      to: address,
      data: encodeFunctionData({
        abi: escrowAbi,
        functionName: "finalizeSellerDefault",
        args: [key, tier],
      }),
    });
    txHash = tx.txHash;
  }
  const [finalized, sellerWon, sellerDefault, feeMinor] = await Promise.all([
    client.readContract({ address, abi: escrowAbi, functionName: "caseFinalized", args: [key] }),
    client.readContract({ address, abi: escrowAbi, functionName: "caseSellerWon", args: [key] }),
    client.readContract({
      address,
      abi: escrowAbi,
      functionName: "caseSellerDefault",
      args: [key],
    }),
    client.readContract({ address, abi: escrowAbi, functionName: "accruedFees", args: [key] }),
  ]);
  if (!finalized || sellerWon || !sellerDefault || feeMinor % 10_000n !== 0n) {
    throw new Error("SELLER_DEFAULT_SETTLEMENT_UNCONFIRMED");
  }
  return { txHash, feeCents: Number(feeMinor / 10_000n) };
}
