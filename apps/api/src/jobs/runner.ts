/**
 * Cron job runner infrastructure.
 *
 * Uses setInterval-based scheduling (no external dependencies).
 * Only starts if ENABLE_CRON=true environment variable is set.
 *
 * Each job is a standalone async function wrapped in try-catch
 * so one failing job never takes down others.
 */

import type { Database } from "@haggle/db";
import { runSettlementAutoRelease } from "./settlement-auto-release.js";
import { runPaymentIntentExpiry } from "./payment-intent-expiry.js";
import { runShipmentSlaCheck } from "./shipment-sla-check.js";
import { runDisputeDepositExpiry } from "./dispute-deposit-expiry.js";
import { runChainEventSync } from "./chain-event-sync.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CronJob {
  name: string;
  /** Interval in milliseconds */
  intervalMs: number;
  handler: (db: Database) => Promise<void>;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Job Registry
// ---------------------------------------------------------------------------

function buildJobRegistry(): CronJob[] {
  return [
    {
      name: "settlement-auto-release",
      intervalMs: 5 * 60 * 1000, // every 5 minutes
      handler: runSettlementAutoRelease,
      enabled: true,
    },
    {
      name: "payment-intent-expiry",
      intervalMs: 15 * 60 * 1000, // every 15 minutes
      handler: runPaymentIntentExpiry,
      enabled: true,
    },
    {
      name: "shipment-sla-check",
      intervalMs: 15 * 60 * 1000, // every 15 minutes
      handler: runShipmentSlaCheck,
      enabled: true,
    },
    {
      name: "dispute-deposit-expiry",
      intervalMs: 60 * 60 * 1000, // every hour
      handler: runDisputeDepositExpiry,
      enabled: true,
    },
    {
      name: "chain-event-sync",
      intervalMs: 60 * 1000, // every 60 seconds
      handler: runChainEventSync,
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const activeTimers: ReturnType<typeof setInterval>[] = [];
const runningJobs = new Set<string>();

/**
 * Initialize and start all cron jobs.
 * No-op if ENABLE_CRON !== "true".
 */
export function initCronJobs(db: Database): void {
  if (process.env.ENABLE_CRON !== "true") {
    console.log("[cron] ENABLE_CRON is not set to 'true' — cron jobs disabled");
    return;
  }

  const jobs = buildJobRegistry();
  const enabledJobs = jobs.filter((j) => j.enabled);

  console.log(
    `[cron] Starting ${enabledJobs.length} job(s): ${enabledJobs.map((j) => j.name).join(", ")}`,
  );

  for (const job of enabledJobs) {
    const timer = setInterval(async () => {
      // Guard: skip if previous invocation is still running
      if (runningJobs.has(job.name)) {
        console.log(`[cron] ${job.name} still running, skipping`);
        return;
      }
      runningJobs.add(job.name);
      const start = Date.now();
      try {
        await job.handler(db);
        const elapsed = Date.now() - start;
        if (elapsed > 5000) {
          console.log(`[cron] ${job.name} completed in ${elapsed}ms`);
        }
      } catch (error) {
        console.error(
          `[cron] ${job.name} FAILED:`,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        runningJobs.delete(job.name);
      }
    }, job.intervalMs);

    // Allow process to exit even if timers are pending
    timer.unref();
    activeTimers.push(timer);
  }
}

/**
 * Stop all running cron jobs. Useful for graceful shutdown and tests.
 */
export function stopCronJobs(): void {
  for (const timer of activeTimers) {
    clearInterval(timer);
  }
  activeTimers.length = 0;
  console.log("[cron] All cron jobs stopped");
}
