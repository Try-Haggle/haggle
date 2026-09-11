import { and, type Database, eq, inArray, trustScores } from "@haggle/db";

type ActorRole = "buyer" | "seller" | "combined";
type TrustStatus = "NEW" | "SCORING" | "MATURE";

/** Buyer-safe trust fields. Never includes rawInputs, weights, or actor ids. */
export interface PublicTrustSummary {
  score: number | null;
  status: TrustStatus;
  completedTransactions: number;
}

export function toPublicTrustSummary(
  row:
    | {
        score: string | number | null;
        status: string | null;
        completedTransactions: number | null;
      }
    | null
    | undefined,
): PublicTrustSummary | null {
  if (!row) return null;
  const parsed = typeof row.score === "number" ? row.score : Number(row.score);
  const status: TrustStatus =
    row.status === "MATURE" || row.status === "SCORING" ? row.status : "NEW";
  return {
    score: Number.isFinite(parsed) ? parsed : null,
    status,
    completedTransactions: row.completedTransactions ?? 0,
  };
}

export async function getPublicTrustSummariesByActorIds(
  db: Database,
  actorIds: Array<string | null | undefined>,
): Promise<Map<string, PublicTrustSummary>> {
  const ids = [
    ...new Set(actorIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ];
  const out = new Map<string, PublicTrustSummary>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      actorId: trustScores.actorId,
      score: trustScores.score,
      status: trustScores.status,
      completedTransactions: trustScores.completedTransactions,
    })
    .from(trustScores)
    .where(and(inArray(trustScores.actorId, ids), eq(trustScores.actorRole, "seller")));
  for (const row of rows) {
    const summary = toPublicTrustSummary(row);
    if (summary) out.set(row.actorId, summary);
  }
  return out;
}

export async function getTrustScore(db: Database, actorId: string, actorRole?: ActorRole) {
  const conditions = [eq(trustScores.actorId, actorId)];
  if (actorRole) {
    conditions.push(eq(trustScores.actorRole, actorRole));
  }

  const rows = await db
    .select()
    .from(trustScores)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

export async function upsertTrustScore(
  db: Database,
  data: {
    actorId: string;
    actorRole: ActorRole;
    score: string;
    status: TrustStatus;
    completedTransactions: number;
    weightsVersion: string;
    rawScore: string;
    slaPenaltyFactor: string;
    rawInputs?: Record<string, unknown>;
  },
) {
  const existing = await getTrustScore(db, data.actorId, data.actorRole);

  if (existing) {
    const [row] = await db
      .update(trustScores)
      .set({
        score: data.score,
        status: data.status,
        completedTransactions: data.completedTransactions,
        weightsVersion: data.weightsVersion,
        rawScore: data.rawScore,
        slaPenaltyFactor: data.slaPenaltyFactor,
        rawInputs: data.rawInputs,
        updatedAt: new Date(),
      })
      .where(eq(trustScores.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(trustScores)
    .values({
      actorId: data.actorId,
      actorRole: data.actorRole,
      score: data.score,
      status: data.status,
      completedTransactions: data.completedTransactions,
      weightsVersion: data.weightsVersion,
      rawScore: data.rawScore,
      slaPenaltyFactor: data.slaPenaltyFactor,
      rawInputs: data.rawInputs,
    })
    .returning();
  return row;
}

export async function getTrustSnapshot(db: Database, actorId: string) {
  const rows = await db
    .select({ rawInputs: trustScores.rawInputs })
    .from(trustScores)
    .where(eq(trustScores.actorId, actorId))
    .limit(1);

  return rows[0]?.rawInputs ?? null;
}
