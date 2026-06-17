"use client";

import { motion } from "framer-motion";
import { AgentIcon } from "./agent-icon";
import { formatPct, formatSignedPct } from "./format";
import type { AgentCard, PlaybackRound, UtilityBreakdown } from "./types";

interface FactorsPanelProps {
  round: PlaybackRound | null;
  agent: AgentCard | null;
}

/**
 * Utility axes mirror engine-core's `computeUtility` output:
 *   v_p (Price), v_t (Time), v_r (Risk), v_s (Relationship)
 */
const UTILITY_AXES: { key: keyof UtilityBreakdown; label: string; color: string }[] = [
  { key: "price", label: "Price", color: "var(--fb-success-fg)" },
  { key: "time", label: "Time", color: "var(--fb-warning-fg)" },
  { key: "risk", label: "Risk", color: "var(--action-primary)" },
  { key: "relationship", label: "Relationship", color: "var(--fb-info-fg)" },
];

export function FactorsPanel({ round, agent }: FactorsPanelProps) {
  if (!round || !agent) {
    return <EmptyState />;
  }

  const breakdown = round.factors.utilityBreakdown;
  const score = round.factors.utilityScore ?? 0;
  const tactic = round.factors.tactic;

  return (
    <motion.div
      key={round.roundIndex}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col gap-5 rounded-2xl p-5"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--border-default)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${agent.accentColor}1f`, color: agent.accentColor }}
        >
          <AgentIcon agent={agent} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-[10px] font-bold tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            ROUND {round.roundIndex} · {round.sender}
          </div>
          <div
            className="text-[13px] font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {agent.name}
          </div>
        </div>
      </div>

      {/* Utility ring (u_total) */}
      <UtilityRing score={score} accent={agent.accentColor} />

      {/* Utility breakdown — v_p / v_t / v_r / v_s */}
      {breakdown && (
        <div className="flex flex-col gap-2.5">
          <div
            className="text-[10px] font-bold tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            UTILITY BREAKDOWN
          </div>
          <div className="flex flex-col gap-2">
            {UTILITY_AXES.map((axis, i) => {
              const value = breakdown[axis.key];
              return (
                <div key={axis.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {axis.label}
                    </span>
                    <span
                      className="text-[11px] font-semibold tabular-nums"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {formatPct(value)}
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--bg-sunken)" }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: axis.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${value * 100}%` }}
                      transition={{
                        duration: 0.7,
                        delay: 0.05 + i * 0.06,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deltas */}
      {(typeof round.factors.batnaDelta === "number" ||
        typeof round.factors.concessionPct === "number") && (
        <div className="grid grid-cols-2 gap-2">
          {typeof round.factors.batnaDelta === "number" && (
            <DeltaTile
              label="BATNA"
              value={formatSignedPct(round.factors.batnaDelta, 1)}
              tone={round.factors.batnaDelta >= 0 ? "var(--fb-success-fg)" : "var(--fb-error-fg)"}
            />
          )}
          {typeof round.factors.concessionPct === "number" && (
            <DeltaTile
              label="Concede"
              value={
                round.factors.concessionPct > 0
                  ? formatSignedPct(-round.factors.concessionPct, 1)
                  : "—"
              }
              tone="var(--text-secondary)"
            />
          )}
        </div>
      )}

      {/* Tactic — DB tacticUsed (single free-form string) */}
      {tactic && (
        <div className="flex flex-col gap-2">
          <div
            className="text-[10px] font-bold tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            TACTIC
          </div>
          <span
            className="self-start rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              background: `${agent.accentColor}14`,
              border: `1px solid ${agent.accentColor}33`,
              color: agent.accentColor,
            }}
          >
            {tactic}
          </span>
        </div>
      )}
    </motion.div>
  );
}

function UtilityRing({ score, accent }: { score: number; accent: string }) {
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score);
  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            style={{ stroke: "var(--border-default)" }}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-[20px] font-bold tabular-nums"
            style={{ color: "var(--text-primary)" }}
          >
            {Math.round(score * 100)}
          </span>
          <span
            className="text-[9px] font-bold tracking-[0.12em]"
            style={{ color: "var(--text-muted)" }}
          >
            / 100
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <span
          className="text-[10px] font-bold tracking-[0.16em]"
          style={{ color: "var(--text-muted)" }}
        >
          UTILITY
        </span>
        <span className="text-[11px] mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
          Weighted score across all axes.
        </span>
      </div>
    </div>
  );
}

function DeltaTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: "var(--bg-sunken)", border: "1px solid var(--border-default)" }}
    >
      <div
        className="text-[10px] font-bold tracking-[0.14em]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div className="text-[14px] font-semibold tabular-nums mt-0.5" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center"
      style={{ background: "var(--bg-raised)", border: "1px dashed var(--border-default)" }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "var(--text-muted)" }}
        aria-hidden="true"
      >
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-5" />
      </svg>
      <div className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
        Tap any message to inspect the agent&apos;s utility, tactic, and reasoning.
      </div>
    </div>
  );
}
