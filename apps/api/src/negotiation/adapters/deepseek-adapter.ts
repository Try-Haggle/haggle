import type {
  ConversationContext,
  ConversationTurn,
  CoreMemory,
  EngineDecision,
  ModelAdapter,
  RoundFact,
} from "../types.js";
import { PHASE_TOKEN_BUDGET as TOKEN_BUDGET } from "../types.js";

function toDollars(minor: number | undefined | null): string {
  return ((minor ?? 0) / 100).toFixed(2);
}

/**
 * DeepSeek Model Adapter — Tier: basic.
 * Uses Structured Output (JSON mode) for reliable parsing.
 * Implements Differential Context to minimize token usage.
 */
export class DeepSeekAdapter implements ModelAdapter {
  readonly modelId = "deepseek";
  readonly tier = "basic" as const;
  readonly location = "remote" as const;
  readonly capabilities = ["parse", "reason", "generate"] as const;

  buildSystemPrompt(skillContext: string, role?: "buyer" | "seller"): string {
    const persona =
      role === "seller"
        ? [
            "You are the SELLER. You own this item and you are talking directly to a real buyer who is interested in it.",
            "Your job is to defend the value of your item, respond to the buyer's arguments on their merits, and find a price you can both live with. You care about the final number, but you also care about not killing the deal over an extra few dollars.",
            'You speak in first person from the seller\'s side ("my item", "I can let it go for…"). You never propose a price below your floor, and you do not drop straight to your floor — concessions are earned, not given.',
          ].join(" ")
        : role === "buyer"
          ? [
              "You are the BUYER. You want this item and you are talking directly to a real seller. You have a budget ceiling (your floor) you absolutely cannot exceed.",
              'Your job is to make a reasonable opening, react to what the seller actually said, and move toward a price that works for you. You are not trying to "win" — you are trying to close a deal you feel good about.',
              'You speak in first person from the buyer\'s side ("I\'d pay…", "could you do…"). NEVER propose a price above your floor. And NEVER counter LOWER than a price you yourself already offered earlier in this thread — backing down from your own number is irrational and the seller will notice. If anything, your offers should creep up (toward the seller) over rounds, not down.',
            ].join(" ")
          : "You are an AI negotiation agent representing one side of a peer-to-peer deal.";

    return [
      persona,
      "",
      "## How to negotiate like a real person",
      "1. READ what the opponent just said. If they made an argument (condition, market price, urgency, comparable listings), engage with it — agree, push back, or trade. Do not ignore their words and just spit out a number.",
      "2. JUSTIFY your move with one concrete signal from the LISTING (battery, scratches, storage, mileage, etc.) or your STRATEGY (urgency, dealbreakers, must-haves). One line of reasoning beats three lines of pleasantries.",
      "3. CONCEDE proportionally. If the opponent moved toward you, move toward them — by less than they did unless you have a reason. If they did NOT move, hold or move only a token amount.",
      "4. ACCEPT when the offer is at or better than your target, or when the remaining gap is small and you are running out of rounds. Do not chase the last dollar.",
      '5. Keep messages to 1–2 short sentences. Match the tone in STRATEGY.negotiation_agent_builder_memory.tone. Avoid filler like "How about $X?" with no reason.',
      "",
      "## Reading the compact memo",
      'In "B:t$X/f$Y/c$Z/o$W": t = YOUR target (best realistic outcome), f = YOUR floor (hard limit you must not cross), c = YOUR last offer, o = the OPPONENT\'s last offer. "HIST" lists prior rounds; "OPP_SAID" is the opponent\'s latest message; "THREAD" is the recent chat. If anything in the prose conflicts with this prompt, trust this prompt.',
      "",
      skillContext,
      "",
      'All monetary values are USD dollars (e.g., "$450.00" = four hundred fifty US dollars).',
      "",
      "## Output",
      "Respond ONLY with valid JSON matching this schema:",
      '{"action":"COUNTER|ACCEPT|REJECT|HOLD|DISCOVER|CONFIRM","price":number,"reasoning":"string","message":"string","non_price_terms":{},"tactic_used":"string"}',
      "Field rules:",
      '- "price": USD dollar amount (e.g., 450.00 for $450), NOT cents. Decimals allowed. Omit for ACCEPT/REJECT/HOLD/DISCOVER.',
      '- "reasoning": short internal note for logs. Not shown to the counterparty.',
      '- "message": the chat line the counterparty actually sees. 1–2 short sentences. Must respond to OPP_SAID if present, and cite one concrete LISTING or STRATEGY signal.',
      '- "tactic_used": one tactic name from the skill context.',
      "Do NOT include markdown, code blocks, or any text outside the JSON.",
    ].join("\n");
  }

  buildUserPrompt(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    signals?: string[],
    prevMemory?: CoreMemory,
    conversation?: ConversationContext,
  ): string {
    const parts: string[] = [];

    // L2: Listing context — sent once per call (no diff). The LLM needs to
    // know what it's actually negotiating about.
    const listingLine = encodeListingContext(memory);
    if (listingLine) parts.push(listingLine);

    // L2.5: Strategy context — persona, advisor memory, dealbreakers.
    const strategyLine = encodeStrategyContext(memory);
    if (strategyLine) parts.push(strategyLine);

    // L3: Core Memory (compact encoding)
    if (prevMemory) {
      // Differential Context — only send what changed
      parts.push(this.encodeDelta(prevMemory, memory));
    } else {
      parts.push(this.encodeCoreMemoCompact(memory));
    }

    // L4: History (compact, USD)
    if (recentFacts.length > 0) {
      parts.push(
        "HIST:" +
          recentFacts
            .map(
              (f) =>
                `R${f.round}:$${toDollars(f.buyer_offer)}/$${toDollars(f.seller_offer)}|g$${toDollars(f.gap)}${f.buyer_tactic ? "|t:" + f.buyer_tactic : ""}`,
            )
            .join(";"),
      );
    }

    // L4.5: Conversation thread — what was actually said. Lets the LLM
    // respond to arguments instead of just prices. Render OPP_SAID separately
    // so the model can't miss it.
    const threadBlock = encodeConversation(conversation, memory.session.role);
    if (threadBlock) parts.push(threadBlock);

    // L4.6: Closing hint — operationalize "ACCEPT when gap is tiny" by
    // computing it server-side and surfacing as an explicit instruction.
    // The LLM ignored the abstract rule in the system prompt; concrete
    // numbers in the user prompt are harder to miss.
    const hintLine = encodeClosingHint(memory);
    if (hintLine) parts.push(hintLine);

    // L5: Signals
    if (signals && signals.length > 0) {
      parts.push("SIG:" + signals.join(";"));
    }

    // Token budget check
    const budget = TOKEN_BUDGET[memory.session.phase];
    const estimated = parts.join("\n").length / 4; // rough estimate
    if (estimated > budget) {
      // Truncate history to fit (USD)
      const truncatedFacts = recentFacts.slice(-2);
      parts[1] =
        "HIST:" +
        truncatedFacts
          .map(
            (f) =>
              `R${f.round}:$${toDollars(f.buyer_offer)}/$${toDollars(f.seller_offer)}|g$${toDollars(f.gap)}`,
          )
          .join(";");
    }

    return parts.join("\n");
  }

  parseResponse(raw: string): EngineDecision {
    // Strip markdown code blocks if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    try {
      const parsed = JSON.parse(cleaned);

      // Validate required fields
      if (!parsed.action || typeof parsed.action !== "string") {
        throw new Error('Missing or invalid "action" field');
      }
      if (!parsed.reasoning || typeof parsed.reasoning !== "string") {
        throw new Error('Missing or invalid "reasoning" field');
      }

      const decision: EngineDecision = {
        action: parsed.action,
        reasoning: parsed.reasoning,
      };

      if (typeof parsed.price === "number" && parsed.price > 0) {
        // LLM returns USD dollars; convert to minor units (cents) for internal use.
        decision.price = Math.round(parsed.price * 100);
      }
      if (parsed.non_price_terms && typeof parsed.non_price_terms === "object") {
        decision.non_price_terms = parsed.non_price_terms;
      }
      if (typeof parsed.tactic_used === "string") {
        decision.tactic_used = parsed.tactic_used;
      }
      if (typeof parsed.message === "string") {
        const trimmed = parsed.message.trim();
        if (trimmed.length > 0) decision.message = trimmed;
      }

      return decision;
    } catch (err) {
      // Fallback: try to extract action from malformed response
      const actionMatch = cleaned.match(/"action"\s*:\s*"(\w+)"/);
      if (actionMatch) {
        return {
          action: actionMatch[1] as EngineDecision["action"],
          reasoning: `Parse recovery from malformed response: ${(err as Error).message}`,
        };
      }
      throw new Error(`Failed to parse LLM response: ${(err as Error).message}`);
    }
  }

  coachingLevel(): "DETAILED" | "STANDARD" | "LIGHT" {
    return "STANDARD";
  }

  // ─── Private helpers ───

  private encodeCoreMemoCompact(m: CoreMemory): string {
    const s = m.session;
    const b = m.boundaries;
    const c = m.coaching;
    const parts = [
      `S:${s.phase}|R${s.round}/${s.max_rounds}|${s.role}|${s.intervention_mode}`,
      `B:t$${toDollars(b.my_target)}/f$${toDollars(b.my_floor)}/c$${toDollars(b.current_offer)}/o$${toDollars(b.opponent_offer)}/g$${toDollars(b.gap)}`,
      `C:rec$${toDollars(c.recommended_price)}|${c.suggested_tactic}|opp:${c.opponent_pattern}|conv:${c.convergence_rate.toFixed(2)}|tp:${c.time_pressure.toFixed(2)}`,
    ];

    if (m.terms.active.length > 0) {
      parts.push(
        "T:" +
          m.terms.active
            .map(
              (t) =>
                `${t.term_id}:${t.status}${t.value !== undefined ? "=" + String(t.value) : ""}`,
            )
            .join(","),
      );
    }

    if (m.competition) {
      const cp = m.competition;
      parts.push(
        `CP:batna$${toDollars(cp.batna_price)}|n${cp.n_active_sessions}|rank${cp.my_rank}`,
      );
    }

    return parts.join("\n");
  }

  private encodeDelta(prev: CoreMemory, curr: CoreMemory): string {
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
    if (prev.coaching.recommended_price !== curr.coaching.recommended_price) {
      diffs.push(`rec:$${toDollars(curr.coaching.recommended_price)}`);
    }
    if (prev.coaching.opponent_pattern !== curr.coaching.opponent_pattern) {
      diffs.push(`opp:${curr.coaching.opponent_pattern}`);
    }
    if (prev.coaching.suggested_tactic !== curr.coaching.suggested_tactic) {
      diffs.push(`tactic:${curr.coaching.suggested_tactic}`);
    }

    // If nothing changed (shouldn't happen), send full memo
    if (diffs.length <= 1) {
      return this.encodeCoreMemoCompact(curr);
    }

    return diffs.join("|");
  }
}

// ─── Listing / Strategy encoders (free functions; not adapter-state) ───────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function encodeListingContext(memory: CoreMemory): string | null {
  const lc = memory.listing_context;
  if (!lc) return null;
  const lines: string[] = ["LISTING:"];
  if (lc.title) lines.push(`  title: ${truncate(lc.title, 120)}`);
  if (lc.category) lines.push(`  category: ${lc.category}${lc.subtype ? `/${lc.subtype}` : ""}`);
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
  if (lc.description) lines.push(`  description: ${truncate(lc.description, 280)}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * If the negotiation is close to a deal, tell the LLM in plain words.
 *
 * The system prompt already says "ACCEPT when gap is small and rounds are
 * running out", but that's an abstraction. Once we see real numbers like
 * R9 sellerOffer=$465 / buyerOffer=$462.50, gap=$2.50, range=$100, ratio=2.5%
 * — we should surface that arithmetic directly so the LLM can't talk itself
 * into another $2 counter.
 *
 * Returns null when the gap is wide enough that countering is still rational.
 */
function encodeClosingHint(memory: CoreMemory): string | null {
  const b = memory.boundaries;
  const s = memory.session;
  const gap = Math.abs(b.gap);
  if (gap <= 0) return null;
  const range = Math.abs(b.my_target - b.my_floor);
  const ratio = range > 0 ? gap / range : 1;

  const lateRound = s.round >= 5;
  const roundsLow = s.rounds_remaining <= 2;
  const gapTiny = ratio < 0.05 || gap < 500; // <5% of range OR <$5 absolute
  const gapSmall = ratio < 0.1 || gap < 1000; // <10% or <$10

  if (gapTiny) {
    return [
      "NEGOTIATION_HINT:",
      `  gap is $${toDollars(gap)} (${(ratio * 100).toFixed(1)}% of your target↔floor range).`,
      "  This is essentially a deal. ACCEPT the opponent's offer — do NOT counter another dollar or two. Closing the deal now is worth more than the final $1.",
    ].join("\n");
  }

  if (gapSmall && (lateRound || roundsLow)) {
    return [
      "NEGOTIATION_HINT:",
      `  gap is $${toDollars(gap)} (${(ratio * 100).toFixed(1)}% of range), round ${s.round}/${s.max_rounds}, ${s.rounds_remaining} left.`,
      "  You are running out of rounds and the gap is small. Strongly consider ACCEPT or meet them halfway in one move — do not nibble.",
    ].join("\n");
  }

  return null;
}

function encodeConversation(
  conversation: ConversationContext | undefined,
  myRole: "buyer" | "seller",
): string | null {
  if (!conversation) return null;
  const lines: string[] = [];

  if (conversation.opponent_message) {
    lines.push(`OPP_SAID: ${truncate(conversation.opponent_message, 320)}`);
  }

  const turns = conversation.recent_turns ?? [];
  if (turns.length > 0) {
    lines.push("THREAD:");
    for (const t of turns) {
      lines.push(`  ${renderTurnSpeaker(t, myRole)}: ${truncate(t.text, 200)}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

function renderTurnSpeaker(turn: ConversationTurn, myRole: "buyer" | "seller"): string {
  const meTag =
    (myRole === "buyer" && turn.sender === "BUYER") ||
    (myRole === "seller" && turn.sender === "SELLER");
  const priceStr = turn.price_minor != null ? ` ($${toDollars(turn.price_minor)})` : "";
  const speakerLabel = meTag ? `R${turn.round} ME` : `R${turn.round} OPP`;
  return `${speakerLabel}${priceStr}`;
}

function encodeStrategyContext(memory: CoreMemory): string | null {
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
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
