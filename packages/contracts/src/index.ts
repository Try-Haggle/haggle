// ─── Smart Contracts Package ─────────────────────────────────
// Solidity smart contracts compiled with Foundry, deployed on Base L2.
// Exports ABIs, deployed addresses, and TypeScript bindings (viem/wagmi).

// TODO: Initialize Foundry project (forge init)
// TODO: Implement HaggleSettlementRouter.sol on Base L2
// TODO: Implement HaggleDisputeRegistry.sol on Base L2
// TODO: Export contract ABIs and addresses
// TODO: Integrate x402 USDC payment protocol
// TODO: Deploy to Base Sepolia (testnet) → Base mainnet

export interface ContractAddresses {
  settlementRouter: `0x${string}` | null;
  disputeRegistry: `0x${string}` | null;
}

export const CONTRACT_ADDRESSES: ContractAddresses = {
  settlementRouter: null,
  disputeRegistry: null,
};

export const HAGGLE_SETTLEMENT_ROUTER_ABI = [
  {
    type: "function",
    name: "executeSettlement",
    stateMutability: "nonpayable",
    inputs: [
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
      { name: "approvalSnapshotHash", type: "bytes32" },
      { name: "reservationId", type: "bytes32" },
    ],
    outputs: [{ name: "executionId", type: "bytes32" }],
  },
  {
    type: "event",
    name: "SettlementExecuted",
    inputs: [
      { indexed: true, name: "executionId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "paymentIntentId", type: "bytes32" },
      { indexed: false, name: "sellerWallet", type: "address" },
      { indexed: false, name: "feeWallet", type: "address" },
      { indexed: false, name: "grossAmount", type: "uint256" },
      { indexed: false, name: "sellerAmount", type: "uint256" },
      { indexed: false, name: "feeAmount", type: "uint256" },
    ],
    anonymous: false,
  },
] as const;

export const HAGGLE_DISPUTE_REGISTRY_ABI = [
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
] as const;
