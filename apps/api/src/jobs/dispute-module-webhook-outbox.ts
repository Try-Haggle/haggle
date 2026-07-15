/**
 * Dispute module webhook outbox dispatcher.
 *
 * Delivers due platform webhooks that were durably persisted by the module
 * dispute API. Row claiming happens in the service layer with a short lease so
 * multiple API instances can run the job without intentionally duplicating work.
 */

import type { Database } from "@haggle/db";
import { dispatchDueDisputeModuleWebhookOutbox } from "../services/dispute-module-webhook.service.js";
import { sendDisputeModuleWebhookDeadLetterAlert } from "../services/dispute-module-webhook-alert.service.js";

const DEFAULT_BATCH_LIMIT = 25;

function configuredBatchLimit(): number {
  const raw = Number(process.env.DISPUTE_MODULE_WEBHOOK_OUTBOX_BATCH_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BATCH_LIMIT;
  return Math.min(Math.floor(raw), 100);
}

export async function runDisputeModuleWebhookOutbox(db: Database): Promise<void> {
  const result = await dispatchDueDisputeModuleWebhookOutbox(db, {
    limit: configuredBatchLimit(),
  });

  if (result.claimed > 0) {
    const message = `[dispute-module-webhook-outbox] claimed=${result.claimed} delivered=${result.delivered} failed=${result.failed} skipped=${result.skipped} dead_lettered=${result.deadLettered}`;
    if (result.deadLettered > 0) {
      console.error(message);
      try {
        const alert = await sendDisputeModuleWebhookDeadLetterAlert(result);
        if (alert.status === "failed") {
          console.error(
            `[dispute-module-webhook-outbox] dead-letter alert failed status=${alert.httpStatus ?? "none"} error=${alert.error ?? "none"}`,
          );
        }
      } catch (error) {
        console.error(
          `[dispute-module-webhook-outbox] dead-letter alert error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      console.log(message);
    }
  }
}
