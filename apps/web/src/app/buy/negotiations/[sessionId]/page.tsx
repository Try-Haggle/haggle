import { getNegotiationAgentPreset } from "@haggle/shared";
import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import { GuestClaimBanner } from "./_guest-claim-banner";
import { type CheckoutApprovalSummary, getCheckoutCta } from "./checkout-contract";
import { PlaybackArena } from "./playback/playback-arena";
import type {
  AgentCard,
  DecisionAction,
  FinalStatus,
  PlaybackResponse,
  PlaybackRound,
} from "./playback/types";

/**
 * Buyer-side negotiation playback page.
 *
 * Renders the live transcript stored under negotiation_rounds for this session.
 * The arena UI is unchanged from the mock era — only the data source moved
 * from a hardcoded scenario to the real /negotiations/sessions/:id payload.
 *
 * Natural-language fields (message/phase/tactic) are populated by the LLM
 * engine. Under the rule-based engine they're empty; the page falls back to
 * synthetic labels so the timeline still reads.
 */

type ServerSession = {
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

type ServerRound = {
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
};

type SessionResponse = { session: ServerSession; rounds: ServerRound[] };

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
  if (status === "REJECTED" || status === "EXPIRED" || status === "SUPERSEDED") return "REJECTED";
  if (status === "NEAR_DEAL") return "NEAR_DEAL";
  return "ESCALATED";
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

function transform(payload: SessionResponse): PlaybackResponse {
  const { session, rounds } = payload;
  const askingMajor = targetPriceToMajor(session.listing?.target_price ?? null);

  const buyerAgent = agentCardFor(session.buyer_negotiation_agent_preset_id, "buyer");
  const sellerAgent = agentCardFor(session.listing?.seller_agent_preset ?? null, "seller");

  const isTerminal = ["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED", "NEAR_DEAL"].includes(
    session.status,
  );
  const finalPrice = isTerminal ? minorToMajor(session.last_offer_price_minor) : null;

  // Detect whether to prepend a synthetic buyer-opening bubble.
  // Round 1 in the DB is always the SELLER processing the BUYER's first offer —
  // the buyer's initial price is stored in price_minor but never shown as its
  // own message. We surface it as a synthetic R1 so the conversation starts
  // with the buyer's move, and shift all DB rounds by +1.
  const firstRound = rounds[0];
  const hasSyntheticBuyerOpen =
    !!firstRound && firstRound.sender_role === "BUYER" && !!firstRound.message?.trim();
  const roundIndexOffset = hasSyntheticBuyerOpen ? 1 : 0;

  const playbackRounds: PlaybackRound[] = rounds.map((r) => {
    // ── Sender semantics fix ──────────────────────────────────────
    // The executor persists each round as: sender_role = side that sent the
    // incoming offer, price_minor = their offer; BUT counter_price_minor and
    // message are generated by the RESPONDER (the agent that processed the
    // offer via the pipeline's respond stage). For chat display we want each
    // bubble to attribute the message to the agent who actually produced it,
    // so when a generated message exists we flip the sender to be the
    // responder. (HNP-direct rows like authoritative ACCEPT have no generated
    // message; in those cases sender_role IS the speaker, so don't flip.)
    const hasGeneratedMessage = !!r.message?.trim();
    const displaySender: "BUYER" | "SELLER" = hasGeneratedMessage
      ? r.sender_role === "BUYER"
        ? "SELLER"
        : "BUYER"
      : r.sender_role;
    const offerMajor = minorToMajor(r.counter_price_minor ?? r.price_minor);
    const concession =
      r.concession_rate !== null && r.concession_rate !== undefined
        ? Number(r.concession_rate)
        : undefined;
    // Round 1 decision label: if synthetic buyer opening was prepended, the
    // seller's first response is a counter (not an opening).
    const rawDecision = mapDecision(r.decision, r.message_type, r.round_no);
    const decision: PlaybackRound["decision"] =
      hasSyntheticBuyerOpen && r.round_no === 1 && rawDecision === "OPENING"
        ? "COUNTER"
        : rawDecision;
    return {
      roundIndex: r.round_no + roundIndexOffset,
      sender: displaySender,
      decision,
      offerPrice: offerMajor,
      message: r.message?.trim() ? r.message : fallbackMessage(r, offerMajor),
      factors: {
        utilityScore: r.utility?.u_total,
        utilityBreakdown: r.utility
          ? {
              price: r.utility.v_p,
              time: r.utility.v_t,
              risk: r.utility.v_r,
              relationship: r.utility.v_s,
            }
          : undefined,
        tactic: r.tactic_used ?? undefined,
        phase: r.phase_at_round ?? undefined,
        concessionPct: Number.isFinite(concession) ? concession : undefined,
        reasoning: r.message?.trim() ? r.message : undefined,
      },
    };
  });

  // Prepend synthetic buyer opening bubble
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
      finalPrice,
      roundsTotal: playbackRounds.length,
    },
    rounds: playbackRounds,
  };
}

export default async function BuyerNegotiationPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const payload = await serverApi.get<SessionResponse>(`/negotiations/sessions/${sessionId}`);
  const data = transform(payload);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isGuest = !user;
  let approval: CheckoutApprovalSummary | undefined;

  if (payload.session.status === "ACCEPTED" && user) {
    try {
      const response = await serverApi.get<{ approval: CheckoutApprovalSummary }>(
        `/settlement-approvals/${sessionId}`,
      );
      approval = response.approval;
    } catch {
      // A missing or inaccessible approval keeps checkout fail-closed.
    }
  }
  const checkoutCta = getCheckoutCta({
    sessionId,
    sessionStatus: payload.session.status,
    userId: user?.id ?? null,
    approval,
  });

  return (
    <>
      {isGuest && (
        <GuestClaimBanner
          sessionId={sessionId}
          status={data.session.finalStatus}
          finalPriceMinor={
            data.session.finalPrice === null ? null : Math.round(data.session.finalPrice * 100)
          }
        />
      )}
      <PlaybackArena
        data={data}
        checkoutHref={checkoutCta?.href}
        checkoutLabel={checkoutCta?.label}
      />
    </>
  );
}
