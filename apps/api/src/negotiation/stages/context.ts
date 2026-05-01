/**
 * Stage 2: Context Assembly
 *
 * Assembles L0-L5 context layers, computes briefing, and encodes memo snapshot.
 * Absorbs logic from adapters/context-assembly.ts + briefing integration + memo-codec.
 */

import type { ContextInput, ContextOutput } from '../pipeline/types.js';
import type { SkillAppliedRecord } from '../skills/skill-types.js';
import { VERIFICATION_BADGES } from '../skills/skill-types.js';
import type { SkillStack } from '../skills/skill-stack.js';
import { assembleContextLayers } from '../adapters/context-assembly.js';
import { computeBriefing } from '../referee/briefing.js';
import { encodeMemo, type MemoEncoding } from '../memo/memo-codec.js';
import { formatUserMemoryBriefSignals } from '../../services/user-memory-card.service.js';
import { formatEvermemoBriefSignals } from '../../services/evermemo-bridge.service.js';

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
  skillStack?: SkillStack,
): ContextOutput {
  const { memory, facts, opponent, skill, l5_signals, memory_brief, evermemo_brief } = input;

  // 1. Compute briefing (facts-only, replaces coaching)
  const briefing = computeBriefing(memory, facts, opponent);

  // 2. Build L5 signal strings
  const signalStrings = buildL5SignalStrings(l5_signals);
  signalStrings.push(...buildUnderstandingSignalStrings(input.understood));
  signalStrings.push(...formatUserMemoryBriefSignals(memory_brief));
  signalStrings.push(...formatEvermemoBriefSignals(evermemo_brief));

  // 3. Build skill verification strings for LLM context (투명성 철학)
  const skillsApplied = buildSkillAppliedRecords(skillStack);
  const skillVerificationStrings = buildSkillVerificationStrings(skillStack);
  signalStrings.push(...skillVerificationStrings);

  // 4. Assemble L0-L5 layers using existing context-assembly module
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

  // 5. Encode memo snapshot
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
    skills_applied: skillsApplied,
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

function buildUnderstandingSignalStrings(
  understood: ContextInput['understood'],
): string[] {
  const parts: string[] = [];

  if (understood.conversation_type) {
    parts.push(`UTYPE:${understood.conversation_type}|intent:${understood.action_intent}|sentiment:${understood.sentiment}`);
  }

  if (understood.information_links && understood.information_links.length > 0) {
    parts.push(
      ...understood.information_links.slice(0, 8).map((link) => (
        `ULINK:${link.connects_to}:${link.entity_type}=${link.value}|conf:${link.confidence.toFixed(2)}`
      )),
    );
  }

  if (understood.missing_information && understood.missing_information.length > 0) {
    parts.push(
      ...understood.missing_information.slice(0, 4).map((need) => (
        `UNEED:${need.priority}:${need.slot}|reason:${need.reason}|ask:${need.question}`
      )),
    );
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Skill Verification — injected into LLM context for transparency
// ---------------------------------------------------------------------------

/**
 * Build skill verification strings for LLM context.
 * LLM sees which skills are active and their trust level,
 * so it can weigh unverified skill advice with more caution.
 */
function buildSkillVerificationStrings(skillStack?: SkillStack): string[] {
  if (!skillStack) return [];

  const skills = skillStack.getSkills();
  if (skills.length === 0) return [];

  const lines = skills.map((s) => {
    const m = s.manifest;
    const badge = VERIFICATION_BADGES[m.verification.status];
    const audit = m.verification.securityAudit ? ",security_audited" : "";
    return `${badge} ${m.name} (${m.type},${m.verification.status}${audit})`;
  });

  return [`SKILLS_ACTIVE:${lines.join("|")}`];
}

/**
 * Build SkillAppliedRecord[] for round response transparency.
 * Users see exactly which skills participated and their verification status.
 */
function buildSkillAppliedRecords(skillStack?: SkillStack): SkillAppliedRecord[] {
  if (!skillStack) return [];

  return skillStack.getSkills().map((s) => ({
    id: s.manifest.id,
    name: s.manifest.name,
    type: s.manifest.type,
    badge: VERIFICATION_BADGES[s.manifest.verification.status],
    verification_status: s.manifest.verification.status,
  }));
}
