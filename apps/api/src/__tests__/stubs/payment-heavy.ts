/**
 * Stub for @haggle/payment-core/heavy/* subpath exports.
 * These modules depend on viem and are not resolvable without a full build.
 * In tests we use MockX402Adapter (default when HAGGLE_X402_MODE is not "real").
 */
export class RealX402Adapter {
  constructor(_opts: unknown) {}
}

export class ViemDisputeRegistryContract {
  constructor(..._args: unknown[]) {}
}

export class ViemSettlementRouterContract {
  constructor(..._args: unknown[]) {}
}
