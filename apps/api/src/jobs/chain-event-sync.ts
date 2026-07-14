/**
 * Chain Event Sync Job
 *
 * Polls SettlementRouter and DisputeRegistry contract events
 * and reconciles on-chain state with the database.
 *
 * Schedule: every 60 seconds
 * If no env vars are configured (no RPC URL / no contract addresses),
 * the job skips silently without error.
 */

import type { Database } from "@haggle/db";
import {
  createChainListenerConfig,
  syncConditionalSettlementEvents,
  syncDisputeEvents,
  syncSettlementEvents,
} from "../chain/event-listener.js";

export async function runChainEventSync(db: Database): Promise<void> {
  const config = createChainListenerConfig();
  if (!config) {
    // No config = graceful skip. Log message handled once inside createChainListenerConfig.
    return;
  }

  const [settlementResult, conditionalSettlementResult, disputeResult] = await Promise.allSettled([
    syncSettlementEvents(db, config),
    syncConditionalSettlementEvents(db, config),
    syncDisputeEvents(db, config),
  ]);

  // Log any failures from the parallel execution
  if (settlementResult.status === "rejected") {
    console.error(
      "[chain-event-sync] Settlement sync failed:",
      settlementResult.reason instanceof Error
        ? settlementResult.reason.message
        : String(settlementResult.reason),
    );
  }

  if (conditionalSettlementResult.status === "rejected") {
    console.error(
      "[chain-event-sync] Conditional settlement sync failed:",
      conditionalSettlementResult.reason instanceof Error
        ? conditionalSettlementResult.reason.message
        : String(conditionalSettlementResult.reason),
    );
  }

  if (disputeResult.status === "rejected") {
    console.error(
      "[chain-event-sync] Dispute sync failed:",
      disputeResult.reason instanceof Error
        ? disputeResult.reason.message
        : String(disputeResult.reason),
    );
  }
}
