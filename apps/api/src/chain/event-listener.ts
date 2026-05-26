/**
 * On-chain Event Listener / Indexer
 *
 * Polls SettlementRouter and DisputeRegistry contract events,
 * reconciling on-chain state with the database.
 *
 * Read-only: no private keys needed. Uses getLogs to fetch events
 * since the last cursor, processes them idempotently, and updates
 * the cursor atomically.
 *
 * Security:
 * - RPC URL from env var only, never hardcoded
 * - Contract addresses from env vars only
 * - 2-block confirmation buffer for reorg protection
 * - Idempotent: same tx hash re-processed = no-op
 * - Missing env vars = graceful disable (log once, don't crash)
 */

import {
  HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
  HAGGLE_SETTLEMENT_ROUTER_ABI,
  HAGGLE_DISPUTE_REGISTRY_ABI,
} from "@haggle/contracts";
import {
  type Database,
  chainSyncCursors,
  eq,
} from "@haggle/db";
import {
  createPublicClient,
  http,
  decodeEventLog,
  type PublicClient,
  type Log,
  type Address,
} from "viem";
import { base, baseSepolia } from "viem/chains";

import { handleSettlementEvent } from "./handlers/settlement-handler.js";
import { handleDisputeEvent } from "./handlers/dispute-handler.js";
import { handleConditionalSettlementEvent } from "./handlers/conditional-settlement-handler.js";

// ── Config ──────────────────────────────────────────────────────

export interface ChainListenerConfig {
  rpcUrl: string;
  chainId: number;
  settlementRouterAddress?: Address;
  conditionalSettlementAddress?: Address;
  disputeRegistryAddress?: Address;
  /** Number of block confirmations before processing (reorg protection). Default: 2 */
  confirmations: number;
  /** Maximum blocks to scan per poll cycle. Default: 2000 */
  maxBlockRange: number;
}

let configLoggedOnce = false;

/**
 * Read config from env vars. Returns null if no RPC URL or no contract addresses,
 * meaning the listener should be silently disabled.
 */
export function createChainListenerConfig(): ChainListenerConfig | null {
  const rpcUrl = process.env.BASE_RPC_URL ?? process.env.HAGGLE_BASE_RPC_URL;
  if (!rpcUrl) {
    if (!configLoggedOnce) {
      console.log("[chain-listener] No BASE_RPC_URL — chain event sync disabled");
      configLoggedOnce = true;
    }
    return null;
  }

  const settlementRouterAddress = (
    process.env.HAGGLE_SETTLEMENT_ROUTER_ADDRESS
    ?? process.env.SETTLEMENT_ROUTER_ADDRESS
  ) as Address | undefined;
  const conditionalSettlementAddress = (
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS
    ?? process.env.CONDITIONAL_SETTLEMENT_ADDRESS
  ) as Address | undefined;
  const disputeRegistryAddress = (
    process.env.HAGGLE_DISPUTE_REGISTRY_ADDRESS
    ?? process.env.DISPUTE_REGISTRY_ADDRESS
  ) as Address | undefined;

  if (!settlementRouterAddress && !conditionalSettlementAddress && !disputeRegistryAddress) {
    if (!configLoggedOnce) {
      console.log("[chain-listener] No contract addresses configured — chain event sync disabled");
      configLoggedOnce = true;
    }
    return null;
  }

  const chainIdRaw = process.env.BASE_CHAIN_ID;
  const chainId = chainIdRaw ? Number(chainIdRaw) : 8453; // default to Base mainnet

  return {
    rpcUrl,
    chainId,
    settlementRouterAddress,
    conditionalSettlementAddress,
    disputeRegistryAddress,
    confirmations: 2,
    maxBlockRange: 2000,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function createClient(config: ChainListenerConfig): PublicClient {
  const chain = config.chainId === 84532 ? baseSepolia : base;
  return createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  }) as PublicClient;
}

async function readCursor(db: Database, cursorId: string): Promise<bigint> {
  const rows = await db
    .select({ lastBlockNumber: chainSyncCursors.lastBlockNumber })
    .from(chainSyncCursors)
    .where(eq(chainSyncCursors.id, cursorId))
    .limit(1);

  if (rows.length === 0) return 0n;
  return BigInt(rows[0]!.lastBlockNumber);
}

async function upsertCursor(
  db: Database,
  cursorId: string,
  chainId: number,
  blockNumber: bigint,
): Promise<void> {
  const now = new Date();

  // Atomic upsert — eliminates race condition between update and insert
  await db
    .insert(chainSyncCursors)
    .values({
      id: cursorId,
      chainId,
      lastBlockNumber: blockNumber.toString(),
      lastSyncedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: chainSyncCursors.id,
      set: {
        lastBlockNumber: blockNumber.toString(),
        lastSyncedAt: now,
        updatedAt: now,
      },
    });
}

async function syncContractEvents(params: {
  db: Database;
  config: ChainListenerConfig;
  cursorId: string;
  address: Address | undefined;
  abi: readonly unknown[];
  handleEvent: (db: Database, log: Log, event: { eventName: string; args: Record<string, unknown> }) => Promise<void>;
  logLabel: string;
}): Promise<{ processed: number; toBlock: bigint }> {
  if (!params.address) {
    return { processed: 0, toBlock: 0n };
  }

  const client = createClient(params.config);
  const lastBlock = await readCursor(params.db, params.cursorId);
  const currentBlock = await client.getBlockNumber();
  const safeBlock = currentBlock - BigInt(params.config.confirmations);

  if (safeBlock <= lastBlock) {
    return { processed: 0, toBlock: lastBlock };
  }

  const fromBlock = lastBlock + 1n;
  const toBlock = safeBlock < fromBlock + BigInt(params.config.maxBlockRange)
    ? safeBlock
    : fromBlock + BigInt(params.config.maxBlockRange) - 1n;

  const logs = await client.getLogs({
    address: params.address,
    fromBlock,
    toBlock,
  });

  let processed = 0;

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: params.abi,
        data: log.data,
        topics: log.topics,
      });

      await params.handleEvent(params.db, log as Log, decoded);
      processed++;
    } catch (error) {
      console.error(
        `[chain-listener] Failed to process ${params.logLabel} log tx=${log.transactionHash} logIndex=${log.logIndex}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  await upsertCursor(params.db, params.cursorId, params.config.chainId, toBlock);

  if (processed > 0) {
    console.log(
      `[chain-listener] Processed ${processed} ${params.logLabel} event(s), blocks ${fromBlock}-${toBlock}`,
    );
  }

  return { processed, toBlock };
}

// ── Settlement Event Sync ───────────────────────────────────────

const SETTLEMENT_EVENTS = HAGGLE_SETTLEMENT_ROUTER_ABI.filter(
  (item) => item.type === "event",
);

export async function syncSettlementEvents(
  db: Database,
  config: ChainListenerConfig,
): Promise<{ processed: number; toBlock: bigint }> {
  return syncContractEvents({
    db,
    config,
    cursorId: "settlement_router",
    address: config.settlementRouterAddress,
    abi: SETTLEMENT_EVENTS,
    handleEvent: handleSettlementEvent,
    logLabel: "settlement",
  });
}

// ── Conditional Settlement Event Sync ────────────────────────────────

const CONDITIONAL_SETTLEMENT_EVENTS = HAGGLE_CONDITIONAL_SETTLEMENT_ABI.filter(
  (item) => item.type === "event",
);

export async function syncConditionalSettlementEvents(
  db: Database,
  config: ChainListenerConfig,
): Promise<{ processed: number; toBlock: bigint }> {
  return syncContractEvents({
    db,
    config,
    cursorId: "conditional_settlement",
    address: config.conditionalSettlementAddress,
    abi: CONDITIONAL_SETTLEMENT_EVENTS,
    handleEvent: handleConditionalSettlementEvent,
    logLabel: "conditional settlement",
  });
}

// ── Dispute Event Sync ──────────────────────────────────────────

const DISPUTE_EVENTS = HAGGLE_DISPUTE_REGISTRY_ABI.filter(
  (item) => item.type === "event",
);

export async function syncDisputeEvents(
  db: Database,
  config: ChainListenerConfig,
): Promise<{ processed: number; toBlock: bigint }> {
  return syncContractEvents({
    db,
    config,
    cursorId: "dispute_registry",
    address: config.disputeRegistryAddress,
    abi: DISPUTE_EVENTS,
    handleEvent: handleDisputeEvent,
    logLabel: "dispute",
  });
}
