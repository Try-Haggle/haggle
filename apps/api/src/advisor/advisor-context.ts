/**
 * Assembles case context for the AI Advisor system prompt.
 *
 * Fetches dispute, order, evidence, resolution, and cost info
 * to build a structured context string. The advisor sees ALL evidence
 * from both sides to provide honest analysis.
 */

import type { Database } from "@haggle/db";
import type { AdvisorRole } from "./advisor-types.js";
import { getDisputeById } from "../services/dispute-record.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";
import { computeDisputeCost } from "@haggle/dispute-core";
import type { DisputeEvidence } from "@haggle/dispute-core";

export interface AdvisorContext {
  contextString: string;
  disputeStatus: string;
  amountCents: number;
}

export async function assembleAdvisorContext(
  db: Database,
  disputeId: string,
  userRole: AdvisorRole,
): Promise<AdvisorContext> {
  // 1. Fetch dispute
  const dispute = await getDisputeById(db, disputeId);
  if (!dispute) {
    throw new Error("DISPUTE_NOT_FOUND");
  }

  // 2. Fetch order for item info and amount
  const order = await getCommerceOrderByOrderId(db, dispute.order_id);
  const amountCents = order?.amountMinor
    ? parseInt(String(order.amountMinor))
    : 0;

  // 3. Determine tier
  const meta = dispute.metadata as Record<string, unknown> | null;
  const currentTier = (meta?.tier as number | undefined) ?? 1;

  // 4. Compute costs for each tier
  const t1Cost = amountCents > 0 ? computeDisputeCost(amountCents, 1) : null;
  const t2Cost = amountCents > 0 ? computeDisputeCost(amountCents, 2) : null;
  const t3Cost = amountCents > 0 ? computeDisputeCost(amountCents, 3) : null;

  // 5. Format evidence from both sides
  const buyerEvidence = dispute.evidence.filter(
    (e) => e.submitted_by === "buyer",
  );
  const sellerEvidence = dispute.evidence.filter(
    (e) => e.submitted_by === "seller",
  );
  const systemEvidence = dispute.evidence.filter(
    (e) => e.submitted_by === "system",
  );

  function formatEvidence(
    items: DisputeEvidence[],
    label: string,
  ): string {
    if (items.length === 0) return `${label}: None submitted.`;
    return `${label}:\n${items
      .map(
        (e, i) =>
          `  ${i + 1}. [${e.type}] ${e.text ? e.text.slice(0, 500) : "(file attachment)"}${e.uri ? " (has attachment)" : ""} — submitted ${e.created_at}`,
      )
      .join("\n")}`;
  }

  // 6. Resolution info (if exists)
  let resolutionInfo = "";
  if (dispute.resolution) {
    resolutionInfo = `\nPREVIOUS RESOLUTION:\n  Outcome: ${dispute.resolution.outcome}\n  Summary: ${dispute.resolution.summary}`;
    if (dispute.resolution.refund_amount_minor) {
      resolutionInfo += `\n  Refund: $${(dispute.resolution.refund_amount_minor / 100).toFixed(2)}`;
    }
  }

  // 7. Build context string
  const contextString = `DISPUTE CASE CONTEXT:
Dispute ID: ${disputeId}
Status: ${dispute.status}
Reason: ${dispute.reason_code.replace(/_/g, " ")}
Current Tier: T${currentTier}
Opened By: ${dispute.opened_by}
Opened At: ${dispute.opened_at}
Transaction Amount: $${amountCents > 0 ? (amountCents / 100).toFixed(2) : "unknown"}

${formatEvidence(buyerEvidence, "BUYER'S EVIDENCE")}

${formatEvidence(sellerEvidence, "SELLER'S EVIDENCE")}

${systemEvidence.length > 0 ? formatEvidence(systemEvidence, "SYSTEM EVIDENCE") : ""}
${resolutionInfo}

DISPUTE COST INFORMATION:
${t1Cost ? `  T1 (AI Review): $${(t1Cost.cost_cents / 100).toFixed(2)} — loser pays` : "  T1 (AI Review): cost unavailable"}
${t2Cost ? `  T2 (DS Panel): $${(t2Cost.cost_cents / 100).toFixed(2)} — requires deposit, loser pays` : ""}
${t3Cost ? `  T3 (Expert Panel): $${(t3Cost.cost_cents / 100).toFixed(2)} — requires deposit, loser pays` : ""}

YOUR ROLE: You are advising the ${userRole}.`.trim();

  return {
    contextString,
    disputeStatus: dispute.status,
    amountCents,
  };
}
