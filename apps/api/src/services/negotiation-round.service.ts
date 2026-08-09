import { and, type Database, eq, negotiationRounds, sql } from "@haggle/db";

type SenderRole = "BUYER" | "SELLER";
type MessageType = "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE";
type DecisionAction = "ACCEPT" | "COUNTER" | "REJECT" | "NEAR_DEAL" | "ESCALATE";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createRound(
  db: Database,
  data: {
    sessionId: string;
    roundNo: number;
    senderRole: SenderRole;
    messageType: MessageType;
    priceminor: string;
    counterPriceMinor?: string;
    utility?: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
    decision?: DecisionAction;
    metadata?: Record<string, unknown>;
    idempotencyKey: string;
    // LLM engine extensions (Step 57)
    coaching?: Record<string, unknown>;
    validation?: Record<string, unknown>;
    llmTokensUsed?: number;
    reasoningUsed?: boolean;
    message?: string;
    phaseAtRound?: string;
  },
) {
  const [row] = await db
    .insert(negotiationRounds)
    .values({
      sessionId: data.sessionId,
      roundNo: data.roundNo,
      senderRole: data.senderRole,
      messageType: data.messageType,
      priceminor: data.priceminor,
      counterPriceMinor: data.counterPriceMinor,
      utility: data.utility,
      decision: data.decision,
      metadata: data.metadata,
      idempotencyKey: data.idempotencyKey,
      coaching: data.coaching,
      validation: data.validation,
      llmTokensUsed: data.llmTokensUsed,
      reasoningUsed: data.reasoningUsed,
      message: data.message,
      phaseAtRound: data.phaseAtRound,
    })
    .returning();

  return row;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getRoundsBySessionId(db: Database, sessionId: string) {
  return db
    .select()
    .from(negotiationRounds)
    .where(eq(negotiationRounds.sessionId, sessionId))
    .orderBy(negotiationRounds.roundNo);
}

export async function getRoundByIdempotencyKey(db: Database, sessionId: string, key: string) {
  const rows = await db
    .select()
    .from(negotiationRounds)
    .where(
      and(eq(negotiationRounds.sessionId, sessionId), eq(negotiationRounds.idempotencyKey, key)),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function getLatestRound(db: Database, sessionId: string) {
  const rows = await db
    .select()
    .from(negotiationRounds)
    .where(eq(negotiationRounds.sessionId, sessionId))
    .orderBy(sql`${negotiationRounds.roundNo} DESC`)
    .limit(1);

  return rows[0] ?? null;
}

/** One requirement the buyer answered when the negotiation paused. */
export interface RecordedPauseAnswer {
  checkId: string;
  /** The question as it was put to the buyer. */
  ask: string;
  /** The canonical stance stored on their criteria. */
  stance: string;
  /** The tappable label that produced it, when the check has canonical options. */
  label?: string;
}

/**
 * Attach the buyer's pause answers to the round that asked for them.
 *
 * The transcript is where people go to check what they agreed to, so an answer that
 * lives only in the buyer's criteria is invisible: the question stays on screen with no
 * reply under it, and after a reload there is no trace the buyer ever responded. Written
 * onto the asking round's metadata so it travels with the round it belongs to.
 */
export async function recordPauseAnswersOnRound(
  db: Database,
  roundId: string,
  answers: RecordedPauseAnswer[],
): Promise<void> {
  if (answers.length === 0) return;
  const rows = await db
    .select({ metadata: negotiationRounds.metadata })
    .from(negotiationRounds)
    .where(eq(negotiationRounds.id, roundId))
    .limit(1);
  const existing = rows[0]?.metadata ?? {};
  await db
    .update(negotiationRounds)
    .set({ metadata: { ...existing, buyer_pause_answers: answers } })
    .where(eq(negotiationRounds.id, roundId));
}
