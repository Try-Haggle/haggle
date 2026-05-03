import { BUYER_AGENT_PRESETS } from "@/lib/buyer-agents";
import type { AgentCard, PlaybackResponse } from "./types";

/**
 * Mock playback transcripts. The "scenario" is picked deterministically from
 * the sessionId hash so the same URL always shows the same playback.
 *
 * Field shape mirrors what the real engine/DB emits:
 *   utilityScore       → engine-core u_total
 *   utilityBreakdown   → engine-core { v_p, v_t, v_r, v_s }  (price/time/risk/relationship)
 *   tactic             → DB tacticUsed (free-form string)
 *   phase              → DB phaseAtRound
 *   batnaDelta         → derived via compareSessions
 *   concessionPct      → DB concessionRate
 *   reasoning          → DB message/reasoning
 */

const ACCEPTED_QUICK: PlaybackResponse = {
  session: {
    id: "mock-quick",
    listing: {
      id: "listing-mbp",
      title: "MacBook Pro 16\" M3 Pro · 18GB · 512GB",
      imageUrl: null,
      askingPrice: 2400,
      currency: "USD",
      category: "electronics",
    },
    buyerAgent: {
      presetId: "fast-closer",
      name: "Fast Closer",
      tagline: "Quick deal, reasonable price.",
      accentColor: "#3b82f6",
      iconKey: "fast-closer",
      stats: { priceAggression: 35, patienceLevel: 20, riskTolerance: 30, speedBias: 95, detailFocus: 40 },
    },
    sellerAgent: {
      presetId: "diplomat",
      name: "The Diplomat",
      tagline: "Builds rapport, lands fair deals.",
      accentColor: "#06b6d4",
      iconKey: "diplomat",
    },
    finalStatus: "ACCEPTED",
    finalPrice: 2180,
    roundsTotal: 4,
  },
  rounds: [
    {
      roundIndex: 1,
      sender: "BUYER",
      decision: "OPENING",
      offerPrice: 1950,
      message:
        "Hi! Saw your listing — I'm interested but moving fast on this. Can we do $1,950 today? I can close by tonight.",
      factors: {
        utilityScore: 0.62,
        utilityBreakdown: { price: 0.78, time: 0.85, risk: 0.55, relationship: 0.40 },
        tactic: "Speed anchor",
        phase: "OPENING",
        batnaDelta: 0.12,
        concessionPct: 0,
        reasoning: "Open low but signal urgency to compress rounds.",
      },
      thinkingMs: 1200,
    },
    {
      roundIndex: 2,
      sender: "SELLER",
      decision: "COUNTER",
      offerPrice: 2300,
      message:
        "Appreciate the quick offer. $1,950 is below where I can go — this one's barely 4 months old with AppleCare through 2027. I can do $2,300.",
      factors: {
        utilityScore: 0.71,
        utilityBreakdown: { price: 0.65, time: 0.50, risk: 0.80, relationship: 0.85 },
        tactic: "Value justification",
        phase: "OPENING",
        batnaDelta: 0.18,
        concessionPct: 0.04,
        reasoning: "Anchor near asking with credibility hooks (AppleCare, age).",
      },
      thinkingMs: 1400,
    },
    {
      roundIndex: 3,
      sender: "BUYER",
      decision: "NEAR_DEAL",
      offerPrice: 2150,
      message:
        "Fair point on the warranty. I can stretch to $2,150 — that's my real ceiling for closing today. Wire transfer, ready when you are.",
      factors: {
        utilityScore: 0.79,
        utilityBreakdown: { price: 0.70, time: 0.95, risk: 0.65, relationship: 0.60 },
        tactic: "Concede to close",
        phase: "MID",
        batnaDelta: 0.09,
        concessionPct: 0.10,
        reasoning: "Big jump signals real ceiling. Bundle payment readiness.",
      },
      thinkingMs: 1100,
    },
    {
      roundIndex: 4,
      sender: "SELLER",
      decision: "ACCEPT",
      offerPrice: 2180,
      message:
        "$2,180 and we have a deal — that covers the original packaging and chargers I'll throw in. Sound good?",
      factors: {
        utilityScore: 0.84,
        utilityBreakdown: { price: 0.72, time: 0.92, risk: 0.85, relationship: 0.90 },
        tactic: "Split-the-difference",
        phase: "CLOSING",
        batnaDelta: 0.14,
        concessionPct: 0.05,
        reasoning: "Meet in the middle, sweeten with bundle to lock acceptance.",
      },
      thinkingMs: 1000,
    },
  ],
};

const ACCEPTED_LONG: PlaybackResponse = {
  session: {
    id: "mock-long",
    listing: {
      id: "listing-bike",
      title: "Specialized Stumpjumper Comp Carbon · 2024",
      imageUrl: null,
      askingPrice: 4200,
      currency: "USD",
      category: "sports",
    },
    buyerAgent: {
      presetId: "price-hunter",
      name: "Price Hunter",
      tagline: "Pushes for the lowest price.",
      accentColor: "#ef4444",
      iconKey: "price-hunter",
      stats: { priceAggression: 90, patienceLevel: 80, riskTolerance: 75, speedBias: 20, detailFocus: 60 },
    },
    sellerAgent: {
      presetId: "gatekeeper",
      name: "The Gatekeeper",
      tagline: "Holds firm on value.",
      accentColor: "#a855f7",
      iconKey: "gatekeeper",
    },
    finalStatus: "ACCEPTED",
    finalPrice: 3650,
    roundsTotal: 7,
  },
  rounds: [
    {
      roundIndex: 1,
      sender: "BUYER",
      decision: "OPENING",
      offerPrice: 3000,
      message:
        "Looking at three other Stumpjumpers in my area in the $3,200 range. Opening at $3,000 — let me know if there's room to talk.",
      factors: {
        utilityScore: 0.58,
        utilityBreakdown: { price: 0.82, time: 0.40, risk: 0.50, relationship: 0.70 },
        tactic: "Comparable cite",
        phase: "OPENING",
        batnaDelta: 0.20,
        concessionPct: 0,
        reasoning: "Anchor 28% below ask with market evidence.",
      },
      thinkingMs: 1300,
    },
    {
      roundIndex: 2,
      sender: "SELLER",
      decision: "REJECT",
      offerPrice: 4100,
      message:
        "Those comps aren't the Carbon Comp build. This is the SRAM GX AXS spec — that's a $700 upgrade. $4,100 is as low as I'll start.",
      factors: {
        utilityScore: 0.68,
        utilityBreakdown: { price: 0.55, time: 0.50, risk: 0.75, relationship: 0.80 },
        tactic: "Spec counter",
        phase: "OPENING",
        batnaDelta: 0.22,
        concessionPct: 0.02,
        reasoning: "Reject low anchor with technical correction. Hold near ask.",
      },
      thinkingMs: 1500,
    },
    {
      roundIndex: 3,
      sender: "BUYER",
      decision: "COUNTER",
      offerPrice: 3300,
      message:
        "Fair on the AXS — but the rear shock has visible service marks and the listing says 18 months on the bearings. $3,300 reflects the service I'll need within 6 months.",
      factors: {
        utilityScore: 0.66,
        utilityBreakdown: { price: 0.75, time: 0.45, risk: 0.55, relationship: 0.60 },
        tactic: "Wear discount",
        phase: "MID",
        batnaDelta: 0.16,
        concessionPct: 0.10,
        reasoning: "Pivot to condition issues. Move up but justify with service cost.",
      },
      thinkingMs: 1400,
    },
    {
      roundIndex: 4,
      sender: "SELLER",
      decision: "COUNTER",
      offerPrice: 3850,
      message:
        "Service is normal at this mileage — not a defect. I'll meet you partway: $3,850, and I'll throw in the original Roval wheels (kept the alloys for backup).",
      factors: {
        utilityScore: 0.74,
        utilityBreakdown: { price: 0.62, time: 0.65, risk: 0.78, relationship: 0.85 },
        tactic: "Bundle add-on",
        phase: "MID",
        batnaDelta: 0.18,
        concessionPct: 0.06,
        reasoning: "Move down but trade for bundle that costs less than discount.",
      },
      thinkingMs: 1600,
    },
    {
      roundIndex: 5,
      sender: "BUYER",
      decision: "COUNTER",
      offerPrice: 3500,
      message:
        "Roval wheels are nice but I already have a wheelset. $3,500 cash, picked up tomorrow — that's where I land.",
      factors: {
        utilityScore: 0.72,
        utilityBreakdown: { price: 0.78, time: 0.75, risk: 0.55, relationship: 0.50 },
        tactic: "Speed anchor",
        phase: "MID",
        batnaDelta: 0.12,
        concessionPct: 0.06,
        reasoning: "Decline irrelevant bundle, switch leverage to closing speed.",
      },
      thinkingMs: 1200,
    },
    {
      roundIndex: 6,
      sender: "SELLER",
      decision: "NEAR_DEAL",
      offerPrice: 3700,
      message:
        "Cash and pickup tomorrow has real value. $3,700, and I'll include the bike fit session I prepaid (it's transferable).",
      factors: {
        utilityScore: 0.78,
        utilityBreakdown: { price: 0.66, time: 0.82, risk: 0.80, relationship: 0.88 },
        tactic: "Creative bundle",
        phase: "CLOSING",
        batnaDelta: 0.15,
        concessionPct: 0.04,
        reasoning: "Substitute cheap concession (transferable service).",
      },
      thinkingMs: 1400,
    },
    {
      roundIndex: 7,
      sender: "BUYER",
      decision: "ACCEPT",
      offerPrice: 3650,
      message:
        "Split it — $3,650 with the fit session. Deal?",
      factors: {
        utilityScore: 0.82,
        utilityBreakdown: { price: 0.80, time: 0.85, risk: 0.70, relationship: 0.78 },
        tactic: "Split-the-difference",
        phase: "CLOSING",
        batnaDelta: 0.14,
        concessionPct: 0.04,
        reasoning: "Final split offer, last token of give.",
      },
      thinkingMs: 1100,
    },
  ],
};

const REJECTED: PlaybackResponse = {
  session: {
    id: "mock-rejected",
    listing: {
      id: "listing-watch",
      title: "Omega Speedmaster Professional · 1998",
      imageUrl: null,
      askingPrice: 5800,
      currency: "USD",
      category: "watches",
    },
    buyerAgent: {
      presetId: "spec-analyst",
      name: "Spec Analyst",
      tagline: "Digs into every detail.",
      accentColor: "#a855f7",
      iconKey: "spec-analyst",
    },
    sellerAgent: {
      presetId: "gatekeeper",
      name: "The Gatekeeper",
      tagline: "Holds firm on value.",
      accentColor: "#06b6d4",
      iconKey: "gatekeeper",
    },
    finalStatus: "REJECTED",
    finalPrice: null,
    roundsTotal: 4,
  },
  rounds: [
    {
      roundIndex: 1,
      sender: "BUYER",
      decision: "OPENING",
      offerPrice: 4200,
      message:
        "1998 cal. 1861 with bezel pitting and a service due in 2026 — Chrono24 medians for this reference range $4,400-$4,800. Opening at $4,200.",
      factors: {
        utilityScore: 0.55,
        utilityBreakdown: { price: 0.78, time: 0.30, risk: 0.45, relationship: 0.60 },
        tactic: "Market data cite",
        phase: "OPENING",
        batnaDelta: 0.18,
        concessionPct: 0,
        reasoning: "Detailed evidence-led anchor 28% below ask.",
      },
      thinkingMs: 1500,
    },
    {
      roundIndex: 2,
      sender: "SELLER",
      decision: "REJECT",
      offerPrice: 5800,
      message:
        "This is a documented full-set with original sales receipt, hangtags, and service papers from Omega Bienne. Chrono24 medians don't apply to full-sets. Holding at $5,800.",
      factors: {
        utilityScore: 0.78,
        utilityBreakdown: { price: 0.50, time: 0.65, risk: 0.92, relationship: 0.88 },
        tactic: "Provenance proof",
        phase: "OPENING",
        batnaDelta: 0.30,
        concessionPct: 0,
        reasoning: "Full-set provenance changes the comp set entirely.",
      },
      thinkingMs: 1700,
    },
    {
      roundIndex: 3,
      sender: "BUYER",
      decision: "COUNTER",
      offerPrice: 4600,
      message:
        "Full-set premium typically adds 10-12% on Speedies, not 35%. $4,600 reflects a fair full-set premium against the condition issues.",
      factors: {
        utilityScore: 0.61,
        utilityBreakdown: { price: 0.75, time: 0.35, risk: 0.60, relationship: 0.55 },
        tactic: "Premium recalibrate",
        phase: "MID",
        batnaDelta: 0.10,
        concessionPct: 0.09,
        reasoning: "Concede full-set premium but bound it with data.",
      },
      thinkingMs: 1300,
    },
    {
      roundIndex: 4,
      sender: "SELLER",
      decision: "REJECT",
      offerPrice: 5600,
      message:
        "I'd rather hold than sell at that. $5,600 is the floor — below that, I'll list it through Bonhams next month and absorb the fees.",
      factors: {
        utilityScore: 0.70,
        utilityBreakdown: { price: 0.42, time: 0.78, risk: 0.90, relationship: 0.70 },
        tactic: "Walk-away signal",
        phase: "CLOSING",
        batnaDelta: 0.25,
        concessionPct: 0.03,
        reasoning: "Walk-away credible — auction floor exists. Negotiation closes.",
      },
      thinkingMs: 1600,
    },
  ],
};

const SCENARIOS: PlaybackResponse[] = [ACCEPTED_QUICK, ACCEPTED_LONG, REJECTED];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Buyer-landing encodes selected agent into the session id as a suffix:
 * `${listingPublicId}-${agentPresetId}`. Detect that suffix so the playback
 * shows the agent the user actually picked instead of the scenario's default.
 */
function extractAgentPresetId(sessionId: string): string | null {
  for (const preset of BUYER_AGENT_PRESETS) {
    if (sessionId.endsWith(`-${preset.id}`)) return preset.id;
  }
  return null;
}

function buyerAgentCardFromPreset(presetId: string): AgentCard | null {
  const preset = BUYER_AGENT_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const iconKey = preset.id as AgentCard["iconKey"];
  return {
    presetId: preset.id,
    name: preset.name,
    tagline: preset.tagline,
    accentColor: preset.accentColor,
    iconKey,
    stats: preset.stats,
  };
}

export function getMockPlayback(sessionId: string): PlaybackResponse {
  const idx = hashString(sessionId) % SCENARIOS.length;
  const base = SCENARIOS[idx];

  // Override buyer agent with the user's actual selection (if encoded in id).
  const selectedPresetId = extractAgentPresetId(sessionId);
  const overrideBuyer = selectedPresetId ? buyerAgentCardFromPreset(selectedPresetId) : null;

  return {
    ...base,
    session: {
      ...base.session,
      id: sessionId,
      buyerAgent: overrideBuyer ?? base.session.buyerAgent,
    },
  };
}
