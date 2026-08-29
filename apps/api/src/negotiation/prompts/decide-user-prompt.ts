/**
 * Single encoder for the Decide user prompt.
 *
 * Change docs/engine/decide-prompt-contract.md first, then this file.
 * Do not add a second history or a second private-number block.
 */

import { encodeHnpCompactStateForLlm, reduceHnpPublicCompactState } from "@haggle/engine-session";
import { factsToHnpPublicActs, turnsToHnpPublicActs } from "../memory/conversation-memory.js";
import { computeHarnessBox, DEFAULT_AUTONOMY } from "../referee/harness-box.js";
import type { ConversationContext, CoreMemory, RoundFact } from "../types.js";
import { sanitizePrivatePlan } from "./private-plan.js";

function toDollars(minor: number | undefined | null): string {
  return ((minor ?? 0) / 100).toFixed(2);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function buildDecideUserPrompt(
  memory: CoreMemory,
  recentFacts: RoundFact[],
  signals?: string[],
  prevMemory?: CoreMemory,
  conversation?: ConversationContext,
): string {
  const parts: string[] = [];

  const listingLine = encodeListingContext(memory);
  if (listingLine) parts.push(listingLine);

  const fulfillmentLine = encodeFulfillmentContext(memory);
  if (fulfillmentLine) parts.push(fulfillmentLine);

  const strategyLine = encodeStrategyContext(memory);
  if (strategyLine) parts.push(strategyLine);

  if (prevMemory) {
    parts.push(`MEMO:\n${encodeDelta(prevMemory, memory)}`);
  } else {
    parts.push(`MEMO:\n${encodePrivateMemo(memory)}`);
  }

  const boxLine = encodeBox(memory);
  if (boxLine) parts.push(boxLine);

  const publicTalk = encodePublicConversation(conversation, recentFacts);
  if (publicTalk.block) parts.push(publicTalk.block);

  const hintLine = encodeClosingHint(memory);
  if (hintLine) parts.push(hintLine);

  if (signals && signals.length > 0) {
    parts.push("SIG:" + signals.join(";"));
  }

  return parts.join("\n");
}

export function encodePrivateMemo(m: CoreMemory): string {
  const s = m.session;
  const b = m.boundaries;
  const c = m.coaching;
  const parts = [
    `S:${s.phase}|R${s.round}/${s.max_rounds}|${s.role}|${s.intervention_mode}`,
    `B:t$${toDollars(b.my_target)}/f$${toDollars(b.my_floor)}/c$${toDollars(b.current_offer)}/o$${toDollars(b.opponent_offer)}/g$${toDollars(b.gap)}`,
    `C:${c.suggested_tactic}|opp:${c.opponent_pattern}|conv:${c.convergence_rate.toFixed(2)}|tp:${c.time_pressure.toFixed(2)}`,
  ];
  const plan = sanitizePrivatePlan(m.private_plan);
  if (plan) parts.push(`P:${plan}`);

  if (m.terms.active.length > 0) {
    parts.push(
      "T:" +
        m.terms.active
          .map(
            (t) => `${t.term_id}:${t.status}${t.value !== undefined ? "=" + String(t.value) : ""}`,
          )
          .join(","),
    );
  }

  if (m.competition) {
    const cp = m.competition;
    parts.push(`CP:batna$${toDollars(cp.batna_price)}|n${cp.n_active_sessions}|rank${cp.my_rank}`);
  }

  return parts.join("\n");
}

function encodeDelta(prev: CoreMemory, curr: CoreMemory): string {
  const diffs: string[] = ["DELTA:"];

  if (prev.session.phase !== curr.session.phase) {
    diffs.push(`phase:${prev.session.phase}→${curr.session.phase}`);
  }
  if (prev.session.round !== curr.session.round) {
    diffs.push(`round:${curr.session.round}/${curr.session.max_rounds}`);
  }
  if (prev.boundaries.current_offer !== curr.boundaries.current_offer) {
    diffs.push(
      `myOffer:$${toDollars(prev.boundaries.current_offer)}→$${toDollars(curr.boundaries.current_offer)}`,
    );
  }
  if (prev.boundaries.opponent_offer !== curr.boundaries.opponent_offer) {
    diffs.push(
      `oppOffer:$${toDollars(prev.boundaries.opponent_offer)}→$${toDollars(curr.boundaries.opponent_offer)}`,
    );
  }
  if (prev.boundaries.gap !== curr.boundaries.gap) {
    diffs.push(`gap:$${toDollars(curr.boundaries.gap)}`);
  }
  if (prev.coaching.opponent_pattern !== curr.coaching.opponent_pattern) {
    diffs.push(`opp:${curr.coaching.opponent_pattern}`);
  }
  if (prev.coaching.suggested_tactic !== curr.coaching.suggested_tactic) {
    diffs.push(`tactic:${curr.coaching.suggested_tactic}`);
  }

  if (diffs.length <= 1) {
    return encodePrivateMemo(curr);
  }

  return diffs.join("|");
}

function encodeBox(memory: CoreMemory): string | null {
  const hb = computeHarnessBox(memory.coaching, memory.boundaries, DEFAULT_AUTONOMY);
  if (!hb) return null;
  const opening = memory.session.phase === "OPENING";
  return [
    "BOX:",
    `  Safe COUNTER range this round: $${toDollars(hb.box.min)}–$${toDollars(hb.box.max)}. Outside is clamped. This is your floor / ask / no-backwards envelope, not a fair price.`,
    "  Faratin pace, if present, is in Skills → Advisor. It is optional. Do not copy it as the deal price.",
    opening
      ? "  Opening: pick the first number from LISTING SOFT facts plus the ask and your budget. The ask is not already adjusted for those facts. Two copies that differ only on SOFT must not open at the same price. Judge how common and how wanted this SOFT is — supply and demand, not a step table."
      : "  Later counters: keep using those SOFT facts and the same supply-and-demand read. Do not walk every copy to the same interior point just because the gap shrank.",
  ].join("\n");
}

export function encodeListingContext(memory: CoreMemory): string | null {
  const lc = memory.listing_context;
  if (!lc) return null;
  const lines: string[] = ["LISTING:"];
  if (lc.title) lines.push(`  title: ${truncate(lc.title, 120)}`);
  if (lc.category) lines.push(`  category: ${lc.category}`);
  if (lc.condition) lines.push(`  condition: ${lc.condition}`);
  if (lc.tags && lc.tags.length > 0) {
    lines.push(`  tags: ${lc.tags.slice(0, 8).join(", ")}`);
  }
  if (lc.attributes && Object.keys(lc.attributes).length > 0) {
    const attrLine = Object.entries(lc.attributes)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    if (attrLine) lines.push(`  attrs: ${attrLine}`);
  }
  if (lc.parcel) {
    const dims = [lc.parcel.length_in, lc.parcel.width_in, lc.parcel.height_in]
      .filter((n): n is number => typeof n === "number")
      .join("x");
    lines.push(
      `  parcel: ${lc.parcel.weight_oz}oz${dims ? ` ${dims}in` : ""} (seller-stated; rate error is the seller's)`,
    );
  }
  if (lc.description) lines.push(`  description: ${truncate(lc.description, 280)}`);
  if (lc.seller_facts && lc.seller_facts.length > 0) {
    const facts = lc.seller_facts
      .map((f) => {
        const q = typeof f.question === "string" && f.question.length > 0 ? `${f.question} ` : "";
        return `${q}= ${truncate(f.stance, 160)}`.trim();
      })
      .filter((s) => s.length > 1)
      .slice(0, 24);
    if (facts.length > 0) lines.push(`  sellerStatedFacts: ${facts.join("; ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

function encodeFulfillmentContext(memory: CoreMemory): string | null {
  const fc = memory.fulfillment_context;
  if (!fc) return null;
  const lines: string[] = ["FULFILLMENT:"];
  const methods = fc.methods && fc.methods.length > 0 ? fc.methods : fc.method ? [fc.method] : [];
  if (methods.length > 0) lines.push(`  buyer_will_accept: ${methods.join(", ")}`);
  if (fc.method) lines.push(`  buyer_opening: ${fc.method}`);
  if (fc.seller_options && fc.seller_options.length > 0) {
    const offered = fc.seller_options
      .map((option) => {
        const extras = [
          option.radius_miles ? `${option.radius_miles}mi` : null,
          option.max_weight_lb ? `${option.max_weight_lb}lb` : null,
        ]
          .filter(Boolean)
          .join("/");
        return extras ? `${option.method}(${extras})` : option.method;
      })
      .join(", ");
    lines.push(`  seller_offered: ${offered}`);
  }
  if (fc.constraints?.travel_radius_miles) {
    lines.push(`  buyer_travel_radius_miles: ${fc.constraints.travel_radius_miles}`);
  }
  if (fc.constraints?.max_pickup_weight_lb) {
    lines.push(`  buyer_max_pickup_weight_lb: ${fc.constraints.max_pickup_weight_lb}`);
  }
  if (fc.carrier_priority) {
    lines.push(`  buyer_carrier_priority: ${fc.carrier_priority}`);
  }
  if (fc.parcel) {
    const dims = [fc.parcel.length_in, fc.parcel.width_in, fc.parcel.height_in]
      .filter((n): n is number => typeof n === "number")
      .join("x");
    lines.push(`  seller_parcel: ${fc.parcel.weight_oz}oz${dims ? ` ${dims}in` : ""}`);
  }
  if (fc.destination) {
    const dest = [fc.destination.city, fc.destination.state, fc.destination.zip]
      .filter(Boolean)
      .join(", ");
    if (dest) lines.push(`  destination: ${dest}`);
  }
  lines.push("  shipping_is_negotiable: yes — stay inside buyer_will_accept ∩ seller_offered.");
  lines.push("  total_price_includes_shipping: yes");
  if (fc.shipping_cost_known && fc.shipping_cost_minor === 0) {
    lines.push("  shipping_money: $0 unless both sides agree to add carrier shipping.");
  } else {
    lines.push(
      "  shipping_money: if carrier stays in play, include it in the all-in total. Parcel-rate error is the seller's problem.",
    );
  }
  if (fc.rate_note) lines.push(`  note: ${truncate(fc.rate_note, 220)}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

function encodeClosingHint(memory: CoreMemory): string | null {
  const b = memory.boundaries;
  const s = memory.session;
  const gap = Math.abs(b.gap);
  if (gap <= 0) return null;
  const range = Math.abs(b.my_target - b.my_floor);
  const ratio = range > 0 ? gap / range : 1;

  const lateRound = s.round >= 5;
  const roundsLow = s.rounds_remaining <= 2;
  const gapTiny = ratio < 0.05 || gap < 500;
  const gapSmall = ratio < 0.1 || gap < 1000;

  if (gapTiny) {
    return [
      "NEGOTIATION_HINT:",
      `  gap is $${toDollars(gap)} (${(ratio * 100).toFixed(1)}% of your target↔floor range).`,
      "  A small gap is not a reason to close. ACCEPT only if THIS copy's SOFT facts make the opponent's number fair. A weaker SOFT answer must not settle where a stronger copy would.",
    ].join("\n");
  }

  if (gapSmall && (lateRound || roundsLow)) {
    return [
      "NEGOTIATION_HINT:",
      `  gap is $${toDollars(gap)} (${(ratio * 100).toFixed(1)}% of range), round ${s.round}/${s.max_rounds}, ${s.rounds_remaining} left.`,
      "  Rounds are low. You may close if the number fits this copy. Do not meet in the middle just to spend the last rounds, and do not copy recommended_price.",
    ].join("\n");
  }

  return null;
}

function encodePublicConversation(
  conversation: ConversationContext | undefined,
  recentFacts: RoundFact[],
): { block: string | null } {
  const lines: string[] = [];

  if (conversation?.opponent_message) {
    lines.push(`OPP_SAID: ${truncate(conversation.opponent_message, 320)}`);
  }

  const turns = conversation?.recent_turns ?? [];
  if (turns.length > 0) {
    const state = reduceHnpPublicCompactState(turnsToHnpPublicActs(turns));
    lines.push(encodeHnpCompactStateForLlm(state));
  } else if (recentFacts.length > 0) {
    const state = reduceHnpPublicCompactState(factsToHnpPublicActs(recentFacts));
    lines.push(encodeHnpCompactStateForLlm(state));
  }

  return { block: lines.length > 0 ? lines.join("\n") : null };
}

export function encodeStrategyContext(memory: CoreMemory): string | null {
  const sc = memory.strategy_context;
  if (!sc) return null;
  const lines: string[] = ["STRATEGY:"];
  if (sc.negotiation_agent_preset_id) lines.push(`  persona: ${sc.negotiation_agent_preset_id}`);
  const advisor = sc.negotiation_agent_builder_memory;
  if (advisor && typeof advisor === "object") {
    const a = advisor as Record<string, unknown>;
    const pushIfString = (label: string, v: unknown) => {
      if (typeof v === "string" && v.length > 0) lines.push(`  ${label}: ${truncate(v, 160)}`);
    };
    const pushIfArray = (label: string, v: unknown) => {
      if (Array.isArray(v) && v.length > 0) {
        const items = v.filter((x) => typeof x === "string" && x.length > 0).slice(0, 6);
        if (items.length > 0) lines.push(`  ${label}: ${items.join("; ")}`);
      }
    };
    pushIfString("tone", a.tone);
    pushIfString("urgency", a.urgency);
    pushIfString("riskStyle", a.riskStyle);
    pushIfString("negotiationStyle", a.negotiationStyle);
    pushIfString("openingTactic", a.openingTactic);
    pushIfArray("mustEmphasize", a.mustEmphasize);
    pushIfArray("dealBreakers", a.dealBreakers);
    pushIfArray("mustHave", a.mustHave);
    pushIfArray("avoid", a.avoid);
    pushIfArray("notes", a.notes);
    if (Array.isArray(a.categoryCriteria)) {
      const hasStance = (c: { stance?: unknown }) =>
        typeof c.stance === "string" && c.stance.length > 0;
      const render = (c: { questionKo?: unknown; stance?: unknown }) => {
        const label = typeof c.questionKo === "string" ? c.questionKo : "";
        const stance = hasStance(c) ? ` = ${c.stance as string}` : "";
        return `${label}${stance}`.trim();
      };
      const criteria = a.categoryCriteria.filter(
        (c): c is { questionKo?: unknown; stance?: unknown; requirement?: unknown } =>
          !!c && typeof c === "object",
      );
      const required = criteria
        .filter((c) => c.requirement === "required")
        .map(render)
        .filter((s) => s.length > 0)
        .slice(0, 24);
      if (required.length > 0) lines.push(`  requiredCriteria: ${required.join("; ")}`);
      const preferences = criteria
        .filter((c) => c.requirement !== "required" && hasStance(c))
        .map(render)
        .filter((s) => s.length > 0)
        .slice(0, 8);
      if (preferences.length > 0) lines.push(`  preferences: ${preferences.join("; ")}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
