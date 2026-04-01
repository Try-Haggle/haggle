import {
  authentications,
  authenticationEvents,
  eq,
  type Database,
} from "@haggle/db";

export interface AuthenticationRow {
  id: string;
  listing_id: string;
  order_id: string | null;
  dispute_id: string | null;
  provider: string;
  category: string;
  turnaround: string;
  status: string;
  verdict: string | null;
  certificate_url: string | null;
  requested_by: string;
  cost_minor: string;
  case_id: string | null;
  intent_id: string | null;
  submission_url: string | null;
  publish_policy: string;
  auto_apply_result: boolean;
  result_applied: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: typeof authentications.$inferSelect): AuthenticationRow {
  return {
    id: row.id,
    listing_id: row.listingId,
    order_id: row.orderId,
    dispute_id: row.disputeId,
    provider: row.provider,
    category: row.category,
    turnaround: row.turnaround,
    status: row.status,
    verdict: row.verdict,
    certificate_url: row.certificateUrl,
    requested_by: row.requestedBy,
    cost_minor: row.costMinor,
    case_id: row.caseId,
    intent_id: row.intentId,
    submission_url: row.submissionUrl,
    publish_policy: row.publishPolicy,
    auto_apply_result: row.autoApplyResult,
    result_applied: row.resultApplied,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function createAuthenticationRecord(
  db: Database,
  data: {
    listingId: string;
    orderId?: string;
    disputeId?: string;
    provider: string;
    category: string;
    turnaround?: string;
    status: string;
    requestedBy: "buyer" | "seller";
    costMinor: string;
    caseId?: string;
    intentId?: string;
    submissionUrl?: string;
    publishPolicy?: string;
    autoApplyResult?: boolean;
  },
): Promise<AuthenticationRow> {
  const [row] = await db
    .insert(authentications)
    .values({
      listingId: data.listingId,
      orderId: data.orderId ?? null,
      disputeId: data.disputeId ?? null,
      provider: data.provider,
      category: data.category,
      turnaround: (data.turnaround ?? "standard") as "ultra_fast" | "fast" | "standard",
      status: data.status as typeof authentications.$inferInsert.status,
      requestedBy: data.requestedBy,
      costMinor: data.costMinor,
      caseId: data.caseId ?? null,
      intentId: data.intentId ?? null,
      submissionUrl: data.submissionUrl ?? null,
      publishPolicy: (data.publishPolicy ?? "publish_immediately") as "wait_for_auth" | "publish_immediately",
      autoApplyResult: data.autoApplyResult ?? true,
    })
    .returning();
  return mapRow(row);
}

export async function getAuthenticationById(
  db: Database,
  id: string,
): Promise<AuthenticationRow | null> {
  const row = await db.query.authentications.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ? mapRow(row) : null;
}

export async function getAuthenticationsByListingId(
  db: Database,
  listingId: string,
): Promise<AuthenticationRow[]> {
  const rows = await db.query.authentications.findMany({
    where: (fields, ops) => ops.eq(fields.listingId, listingId),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  });
  return rows.map(mapRow);
}

export async function getAuthenticationsByOrderId(
  db: Database,
  orderId: string,
): Promise<AuthenticationRow[]> {
  const rows = await db.query.authentications.findMany({
    where: (fields, ops) => ops.eq(fields.orderId, orderId),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  });
  return rows.map(mapRow);
}

export async function getAuthenticationsByDisputeId(
  db: Database,
  disputeId: string,
): Promise<AuthenticationRow[]> {
  const rows = await db.query.authentications.findMany({
    where: (fields, ops) => ops.eq(fields.disputeId, disputeId),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  });
  return rows.map(mapRow);
}

export async function getAuthenticationByCaseId(
  db: Database,
  caseId: string,
): Promise<AuthenticationRow | null> {
  const row = await db.query.authentications.findFirst({
    where: (fields, ops) => ops.eq(fields.caseId, caseId),
  });
  return row ? mapRow(row) : null;
}

export async function updateAuthenticationRecord(
  db: Database,
  id: string,
  data: {
    status?: string;
    verdict?: string;
    certificateUrl?: string;
    caseId?: string;
    intentId?: string;
    submissionUrl?: string;
    resultApplied?: boolean;
  },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.status !== undefined) set.status = data.status;
  if (data.verdict !== undefined) set.verdict = data.verdict;
  if (data.certificateUrl !== undefined) set.certificateUrl = data.certificateUrl;
  if (data.caseId !== undefined) set.caseId = data.caseId;
  if (data.intentId !== undefined) set.intentId = data.intentId;
  if (data.submissionUrl !== undefined) set.submissionUrl = data.submissionUrl;
  if (data.resultApplied !== undefined) set.resultApplied = data.resultApplied;

  await db
    .update(authentications)
    .set(set)
    .where(eq(authentications.id, id));
}

export async function insertAuthenticationEvent(
  db: Database,
  event: {
    authenticationId: string;
    eventType: string;
    status: string;
    verdict?: string;
    certificateUrl?: string;
    occurredAt: string;
    raw?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(authenticationEvents).values({
    authenticationId: event.authenticationId,
    eventType: event.eventType,
    status: event.status as typeof authenticationEvents.$inferInsert.status,
    verdict: (event.verdict as typeof authenticationEvents.$inferInsert.verdict) ?? null,
    certificateUrl: event.certificateUrl ?? null,
    occurredAt: new Date(event.occurredAt),
    raw: event.raw ?? null,
  });
}
