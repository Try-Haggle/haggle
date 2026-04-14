import { api } from "@/lib/api-client";

export interface CreateIntentResponse {
  intent: {
    id: string;
    status: string;
  };
}

export async function getBuyerSessions(userId: string, listingId: string) {
  const data = await api.get<{
    sessions: Array<{
      id: string;
      listing_id: string;
      status: string;
      current_round: number;
    }>;
  }>(`/negotiations/sessions?user_id=${userId}&role=BUYER`);
  return (data.sessions ?? []).filter((s) => s.listing_id === listingId);
}

export async function createBuyerIntent(params: {
  userId: string;
  category: string;
  keywords: string[];
  listingId: string;
  agentPreset: string;
  targetPrice?: number;
}) {
  const strategy = buildStrategyFromPreset(params.agentPreset, params.targetPrice);

  return api.post<CreateIntentResponse>("/api/intents", {
    user_id: params.userId,
    role: "BUYER",
    category: params.category || "general",
    keywords: params.keywords || [],
    strategy,
    min_u_total: 0.3,
    max_active_sessions: 5,
    expires_in_days: 30,
  });
}

export async function triggerMatch(category: string, listingId: string) {
  return api.post<{
    match_result: { matched: unknown[]; rejected: unknown[]; total_evaluated: number };
  }>("/api/intents/trigger-match", {
    category,
    listing_id: listingId,
    context_template: {
      price: { current: 0, target: 0, limit: 0, opening: 0 },
      time: { round: 1, max_rounds: 10, deadline_pressure: 0 },
      risk: { trust_score: 0.5, escrow_active: true, dispute_rate: 0, is_first_transaction: false },
      relationship: { repeat_partner: false, total_history: 0, avg_concession: 0 },
    },
  });
}

function buildStrategyFromPreset(presetId: string, targetPrice?: number) {
  const presets: Record<string, Record<string, unknown>> = {
    "price-hunter": { aggression: 0.7, patience: 0.5, risk: 0.6, style: "aggressive" },
    "smart-trader": { aggression: 0.3, patience: 0.9, risk: 0.3, style: "analytical" },
    "fast-closer": { aggression: 0.5, patience: 0.7, risk: 0.4, style: "collaborative" },
    "spec-analyst": { aggression: 0.9, patience: 0.3, risk: 0.8, style: "hardball" },
  };

  return {
    preset: presetId,
    params: presets[presetId] || presets["price-hunter"],
    target_price: targetPrice,
  };
}
