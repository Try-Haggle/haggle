export type ServerSession = {
  id: string;
  status: string;
  current_round: number;
  last_offer_price_minor: string | number | null;
  buyer_negotiation_agent_preset_id: string | null;
  listing: {
    public_id: string;
    title: string;
    photo_url: string | null;
    target_price: string | null;
    category: string | null;
    seller_agent_preset: string | null;
  } | null;
};

export type ServerRound = {
  id: string;
  round_no: number;
  sender_role: "BUYER" | "SELLER";
  message_type: "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE";
  price_minor: string | number;
  counter_price_minor: string | number | null;
  utility: {
    u_total: number;
    v_p: number;
    v_t: number;
    v_r: number;
    v_s: number;
  } | null;
  decision: "ACCEPT" | "COUNTER" | "REJECT" | "NEAR_DEAL" | "ESCALATE" | null;
  message: string | null;
  phase_at_round: string | null;
  tactic_used: string | null;
  concession_rate: string | number | null;
  created_at: string;
  pause_answers?: Array<{
    checkId: string;
    ask: string;
    stance: string;
    label?: string;
  }> | null;
};

export type SessionResponse = { session: ServerSession; rounds: ServerRound[] };

const TERMINAL_STATUSES = new Set([
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "NEAR_DEAL",
  "STALLED",
]);

export function isTerminalNegotiationStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function getRoundSpeaker(round: ServerRound): "BUYER" | "SELLER" {
  if (!round.message?.trim()) return round.sender_role;
  return round.sender_role === "BUYER" ? "SELLER" : "BUYER";
}

function agentCardFor(presetId: string | null | undefined, role: "buyer" | "seller"): AgentCard {
  const preset = presetId ? getNegotiationAgentPreset(presetId) : null;
  if (preset) {
    return {
      presetId: preset.id,
      name: preset.copy[role].name,
      tagline: preset.copy[role].tagline,
      accentColor: preset.accentColor,
      emoji: preset.emoji,
    };
  }
  return {
    presetId: presetId ?? "unknown",
    name: role === "buyer" ? "Buyer Agent" : "Seller Agent",
    tagline: "",
    accentColor: role === "buyer" ? "#3b82f6" : "#06b6d4",
    emoji: role === "buyer" ? "🤝" : "🏷️",
  };
}

function minorToMajor(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n / 100 : 0;
}

function targetPriceToMajor(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapDecision(
  decision: ServerRound["decision"],
  messageType: ServerRound["message_type"],
  roundNo: number,
): DecisionAction {
  if (decision === "ACCEPT") return "ACCEPT";
  if (decision === "REJECT") return "REJECT";
  if (decision === "NEAR_DEAL") return "NEAR_DEAL";
  if (messageType === "OFFER" && roundNo === 1) return "OPENING";
  return "COUNTER";
}

function mapFinalStatus(status: string): FinalStatus {
  if (status === "ACCEPTED") return "ACCEPTED";
  if (status === "REJECTED" || status === "EXPIRED" || status === "SUPERSEDED") {
    return "REJECTED";
  }
  if (status === "NEAR_DEAL") return "NEAR_DEAL";
  if (status === "STALLED" || status === "ESCALATED") return "ESCALATED";
  return "IN_PROGRESS";
}

function fallbackMessage(round: ServerRound, priceMajor: number, currency = "USD"): string {
  const role = round.sender_role === "BUYER" ? "Buyer" : "Seller";
  const formatted = priceMajor.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: priceMajor < 100 ? 2 : 0,
  });
  if (round.decision === "ACCEPT") return `${role} accepted at ${formatted}.`;
  if (round.decision === "REJECT") return `${role} walked away.`;
  if (round.decision === "NEAR_DEAL") return `${role} signals near-deal at ${formatted}.`;
  if (round.round_no === 1) return `${role} opened at ${formatted}.`;
  return `${role} countered at ${formatted}.`;
}

export function transformNegotiationPlayback(payload: SessionResponse): PlaybackResponse {
  const { session, rounds } = payload;
  const askingMajor = targetPriceToMajor(session.listing?.target_price ?? null);
  const buyerAgent = agentCardFor(session.buyer_negotiation_agent_preset_id, "buyer");
  const sellerAgent = agentCardFor(session.listing?.seller_agent_preset ?? null, "seller");
  const terminal = isTerminalNegotiationStatus(session.status);
  const firstRound = rounds[0];
  const hasSyntheticBuyerOpen =
    !!firstRound && firstRound.sender_role === "BUYER" && !!firstRound.message?.trim();
  const roundIndexOffset = hasSyntheticBuyerOpen ? 1 : 0;

  const playbackRounds: PlaybackRound[] = rounds.map((round) => {
    const displaySender = getRoundSpeaker(round);
    const offerMajor = minorToMajor(round.counter_price_minor ?? round.price_minor);
    const concession =
      round.concession_rate !== null && round.concession_rate !== undefined
        ? Number(round.concession_rate)
        : undefined;
    const rawDecision = mapDecision(round.decision, round.message_type, round.round_no);
    const decision =
      hasSyntheticBuyerOpen && round.round_no === 1 && rawDecision === "OPENING"
        ? "COUNTER"
        : rawDecision;
    return {
      roundIndex: round.round_no + roundIndexOffset,
      sender: displaySender,
      decision,
      offerPrice: offerMajor,
      message: round.message?.trim() || fallbackMessage(round, offerMajor),
      ...(round.pause_answers?.length ? { pauseAnswers: round.pause_answers } : {}),
      factors: {
        utilityScore: round.utility?.u_total,
        utilityBreakdown: round.utility
          ? {
              price: round.utility.v_p,
              time: round.utility.v_t,
              risk: round.utility.v_r,
              relationship: round.utility.v_s,
            }
          : undefined,
        tactic: round.tactic_used ?? undefined,
        phase: round.phase_at_round ?? undefined,
        concessionPct: Number.isFinite(concession) ? concession : undefined,
        reasoning: round.message?.trim() || undefined,
      },
    };
  });

  if (hasSyntheticBuyerOpen) {
    const buyerInitialMajor = minorToMajor(firstRound.price_minor);
    const formattedPrice = buyerInitialMajor.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    playbackRounds.unshift({
      roundIndex: 1,
      sender: "BUYER",
      decision: "OPENING",
      offerPrice: buyerInitialMajor,
      message: `Hi, I'm interested in this listing. I'd like to offer ${formattedPrice}.`,
      factors: {},
    });
  }

  return {
    session: {
      id: session.id,
      listing: {
        id: session.listing?.public_id ?? "",
        title: session.listing?.title ?? "Listing",
        imageUrl: session.listing?.photo_url ?? null,
        askingPrice: askingMajor,
        currency: "USD",
        category: session.listing?.category ?? null,
      },
      buyerAgent,
      sellerAgent,
      finalStatus: mapFinalStatus(session.status),
      finalPrice: terminal ? minorToMajor(session.last_offer_price_minor) : null,
      roundsTotal: playbackRounds.length,
    },
    rounds: playbackRounds,
  };
}

import { getNegotiationAgentPreset } from "@haggle/shared";
import type {
  AgentCard,
  DecisionAction,
  FinalStatus,
  PlaybackResponse,
  PlaybackRound,
} from "./playback/types";
