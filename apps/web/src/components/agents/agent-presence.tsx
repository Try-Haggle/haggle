"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import {
  NEGOTIATION_AGENT_STATE_LABEL,
  type NegotiationAgentState,
} from "@/lib/negotiation-agent-state";
import { AgentAvatar } from "./agent-avatar";

type BadgeGlyph = "arrow" | "question" | "check" | "cross" | "pause";

/**
 * How each state is signalled, given that the face itself never changes.
 *
 * `ring` is the halo, `badge` the corner mark, `fade`/`grey` what happens to
 * the head. The face staying identical in every state is the point: a roster
 * is scanned by who, then by what, and an agent that changed expression would
 * be harder to find, not easier.
 */
const STATE_STYLE: Record<
  NegotiationAgentState,
  {
    ring: "none" | "spin" | "pulse" | "solid";
    badge: null | { glyph: BadgeGlyph; tone: string };
    fade: number;
    grey: boolean;
  }
> = {
  idle: { ring: "none", badge: null, fade: 1, grey: false },
  // Sweeps while a move is being worked out — says "working" without having
  // to invent a percentage.
  thinking: { ring: "spin", badge: null, fade: 1, grey: false },
  offer: { ring: "solid", badge: { glyph: "arrow", tone: "#2e6fd6" }, fade: 1, grey: false },
  waiting: { ring: "none", badge: { glyph: "pause", tone: "#9a9079" }, fade: 0.72, grey: false },
  // The only state that needs a person, and so the only one that pulses.
  question: {
    ring: "pulse",
    badge: { glyph: "question", tone: "#d69a4c" },
    fade: 1,
    grey: false,
  },
  deal: { ring: "solid", badge: { glyph: "check", tone: "#3e8e5a" }, fade: 1, grey: false },
  walked: { ring: "none", badge: { glyph: "cross", tone: "#c8412e" }, fade: 0.55, grey: true },
};

interface AgentPresenceProps {
  /** Stored avatar — an animal slug or a glyph. */
  value: string | null | undefined;
  /** Agent accent, `#rrggbb`. Tints the chip and colours the ring. */
  accent: string;
  state: NegotiationAgentState;
  /** Chip diameter in px. The ring and badge sit outside it. */
  size?: number;
  /** Who this is, for assistive tech; the state is appended. */
  label?: string;
  fallback?: string;
  className?: string;
}

/**
 * An agent's avatar with its negotiation state drawn around it.
 *
 * Reduced motion is honoured through MotionConfig rather than by branching on
 * a media query, so server and client render the same markup.
 */
export function AgentPresence({
  value,
  accent,
  state,
  size = 40,
  label,
  fallback,
  className,
}: AgentPresenceProps) {
  const st = STATE_STYLE[state];
  const pad = Math.round(size * 0.14);
  const box = size + pad * 2;
  const r = size / 2 + pad * 0.55;
  const badgeSize = Math.max(14, Math.round(size * 0.36));
  const stateLabel = NEGOTIATION_AGENT_STATE_LABEL[state];

  return (
    <MotionConfig reducedMotion="user">
      <span
        role="img"
        aria-label={label ? `${label} — ${stateLabel}` : stateLabel}
        data-state={state}
        className={cn("relative inline-block shrink-0", className)}
        style={{ width: box, height: box }}
      >
        <svg
          viewBox={`0 0 ${box} ${box}`}
          width={box}
          height={box}
          className="absolute inset-0 overflow-visible"
          aria-hidden="true"
        >
          {st.ring === "solid" && (
            <circle
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              stroke={accent}
              strokeWidth={2}
              opacity={0.5}
            />
          )}
          {st.ring === "pulse" && (
            <motion.circle
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              stroke={accent}
              strokeWidth={2.4}
              initial={{ opacity: 0.55, scale: 0.94 }}
              animate={{ opacity: [0.55, 0, 0.55], scale: [0.94, 1.1, 0.94] }}
              transition={{ duration: 1.9, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
              style={{ transformOrigin: "center" }}
            />
          )}
          {st.ring === "spin" && (
            <motion.circle
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              stroke={accent}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * r * 0.24} ${2 * Math.PI * r}`}
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
              style={{ transformOrigin: "center" }}
            />
          )}
        </svg>

        {/* The chip every other agent surface uses: a tinted circle. */}
        <motion.span
          className="absolute flex items-center justify-center rounded-full"
          style={{
            left: pad,
            top: pad,
            width: size,
            height: size,
            fontSize: Math.round(size * 0.46),
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
            opacity: st.fade,
            filter: st.grey ? "grayscale(0.85)" : undefined,
          }}
          // Only `offer` moves the head, because only an offer is an event.
          animate={state === "offer" ? { y: [0, -3, 0] } : { y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <AgentAvatar value={value} fallback={fallback} />
        </motion.span>

        <AnimatePresence>
          {st.badge && (
            <motion.span
              key={state}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              className="absolute grid place-items-center rounded-full"
              style={{
                right: 0,
                bottom: 0,
                width: badgeSize,
                height: badgeSize,
                background: st.badge.tone,
                boxShadow: "0 1px 3px rgba(11,17,33,.25), 0 0 0 2px var(--bg-raised, #fffdf9)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width={Math.round(badgeSize * 0.66)}
                height={Math.round(badgeSize * 0.66)}
                aria-hidden="true"
              >
                <Glyph kind={st.badge.glyph} />
              </svg>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </MotionConfig>
  );
}

function Glyph({ kind }: { kind: BadgeGlyph }) {
  const stroke = {
    fill: "none",
    stroke: "#fff",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "arrow":
      return <path d="M5 12 L19 12 M13 6 L19 12 L13 18" {...stroke} />;
    case "question":
      return (
        <>
          <path d="M9 9a3 3 0 1 1 3.6 2.9c-.8.2-1.1.7-1.1 1.5v.6" {...stroke} />
          <circle cx={12} cy={18} r={1.4} fill="#fff" />
        </>
      );
    case "check":
      return <path d="M6 12.5 L10.5 17 L18 8" {...stroke} />;
    case "cross":
      return <path d="M7.5 7.5 L16.5 16.5 M16.5 7.5 L7.5 16.5" {...stroke} />;
    default:
      return <path d="M9.5 7 L9.5 17 M14.5 7 L14.5 17" {...stroke} />;
  }
}
