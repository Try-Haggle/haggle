export type AdvisorMemory = {
  categoryInterest: string;
  /** User-facing dollars captured from advisor chat, converted at API boundaries. */
  budgetMax?: number;
  /** User-facing dollars captured from advisor chat, converted at API boundaries. */
  targetPrice?: number;
  mustHave: string[];
  avoid: string[];
  riskStyle: "safe_first" | "balanced" | "lowest_price";
  negotiationStyle: "defensive" | "balanced" | "aggressive";
  openingTactic: "condition_anchor" | "fair_market_anchor" | "speed_close";
  questions: string[];
  source: string[];
  structured?: {
    activeIntent?: {
      productScope?: string;
      source?: string;
    };
    productRequirements: Record<string, {
      mustHave: string[];
      avoid: string[];
      answeredSlots: string[];
      ambiguousSlots: string[];
    }>;
    globalPreferences: {
      mustHave: string[];
      avoid: string[];
      budgetMax?: number;
      targetPrice?: number;
      riskStyle?: "safe_first" | "balanced" | "lowest_price";
      negotiationStyle?: "defensive" | "balanced" | "aggressive";
      openingTactic?: "condition_anchor" | "fair_market_anchor" | "speed_close";
    };
    pendingSlots: Array<{
      slotId: string;
      question: string;
      enforcement: "hard" | "soft";
      productScope?: string;
      status: "pending" | "ambiguous";
    }>;
    discardedSignals: Array<{
      text: string;
      reason: "off_topic" | "ambiguous" | "noise" | "security";
      relatedQuestion?: string;
    }>;
    memoryConflicts: Array<{
      slotId: string;
      productScope?: string;
      previousValue?: string;
      currentValue?: string;
      status: "current" | "superseded" | "conflicting" | "needs_confirmation";
      resolutionQuestion?: string;
      reason?: string;
    }>;
    scopedConditionDecisions: Array<{
      slotId: string;
      sourceScope?: string;
      targetScope: string;
      decision: "applied" | "rejected";
      reason?: string;
    }>;
    sessionMemory?: {
      facts: string[];
      pendingQuestions: string[];
      reason?: string;
    };
    longTermMemory?: {
      facts: string[];
      productScopes: string[];
      globalFacts: string[];
    };
    promotionDecisions: Array<{
      text: string;
      decision: "promote" | "session_only" | "discard";
      reason:
        | "confirmed_product_requirement"
        | "explicit_budget"
        | "stable_global_preference"
        | "pending_hard_slot"
        | "ambiguous"
        | "off_topic"
        | "security"
        | "low_information";
      target: "long_term" | "session" | "none";
      productScope?: string;
    }>;
    compression?: {
      recentWindowFacts: string[];
      carriedForwardFacts: string[];
      droppedSignals: string[];
      summary: string;
    };
    questionPlan?: {
      policy: {
        maxQuestionsPerTurn: number;
        order: Array<"conflict_resolution" | "hard_slot" | "candidate_narrowing" | "soft_slot">;
        rationale: string;
      };
      budget: {
        maxQuestionsPerTurn: number;
        used: number;
      };
      askedThisTurn: {
        kind: "conflict" | "hard_slot" | "soft_slot" | "candidate" | "none";
        question?: string;
        slotId?: string;
        productScope?: string;
      };
      deferred: Array<{
        slotId: string;
        question: string;
        enforcement: "hard" | "soft";
        reason: "question_budget" | "conflict_resolution_first" | "lower_priority" | "already_answered";
        productScope?: string;
      }>;
    };
  };
};

export type AdvisorListing = {
  id: string;
  title: string;
  category?: string;
  condition: string;
  askPriceMinor: number;
  floorPriceMinor: number;
  marketMedianMinor: number;
  sellerTurns: Array<{ seller_price_minor: number; seller_message: string }>;
  tags: string[];
  sellerNote: string;
};
