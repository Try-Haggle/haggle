import {
  eq,
  and,
  trustScores,
  type Database,
} from "@haggle/db";

type ActorRole = "buyer" | "seller" | "combined";
type TrustStatus = "NEW" | "SCORING" | "MATURE";

export async function getTrustScore(
  db: Database,
  actorId: string,
  actorRole?: ActorRole,
) {
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

export async function getTrustSnapshot(
  db: Database,
  actorId: string,
) {
  const rows = await db
    .select({ rawInputs: trustScores.rawInputs })
    .from(trustScores)
    .where(eq(trustScores.actorId, actorId))
    .limit(1);

  return rows[0]?.rawInputs ?? null;
}
