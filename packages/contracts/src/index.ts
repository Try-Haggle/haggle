// ─── Smart Contracts Package ─────────────────────────────────
// Solidity smart contracts compiled with Foundry, deployed on Base L2.
// Exports ABIs, deployed addresses, and TypeScript bindings (viem/wagmi).

export interface ContractAddresses {
  settlementRouter: `0x${string}` | null;
  disputeRegistry: `0x${string}` | null;
}

export const CONTRACT_ADDRESSES: ContractAddresses = {
  settlementRouter: null,
  disputeRegistry: null,
};

// Base mainnet USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
// Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_SEPOLIA_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

export const HAGGLE_SETTLEMENT_ROUTER_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "initialOwner", type: "address" },
      { name: "initialSigner", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  // ─── Core ─────────────────────────────────────────────────
  {
    type: "function",
    name: "executeSettlement",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "orderId", type: "bytes32" },
          { name: "paymentIntentId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "seller", type: "address" },
          { name: "sellerWallet", type: "address" },
          { name: "feeWallet", type: "address" },
          { name: "asset", type: "address" },
          { name: "grossAmount", type: "uint256" },
          { name: "sellerAmount", type: "uint256" },
          { name: "feeAmount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "signerNonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "executionId", type: "bytes32" }],
  },
  // ─── Signer Rotation (Two-Phase, 48h Delay) ──────────────
  {
    type: "function",
    name: "proposeSigner",
    stateMutability: "nonpayable",
    inputs: [{ name: "newSigner", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "confirmSigner",
    stateMutability: "nonpayable",
    inputs: [{ name: "expectedSigner", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelSignerRotation",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "emergencyFreezeSigner",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // ─── Guardian ─────────────────────────────────────────────
  {
    type: "function",
    name: "setGuardian",
    stateMutability: "nonpayable",
    inputs: [{ name: "newGuardian", type: "address" }],
    outputs: [],
  },
  // ─── Settlement Cap ───────────────────────────────────────
  {
    type: "function",
    name: "setMaxSettlementAmount",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAmount", type: "uint256" }],
    outputs: [],
  },
  // ─── Asset Allowlist ──────────────────────────────────────
  {
    type: "function",
    name: "allowAsset",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "disallowAsset",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [],
  },
  // ─── Manual Override ──────────────────────────────────────
  {
    type: "function",
    name: "adminResetOrder",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "adminVoidOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  // ─── Pause ────────────────────────────────────────────────
  {
    type: "function",
    name: "pause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "unpause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // ─── Views ────────────────────────────────────────────────
  {
    type: "function",
    name: "signer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "signerNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "guardian",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "maxSettlementAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "signerRotationReadyAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "settledOrders",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "voidedOrders",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowedAssets",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "SETTLEMENT_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "MAX_FEE_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_GROSS_AMOUNT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "SIGNER_ROTATION_DELAY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PAUSE_COOLDOWN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastPausedAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ─── Events ───────────────────────────────────────────────
  {
    type: "event",
    name: "SettlementExecuted",
    inputs: [
      { indexed: true, name: "executionId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "paymentIntentId", type: "bytes32" },
      { indexed: false, name: "buyer", type: "address" },
      { indexed: false, name: "seller", type: "address" },
      { indexed: false, name: "sellerWallet", type: "address" },
      { indexed: false, name: "feeWallet", type: "address" },
      { indexed: false, name: "asset", type: "address" },
      { indexed: false, name: "grossAmount", type: "uint256" },
      { indexed: false, name: "sellerAmount", type: "uint256" },
      { indexed: false, name: "feeAmount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AssetAllowed",
    inputs: [{ indexed: true, name: "asset", type: "address" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "AssetDisallowed",
    inputs: [{ indexed: true, name: "asset", type: "address" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "SignerUpdated",
    inputs: [
      { indexed: true, name: "oldSigner", type: "address" },
      { indexed: true, name: "newSigner", type: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GuardianUpdated",
    inputs: [
      { indexed: true, name: "oldGuardian", type: "address" },
      { indexed: true, name: "newGuardian", type: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MaxSettlementAmountUpdated",
    inputs: [
      { indexed: false, name: "oldAmount", type: "uint256" },
      { indexed: false, name: "newAmount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SignerRotationProposed",
    inputs: [
      { indexed: true, name: "proposedSigner", type: "address" },
      { indexed: false, name: "readyAt", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SignerRotationCancelled",
    inputs: [
      { indexed: true, name: "cancelledSigner", type: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "OrderReset",
    inputs: [{ indexed: true, name: "orderId", type: "bytes32" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "OrderVoidedEvent",
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "reason", type: "string" },
    ],
    anonymous: false,
  },
] as const;

export const HAGGLE_DISPUTE_REGISTRY_ABI = [
  {
    type: "constructor",
    inputs: [{ name: "initialOwner", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "anchorDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "disputeCaseId", type: "bytes32" },
      { name: "evidenceRootHash", type: "bytes32" },
      { name: "resolutionHash", type: "bytes32" },
    ],
    outputs: [{ name: "anchorId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "grantResolver",
    stateMutability: "nonpayable",
    inputs: [{ name: "resolver", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeResolver",
    stateMutability: "nonpayable",
    inputs: [{ name: "resolver", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "supersedeAnchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "oldAnchorId", type: "bytes32" },
      { name: "newEvidenceRootHash", type: "bytes32" },
      { name: "newResolutionHash", type: "bytes32" },
    ],
    outputs: [{ name: "newAnchorId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "revokeAnchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anchorId", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getOrderAnchors",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "getOrderAnchorCount",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "resolvers",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "disputeAnchored",
    stateMutability: "view",
    inputs: [
      { name: "orderId", type: "bytes32" },
      { name: "disputeCaseId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "anchors",
    stateMutability: "view",
    inputs: [{ name: "anchorId", type: "bytes32" }],
    outputs: [
      { name: "orderId", type: "bytes32" },
      { name: "disputeCaseId", type: "bytes32" },
      { name: "evidenceRootHash", type: "bytes32" },
      { name: "resolutionHash", type: "bytes32" },
      { name: "anchoredAt", type: "uint256" },
      { name: "supersededBy", type: "bytes32" },
      { name: "revoked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "MAX_ANCHORS_PER_ORDER",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "DisputeAnchored",
    inputs: [
      { indexed: true, name: "anchorId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "disputeCaseId", type: "bytes32" },
      { indexed: false, name: "evidenceRootHash", type: "bytes32" },
      { indexed: false, name: "resolutionHash", type: "bytes32" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ResolverGranted",
    inputs: [{ indexed: true, name: "resolver", type: "address" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "ResolverRevoked",
    inputs: [{ indexed: true, name: "resolver", type: "address" }],
    anonymous: false,
  },
  {
    type: "event",
    name: "AnchorRevoked",
    inputs: [
      { indexed: true, name: "anchorId", type: "bytes32" },
      { indexed: false, name: "reason", type: "string" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AnchorSuperseded",
    inputs: [
      { indexed: true, name: "oldAnchorId", type: "bytes32" },
      { indexed: true, name: "newAnchorId", type: "bytes32" },
    ],
    anonymous: false,
  },
] as const;

// EIP-712 domain for off-chain signing (used by backend)
export const SETTLEMENT_EIP712_DOMAIN = {
  name: "HaggleSettlementRouter",
  version: "1",
} as const;

export const SETTLEMENT_EIP712_TYPES = {
  Settlement: [
    { name: "orderId", type: "bytes32" },
    { name: "paymentIntentId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "sellerWallet", type: "address" },
    { name: "feeWallet", type: "address" },
    { name: "asset", type: "address" },
    { name: "grossAmount", type: "uint256" },
    { name: "sellerAmount", type: "uint256" },
    { name: "feeAmount", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "signerNonce", type: "uint256" },
  ],
} as const;
