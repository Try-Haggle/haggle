import { createHash } from "node:crypto";
import { and, desc, disputeAiAssessmentEvents, eq, sql, type Database } from "@haggle/db";

export interface DisputeAiAssessmentEventInput {
  id: string;
  disputeId: string;
  eventType: "COMPLETED" | "FAILED";
  revision?: number;
  versionId?: string;
  supersedesAssessmentId?: string;
  evidenceSnapshotHash: string;
  policyVersion: string;
  model?: string;
  contextHash: string;
  requestedBy: string;
  forced: boolean;
  reassessmentReason?: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface HashableDisputeAiAssessmentEvent {
  id: string;
  disputeId: string;
  eventType: "COMPLETED" | "FAILED";
  revision?: number | null;
  versionId?: string | null;
  supersedesAssessmentId?: string | null;
  evidenceSnapshotHash: string;
  policyVersion: string;
  model?: string | null;
  contextHash: string;
  requestedBy: string;
  forced: boolean;
  reassessmentReason?: string | null;
  payload: Record<string, unknown>;
  createdAt: Date | string;
  previousEventHash?: string | null;
  eventHash?: string | null;
}

export function canonicalDisputeAuditJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalDisputeAuditJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalDisputeAuditJson(record[key])}`).join(",")}}`;
}

function canonicalEvent(event: HashableDisputeAiAssessmentEvent, previousEventHash: string | null) {
  return {
    id: event.id,
    dispute_id: event.disputeId,
    event_type: event.eventType,
    revision: event.revision ?? null,
    version_id: event.versionId ?? null,
    supersedes_assessment_id: event.supersedesAssessmentId ?? null,
    evidence_snapshot_hash: event.evidenceSnapshotHash,
    policy_version: event.policyVersion,
    model: event.model ?? null,
    context_hash: event.contextHash,
    requested_by: event.requestedBy,
    forced: event.forced,
    reassessment_reason: event.reassessmentReason ?? null,
    payload: event.payload,
    created_at: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
    previous_event_hash: previousEventHash,
  };
}

export function buildDisputeAiAssessmentEventHash(
  event: HashableDisputeAiAssessmentEvent,
  previousEventHash: string | null,
): string {
  return createHash("sha256").update(canonicalDisputeAuditJson(canonicalEvent(event, previousEventHash))).digest("hex");
}

export function legacyDisputeAiAssessmentEventAnchor(event: HashableDisputeAiAssessmentEvent): string {
  return createHash("sha256")
    .update(`legacy:${canonicalDisputeAuditJson(canonicalEvent(event, null))}`)
    .digest("hex");
}

export function disputeAiAuditAdvisoryLockKey(disputeId: string) {
  return `dispute-ai-audit:${disputeId}`;
}

export function verifyDisputeAiAssessmentEventChain(events: HashableDisputeAiAssessmentEvent[]) {
  let valid = true;
  let legacyUnsealed = 0;
  let previousEffectiveHash: string | null = null;
  for (const event of events) {
    const effectiveHash = event.eventHash ?? legacyDisputeAiAssessmentEventAnchor(event);
    if (!event.eventHash) {
      legacyUnsealed += 1;
    } else {
      if (event.eventHash !== buildDisputeAiAssessmentEventHash(event, event.previousEventHash ?? null)) valid = false;
      if (previousEffectiveHash && event.previousEventHash !== previousEffectiveHash) valid = false;
    }
    previousEffectiveHash = effectiveHash;
  }
  return {
    valid,
    sealed_events: events.length - legacyUnsealed,
    legacy_unsealed_events: legacyUnsealed,
    head_event_hash: previousEffectiveHash,
  };
}

export async function appendDisputeAiAssessmentEvent(
  db: Database,
  input: DisputeAiAssessmentEventInput,
): Promise<void> {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${disputeAiAuditAdvisoryLockKey(input.disputeId)}, 0))
    `);
    await appendLockedDisputeAiAssessmentEvent(tx, input);
  });
}

async function appendLockedDisputeAiAssessmentEvent(db: Database, input: DisputeAiAssessmentEventInput) {
  const [latest] = await db
    .select()
    .from(disputeAiAssessmentEvents)
    .where(eq(disputeAiAssessmentEvents.disputeId, input.disputeId))
    .orderBy(desc(disputeAiAssessmentEvents.createdAt), desc(disputeAiAssessmentEvents.id))
    .limit(1);
  const [latestCompleted] = input.eventType === "COMPLETED" ? await db
    .select()
    .from(disputeAiAssessmentEvents)
    .where(and(
      eq(disputeAiAssessmentEvents.disputeId, input.disputeId),
      eq(disputeAiAssessmentEvents.eventType, "COMPLETED"),
    ))
    .orderBy(desc(disputeAiAssessmentEvents.revision), desc(disputeAiAssessmentEvents.createdAt))
    .limit(1) : [];
  if (input.eventType === "COMPLETED") {
    const expectedRevision = (latestCompleted?.revision ?? 0) + 1;
    if (input.revision !== expectedRevision) throw new Error("AI_AUDIT_REVISION_CONFLICT");
    const expectedSupersedes = latestCompleted?.id;
    if ((input.supersedesAssessmentId ?? null) !== (expectedSupersedes ?? null)) {
      throw new Error("AI_AUDIT_SUPERSEDES_CONFLICT");
    }
  }
  const previousEventHash = latest
    ? latest.eventHash ?? legacyDisputeAiAssessmentEventAnchor(latest)
    : null;
  const createdAt = latest && input.createdAt.getTime() <= new Date(latest.createdAt).getTime()
    ? new Date(new Date(latest.createdAt).getTime() + 1)
    : input.createdAt;
  const eventHash = buildDisputeAiAssessmentEventHash({ ...input, createdAt }, previousEventHash);
  await db.insert(disputeAiAssessmentEvents).values({
    id: input.id,
    disputeId: input.disputeId,
    eventType: input.eventType,
    revision: input.revision,
    versionId: input.versionId,
    supersedesAssessmentId: input.supersedesAssessmentId,
    evidenceSnapshotHash: input.evidenceSnapshotHash,
    policyVersion: input.policyVersion,
    model: input.model,
    contextHash: input.contextHash,
    requestedBy: input.requestedBy,
    forced: input.forced,
    reassessmentReason: input.reassessmentReason,
    previousEventHash,
    eventHash,
    payload: input.payload,
    createdAt,
  });
}

export async function listDisputeAiAssessmentEvents(db: Database, disputeId: string, limit = 50) {
  return db
    .select()
    .from(disputeAiAssessmentEvents)
    .where(eq(disputeAiAssessmentEvents.disputeId, disputeId))
    .orderBy(desc(disputeAiAssessmentEvents.createdAt), desc(disputeAiAssessmentEvents.id))
    .limit(limit);
}
