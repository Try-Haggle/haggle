import {
  eq,
  and,
  sql,
  inArray,
  waitingIntents,
  intentMatches,
  type Database,
} from "@haggle/db";

type IntentRole = "BUYER" | "SELLER";
type IntentStatus = "ACTIVE" | "MATCHED" | "FULFILLED" | "EXPIRED" | "CANCELLED";

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export async function getIntentById(db: Database, intentId: string) {
  const rows = await db
    .select()
    .from(waitingIntents)
    .where(eq(waitingIntents.id, intentId))
    .limit(1);

  return rows[0] ?? null;
}

export async function getActiveIntentsByCategory(
  db: Database,
  category: string,
  role?: string,
) {
  const conditions = [
    eq(waitingIntents.status, "ACTIVE" as IntentStatus),
    eq(waitingIntents.category, category),
  ];

  if (role) {
    conditions.push(eq(waitingIntents.role, role as IntentRole));
  }

  const rows = await db
    .select()
    .from(waitingIntents)
    .where(and(...conditions));

  return rows;
}

export async function getIntentsByUserId(
  db: Database,
  userId: string,
  status?: string,
) {
  const conditions = [eq(waitingIntents.userId, userId)];

  if (status) {
    conditions.push(eq(waitingIntents.status, status as IntentStatus));
  }

  const rows = await db
    .select()
    .from(waitingIntents)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

  return rows;
}

export async function createIntent(
  db: Database,
  data: {
    userId: string;
    role: IntentRole;
    category: string;
    keywords: string[];
    strategySnapshot: Record<string, unknown>;
    minUtotal?: string;
    maxActiveSessions?: number;
    expiresAt: Date;
  },
) {
  const [row] = await db
    .insert(waitingIntents)
    .values({
      userId: data.userId,
      role: data.role,
      category: data.category,
      keywords: data.keywords,
      strategySnapshot: data.strategySnapshot,
      minUtotal: data.minUtotal,
      maxActiveSessions: data.maxActiveSessions,
      expiresAt: data.expiresAt,
    })
    .returning();

  return row;
}

export async function updateIntentStatus(
  db: Database,
  intentId: string,
  status: IntentStatus,
  extraFields?: Partial<{ matchedAt: Date; fulfilledAt: Date }>,
) {
  const [row] = await db
    .update(waitingIntents)
    .set({
      status,
      ...extraFields,
      updatedAt: new Date(),
    })
    .where(eq(waitingIntents.id, intentId))
    .returning();

  return row;
}

export async function getActiveIntentCount(db: Database, userId: string) {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(waitingIntents)
    .where(
      and(
        eq(waitingIntents.userId, userId),
        inArray(waitingIntents.status, ["ACTIVE", "MATCHED"] as IntentStatus[]),
      ),
    );

  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function createMatch(
  db: Database,
  data: {
    intentId: string;
    counterpartyIntentId?: string;
    listingId?: string;
    sessionId?: string;
    buyerUtotal: string;
    sellerUtotal?: string;
  },
) {
  const [row] = await db
    .insert(intentMatches)
    .values({
      intentId: data.intentId,
      counterpartyIntentId: data.counterpartyIntentId,
      listingId: data.listingId,
      sessionId: data.sessionId,
      buyerUtotal: data.buyerUtotal,
      sellerUtotal: data.sellerUtotal,
    })
    .returning();

  return row;
}

export async function getMatchesByIntentId(db: Database, intentId: string) {
  const rows = await db
    .select()
    .from(intentMatches)
    .where(eq(intentMatches.intentId, intentId));

  return rows;
}

export async function expireStaleIntents(db: Database) {
  const rows = await db
    .update(waitingIntents)
    .set({
      status: "EXPIRED" as IntentStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(waitingIntents.status, "ACTIVE" as IntentStatus),
        sql`${waitingIntents.expiresAt} < now()`,
      ),
    )
    .returning();

  return rows.length;
}
