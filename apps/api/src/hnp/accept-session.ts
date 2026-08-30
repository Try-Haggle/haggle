import type { Database } from "@haggle/db";
import {
  createHnpAgreementObject,
  createHnpTransactionHandoff,
  createHnpTransactionHandoffFromSignals,
  type HnpAgreementObject,
  type HnpTransactionHandoff,
  type HnpTransactionHandoffChainSummary,
  summarizeHnpTransactionHandoffChain,
  validateHnpTransactionHandoff,
} from "@haggle/engine-session";
import { createRound, getRoundsBySessionId } from "../services/negotiation-round.service.js";
import { updateSessionState } from "../services/negotiation-session.service.js";
import { validateHnpIngress } from "../services/hnp-ingress.service.js";
import type { HnpAcceptEnvelope } from "./envelope-schema.js";

export interface HnpTransactionSignals {
  payment_decision?: "AUTO_APPROVE" | "HUMAN_APPROVAL_REQUIRED" | "BLOCKED";
  payment_reasons?: string[];
  settlement_completed?: boolean;
  dispute_evidence_packet_hashes?: string[];
  trust_event_hashes?: string[];
}

export interface NormalizeAcceptInput {
  accepted_message_id?: string;
  accepted_proposal_id?: string;
  hnp?: HnpAcceptEnvelope;
  agent_delegation?: {
    principal_user_id: string;
    agent_id: string;
    scopes: string[];
    expires_at_ms: number;
    delegation_id?: string;
  };
  transaction_signals?: HnpTransactionSignals;
}

export type NormalizedAcceptRequest =
  | {
      ok: true;
      acceptedMessageId?: string;
      acceptedProposalId?: string;
      acceptedProposalHash?: string;
      acceptedIssues?: Array<{
        issue_id: string;
        value: string | number | boolean;
        unit?: string;
        kind?: "NEGOTIABLE" | "INFORMATIONAL";
      }>;
      transactionSignals?: HnpTransactionSignals;
      agentDelegation?: NormalizeAcceptInput["agent_delegation"];
      hnp?: HnpAcceptEnvelope;
      protocol?: {
        messageId: string;
        idempotencyKey: string;
        sequence: number;
        senderRole: "BUYER" | "SELLER";
        senderAgentId: string;
        messageType: "ACCEPT";
        acceptedProposalHash?: string;
      };
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export type NormalizedAcceptOk = Extract<NormalizedAcceptRequest, { ok: true }>;

export interface AcceptSessionView {
  id: string;
  version: number;
  currentRound: number;
  status: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  groupId?: string | null;
  lastOfferPriceMinor?: string | number | null;
}

export type ApplyHnpAcceptResult =
  | {
      ok: true;
      updated: boolean;
      idempotent?: boolean;
      session_status: "ACCEPTED";
      agreement?: HnpAgreementObject;
      transaction_handoff?: HnpTransactionHandoff;
      transaction_handoff_summary?: HnpTransactionHandoffChainSummary;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export function normalizeAcceptRequest(
  body: NormalizeAcceptInput | undefined,
  sessionId: string,
  nowMs: number,
): NormalizedAcceptRequest {
  if (!body?.hnp) {
    return {
      ok: true,
      acceptedMessageId: body?.accepted_message_id,
      acceptedProposalId: body?.accepted_proposal_id,
      transactionSignals: body?.transaction_signals,
      agentDelegation: body?.agent_delegation,
    };
  }

  if (body.hnp.session_id !== sessionId) {
    return {
      ok: false,
      status: 400,
      body: { error: "HNP_SESSION_MISMATCH" },
    };
  }

  if (body.hnp.expires_at_ms <= nowMs) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "STALE_MESSAGE",
        retryable: false,
        related_message_id: body.hnp.message_id,
      },
    };
  }

  return {
    ok: true,
    acceptedMessageId: body.hnp.payload.accepted_message_id,
    acceptedProposalId: body.hnp.payload.accepted_proposal_id,
    acceptedProposalHash: body.hnp.payload.accepted_proposal_hash,
    acceptedIssues: body.hnp.payload.accepted_issues,
    transactionSignals: body.transaction_signals,
    agentDelegation: body.agent_delegation,
    hnp: body.hnp,
    protocol: {
      messageId: body.hnp.message_id,
      idempotencyKey: body.hnp.idempotency_key,
      sequence: body.hnp.sequence,
      senderRole: body.hnp.sender_role,
      senderAgentId: body.hnp.sender_agent_id,
      messageType: "ACCEPT",
      acceptedProposalHash: body.hnp.payload.accepted_proposal_hash,
    },
  };
}

export async function applyHnpAccept(
  db: Database,
  session: AcceptSessionView,
  accepted: NormalizedAcceptOk,
): Promise<ApplyHnpAcceptResult> {
  if (accepted.protocol) {
    const hnpIngress = await validateHnpIngress(db, session.id, {
      envelope: accepted.hnp,
      protocol: accepted.protocol,
    });
    if (!hnpIngress.ok) {
      return { ok: false, status: hnpIngress.status, body: hnpIngress.body };
    }
  }

  const acceptableStatuses = new Set(["ACTIVE", "NEAR_DEAL"]);
  if (!acceptableStatuses.has(session.status)) {
    const idempotentAccept =
      session.status === "ACCEPTED" && accepted.protocol
        ? await findIdempotentAcceptedRound(db, session.id, accepted)
        : null;
    if (idempotentAccept) {
      return {
        ok: true,
        updated: false,
        idempotent: true,
        session_status: "ACCEPTED",
        agreement: idempotentAccept.agreement as HnpAgreementObject | undefined,
        transaction_handoff: idempotentAccept.transactionHandoff as
          | HnpTransactionHandoff
          | undefined,
        transaction_handoff_summary: idempotentAccept.transactionHandoffSummary as
          | HnpTransactionHandoffChainSummary
          | undefined,
      };
    }

    return {
      ok: false,
      status: 409,
      body: { error: "INVALID_STATUS", message: `Cannot accept from ${session.status}` },
    };
  }

  let acceptedRound: Awaited<ReturnType<typeof getRoundsBySessionId>>[number] | null = null;
  if (accepted.acceptedMessageId || accepted.acceptedProposalId || accepted.acceptedProposalHash) {
    const rounds = await getRoundsBySessionId(db, session.id);
    acceptedRound = rounds.find((round) => roundMatchesAcceptedProposal(round, accepted)) ?? null;
    if (!acceptedRound) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "INVALID_PROPOSAL",
          message: "Accepted HNP proposal is not known for this session",
        },
      };
    }
    const storedIssues = getStoredHnpIssues(acceptedRound);
    if (
      accepted.acceptedIssues &&
      storedIssues.length > 0 &&
      !hnpIssuesEqual(accepted.acceptedIssues, storedIssues)
    ) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "INVALID_PROPOSAL_ISSUES",
          message: "Accepted issue snapshot does not match the stored HNP proposal",
        },
      };
    }
  }

  const acceptedAtMs = Date.now();
  const agreement = accepted.hnp
    ? buildAcceptedAgreement({
        session,
        accepted,
        acceptedRound,
        createdAtMs: acceptedAtMs,
      })
    : undefined;
  const handoff = agreement
    ? buildAcceptedTransactionHandoff({
        agreement,
        signals: accepted.transactionSignals,
        createdAtMs: acceptedAtMs,
      })
    : undefined;
  if (handoff && !handoff.validation.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "INVALID_TRANSACTION_HANDOFF",
        issues: handoff.validation.issues,
      },
    };
  }

  const updated = await finalizeAcceptedSession(db, {
    session,
    accepted,
    agreement,
    handoff,
  });

  if (!updated) {
    return { ok: false, status: 409, body: { error: "CONCURRENT_MODIFICATION" } };
  }

  return {
    ok: true,
    updated: true,
    session_status: "ACCEPTED",
    agreement,
    transaction_handoff: handoff?.handoff,
    transaction_handoff_summary: handoff?.summary,
  };
}

export function getAcceptedEventPriceMinor(input: {
  agreement?: HnpAgreementObject;
  session: { lastOfferPriceMinor?: string | number | null };
}): number {
  return (
    input.agreement?.agreed_price?.units_minor ??
    numberFromUnknown(input.session.lastOfferPriceMinor ?? 0)
  );
}

function roundMatchesAcceptedProposal(
  round: { id: string; metadata: Record<string, unknown> | null },
  accepted: {
    acceptedMessageId?: string;
    acceptedProposalId?: string;
    acceptedProposalHash?: string;
  },
): boolean {
  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ??
    {}) as Record<string, unknown>;
  const messageId = typeof hnp.messageId === "string" ? hnp.messageId : undefined;
  const proposalId = typeof hnp.proposalId === "string" ? hnp.proposalId : undefined;
  const proposalHash = typeof hnp.proposalHash === "string" ? hnp.proposalHash : undefined;

  return Boolean(
    (!accepted.acceptedMessageId ||
      accepted.acceptedMessageId === messageId ||
      accepted.acceptedMessageId === round.id) &&
      (!accepted.acceptedProposalId || accepted.acceptedProposalId === proposalId) &&
      (!accepted.acceptedProposalHash || accepted.acceptedProposalHash === proposalHash),
  );
}

function getStoredHnpIssues(round: { metadata: Record<string, unknown> | null }): Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}> {
  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ??
    {}) as Record<string, unknown>;
  return hnpIssueArrayOrEmpty(hnp.issues);
}

function hnpIssuesEqual(
  left: Array<{
    issue_id: string;
    value: string | number | boolean;
    unit?: string;
    kind?: "NEGOTIABLE" | "INFORMATIONAL";
  }>,
  right: Array<{
    issue_id: string;
    value: string | number | boolean;
    unit?: string;
    kind?: "NEGOTIABLE" | "INFORMATIONAL";
  }>,
): boolean {
  return JSON.stringify(normalizeHnpIssues(left)) === JSON.stringify(normalizeHnpIssues(right));
}

function normalizeHnpIssues(
  issues: Array<{
    issue_id: string;
    value: string | number | boolean;
    unit?: string;
    kind?: "NEGOTIABLE" | "INFORMATIONAL";
  }>,
): Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}> {
  return issues
    .map((issue) => ({
      issue_id: issue.issue_id,
      value: issue.value,
      ...(issue.unit ? { unit: issue.unit } : {}),
      ...(issue.kind ? { kind: issue.kind } : {}),
    }))
    .sort((a, b) => a.issue_id.localeCompare(b.issue_id));
}

function buildAcceptedAgreement(input: {
  session: {
    id: string;
    buyerId: string;
    sellerId: string;
    lastOfferPriceMinor?: string | number | null;
  };
  accepted: {
    acceptedMessageId?: string;
    acceptedProposalId?: string;
    acceptedProposalHash?: string;
    acceptedIssues?: Array<{
      issue_id: string;
      value: string | number | boolean;
      unit?: string;
      kind?: "NEGOTIABLE" | "INFORMATIONAL";
    }>;
  };
  acceptedRound: {
    id: string;
    priceminor?: string | number | null;
    priceMinor?: string | number | null;
    counterPriceMinor?: string | number | null;
    metadata: Record<string, unknown> | null;
  } | null;
  createdAtMs: number;
}): HnpAgreementObject {
  const hnp = ((input.acceptedRound?.metadata?.protocol as Record<string, unknown> | undefined)
    ?.hnp ?? {}) as Record<string, unknown>;
  const acceptedMessageId =
    input.accepted.acceptedMessageId ??
    stringOrUndefined(hnp.messageId) ??
    input.acceptedRound?.id ??
    "";
  const acceptedProposalId =
    input.accepted.acceptedProposalId ?? stringOrUndefined(hnp.proposalId) ?? "";
  const acceptedProposalHash =
    input.accepted.acceptedProposalHash ?? stringOrUndefined(hnp.proposalHash);
  const acceptedIssues = input.accepted.acceptedIssues ?? hnpIssueArrayOrEmpty(hnp.issues);
  const currency = stringOrUndefined(hnp.currency) ?? "USD";
  const settlementPreconditions = stringArrayOrEmpty(hnp.settlementPreconditions);
  const agreedPriceMinor = numberFromUnknown(
    input.acceptedRound?.counterPriceMinor ??
      input.acceptedRound?.priceminor ??
      input.acceptedRound?.priceMinor ??
      input.session.lastOfferPriceMinor ??
      0,
  );

  return createHnpAgreementObject({
    session_id: input.session.id,
    accepted_message_id: acceptedMessageId,
    accepted_proposal_id: acceptedProposalId,
    accepted_proposal_hash: acceptedProposalHash,
    agreed_price: {
      currency,
      units_minor: agreedPriceMinor,
    },
    accepted_issues: acceptedIssues,
    parties: [
      { role: "BUYER", agent_id: input.session.buyerId },
      { role: "SELLER", agent_id: input.session.sellerId },
    ],
    settlement_preconditions: settlementPreconditions,
    created_at_ms: input.createdAtMs,
  });
}

function buildAcceptedTransactionHandoff(input: {
  agreement: HnpAgreementObject;
  signals?: HnpTransactionSignals;
  createdAtMs: number;
}): {
  handoff: HnpTransactionHandoff;
  summary: HnpTransactionHandoffChainSummary | undefined;
  validation: ReturnType<typeof validateHnpTransactionHandoff>;
} {
  const common = {
    agreement_hash: input.agreement.agreement_hash,
    listing_evidence_bundle_hash: input.agreement.listing_evidence_bundle_hash,
    payment_approval_policy_hash: input.agreement.payment_approval_policy_hash,
    shipping_terms_hash: input.agreement.shipping_terms_hash,
    trust_event_hashes: input.signals?.trust_event_hashes,
    created_at_ms: input.createdAtMs,
  };
  const handoff = input.signals
    ? createHnpTransactionHandoffFromSignals({
        ...common,
        payment_decision: input.signals.payment_decision,
        payment_reasons: input.signals.payment_reasons,
        settlement_completed: input.signals.settlement_completed,
        dispute_evidence_packet_hashes: input.signals.dispute_evidence_packet_hashes,
      })
    : createHnpTransactionHandoff({
        ...common,
        status: "ready_for_settlement",
      });
  const validation = validateHnpTransactionHandoff(handoff, { verifyHash: true });

  return {
    handoff,
    summary: validation.ok
      ? summarizeHnpTransactionHandoffChain([handoff], { verifyHash: true })
      : undefined,
    validation,
  };
}

async function finalizeAcceptedSession(
  db: Database,
  input: {
    session: {
      id: string;
      version: number;
      currentRound: number;
    };
    accepted: NormalizedAcceptOk;
    agreement?: HnpAgreementObject;
    handoff?: {
      handoff: HnpTransactionHandoff;
      summary: HnpTransactionHandoffChainSummary | undefined;
    };
  },
) {
  return db.transaction(async (tx) => {
    const shouldPersistAcceptRound = Boolean(
      input.agreement && input.handoff && input.accepted.protocol,
    );
    const updated = await updateSessionState(
      tx as unknown as Database,
      input.session.id,
      input.session.version,
      {
        status: "ACCEPTED",
        ...(shouldPersistAcceptRound ? { currentRound: input.session.currentRound + 1 } : {}),
      },
    );
    if (!updated) return null;

    if (shouldPersistAcceptRound && input.agreement && input.handoff && input.accepted.protocol) {
      await createAcceptedRoundRecord(tx as unknown as Database, {
        session: input.session,
        accepted: { ...input.accepted, protocol: input.accepted.protocol },
        agreement: input.agreement,
        handoff: input.handoff,
      });
    }

    return updated;
  });
}

async function createAcceptedRoundRecord(
  db: Database,
  input: {
    session: {
      id: string;
      currentRound: number;
    };
    accepted: {
      acceptedMessageId?: string;
      acceptedProposalId?: string;
      acceptedProposalHash?: string;
      hnp?: HnpAcceptEnvelope;
      protocol: NonNullable<NormalizedAcceptOk["protocol"]>;
    };
    agreement: HnpAgreementObject;
    handoff: {
      handoff: HnpTransactionHandoff;
      summary: HnpTransactionHandoffChainSummary | undefined;
    };
  },
): Promise<void> {
  await createRound(db, {
    sessionId: input.session.id,
    roundNo: input.session.currentRound + 1,
    senderRole: input.accepted.protocol.senderRole,
    messageType: "ACCEPT",
    priceminor: String(input.agreement.agreed_price?.units_minor ?? 0),
    decision: "ACCEPT",
    idempotencyKey: input.accepted.protocol.idempotencyKey,
    metadata: {
      protocol: {
        hnp: {
          messageId: input.accepted.protocol.messageId,
          idempotencyKey: input.accepted.protocol.idempotencyKey,
          sequence: input.accepted.protocol.sequence,
          senderAgentId: input.accepted.protocol.senderAgentId,
          messageType: input.accepted.protocol.messageType,
          acceptedProposalHash: input.accepted.protocol.acceptedProposalHash,
          acceptedMessageId: input.accepted.acceptedMessageId,
          acceptedProposalId: input.accepted.acceptedProposalId,
          type: "ACCEPT",
        },
      },
      agreement: input.agreement,
      transaction_handoff: input.handoff.handoff,
      transaction_handoff_summary: input.handoff.summary,
    },
  });
}

async function findIdempotentAcceptedRound(
  db: Database,
  sessionId: string,
  accepted: NormalizedAcceptOk,
): Promise<{
  agreement: unknown;
  transactionHandoff: unknown;
  transactionHandoffSummary: unknown;
} | null> {
  if (!accepted.protocol) return null;

  const rounds = await getRoundsBySessionId(db, sessionId);
  const round = rounds.find((candidate) =>
    roundMatchesAcceptedRetry(candidate, {
      ...accepted,
      protocol: accepted.protocol!,
    }),
  );
  if (!round) return null;

  const metadata = round.metadata as Record<string, unknown> | null;
  const agreement = metadata?.agreement;
  if (!agreement || typeof agreement !== "object") return null;

  return {
    agreement,
    transactionHandoff: metadata?.transaction_handoff,
    transactionHandoffSummary: metadata?.transaction_handoff_summary,
  };
}

function roundMatchesAcceptedRetry(
  round: Awaited<ReturnType<typeof getRoundsBySessionId>>[number],
  accepted: NormalizedAcceptOk & {
    protocol: NonNullable<NormalizedAcceptOk["protocol"]>;
  },
): boolean {
  if (round.idempotencyKey !== accepted.protocol.idempotencyKey) return false;
  if (round.messageType !== "ACCEPT") return false;

  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ??
    {}) as Record<string, unknown>;
  const type =
    typeof hnp.type === "string"
      ? hnp.type
      : typeof hnp.messageType === "string"
        ? hnp.messageType
        : undefined;

  if (type !== "ACCEPT") return false;
  if (hnp.messageId !== accepted.protocol.messageId) return false;
  if (hnp.idempotencyKey !== accepted.protocol.idempotencyKey) return false;
  if (hnp.sequence !== accepted.protocol.sequence) return false;
  if (hnp.senderAgentId !== accepted.protocol.senderAgentId) return false;
  if (accepted.acceptedMessageId && hnp.acceptedMessageId !== accepted.acceptedMessageId)
    return false;
  if (accepted.acceptedProposalId && hnp.acceptedProposalId !== accepted.acceptedProposalId)
    return false;
  if (accepted.acceptedProposalHash && hnp.acceptedProposalHash !== accepted.acceptedProposalHash)
    return false;

  return true;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function hnpIssueArrayOrEmpty(value: unknown): Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const issue = item as Record<string, unknown>;
    if (typeof issue.issue_id !== "string" || !issue.issue_id.trim()) return [];
    if (!["string", "number", "boolean"].includes(typeof issue.value)) return [];
    const normalized: {
      issue_id: string;
      value: string | number | boolean;
      unit?: string;
      kind?: "NEGOTIABLE" | "INFORMATIONAL";
    } = {
      issue_id: issue.issue_id,
      value: issue.value as string | number | boolean,
    };
    if (typeof issue.unit === "string") normalized.unit = issue.unit;
    if (issue.kind === "NEGOTIABLE" || issue.kind === "INFORMATIONAL") normalized.kind = issue.kind;
    return [normalized];
  });
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
