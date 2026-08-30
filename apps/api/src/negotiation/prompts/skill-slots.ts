/**
 * Decide system-prompt slots for engine skills.
 *
 * Skills are plugins inside the harness (BOX / floor / HARD criteria).
 * They do not go on the HNP wire. See docs/engine/decide-prompt-contract.md
 * and docs/protocol/HNP.md (skills stay in the engine).
 */

export interface SkillSlotContent {
  /** Category briefs and the session skill's getLLMContext() pointer. */
  knowledge?: string[];
  /** How this category usually prices a slot. Advisory, not a script. */
  valuation?: string[];
  /** Tactic names the model may put in tactic_used. */
  tactics?: string[];
  /** Optional advisor notes (price/tactic/observation). May ignore. */
  advisor?: string[];
  /** Live market quotes. Prefer SIG if already there; this is the system copy. */
  market?: string[];
  /** Skill HARD/SOFT rules as text. Code validate remains authoritative. */
  constraints?: string[];
  /** How to talk. Decide writes `message`; respond stays template. */
  tone?: string[];
  /** Paid/service facts already fetched (CheckMEND, LegitApp). Not a call. */
  services?: string[];
}

export interface SkillSlotHookDraft {
  categoryBrief?: string;
  valuationRules?: string[];
  tactics?: string[];
  advisories?: Array<{
    skillId: string;
    recommendedPrice?: number;
    acceptableRange?: { min: number; max: number };
    suggestedTactic?: string;
    observations?: string[];
  }>;
  marketData?: Array<{ skillId?: string; price: number; source: string }>;
}

export interface SkillSlotValidateDraft {
  hardRules: Array<{ rule: string; description: string; skillId?: string }>;
  softRules: Array<{ rule: string; description: string; skillId?: string }>;
}

const SKILL_LEGEND = [
  "## Skills",
  "Engine plugins for THIS item. Advisory. BOX, floor, and HARD criteria still win.",
  'Do not invent an HNP issue id from a skill. Do not quote a skill dollar hint as your floor or as "always $X".',
  "If a skill line conflicts with LISTING, STRATEGY, or a criteria card, trust LISTING / STRATEGY / the card.",
].join("\n");

function take(lines: string[] | undefined, max: number): string[] {
  return (lines ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return [``, `### ${title}`, ...lines.map((s) => `- ${s}`)];
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Fold pipeline hook output into labeled slots. Empty arrays stay omitted. */
export function collectSkillSlots(input: {
  llmContext?: string;
  decide?: SkillSlotHookDraft;
  validate?: SkillSlotValidateDraft;
  /** Already formatted market/service lines. Do not pass raw cents here. */
  market?: string[];
  toneGuidance?: string;
  terminology?: Record<string, string>;
  services?: string[];
}): SkillSlotContent {
  const knowledge = [input.llmContext, input.decide?.categoryBrief].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  const advisor: string[] = [];
  for (const adv of input.decide?.advisories ?? []) {
    if (typeof adv.recommendedPrice === "number") {
      advisor.push(`${adv.skillId}: suggested ${centsToUsd(adv.recommendedPrice)} (advisory)`);
    }
    if (adv.acceptableRange) {
      advisor.push(
        `${adv.skillId}: range ${centsToUsd(adv.acceptableRange.min)}–${centsToUsd(adv.acceptableRange.max)} (advisory)`,
      );
    }
    if (adv.suggestedTactic) {
      advisor.push(`${adv.skillId}: tactic ${adv.suggestedTactic}`);
    }
    for (const obs of adv.observations ?? []) {
      advisor.push(`${adv.skillId}: ${obs}`);
    }
  }

  const market = [...(input.market ?? [])];

  const constraints = [
    ...(input.validate?.hardRules ?? []).map((r) => `HARD ${r.rule}: ${r.description}`),
    ...(input.validate?.softRules ?? []).map((r) => `SOFT ${r.rule}: ${r.description}`),
  ];

  const tone = [
    input.toneGuidance,
    input.terminology
      ? Object.entries(input.terminology)
          .map(([k, v]) => `${k} = ${v}`)
          .join("; ")
      : undefined,
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  return {
    knowledge,
    valuation: input.decide?.valuationRules,
    tactics: input.decide?.tactics,
    advisor,
    market,
    constraints,
    tone,
    services: input.services,
  };
}

/** System-prompt block. Always present so a future skill has a labeled home. */
export function encodeSkillSlots(slots?: SkillSlotContent | null): string {
  const knowledge = take(slots?.knowledge, 8);
  const valuation = take(slots?.valuation, 8);
  const tactics = take(slots?.tactics, 8);
  const advisor = take(slots?.advisor, 6);
  const market = take(slots?.market, 4);
  const constraints = take(slots?.constraints, 8);
  const tone = take(slots?.tone, 4);
  const services = take(slots?.services, 4);

  const body = [
    ...section("Knowledge", knowledge),
    ...section("Valuation", valuation),
    ...section("Tactics", tactics),
    ...section("Advisor", advisor),
    ...section("Market", market),
    ...section("Constraints", constraints),
    ...section("Tone", tone),
    ...section("Services", services),
  ];

  if (body.length === 0) {
    return [SKILL_LEGEND, "", "No skill body this round. Do not invent category lore."].join("\n");
  }
  return [SKILL_LEGEND, ...body].join("\n");
}
