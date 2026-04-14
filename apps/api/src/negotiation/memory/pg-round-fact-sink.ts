import { negotiationRoundFacts, type Database } from '@haggle/db';
import { computeFactHash } from '@haggle/engine-session';
import type { RoundFactPayload } from '@haggle/engine-session';
import type { RoundFact } from '../types.js';

/**
 * Pending fact entry before flush.
 */
interface PendingFact {
  sessionId: string;
  roundNo: number;
  fact: RoundFact;
}

/**
 * PgRoundFactSink accumulates RoundFacts and flushes them to the
 * `negotiation_round_facts` table with hash-chain integrity.
 *
 * Usage:
 *   sink.add(sessionId, roundNo, fact)
 *   const finalHash = await sink.flush(db)
 */
export class PgRoundFactSink {
  private pending: PendingFact[] = [];
  /** Last known fact_hash for a session — used for chain linking. */
  private lastHashes = new Map<string, string | null>();

  /**
   * Register a round fact for deferred persistence.
   */
  add(sessionId: string, roundNo: number, fact: RoundFact): void {
    this.pending.push({ sessionId, roundNo, fact });
  }

  /**
   * Set the initial prev_fact_hash for a session (e.g., loaded from DB).
   */
  setLastHash(sessionId: string, hash: string | null): void {
    this.lastHashes.set(sessionId, hash);
  }

  /**
   * Flush all pending facts to the DB in round order, computing hash chain.
   * Returns a map of sessionId → final fact_hash.
   */
  async flush(db: Database): Promise<Map<string, string>> {
    // Atomically capture and clear pending to prevent concurrent add() interference
    const toFlush = this.pending;
    this.pending = [];

    if (toFlush.length === 0) return new Map();

    const finalHashes = new Map<string, string>();

    for (const { sessionId, roundNo, fact } of toFlush) {
      const prevFactHash = this.lastHashes.get(sessionId) ?? null;

      const payload: RoundFactPayload = {
        session_id: sessionId,
        round_no: roundNo,
        buyer_offer: String(fact.buyer_offer),
        seller_offer: String(fact.seller_offer),
        gap: String(fact.gap),
        buyer_tactic: fact.buyer_tactic ?? null,
        seller_tactic: fact.seller_tactic ?? null,
        conditions_changed: Object.entries(fact.conditions_changed ?? {}).map(
          ([term, value]) => ({ term, value }),
        ),
        coaching_recommended_price: String(fact.coaching_given.recommended),
        coaching_recommended_tactic: fact.coaching_given.tactic ?? null,
        coaching_followed: fact.coaching_followed,
        human_intervened: fact.human_intervened,
        phase: fact.phase,
      };

      const { fact_hash } = computeFactHash(payload, prevFactHash);

      await db.insert(negotiationRoundFacts).values({
        sessionId,
        roundNo,
        buyerOffer: String(fact.buyer_offer),
        sellerOffer: String(fact.seller_offer),
        gap: String(fact.gap),
        buyerTactic: fact.buyer_tactic ?? null,
        sellerTactic: fact.seller_tactic ?? null,
        conditionsChanged: Object.entries(fact.conditions_changed ?? {}).map(
          ([term, value]) => ({ term, old_value: null, new_value: value, who: 'unknown' }),
        ),
        coachingRecommendedPrice: String(fact.coaching_given.recommended),
        coachingRecommendedTactic: fact.coaching_given.tactic ?? null,
        coachingFollowed: fact.coaching_followed,
        humanIntervened: fact.human_intervened,
        phase: fact.phase,
        factHash: fact_hash,
        prevFactHash: prevFactHash,
      });

      this.lastHashes.set(sessionId, fact_hash);
      finalHashes.set(sessionId, fact_hash);
    }

    return finalHashes;
  }

  /**
   * Return the last known hash for a session (after flush).
   */
  getLastHash(sessionId: string): string | null {
    return this.lastHashes.get(sessionId) ?? null;
  }
}
