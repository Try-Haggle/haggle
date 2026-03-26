export * from "./types.js";
export * from "./state-machine.js";
export * from "./trust-events.js";
export * from "./provider.js";
export * from "./service.js";
export * from "./mock-x402-adapter.js";
export * from "./mock-stripe-adapter.js";
export * from "./execution.js";
export * from "./x402-contracts.js";
export * from "./x402-protocol.js";

export * from "./scaffold-contracts.js";
export * from "./facilitator-client.js";
export * from "./settlement-release.js";

// Heavy modules (depend on viem + @haggle/contracts).
// NOT re-exported from barrel — import directly when needed:
//   import { ViemSettlementRouterContract } from "@haggle/payment-core/src/viem-contracts.js";
//   import { RealX402Adapter } from "@haggle/payment-core/src/real-x402-adapter.js";
