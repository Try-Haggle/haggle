/**
 * First-party Case Guide HTTP wiring (CTO ticket F1).
 *
 * Loads dispute context, calls dispute-core harness via `runCaseGuide`, and
 * returns party-scoped summary + evidence organization only
 * (`dispute_ai_case_guide_v1`). Does not refund, release, settle, approve,
 * assess, or call `finalizeDisputeResolution`.
 */

import type { Database } from "@haggle/db";
import type { CaseGuideOutput, DisputeAiCaseContext, DisputeAiParty } from "@haggle/dispute-core";
import {
  assertDisputeCaseGuideDoesNotMoveMoney,
  buildDisputeCaseGuideMoneySafetyFields,
  type DISPUTE_CASE_GUIDE_AUTO_APPLIED,
  type DISPUTE_CASE_GUIDE_MONEY_MOVED,
} from "../lib/dispute-case-guide-money-guard.js";
import {
  buildDisputeAiCaseContextFromDispute,
  createDisputeAiProvider,
  type DisputeAiProvider,
  type DisputeAiProviderResponse,
  runCaseGuide,
} from "./dispute-ai.service.js";
import { getDisputeById } from "./dispute-record.service.js";
import { getCommerceOrderByOrderId } from "./payment-record.service.js";

export type DisputeCaseGuideRequest = {
  party: DisputeAiParty;
  message?: string;
  context?: string;
};

export type DisputeCaseGuideSuccess = {
  dispute_id: string;
  role: "case_guide";
  display_name: "Case Guide";
  schema_name: "dispute_ai_case_guide_v1";
  party: DisputeAiParty;
  case_guide: CaseGuideOutput;
  context_hash: string;
  model?: string;
  usage?: DisputeAiProviderResponse["usage"];
  money_moved: typeof DISPUTE_CASE_GUIDE_MONEY_MOVED;
  auto_applied: typeof DISPUTE_CASE_GUIDE_AUTO_APPLIED;
};

function mergePartyMessage(
  base: DisputeAiCaseContext,
  party: DisputeAiParty,
  message?: string,
  contextNote?: string,
): DisputeAiCaseContext {
  const parts = [base.party_statements[party], message, contextNote]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  if (parts.length === 0) return base;
  return {
    ...base,
    party_statements: {
      ...base.party_statements,
      [party]: parts.join("\n\n"),
    },
  };
}

export function buildCaseGuideContextFromDispute(
  dispute: NonNullable<Awaited<ReturnType<typeof getDisputeById>>>,
  party: DisputeAiParty,
  options: {
    amountMinor?: number;
    orderStatus?: string;
    message?: string;
    context?: string;
  } = {},
): DisputeAiCaseContext {
  const metadata =
    dispute.metadata && typeof dispute.metadata === "object" && !Array.isArray(dispute.metadata)
      ? (dispute.metadata as Record<string, unknown>)
      : {};
  const tierRaw = metadata.tier;
  const tier = tierRaw === 2 || tierRaw === 3 ? tierRaw : 1;
  const base = buildDisputeAiCaseContextFromDispute(dispute, {
    tier,
    transaction: {
      amount_minor: options.amountMinor ?? 0,
      currency: "USDC",
      status: options.orderStatus ?? dispute.status,
    },
    policy: {
      platform_rules: [
        "Case Guide organizes evidence and claims for one party only.",
        "Do not promise outcomes, move money, or impersonate Resolution Assessor.",
        "Ask for compact, verifiable evidence the platform can evaluate.",
      ],
    },
  });
  return mergePartyMessage(base, party, options.message, options.context);
}

export async function runDisputeCaseGuide(
  db: Database,
  disputeId: string,
  request: DisputeCaseGuideRequest,
  options: { provider?: DisputeAiProvider } = {},
): Promise<
  | { ok: true; result: DisputeCaseGuideSuccess }
  | {
      ok: false;
      error: string;
      message: string;
      statusCode: number;
      issues?: unknown;
      context_hash?: string;
    }
> {
  const dispute = await getDisputeById(db, disputeId);
  if (!dispute) {
    return {
      ok: false,
      error: "DISPUTE_NOT_FOUND",
      message: "Dispute not found",
      statusCode: 404,
    };
  }

  const order = await getCommerceOrderByOrderId(db, dispute.order_id);
  const amountMinor = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;
  const context = buildCaseGuideContextFromDispute(dispute, request.party, {
    amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0,
    orderStatus: order?.status,
    message: request.message,
    context: request.context,
  });

  const provider =
    options.provider ??
    createDisputeAiProvider({ correlationId: `dispute-ai:case-guide:${disputeId}` });
  const run = await runCaseGuide(context, request.party, provider);

  if (!run.ok) {
    return {
      ok: false,
      error: "CASE_GUIDE_FAILED",
      message: run.message,
      statusCode: 502,
      issues: run.issues,
      context_hash: run.contextHash,
    };
  }

  const moneySafety = buildDisputeCaseGuideMoneySafetyFields();
  assertDisputeCaseGuideDoesNotMoveMoney(moneySafety);

  const result: DisputeCaseGuideSuccess = {
    dispute_id: disputeId,
    role: "case_guide",
    display_name: "Case Guide",
    schema_name: "dispute_ai_case_guide_v1",
    party: request.party,
    case_guide: run.output,
    context_hash: run.contextHash,
    model: run.model,
    usage: run.usage,
    ...moneySafety,
  };

  return { ok: true, result };
}
