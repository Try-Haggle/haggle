/**
 * Stage 2: Context Assembly
 *
 * Assembles L0-L5 context layers, computes briefing, and encodes memo snapshot.
 * Absorbs logic from adapters/context-assembly.ts + briefing integration + memo-codec.
 */

import type { ContextInput, ContextOutput } from '../pipeline/types.js';
import { assembleContextLayers } from '../adapters/context-assembly.js';
import { computeBriefing } from '../referee/briefing.js';
import { encodeMemo, type MemoEncoding } from '../memo/memo-codec.js';

/**
 * Assemble full negotiation context for a round.
 *
 * 1. Compute briefing (referee facts-only observations)
 * 2. Assemble L0-L5 context layers
 * 3. Encode memo snapshot for LLM consumption
 */
export function assembleStageContext(
  input: ContextInput,
  adapter: import('../types.js').ModelAdapter,
  memoEncoding: MemoEncoding = 'codec',
): ContextOutput {
  const { memory, facts, opponent, skill, l5_signals } = input;

  // 1. Compute briefing (facts-only, replaces coaching)
  const briefing = computeBriefing(memory, facts, opponent);

  // 2. Build L5 signal strings
  const signalStrings = buildL5SignalStrings(l5_signals);

  // 3. Assemble L0-L5 layers using existing context-assembly module
  // NOTE: assembleContextLayers still expects RefereeCoaching for L3 layer.
  // During transition, pass memory.coaching (old RefereeCoaching from CoreMemory).
  const layers = assembleContextLayers({
    skill,
    adapter,
    memory,
    recentFacts: facts.slice(-5),
    coaching: memory.coaching,
    signals: signalStrings,
  });

  // 4. Encode memo snapshot
  const memoSnapshot = encodeMemo(
    memory,
    memoEncoding,
    facts.slice(-5),
  );

  return {
    layers,
    briefing,
    coaching: briefing, // deprecated alias
    memo_snapshot: memoSnapshot,
    skills_applied: [],
  };
}

// ---------------------------------------------------------------------------
// L5 Signal formatting
// ---------------------------------------------------------------------------

function buildL5SignalStrings(
  signals?: import('../types.js').L5Signals,
): string[] {
  if (!signals) return [];

  const parts: string[] = [];

  if (signals.market) {
    const m = signals.market;
    parts.push(`MKT:avg30d=$${m.avg_sold_price_30d}|trend:${m.price_trend}|listings:${m.active_listings_count}`);
    if (m.source_prices.length > 0) {
      const sources = m.source_prices
        .map((s) => `${s.platform}:$${s.price}`)
        .join(',');
      parts.push(`PRICES:${sources}`);
    }
  }

  if (signals.competition) {
    const c = signals.competition;
    let comp = `COMP:sessions:${c.concurrent_sessions}`;
    if (c.best_competing_offer !== undefined) {
      comp += `|best:$${c.best_competing_offer}`;
    }
    parts.push(comp);
  }

  if (signals.category) {
    const cat = signals.category;
    parts.push(`CAT:avg_disc:${(cat.avg_discount_rate * 100).toFixed(1)}%|avg_rounds:${cat.avg_rounds_to_deal}`);
  }

  return parts;
}
