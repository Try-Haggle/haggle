import { api } from "./api-client";
import type { AdvisorListing, AdvisorMemory } from "./advisor-demo-types";

const DEMO_OPTS = { skipAuth: true } as const;

export type StoredMemoryCard = {
  id: string;
  user_id: string;
  card_type: string;
  memory_key: string;
  summary: string;
  memory: Record<string, unknown>;
  strength: string;
  version: number;
  updated_at: string;
};

export type SaveAdvisorMemoryResponse = {
  user_id: string;
  session_id: string;
  source_message_id: string;
  signals: {
    extracted: number;
    inserted: number;
  };
  memory_cards: StoredMemoryCard[];
};

export type TagGardenSignalAction =
  | "promote_candidate"
  | "merge_candidate"
  | "deprecate_tag"
  | "reject_noise"
  | "watch";

export type TagGardenSignal = {
  action: TagGardenSignalAction;
  label: string;
  normalizedLabel: string;
  category: string | null;
  strength: number;
  reason: string;
  evidence: Record<string, unknown>;
};

export type TagGardenIntelligenceSnapshot = {
  generatedAt: string;
  windows: {
    trendMinOccurrences: number;
    staleAfterDays: number;
    noiseAfterDays: number;
  };
  summary: {
    trendCandidates: number;
    mergeCandidates: number;
    deprecateCandidates: number;
    noiseCandidates: number;
  };
  signals: TagGardenSignal[];
};

export type AnalyzeAdvisorTurnResponse = {
  user_id: string;
  agent_id?: string;
  memory: AdvisorMemory;
  reply: string;
  reasoning_summary?: string;
  advisor_plan?: AdvisorCandidatePlan;
  turn_cost?: AdvisorTurnCost;
};

export type AdvisorDemoListingsResponse = {
  source: "db";
  count: number;
  shown?: number;
  listings: AdvisorListing[];
  advisor_plan?: AdvisorCandidatePlan;
  retrieval?: {
    mode: "semantic_hybrid" | "keyword";
    semanticApplied: boolean;
    semanticCandidates: number;
    keywordCandidates: number;
  };
};

export type AdvisorCandidatePlan = {
  candidateCount: number;
  dominantCluster: {
    label: string;
    count: number;
    share: number;
  } | null;
  facets: Array<{
    slot: string;
    values: Array<{ label: string; count: number; share: number }>;
    entropy: number;
  }>;
  nextAction: {
    action: string;
    slot: string;
    reasonCode: string;
    question: string | null;
  };
};

export type AdvisorTurnCost = {
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  estimated_usd: number;
  pricing: {
    prompt_usd_per_1m: number;
    completion_usd_per_1m: number;
  };
};

export type NegotiationPresetId = "safe_buyer" | "balanced_closer" | "lowest_price" | "fast_close";

export type PresetTermDraft = {
  termId: string;
  label: string;
  enforcement: "hard" | "soft" | "deal_breaker";
  source: "listing" | "memory" | "preset" | "tag";
  question: string;
  rationale: string;
  checked: boolean;
  confirmedValue?: {
    value: string | number | boolean;
    label?: string;
    unit?: string;
    source: "listing" | "memory" | "user" | "seller_reply";
  };
};

export type PresetLeverageDraft = {
  termId: string;
  label: string;
  reason: string;
  priceImpactMinor: number;
  source: "listing" | "memory" | "preset" | "tag";
  enabled: boolean;
};

export type PresetWalkAwayDraft = {
  id: string;
  label: string;
  reason: string;
  source: "listing" | "memory" | "preset" | "tag";
  enabled: boolean;
};

export type PresetEngineReview = {
  cycle: "design_architecture_implementation_review";
  status: "ready" | "needs_user_input" | "blocked";
  branches: Array<{
    id: string;
    label: string;
    outcome: "continue" | "ask_user" | "block";
    reason: string;
  }>;
  blockers: Array<{
    id: string;
    label: string;
    severity: "hard" | "soft";
    source: "listing" | "memory" | "tag" | "security";
    reason: string;
  }>;
  nextActions: Array<{
    termId?: string;
    label: string;
    control: "toggle" | "slider" | "select" | "text";
    question: string;
    controlConfig?: {
      unit?: string;
      min?: number;
      max?: number;
      step?: number;
      defaultValue?: string | number | boolean;
      placeholder?: string;
      options?: Array<{ value: string; label: string }>;
    };
  }>;
};

export type PresetTuningDraft = {
  draftId: string;
  presetId: NegotiationPresetId;
  presetLabel: string;
  listing: {
    id: string;
    title: string;
    category?: string;
    askPriceMinor: number;
    marketMedianMinor?: number;
    tags: string[];
  };
  priceCapMinor: number;
  openingOfferMinor: number;
  maxAgreementMinor: number;
  concessionSpeed: "slow" | "medium" | "fast";
  riskTolerance: "low" | "medium" | "high";
  strategyNotes: string[];
  mustVerify: PresetTermDraft[];
  leverage: PresetLeverageDraft[];
  walkAway: PresetWalkAwayDraft[];
  engineReview?: PresetEngineReview;
  sourceBadges: Array<"listing" | "memory" | "preset" | "tag">;
  appliedTunedCandidate?: {
    key: string;
    memoryKey: string;
    score: number;
    reason: string;
    applicationMode: "auto" | "manual";
  };
  negotiationStartPayload: Record<string, unknown>;
};

export type SavePresetTuningCandidateResponse = {
  user_id: string;
  source_message_id: string;
  candidate: {
    cardType: string;
    memoryKey: string;
    summary: string;
    memory: Record<string, unknown>;
    strength: number;
  };
  memory_cards: StoredMemoryCard[];
};

export type NegotiationPresetSummary = {
  id: NegotiationPresetId;
  label: string;
  concessionSpeed: "slow" | "medium" | "fast";
  riskTolerance: "low" | "medium" | "high";
  notes: string[];
};

export async function analyzeAdvisorTurn(params: {
  userId?: string;
  agentId: string;
  message: string;
  previousMemory: AdvisorMemory;
  listings: AdvisorListing[];
}): Promise<AnalyzeAdvisorTurnResponse> {
  return api.post<AnalyzeAdvisorTurnResponse>(
    "/intelligence/demo/advisor-turn",
    {
      user_id: params.userId,
      agent_id: params.agentId,
      message: params.message,
      previous_memory: params.previousMemory,
      listings: params.listings.map((listing) => ({
        id: listing.id,
        title: listing.title,
        category: listing.category,
        condition: listing.condition,
        askPriceMinor: listing.askPriceMinor,
        floorPriceMinor: listing.floorPriceMinor,
        marketMedianMinor: listing.marketMedianMinor,
        tags: listing.tags,
        sellerNote: listing.sellerNote,
      })),
    },
    DEMO_OPTS,
  );
}

export async function getAdvisorDemoListings(params: {
  query?: string;
  limit?: number;
} = {}): Promise<AdvisorDemoListingsResponse> {
  const search = new URLSearchParams();
  if (params.query) search.set("q", params.query);
  if (params.limit) search.set("limit", String(params.limit));
  const query = search.toString();

  return api.get<AdvisorDemoListingsResponse>(
    `/intelligence/demo/advisor-listings${query ? `?${query}` : ""}`,
    DEMO_OPTS,
  );
}

export async function saveAdvisorMemory(params: {
  userId?: string;
  sessionId?: string;
  agentId: string;
  message: string;
  memory: AdvisorMemory;
}): Promise<SaveAdvisorMemoryResponse> {
  return api.post<SaveAdvisorMemoryResponse>(
    "/intelligence/demo/advisor-memory",
    {
      user_id: params.userId,
      session_id: params.sessionId,
      agent_id: params.agentId,
      message: params.message,
      memory: params.memory,
    },
    DEMO_OPTS,
  );
}

export async function getDemoMemoryCards(userId?: string): Promise<{
  user_id: string;
  cards: StoredMemoryCard[];
  advisor_memory: AdvisorMemory | null;
}> {
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return api.get(`/intelligence/demo/memory${query}`, DEMO_OPTS);
}

export async function getTagGardenIntelligence(limit = 8): Promise<TagGardenIntelligenceSnapshot> {
  return api.get(
    `/intelligence/demo/tag-garden-intelligence?limit=${encodeURIComponent(String(limit))}`,
    DEMO_OPTS,
  );
}

export async function getNegotiationPresets(): Promise<{ presets: NegotiationPresetSummary[] }> {
  return api.get("/intelligence/demo/negotiation-presets", DEMO_OPTS);
}

export async function compilePresetTuningDraft(params: {
  listing: AdvisorListing;
  memory?: AdvisorMemory | null;
  presetId?: NegotiationPresetId;
  priceCapMinor?: number;
}): Promise<{ draft: PresetTuningDraft }> {
  return api.post(
    "/intelligence/demo/preset-tuning-draft",
    {
      listing: params.listing,
      memory: params.memory,
      preset_id: params.presetId,
      price_cap_minor: params.priceCapMinor,
    },
    DEMO_OPTS,
  );
}

export async function savePresetTuningCandidate(params: {
  userId: string;
  agentId?: string;
  draft: PresetTuningDraft;
}): Promise<SavePresetTuningCandidateResponse> {
  return api.post(
    "/intelligence/demo/preset-tuning-candidate",
    {
      user_id: params.userId,
      agent_id: params.agentId,
      draft: params.draft,
    },
    DEMO_OPTS,
  );
}

export async function recordPresetTuningFeedback(params: {
  userId: string;
  memoryKey: string;
  outcome: "accepted" | "rejected" | "abandoned" | "cap_blocked";
  finalPriceMinor?: number;
  priceCapMinor?: number;
  applicationMode?: "auto" | "manual";
}): Promise<{
  user_id: string;
  memory_key: string;
  outcome: string;
  delta: number;
  memory_cards: StoredMemoryCard[];
}> {
  return api.post(
    "/intelligence/demo/preset-tuning-feedback",
    {
      user_id: params.userId,
      memory_key: params.memoryKey,
      outcome: params.outcome,
      final_price_minor: params.finalPriceMinor,
      price_cap_minor: params.priceCapMinor,
      application_mode: params.applicationMode,
    },
    DEMO_OPTS,
  );
}

export async function resetDemoMemory(userId: string): Promise<{
  user_id: string;
  deleted: {
    user_memory_events: number;
    user_memory_cards: number;
    conversation_market_signals: number;
    conversation_signal_sources: number;
  };
}> {
  return api.delete(
    `/intelligence/demo/memory?user_id=${encodeURIComponent(userId)}`,
    DEMO_OPTS,
  );
}
