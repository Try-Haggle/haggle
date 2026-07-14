import { type Address, createPublicClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const SETTLEMENT_PREFLIGHT_ABI = [
  {
    type: "function",
    name: "signer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "allowedAssets",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

export interface ConditionalSettlementPreflightClient {
  getChainId(): Promise<number>;
  getBytecode(input: { address: Address }): Promise<Hex | undefined>;
  readContract(input: Record<string, unknown>): Promise<unknown>;
}

export interface ConditionalSettlementPreflightConfig {
  network: "base" | "base-sepolia";
  rpcUrl: string;
  settlementAddress: Address;
  usdcAddress: Address;
  relayerPrivateKey: Hex;
}

export interface ConditionalSettlementPreflightResult {
  status: "ready" | "blocked" | "unavailable";
  ready: boolean;
  checks: {
    rpc_reachable: boolean;
    chain_id_match: boolean;
    settlement_bytecode: boolean;
    usdc_bytecode: boolean;
    signer_matches: boolean;
    usdc_allowed: boolean;
  };
  blocked_by: string[];
  expected_chain_id: number;
  observed_chain_id: number | null;
  settlement_bytecode_bytes: number;
  usdc_bytecode_bytes: number;
  error_code: "RPC_UNAVAILABLE" | "RPC_TIMEOUT" | null;
  checked_at: string;
  duration_ms: number;
}

function hasCode(value: Hex | undefined): value is Hex {
  return Boolean(value && value !== "0x" && value.length > 2);
}

function bytecodeBytes(value: Hex | undefined): number {
  return hasCode(value) ? (value.length - 2) / 2 : 0;
}

function expectedChainId(network: ConditionalSettlementPreflightConfig["network"]): number {
  return network === "base-sepolia" ? baseSepolia.id : base.id;
}

export function validateConditionalSettlementPreflightConfig(input: {
  network?: string;
  rpcUrl?: string;
  settlementAddress?: string;
  usdcAddress?: string;
  relayerPrivateKey?: string;
  requireHttps?: boolean;
}):
  | { ok: true; config: ConditionalSettlementPreflightConfig }
  | { ok: false; blockedBy: string[] } {
  const blockedBy: string[] = [];
  if (input.network !== "base" && input.network !== "base-sepolia")
    blockedBy.push("supported_network");
  try {
    const url = new URL(input.rpcUrl ?? "");
    if (
      (input.requireHttps && url.protocol !== "https:") ||
      (!input.requireHttps && url.protocol !== "http:" && url.protocol !== "https:")
    )
      blockedBy.push("base_rpc");
  } catch {
    blockedBy.push("base_rpc");
  }
  if (
    !input.settlementAddress ||
    !EVM_ADDRESS.test(input.settlementAddress) ||
    /^0x0{40}$/i.test(input.settlementAddress)
  )
    blockedBy.push("conditional_settlement_address");
  if (
    !input.usdcAddress ||
    !EVM_ADDRESS.test(input.usdcAddress) ||
    /^0x0{40}$/i.test(input.usdcAddress)
  )
    blockedBy.push("usdc_asset_address");
  if (
    !input.relayerPrivateKey ||
    !PRIVATE_KEY.test(input.relayerPrivateKey) ||
    /^0x0{64}$/i.test(input.relayerPrivateKey)
  )
    blockedBy.push("relayer_signer");
  if (blockedBy.length > 0) return { ok: false, blockedBy: [...new Set(blockedBy)] };
  return {
    ok: true,
    config: {
      network: input.network as ConditionalSettlementPreflightConfig["network"],
      rpcUrl: input.rpcUrl as string,
      settlementAddress: input.settlementAddress as Address,
      usdcAddress: input.usdcAddress as Address,
      relayerPrivateKey: input.relayerPrivateKey as Hex,
    },
  };
}

export async function runConditionalSettlementPreflight(
  config: ConditionalSettlementPreflightConfig,
  options: {
    client?: ConditionalSettlementPreflightClient;
    expectedSignerAddress?: Address;
    timeoutMs?: number;
    now?: () => Date;
  } = {},
): Promise<ConditionalSettlementPreflightResult> {
  const startedAt = Date.now();
  const expectedId = expectedChainId(config.network);
  const checks = {
    rpc_reachable: false,
    chain_id_match: false,
    settlement_bytecode: false,
    usdc_bytecode: false,
    signer_matches: false,
    usdc_allowed: false,
  };
  let observedChainId: number | null = null;
  let settlementCode: Hex | undefined;
  let usdcCode: Hex | undefined;
  const client =
    options.client ??
    createPublicClient({
      chain: config.network === "base-sepolia" ? baseSepolia : base,
      transport: http(config.rpcUrl, {
        retryCount: 0,
        timeout: Math.min(options.timeoutMs ?? 5_000, 5_000),
      }),
    });
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 5_000, 5_000));
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const probe = (async () => {
      [observedChainId, settlementCode, usdcCode] = await Promise.all([
        client.getChainId(),
        client.getBytecode({ address: config.settlementAddress }),
        client.getBytecode({ address: config.usdcAddress }),
      ]);
      checks.rpc_reachable = true;
      checks.chain_id_match = observedChainId === expectedId;
      checks.settlement_bytecode = hasCode(settlementCode);
      checks.usdc_bytecode = hasCode(usdcCode);
      if (!checks.chain_id_match || !checks.settlement_bytecode || !checks.usdc_bytecode) return;

      const expectedSigner = (
        options.expectedSignerAddress ?? privateKeyToAccount(config.relayerPrivateKey).address
      ).toLowerCase();
      const [deployedSigner, usdcAllowed] = await Promise.all([
        client.readContract({
          address: config.settlementAddress,
          abi: SETTLEMENT_PREFLIGHT_ABI,
          functionName: "signer",
        }),
        client.readContract({
          address: config.settlementAddress,
          abi: SETTLEMENT_PREFLIGHT_ABI,
          functionName: "allowedAssets",
          args: [config.usdcAddress],
        }),
      ]);
      checks.signer_matches =
        typeof deployedSigner === "string" && deployedSigner.toLowerCase() === expectedSigner;
      checks.usdc_allowed = usdcAllowed === true;
    })();
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(Object.assign(new Error("RPC_TIMEOUT"), { code: "RPC_TIMEOUT" })),
        timeoutMs,
      );
    });
    await Promise.race([probe, timeout]);
  } catch (error) {
    const errorCode =
      error && typeof error === "object" && "code" in error && error.code === "RPC_TIMEOUT"
        ? "RPC_TIMEOUT"
        : "RPC_UNAVAILABLE";
    return {
      status: "unavailable",
      ready: false,
      checks,
      blocked_by: Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name),
      expected_chain_id: expectedId,
      observed_chain_id: observedChainId,
      settlement_bytecode_bytes: bytecodeBytes(settlementCode),
      usdc_bytecode_bytes: bytecodeBytes(usdcCode),
      error_code: errorCode,
      checked_at: (options.now?.() ?? new Date()).toISOString(),
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const blockedBy = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    status: blockedBy.length === 0 ? "ready" : "blocked",
    ready: blockedBy.length === 0,
    checks,
    blocked_by: blockedBy,
    expected_chain_id: expectedId,
    observed_chain_id: observedChainId,
    settlement_bytecode_bytes: bytecodeBytes(settlementCode),
    usdc_bytecode_bytes: bytecodeBytes(usdcCode),
    error_code: null,
    checked_at: (options.now?.() ?? new Date()).toISOString(),
    duration_ms: Date.now() - startedAt,
  };
}
