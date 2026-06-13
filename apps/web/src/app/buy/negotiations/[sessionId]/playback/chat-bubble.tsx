"use client";

import { motion } from "framer-motion";
import { AgentIcon } from "./agent-icon";
import { formatPct, formatPrice, formatSignedPct } from "./format";
import type { AgentCard, PlaybackRound } from "./types";

interface ChatBubbleProps {
  round: PlaybackRound;
  agent: AgentCard;
  state: "typing" | "settled";
  typedText: string; // partial text during typing
  currency: string;
  onSelect?: () => void;
  isFocused?: boolean;
}

const DECISION_STYLES: Record<
  PlaybackRound["decision"],
  { ring: string; tint: string; label: string; chipBg: string }
> = {
  OPENING: {
    ring: "var(--text-secondary)",
    tint: "var(--bg-sunken)",
    label: "Opening",
    chipBg: "var(--border-default)",
  },
  COUNTER: {
    ring: "var(--text-secondary)",
    tint: "var(--bg-sunken)",
    label: "Counter",
    chipBg: "var(--border-default)",
  },
  NEAR_DEAL: {
    ring: "var(--fb-warning-fg)",
    tint: "var(--fb-warning-bg)",
    label: "Near Deal",
    chipBg: "var(--fb-warning-bg)",
  },
  ACCEPT: {
    ring: "var(--fb-success-fg)",
    tint: "var(--fb-success-bg)",
    label: "Accept",
    chipBg: "var(--fb-success-bg)",
  },
  REJECT: {
    ring: "var(--fb-error-fg)",
    tint: "var(--fb-error-bg)",
    label: "Reject",
    chipBg: "var(--fb-error-bg)",
  },
};

export function ChatBubble({
  round,
  agent,
  state,
  typedText,
  currency,
  onSelect,
  isFocused,
}: ChatBubbleProps) {
  const isBuyer = round.sender === "BUYER";
  const decisionStyle = DECISION_STYLES[round.decision];
  const showCaret = state === "typing" && typedText.length < round.message.length;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`flex gap-2 sm:gap-3 ${isBuyer ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div className="flex flex-col items-center gap-1.5 pt-1">
        <div
          className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: `${agent.accentColor}1f`,
            color: agent.accentColor,
            boxShadow: `0 0 0 1px ${agent.accentColor}33`,
          }}
        >
          <AgentIcon agent={agent} size={16} />
        </div>
        <div
          className="text-[9px] font-bold tracking-[0.12em] hidden sm:block"
          style={{ color: "var(--text-muted)" }}
        >
          R{round.roundIndex}
        </div>
      </div>

      {/* Bubble */}
      <button
        type="button"
        onClick={onSelect}
        className={`group flex min-w-0 max-w-[88%] sm:max-w-[78%] flex-col gap-2 rounded-2xl px-3.5 py-3 sm:px-4 sm:py-3.5 text-left transition-colors ${isBuyer ? "items-end" : "items-start"}`}
        style={{
          background: decisionStyle.tint,
          border: `1px solid ${isFocused ? decisionStyle.ring : "var(--border-default)"}`,
          boxShadow: isFocused
            ? `0 0 0 1px ${decisionStyle.ring}66, 0 8px 32px -12px ${decisionStyle.ring}44`
            : "none",
          cursor: onSelect ? "pointer" : "default",
        }}
      >
        {/* Top row: agent name + role label + decision chip + price */}
        <div className={`flex w-full items-center gap-2 ${isBuyer ? "flex-row-reverse" : ""}`}>
          <span
            className="text-[12px] sm:text-[13px] font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {agent.name}
          </span>
          <span
            className="text-[9px] sm:text-[10px] font-medium uppercase tracking-wider shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            {isBuyer ? "Buyer" : "Seller"}
          </span>
          <span
            className="rounded-md px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-[0.08em] uppercase"
            style={{ background: decisionStyle.chipBg, color: decisionStyle.ring }}
          >
            {decisionStyle.label}
          </span>
          <span
            className="ml-auto text-[12px] sm:text-[13px] font-bold tabular-nums"
            style={{ color: "var(--text-primary)" }}
          >
            {formatPrice(round.offerPrice, currency)}
          </span>
        </div>

        {/* Message text */}
        <div
          className="text-[13px] sm:text-[14px] leading-[1.55]"
          style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {state === "typing" ? typedText : round.message}
          {showCaret && (
            <motion.span
              className="ml-0.5 inline-block w-[2px] align-middle"
              style={{ background: agent.accentColor, height: "1em" }}
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          )}
        </div>

        {/* Factors row */}
        {state === "settled" && <FactorsRow round={round} accent={agent.accentColor} />}
      </button>
    </motion.div>
  );
}

function FactorsRow({ round, accent }: { round: PlaybackRound; accent: string }) {
  const f = round.factors;
  const chips: { label: string; value: string; tone?: string }[] = [];

  if (typeof f.utilityScore === "number") {
    chips.push({ label: "Utility", value: formatPct(f.utilityScore), tone: accent });
  }
  if (typeof f.concessionPct === "number" && f.concessionPct > 0) {
    chips.push({
      label: "Concede",
      value: formatSignedPct(-f.concessionPct, 1),
      tone: "var(--text-secondary)",
    });
  }
  if (typeof f.batnaDelta === "number") {
    chips.push({
      label: "BATNA",
      value: formatSignedPct(f.batnaDelta, 1),
      tone: f.batnaDelta >= 0 ? "var(--fb-success-fg)" : "var(--fb-error-fg)",
    });
  }

  if (chips.length === 0 && !f.tactic) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
      className="flex flex-wrap items-center gap-1.5 pt-1"
    >
      {chips.map((c, i) => (
        <motion.span
          key={c.label}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, delay: 0.05 + i * 0.05, ease: "easeOut" }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium"
          style={{
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-default)",
            color: c.tone ?? "var(--text-secondary)",
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>{c.label}</span>
          <span className="tabular-nums">{c.value}</span>
        </motion.span>
      ))}
      {f.tactic && (
        <motion.span
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, delay: 0.05 + chips.length * 0.05, ease: "easeOut" }}
          className="rounded-md px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium"
          style={{ background: `${accent}14`, border: `1px solid ${accent}33`, color: accent }}
        >
          {f.tactic}
        </motion.span>
      )}
    </motion.div>
  );
}
