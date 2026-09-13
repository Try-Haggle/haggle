"use client";

import { getNegotiationAgentPreset } from "@haggle/shared";
import { AgentPresence } from "@/components/agents/agent-presence";
import { ListRow } from "@/components/ui/list-row";
import { formatTimeAgo } from "@/lib/format";
import {
  NEGOTIATION_AGENT_STATE_LABEL,
  type NegotiationSide,
  negotiationAgentState,
} from "@/lib/negotiation-agent-state";

/** A session as `GET /negotiations/sessions` lists it. */
export interface NegotiationListItem {
  id: string;
  listing_id: string;
  status: string;
  current_round: number;
  last_offer_price_minor: number | string | null;
  created_at: string;
  updated_at: string;
  /** Absent from responses before rows carried their listing. */
  listing?: { public_id: string; title: string | null } | null;
  /** The viewer's own agent — identity only. */
  agent?: { preset_id: string | null; emoji: string | null; accent_color: string | null } | null;
  last_sender_role?: NegotiationSide | null;
  paused_for_buyer?: boolean;
}

function formatMinorPrice(priceMinor: number | string | null): string {
  if (priceMinor === null) return "—";
  const minor = Number(priceMinor);
  if (!Number.isFinite(minor)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

/**
 * One negotiation in a dashboard, drawn as a roster entry: the viewer's agent
 * with its state on the frame, what it is negotiating over, and where things
 * stand. Buyer and seller dashboards share it so the same negotiation reads the
 * same way from either side — only whose agent is shown differs.
 */
export function NegotiationRosterRow({
  negotiation,
  side,
  href,
}: {
  negotiation: NegotiationListItem;
  side: NegotiationSide;
  href: string;
}) {
  const preset = getNegotiationAgentPreset(negotiation.agent?.preset_id ?? "");
  const state = negotiationAgentState({
    side,
    status: negotiation.status,
    lastSender: negotiation.last_sender_role ?? null,
    pausedForBuyer: negotiation.paused_for_buyer ?? false,
    surface: "list",
  });
  const agentName = preset?.copy[side === "BUYER" ? "buyer" : "seller"].name ?? "Your agent";
  const title = negotiation.listing?.title?.trim();

  return (
    <ListRow
      href={href}
      showChevron
      leading={
        <AgentPresence
          value={negotiation.agent?.emoji ?? preset?.emoji}
          accent={negotiation.agent?.accent_color ?? preset?.accentColor ?? "#d69a4c"}
          state={state}
          size={40}
          label={agentName}
          fallback="🤝"
        />
      }
      title={title ? title : <span className="font-mono">{negotiation.id.slice(0, 8)}...</span>}
      meta={`${NEGOTIATION_AGENT_STATE_LABEL[state]} · Round ${negotiation.current_round} · Last offer: ${formatMinorPrice(negotiation.last_offer_price_minor)}`}
      trailing={
        <span className="text-ink-muted text-xs">{formatTimeAgo(negotiation.updated_at)}</span>
      }
    />
  );
}
