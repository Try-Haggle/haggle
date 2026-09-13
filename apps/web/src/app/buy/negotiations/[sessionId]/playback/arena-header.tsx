"use client";

import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useState } from "react";
import { AgentPresence } from "@/components/agents/agent-presence";
import type { NegotiationAgentState } from "@/lib/negotiation-agent-state";
import { formatPrice, formatSignedPct } from "./format";
import type { AgentCard, AgentRole } from "./types";

interface ArenaHeaderProps {
  buyerAgent: AgentCard;
  sellerAgent: AgentCard;
  /** What each avatar shows — see `negotiationAgentState`. */
  buyerState: NegotiationAgentState;
  sellerState: NegotiationAgentState;
  currentRound: number;
  currentPrice: number | null;
  previousPrice: number | null;
  askingPrice: number;
  currency: string;
  pulseKey?: number | string;
}

/**
 * Compact arena header — single horizontal row.
 *  [Seller mini] | round + price + delta | [Buyer mini]
 *
 * Designed to keep the chat below as the visual hero. Rich vs/glow framing is
 * reserved for PreFight; here we want supporting context only.
 */
export function ArenaHeader({
  buyerAgent,
  sellerAgent,
  buyerState,
  sellerState,
  currentRound,
  currentPrice,
  previousPrice,
  askingPrice,
  currency,
  pulseKey,
}: ArenaHeaderProps) {
  const display = currentPrice ?? askingPrice;
  const baseline = previousPrice ?? askingPrice;
  // Direction arrow follows the round-over-round price movement.
  const direction: "up" | "down" | "flat" =
    Math.abs(display - baseline) < 1 ? "flat" : display > baseline ? "up" : "down";
  const askingDiffPct = askingPrice > 0 ? (display - askingPrice) / askingPrice : 0;
  // Color is from the BUYER's perspective: lower-than-asking is favorable (green).
  const dirColor =
    Math.abs(askingDiffPct) < 0.0005
      ? "var(--text-secondary)"
      : askingDiffPct < 0
        ? "var(--fb-success-fg)"
        : "var(--fb-error-fg)";

  // Animated count-up for the displayed price.
  const motionValue = useMotionValue(display);
  const [shown, setShown] = useState(display);
  useEffect(() => {
    const controls = animate(motionValue, display, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [display, motionValue]);

  return (
    // Mobile: 2-col grid with center on top (spans both), agents on row 2.
    // sm+: 3-col grid with seller / center / buyer all on a single row.
    <div className="grid grid-cols-2 grid-rows-[auto_auto] items-center gap-x-3 gap-y-4 sm:grid-cols-[1fr_auto_1fr] sm:grid-rows-[auto] sm:gap-5">
      <div className="row-start-2 sm:row-start-1 sm:col-start-1">
        {/* biome-ignore lint/a11y/useValidAriaRole: "role" is a CompactAgent prop (BUYER/SELLER), not an ARIA role */}
        <CompactAgent agent={sellerAgent} role="SELLER" state={sellerState} side="left" />
      </div>

      {/* Center: round + price + delta */}
      <div className="col-span-2 row-start-1 flex flex-col items-center gap-2 px-2 sm:col-span-1 sm:col-start-2 sm:gap-2.5 sm:px-4">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-[0.18em]"
          style={{
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-default)",
            color: "var(--text-muted)",
          }}
        >
          <span>ROUND</span>
          <motion.span
            key={currentRound}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="tabular-nums"
            style={{ color: "var(--text-secondary)" }}
          >
            {Math.max(currentRound, 0)}
          </motion.span>
        </div>
        <motion.div
          key={pulseKey}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-[22px] sm:text-[28px] font-bold tabular-nums leading-none"
          style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
        >
          {formatPrice(shown, currency)}
        </motion.div>
        <div
          className="flex items-center gap-1.5 text-[10px] sm:text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span>asking</span>
          <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {formatPrice(askingPrice, currency)}
          </span>
          <span className="h-3 w-px" style={{ background: "var(--border-default)" }} />
          <span className="flex items-center gap-0.5 tabular-nums" style={{ color: dirColor }}>
            {direction !== "flat" && <DirectionArrow direction={direction} />}
            {direction === "flat" ? "—" : formatSignedPct(askingDiffPct, 1)}
          </span>
        </div>
      </div>

      <div className="row-start-2 col-start-2 flex justify-end sm:row-start-1 sm:col-start-3">
        {/* biome-ignore lint/a11y/useValidAriaRole: "role" is a CompactAgent prop (BUYER/SELLER), not an ARIA role */}
        <CompactAgent agent={buyerAgent} role="BUYER" state={buyerState} side="right" />
      </div>
    </div>
  );
}

function CompactAgent({
  agent,
  role,
  state,
  side,
}: {
  agent: AgentCard;
  role: AgentRole;
  state: NegotiationAgentState;
  side: "left" | "right";
}) {
  const isLeft = side === "left";
  return (
    <div
      className={`flex min-w-0 items-center gap-2 sm:gap-2.5 ${isLeft ? "" : "flex-row-reverse"}`}
    >
      {/* The state lives on the frame — ring, badge, motion — because the face
          itself never changes. Replaces the square glow chip, which could only
          say "active" and was the last agent face not drawn as a circle. */}
      <AgentPresence
        value={agent.emoji}
        accent={agent.accentColor}
        state={state}
        size={36}
        label={agent.name}
      />
      <div className={`min-w-0 flex flex-col ${isLeft ? "items-start" : "items-end"}`}>
        <div
          className="text-[9px] font-bold tracking-[0.16em]"
          style={{ color: "var(--text-muted)" }}
        >
          {role}
        </div>
        <div
          className="text-[12px] sm:text-[14px] font-semibold leading-tight truncate max-w-[100px] sm:max-w-[160px]"
          style={{ color: "var(--text-primary)" }}
        >
          {agent.name}
        </div>
      </div>
    </div>
  );
}

function DirectionArrow({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "up" ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}
