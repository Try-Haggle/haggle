"use client";

import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useState } from "react";
import type { AgentCard, AgentRole } from "./types";
import { AgentIcon } from "./agent-icon";
import { formatPrice, formatSignedPct } from "./format";

interface ArenaHeaderProps {
  buyerAgent: AgentCard;
  sellerAgent: AgentCard;
  activeRole: AgentRole | null;
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
  activeRole,
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
  const askingDiffPct =
    askingPrice > 0 ? (display - askingPrice) / askingPrice : 0;
  // Color is from the BUYER's perspective: lower-than-asking is favorable (green).
  const dirColor =
    Math.abs(askingDiffPct) < 0.0005
      ? "#94a3b8"
      : askingDiffPct < 0
        ? "#10b981"
        : "#ef4444";

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
        <CompactAgent
          agent={sellerAgent}
          role="SELLER"
          active={activeRole === "SELLER"}
          side="left"
        />
      </div>

      {/* Center: round + price + delta */}
      <div className="col-span-2 row-start-1 flex flex-col items-center gap-2 px-2 sm:col-span-1 sm:col-start-2 sm:gap-2.5 sm:px-4">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-[0.18em]"
          style={{
            background: "rgba(15,23,42,0.6)",
            border: "1px solid #1e293b",
            color: "#64748b",
          }}
        >
          <span>ROUND</span>
          <motion.span
            key={currentRound}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="tabular-nums"
            style={{ color: "#cbd5e1" }}
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
          style={{ color: "#f8fafc", letterSpacing: "-0.02em" }}
        >
          {formatPrice(shown, currency)}
        </motion.div>
        <div
          className="flex items-center gap-1.5 text-[10px] sm:text-[11px]"
          style={{ color: "#64748b" }}
        >
          <span>asking</span>
          <span className="tabular-nums" style={{ color: "#94a3b8" }}>
            {formatPrice(askingPrice, currency)}
          </span>
          <span className="h-3 w-px" style={{ background: "#1e293b" }} />
          <span
            className="flex items-center gap-0.5 tabular-nums"
            style={{ color: dirColor }}
          >
            {direction !== "flat" && (
              <DirectionArrow direction={direction} />
            )}
            {direction === "flat" ? "—" : formatSignedPct(askingDiffPct, 1)}
          </span>
        </div>
      </div>

      <div className="row-start-2 col-start-2 flex justify-end sm:row-start-1 sm:col-start-3">
        <CompactAgent
          agent={buyerAgent}
          role="BUYER"
          active={activeRole === "BUYER"}
          side="right"
        />
      </div>
    </div>
  );
}

function CompactAgent({
  agent,
  role,
  active,
  side,
}: {
  agent: AgentCard;
  role: AgentRole;
  active: boolean;
  side: "left" | "right";
}) {
  const isLeft = side === "left";
  return (
    <div
      className={`flex min-w-0 items-center gap-2 sm:gap-2.5 ${
        isLeft ? "" : "flex-row-reverse"
      }`}
    >
      <motion.div
        className="relative flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${agent.accentColor}1f`, color: agent.accentColor }}
        animate={{
          boxShadow: active
            ? `0 0 0 1px ${agent.accentColor}, 0 0 18px ${agent.accentColor}55`
            : `0 0 0 1px ${agent.accentColor}33`,
        }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <AgentIcon agent={agent} size={14} />
        {active && (
          <motion.span
            aria-hidden
            className="absolute -inset-0.5 rounded-xl"
            style={{ border: `1px solid ${agent.accentColor}` }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: [0.7, 0, 0.7], scale: [0.95, 1.1, 0.95] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </motion.div>
      <div
        className={`min-w-0 flex flex-col ${
          isLeft ? "items-start" : "items-end"
        }`}
      >
        <div
          className="text-[9px] font-bold tracking-[0.16em]"
          style={{ color: "#64748b" }}
        >
          {role}
        </div>
        <div
          className="text-[12px] sm:text-[14px] font-semibold leading-tight truncate max-w-[100px] sm:max-w-[160px]"
          style={{ color: "#f1f5f9" }}
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
    >
      {direction === "up" ? (
        <path d="m18 15-6-6-6 6" />
      ) : (
        <path d="m6 9 6 6 6-6" />
      )}
    </svg>
  );
}
