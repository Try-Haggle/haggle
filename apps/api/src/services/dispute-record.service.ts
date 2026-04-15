import {
  disputeCases,
  disputeEvidence,
  disputeResolutions,
  eq,
  type Database,
} from "@haggle/db";
import type {
  DisputeCase,
  DisputeStatus,
  DisputeEvidence as DisputeEvidenceType,
  DisputeResolution,
} from "@haggle/dispute-core";

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapDisputeCase(
  row: typeof disputeCases.$inferSelect,
  evidence: DisputeEvidenceType[] = [],
  resolution?: DisputeResolution,
): DisputeCase {
  return {
    id: row.id,
    order_id: row.orderId,
    reason_code: row.reasonCode,
    status: row.status as DisputeStatus,
    opened_by: row.openedBy as "buyer" | "seller" | "system",
    opened_at: row.openedAt.toISOString(),
    evidence,
    resolution,
    metadata: row.metadata ?? null,
    refundAmountMinor: resolution?.refund_amount_minor?.toString() ?? null,
  };
}

export async function createDisputeRecord(
  db: Database,
  dispute: DisputeCase,
): Promise<DisputeCase> {
  const [row] = await db
    .insert(disputeCases)
    .values({
      id: dispute.id,
      orderId: dispute.order_id,
      reasonCode: dispute.reason_code,
      status: dispute.status,
      openedBy: dispute.opened_by,
      openedAt: new Date(dispute.opened_at),
    })
    .returning();

  if (dispute.evidence.length > 0) {
    await db.insert(disputeEvidence).values(
      dispute.evidence.map((e) => ({
        id: e.id,
        disputeId: dispute.id,
        submittedBy: e.submitted_by,
        type: e.type,
        uri: e.uri,
        text: e.text,
        createdAt: new Date(e.created_at),
      })),
    );
  }

  return mapDisputeCase(row, dispute.evidence);
}

export async function getDisputeById(db: Database, id: string): Promise<DisputeCase | null> {
  const row = await db.query.disputeCases.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  if (!row) return null;

  const evidenceRows = await db.query.disputeEvidence.findMany({
    where: (fields, ops) => ops.eq(fields.disputeId, id),
    orderBy: (fields, { asc }) => [asc(fields.createdAt)],
  });

  const evidence: DisputeEvidenceType[] = evidenceRows.map((e) => ({
    id: e.id,
    dispute_id: e.disputeId,
    submitted_by: e.submittedBy as "buyer" | "seller" | "system",
    type: e.type as DisputeEvidenceType["type"],
    uri: e.uri ?? undefined,
    text: e.text ?? undefined,
    created_at: e.createdAt.toISOString(),
  }));

  let resolution: DisputeResolution | undefined;
  const resRow = await db.query.disputeResolutions.findFirst({
    where: (fields, ops) => ops.eq(fields.disputeId, id),
  });
  if (resRow) {
    resolution = {
      outcome: resRow.outcome as DisputeResolution["outcome"],
      summary: resRow.summary,
      refund_amount_minor: resRow.refundAmountMinor ? Number(resRow.refundAmountMinor) : undefined,
      resolved_at: toIso(resRow.resolvedAt),
    };
  }

  return mapDisputeCase(row, evidence, resolution);
}

export async function getDisputeByOrderId(db: Database, orderId: string): Promise<DisputeCase | null> {
  const row = await db.query.disputeCases.findFirst({
    where: (fields, ops) => ops.eq(fields.orderId, orderId),
  });
  if (!row) return null;
  return getDisputeById(db, row.id);
}

export async function updateDisputeRecord(
  db: Database,
  dispute: DisputeCase,
): Promise<void> {
  await db
    .update(disputeCases)
    .set({
      status: dispute.status,
      resolutionSummary: dispute.resolution?.summary,
      metadata: dispute.metadata ?? undefined,
      resolvedAt: dispute.resolution?.resolved_at ? new Date(dispute.resolution.resolved_at) : undefined,
      closedAt: dispute.status === "CLOSED" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(disputeCases.id, dispute.id));
}

export async function addDisputeEvidenceRecord(
  db: Database,
  evidence: DisputeEvidenceType,
): Promise<void> {
  await db.insert(disputeEvidence).values({
    id: evidence.id,
    disputeId: evidence.dispute_id,
    submittedBy: evidence.submitted_by,
    type: evidence.type,
    uri: evidence.uri,
    text: evidence.text,
    createdAt: new Date(evidence.created_at),
  });
}

export async function createDisputeResolutionRecord(
  db: Database,
  disputeId: string,
  resolution: DisputeResolution,
): Promise<void> {
  await db.insert(disputeResolutions).values({
    disputeId,
    outcome: resolution.outcome,
    summary: resolution.summary,
    refundAmountMinor: resolution.refund_amount_minor?.toString(),
    resolvedAt: resolution.resolved_at ? new Date(resolution.resolved_at) : undefined,
  });
}
