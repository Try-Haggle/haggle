import {
  eq,
  and,
  sql,
  negotiationSessions,
  type Database,
} from "@haggle/db";

type SessionRole = "BUYER" | "SELLER";
type SessionStatus =
  | "CREATED" | "ACTIVE" | "NEAR_DEAL" | "STALLED"
  | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED" | "WAITING"
  | "NEGOTIATING_VERSION" | "FAILED_COMPATIBILITY";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createSession(
  db: Database,
  data: {
    groupId?: string;
    intentId?: string;
    listingId: string;
    strategyId: string;
    role: SessionRole;
    buyerId: string;
    sellerId: string;
    counterpartyId: string;
    strategySnapshot: Record<string, unknown>;
    expiresAt?: Date;
  },
) {
  const [row] = await db
    .insert(negotiationSessions)
    .values({
      groupId: data.groupId,
      intentId: data.intentId,
      listingId: data.listingId,
      strategyId: data.strategyId,
      role: data.role,
      buyerId: data.buyerId,
      sellerId: data.sellerId,
      counterpartyId: data.counterpartyId,
      strategySnapshot: data.strategySnapshot,
      expiresAt: data.expiresAt,
    })
    .returning();

  return row;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getSessionById(db: Database, sessionId: string) {
  const rows = await db
    .select()
    .from(negotiationSessions)
    .where(eq(negotiationSessions.id, sessionId))
    .limit(1);

  return rows[0] ?? null;
}

export async function getSessionsByUserId(
  db: Database,
  userId: string,
  role: SessionRole,
  status?: SessionStatus,
) {
  const userCol = role === "BUYER" ? negotiationSessions.buyerId : negotiationSessions.sellerId;
  const conditions = [eq(userCol, userId)];

  if (status) {
    conditions.push(eq(negotiationSessions.status, status));
  }

  return db
    .select()
    .from(negotiationSessions)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0]);
}

export async function getSessionsByGroupId(db: Database, groupId: string) {
  return db
    .select()
    .from(negotiationSessions)
    .where(eq(negotiationSessions.groupId, groupId));
}

// ---------------------------------------------------------------------------
// Update with optimistic locking
// ---------------------------------------------------------------------------

export async function updateSessionState(
  db: Database,
  sessionId: string,
  expectedVersion: number,
  updates: Partial<{
    status: SessionStatus;
    currentRound: number;
    roundsNoConcession: number;
    lastOfferPriceMinor: string;
    lastUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
    // LLM engine extensions (Step 57)
    phase: string;
    coachingSnapshot: Record<string, unknown>;
    interventionMode: string;
    buddyTone: Record<string, unknown>;
  }>,
) {
  const rows = await db
    .update(negotiationSessions)
    .set({
      ...updates,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(negotiationSessions.id, sessionId),
        eq(negotiationSessions.version, expectedVersion),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Row-level lock (use inside transaction only)
// ---------------------------------------------------------------------------

export async function lockSessionForUpdate(db: Database, sessionId: string) {
  const rows = await db.execute(
    sql`SELECT * FROM negotiation_sessions WHERE id = ${sessionId} FOR UPDATE`,
  );

  // postgres-js returns an array-like RowList; index access works directly
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Batch status update (for supersede)
// ---------------------------------------------------------------------------

export async function batchUpdateSessionStatus(
  db: Database,
  sessionIds: string[],
  status: SessionStatus,
) {
  if (sessionIds.length === 0) return 0;

  const result = await db.execute(
    sql`UPDATE negotiation_sessions
        SET status = ${status}, updated_at = now(), version = version + 1
        WHERE id = ANY(${sessionIds})`,
  );

  // postgres-js RowList has .count for affected rows
  return (result as unknown as { count: number }).count ?? 0;
}
