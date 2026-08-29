/**
 * Decide few-shot: teach HARD/SOFT, then one card per opened criterion.
 *
 * Written for a model that has never seen these labels. Cards say what the
 * slot is, what to do, and what to say. No scripted prices.
 * See docs/engine/criteria-and-issues.md.
 */

import { type NegotiationCheck, resolveChecks } from "@haggle/shared";

export interface ListingHint {
  tags?: string[];
  category?: string;
}

export type DecideFewShotMode = "on" | "off";

let decideFewShotMode: DecideFewShotMode = "on";

/** Process-local toggle for A/B labs. Production stays on. */
export function setDecideFewShotMode(mode: DecideFewShotMode): void {
  decideFewShotMode = mode === "off" ? "off" : "on";
}

export function getDecideFewShotMode(): DecideFewShotMode {
  return decideFewShotMode;
}

/** Criteria that can also appear as an HNP core issue. One fact, two layers. */
export const CRITERIA_HNP_OVERLAP: Readonly<Record<string, string>> = {
  battery_health: "hnp.issue.condition.battery_health",
  cosmetic_grade: "hnp.issue.condition.grade",
  battery_warranty_remaining: "hnp.issue.warranty.remaining",
};

interface CriterionLesson {
  meaning: string;
  move: string;
  say: string;
}

const CRITERION_LESSON: Readonly<Record<string, CriterionLesson>> = {
  imei_verification: {
    meaning:
      "IMEI is the phone's serial on the carrier blacklist. A lost/stolen/unpaid IMEI cannot be activated. The next owner gets a brick.",
    move: "If LISTING is not clean/verifiable, or STRATEGY requires clean and LISTING does not show it, action=HOLD. A cheaper COUNTER does not clear a blacklist.",
    say: "Name IMEI. Ask for a clean check, or say you cannot close until it is verified. Do not ACCEPT.",
  },
  financing_paid_off: {
    meaning:
      "Carrier installment (EIP) still on the account can blacklist this IMEI after the sale. The buyer then loses service.",
    move: "If LISTING says still financed, or STRATEGY requires paid-off and LISTING does not, action=HOLD. Do not treat leftover balance as a discount.",
    say: "Name the unpaid plan. Say the deal waits until it is paid off. Do not ACCEPT a promise to pay it later.",
  },
  water_damage: {
    meaning:
      "Liquid contact indicator (LCI) or corrosion. Water damage is a reliability risk, not a scratch.",
    move: "If LISTING is has/unknown and STRATEGY requires none, action=HOLD. If STRATEGY does not require it, you may COUNTER, but name the risk — do not ignore it.",
    say: "Name water/LCI. If you HOLD, say you need a clean indicator. If you COUNTER, say why the number moved.",
  },
  find_my_status: {
    meaning:
      "Apple Activation Lock. If Find My is still on, the next Apple ID owns the phone. A new owner cannot erase or use it.",
    move: "If LISTING says still on / not off, action=HOLD. Do not ACCEPT. Do not close on 'I'll turn it off after payment'.",
    say: "Name Find My. Say you can talk price after it is off. One sentence.",
  },
  battery_health: {
    meaning:
      "Remaining battery capacity as a percent. 95% is near-new. 87% is usable but weaker. Below 80% often needs a replacement soon.",
    move: "The phone still works, so you COUNTER — you do not HOLD just for a lower percent. Weaker than STRATEGY.preferences → buyer COUNTER lower inside BOX, seller defends with another strength. Stronger → the opposite. The number or the line must change.",
    say: "Name the percent once. Shape: 'I'd come in lower — battery is 87%.' Not a bare dollar and not a second question about battery.",
  },
  carrier_lock: {
    meaning:
      "A locked phone only works on one carrier. Unlocked works on any. Lock is a limit, not a safety fail — unless STRATEGY made unlocked required.",
    move: "If STRATEGY requires unlocked and LISTING is locked, action=HOLD. Otherwise COUNTER and treat lock as leverage (buyer pays less / seller explains why it is still worth it).",
    say: "Name carrier lock or unlocked. If HOLD, say you need unlocked. If COUNTER, say how lock changed the number.",
  },
  storage_capacity: {
    meaning:
      "How much storage THIS copy has. More is usually worth more. This is not a safety fail. The published ask is one number for this copy — it is not a storage-adjusted price.",
    move: "Never HOLD just because capacity is smaller. Read LISTING's exact size. You judge what that size is worth at THIS ask, using this product and Market if present. A smaller size at the same ask is usually a worse deal; a larger size is usually a better one. Your COUNTER must move. Compare also to STRATEGY.preferences. Do not use a universal $/GB or '256 always $X'.",
    say: "Name the size once ('256GB so I can do …'). The number should show you noticed it.",
  },
  working_status: {
    meaning: "Does the item power on and do its job, or is a defect disclosed?",
    move: "A disclosed fault is leverage, not an automatic HOLD — unless STRATEGY required fully working and LISTING shows a defect, then HOLD. Otherwise COUNTER and name the fault.",
    say: "Name the defect or 'fully working'. If you COUNTER, the line must mention it.",
  },
  cosmetic_grade: {
    meaning:
      "How it looks: scratches, dents, screen marks. Looks change price. They rarely stop a sale.",
    move: "Do not HOLD for looks unless STRATEGY made a grade required and LISTING misses it. Weaker grade → buyer COUNTER lower; seller names the grade and defends function. Different grade = different COUNTER or different line.",
    say: "Name the grade or the scratch. One concrete mark beats 'it's in good shape'.",
  },
  title_status: {
    meaning:
      "Legal right to sell a vehicle (clean / salvage / rebuilt). A dirty title can block registration.",
    move: "If STRATEGY requires clean and LISTING is not clean, action=HOLD. Do not ACCEPT a salvage title by cutting price.",
    say: "Name the title status. Say you cannot close until title is clean, or that salvage is outside what you can take.",
  },
  mileage: {
    meaning:
      "How far the vehicle has been driven. Higher miles usually mean more wear and a lower price. The published ask is not already mileage-adjusted.",
    move: "Do not HOLD for miles alone. Different bands must change COUNTER or message. Compare LISTING miles to STRATEGY.preferences. You judge this copy at this ask — no $/1k-miles table.",
    say: "Name the miles once. Shape: 'at 80k miles I need to come in lower.'",
  },
  authenticity: {
    meaning:
      "Is this the real brand, or a replica? A fake is not a cheaper version of the same item.",
    move: "If STRATEGY requires genuine and LISTING is unproven or replica, action=HOLD. Do not ACCEPT a fake by bargaining.",
    say: "Name authenticity. Ask for proof, or say you only close on genuine.",
  },
  size: {
    meaning:
      "Does it fit (clothing size, frame size). Wrong size is a use problem, not a small scratch. The published ask is not already size-adjusted.",
    move: "If STRATEGY named a size and LISTING is a different size, HOLD or COUNTER only if STRATEGY said a miss is acceptable. Do not ignore size. When size is still in play as SOFT, the number or the line must change.",
    say: "Name both sizes if they differ. Ask whether this size still works before you ACCEPT.",
  },
};

const CRITERIA_LEGEND = [
  "## Criteria — what you are looking at",
  "You are a negotiation agent. Below are structured facts about THIS item, not a vibe and not a second product catalog.",
  "A tag is only the item's name (iPhone 17 Pro, hoodie, sedan). The tag garden already picked it. That tag opened a fixed list of questions — we call each question a criterion (plural: criteria). The seller answered them when listing. The person who built YOU answered the same questions when creating this agent. You do not invent a new question.",
  "",
  "Do not call criteria 'issues'. In this prompt:",
  "- Criteria = the questions and answers you use to decide (cards below + LISTING + STRATEGY).",
  "- HNP ISSUES = the public wire of values already disclosed on the envelope (PRICE / ISSUES / ACTS). The opponent can see those.",
  "If the same fact appears in both (often battery or cosmetic grade), it is ONE fact on two layers. Do not ask it twice. Do not mint a new issue id.",
  "",
  "## HARD vs SOFT — read this before the cards",
  "HARD and SOFT are labels we already assigned. They tell you which JSON action is legal, not how dramatic the topic feels.",
  "",
  "HARD means: this slot can stop the sale. The item may be unusable, legally blocked, or unsafe until it clears. Money does not fix a HARD fail.",
  "- Compare LISTING (what this copy is) to STRATEGY.requiredCriteria (what you must have).",
  "- If they conflict, or LISTING shows a fail (Find My on, dirty IMEI, unpaid financing, salvage title, …), your action is HOLD. Not ACCEPT. Not 'COUNTER cheaper and close anyway'.",
  "- HOLD = pause this close and name the slot. You can still talk. REJECT = walk away from the whole deal. Use REJECT only when you are done, not as a substitute for HOLD.",
  "- If the HARD slot is already clear, do not keep blocking on it. Argue price with a SOFT slot instead.",
  "",
  "SOFT means: this slot changes how valuable the item is. The deal can still close.",
  "- Compare LISTING's answer to STRATEGY.preferences (or to a stronger copy of the same tag).",
  "- Weaker SOFT → buyer COUNTER lower inside BOX, or seller names the weakness and defends something else. Stronger SOFT → the opposite.",
  "- Your COUNTER price and/or message MUST change when a SOFT value changes. Same price + same line as a better copy is a miss.",
  "- The published ask is not already adjusted for SOFT answers (storage, battery, grade, lock, miles, size, or any other SOFT on the cards). You judge this copy at this ask. Different answers must change the number and/or the line. No $/step table and no rank placement.",
  "- Price THIS copy from supply and demand for its SOFT answers, not from a catalog step. The ask is one seller's number, not the market-clearing price for that spec. A common or less-wanted spec should come further off the ask; a scarce and wanted spec can hold closer. Rarity alone is not value — a rare size nobody wants is still weak. You judge which this copy is. No table.",
  "- A SOFT miss alone is not HOLD and not REJECT. Do not treat a weaker SOFT answer like a stolen-phone gate.",
  "",
  "A SOFT criterion can still sit in STRATEGY.requiredCriteria if the builder marked it required (example: 'unlocked only'). Then treat THAT answer like a HARD fail: HOLD if LISTING misses it.",
  "",
  "## Where to read the answers this round",
  "- Cards below = which criteria exist for THIS tag, and how to treat each. Use only these ids. If a topic is not on a card, do not invent it.",
  "- LISTING.sellerStatedFacts = the seller's answers for THIS physical copy. Public specs. If a card has no LISTING line, the seller did not answer — do not guess 256GB or 87%. HARD unanswered → HOLD or ask. SOFT unanswered → ask or COUNTER without inventing a spec.",
  "- STRATEGY.requiredCriteria = your must-hold answers. Missing or conflicting → HOLD.",
  "- STRATEGY.preferences = your nice-to-have SOFT answers. Use them to move price and the sentence, not to kill the deal.",
  "- OPP_SAID = the line you answer now. If they named a criterion, answer that criterion.",
  "- MEMO B: t=your target, f=your floor. Never put those numbers in message.",
  "- BOX = legal COUNTER range. Stay inside it.",
  "",
  'Message: 1–2 short sentences. Cite one LISTING or STRATEGY stance by name (battery 87%, 256GB, 80k miles, size M, Find My still on). No script, no "256 always $480", no concession calendar. First person. Do not reveal floor, target, or BOX.',
].join("\n");

function listingTags(listing?: ListingHint | null): string[] {
  if (!listing) return [];
  return [listing.category, ...(listing.tags ?? [])]
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase());
}

function wireLine(checkId: string): string {
  const issue = CRITERIA_HNP_OVERLAP[checkId];
  return issue
    ? `Wire: same fact may also show as HNP ${issue}. Do not treat that as a second question.`
    : "Wire: no HNP core issue. Engine criterion only. Do not invent an issue id.";
}

function lessonFor(check: NegotiationCheck): CriterionLesson {
  const written = CRITERION_LESSON[check.id];
  if (written) return written;
  if (check.enforcement === "hard") {
    return {
      meaning:
        "This slot can stop the sale (safety, ownership, or the item cannot be used as promised).",
      move: "If LISTING conflicts with STRATEGY.requiredCriteria, or LISTING shows a fail, action=HOLD. Do not ACCEPT. A cheaper price does not clear this slot.",
      say: "Name this slot in one sentence. Say what must be true before you can close.",
    };
  }
  return {
    meaning: "This slot changes how valuable the item is. The deal can still close.",
    move: "If THIS copy's LISTING answer is weaker or stronger than STRATEGY.preferences, COUNTER and/or message must change and must name this slot. Do not HOLD only because this slot is imperfect.",
    say: "Name this slot once in the chat line. Do not invent a fixed price for each value.",
  };
}

export function encodeCriterionCard(check: NegotiationCheck): string {
  const kind = check.enforcement === "hard" ? "HARD" : "SOFT";
  const lesson = lessonFor(check);
  return [
    `${kind} ${check.id} — ${check.questionKo}`,
    `  Meaning: ${lesson.meaning}`,
    `  Your move: ${lesson.move}`,
    `  What to say: ${lesson.say}`,
    `  ${wireLine(check.id)}`,
  ].join("\n");
}

/**
 * Legend plus one card per opened criterion.
 * Always attached to the Decide system prompt on every LLM call.
 */
export function encodeCriteriaFewShot(listing?: ListingHint | null): string {
  if (decideFewShotMode === "off") return "";
  const checks = resolveChecks(listingTags(listing));
  if (checks.length === 0) {
    return [
      CRITERIA_LEGEND,
      "",
      "## Criteria cards — this tag",
      "No opened criteria. Do not invent HARD gates or SOFT levers.",
    ].join("\n");
  }

  const hard = checks.filter((c) => c.enforcement === "hard");
  const soft = checks.filter((c) => c.enforcement === "soft");
  return [
    CRITERIA_LEGEND,
    "",
    "## Criteria cards — this tag",
    `This tag opened ${hard.length} HARD and ${soft.length} SOFT criteria. Each card is one question. Use only these. Values for THIS copy are in the user prompt, not on the card.`,
    "",
    ...hard.map(encodeCriterionCard),
    "",
    ...soft.map(encodeCriterionCard),
  ].join("\n");
}
