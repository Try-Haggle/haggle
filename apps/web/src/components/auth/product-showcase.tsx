"use client";

import { NEGOTIATION_AGENT_PRESETS } from "@haggle/shared";
import confetti from "canvas-confetti";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { MotionRadar } from "@/components/listing-detail/motion-radar";
import { cn } from "@/lib/cn";

/**
 * The left half of the sign-up page: what Haggle does, shown with the same
 * pieces the app itself uses — the four real agent presets, each one's real
 * strategy shape (the morphing radar from listing detail), and a negotiation
 * thread drawn like the live one. Examples rather than product facts are
 * tagged "Sample".
 *
 * The highlighted agent steps through the presets on its own so the radar
 * keeps reshaping — the point being that each agent negotiates differently.
 * Nothing here is interactive: a clickable agent next to a sign-up form reads
 * as "you must pick one to sign up". Reduced-motion users get no cycle.
 */
const CYCLE_MS = 2800;

export function ProductShowcase() {
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % NEGOTIATION_AGENT_PRESETS.length),
      CYCLE_MS,
    );
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  // Visuals first, one line of copy under them: the cards carry the story,
  // the line names it.
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <AgentsCard active={active} />
        <div className="grid grid-cols-5 gap-4">
          <NegotiationCard className="col-span-3" />
          <StrategyCard active={active} className="col-span-2" />
        </div>
      </div>
      <h2 className="text-center font-bold text-2xl text-ink tracking-tight">
        Let your agent do the haggling.
      </h2>
    </div>
  );
}

function ShowcaseCard({
  title,
  sample,
  className,
  overlay,
  children,
}: {
  title: string;
  sample?: boolean;
  className?: string;
  /** Drawn over the whole card, clipped to it (e.g. a confetti canvas). */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised p-5 shadow-card",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink-secondary text-xs uppercase tracking-wider">
          {title}
        </h3>
        {sample && (
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 font-medium text-[11px] text-ink-secondary uppercase tracking-wider">
            Sample
          </span>
        )}
      </div>
      <div className="flex-1">{children}</div>
      {overlay && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {overlay}
        </div>
      )}
    </section>
  );
}

/** The four presets a buyer can start from — real names, avatars and colours.
 *  Display only; the highlight moves on its own. */
function AgentsCard({ active }: { active: number }) {
  return (
    <ShowcaseCard title="Agents">
      <ul className="grid grid-cols-4 gap-2">
        {NEGOTIATION_AGENT_PRESETS.map((preset, index) => {
          const [first, ...rest] = preset.copy.buyer.name.split(" ");
          return (
            <li
              key={preset.id}
              className={cn(
                "flex flex-col items-center gap-2 py-1 text-center transition-opacity duration-300",
                index === active ? "opacity-100" : "opacity-45",
              )}
            >
              <AgentChip animal={preset.emoji} accent={preset.accentColor} size={52} />
              {/* Every name on two lines (first word, then the rest) so the
                  row lines up — otherwise only the longest name wraps. */}
              <span className="font-medium text-ink text-sm leading-tight">
                {first}
                <br />
                {rest.join(" ")}
              </span>
            </li>
          );
        })}
      </ul>
    </ShowcaseCard>
  );
}

/** What each preset weighs most — its real weights, labelled for people.
 *  Rapport (w_s) is left out: it barely varies between presets. */
const WEIGHT_ROWS = [
  { key: "w_p", label: "Price" },
  { key: "w_t", label: "Speed" },
  { key: "w_r", label: "Risk" },
] as const;

// Weights top out near 0.5; doubling lets the dominant one fill its bar, the
// same display scale the strategy radar uses.
const WEIGHT_DISPLAY_SCALE = 2;

/**
 * The highlighted agent's strategy: the radar morphs to its shape, and the
 * bars under it show the four weights driving that shape.
 */
function StrategyCard({ active, className }: { active: number; className?: string }) {
  const preset = NEGOTIATION_AGENT_PRESETS[active];
  return (
    <ShowcaseCard title="Strategy" className={className}>
      <div className="flex justify-center">
        <MotionRadar preset={preset} size={140} showLabels={false} />
      </div>
      <ul className="mt-3 space-y-2">
        {WEIGHT_ROWS.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-ink-secondary text-sm">{row.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-standard motion-reduce:transition-none"
                style={{
                  width: `${Math.min(1, preset.weights[row.key] * WEIGHT_DISPLAY_SCALE) * 100}%`,
                  backgroundColor: preset.accentColor,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </ShowcaseCard>
  );
}

function AgentChip({
  animal,
  accent,
  size = 40,
}: {
  animal: string;
  accent: string;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-surface"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${accent}`, fontSize: size * 0.5 }}
    >
      <AgentAvatar value={animal} />
    </span>
  );
}

const BUYER = NEGOTIATION_AGENT_PRESETS.find((p) => p.id === "hunter");
// The other side of the table: an animal that is not one of the four agents
// you can pick, in a neutral colour, so it reads as "someone else's agent"
// rather than one of yours.
const SELLER = { emoji: "raccoon", accentColor: "#7a7260" } as const;

const THREAD = [
  { side: "seller", text: "Listed at $280" },
  { side: "buyer", text: "Offer $230" },
  { side: "seller", text: "Counter $262" },
  { side: "buyer", text: "Offer $245" },
] as const;

const TURN_STAGGER_S = 0.55;
const FIRST_TURN_DELAY_S = 0.4;

/**
 * Two agents trading offers until they meet — the shape of a real session.
 *
 * Plays once on load (turns arrive one by one, then the deal) and then holds
 * still: the strategy radar beside it already moves, and a looping thread
 * would make two things compete for attention next to the form. Under
 * MotionConfig reducedMotion="user" the turns only fade in.
 */
function NegotiationCard({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  if (!BUYER) return null;
  const dealDelay = FIRST_TURN_DELAY_S + THREAD.length * TURN_STAGGER_S + 0.2;

  // One burst over the whole card when the deal lands, rising from the deal
  // row. canvas-confetti's `disableForReducedMotion` skips it for people who
  // ask for less motion.
  function celebrate() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const burst = confetti.create(canvas, { resize: true, disableForReducedMotion: true });
    void burst({
      particleCount: 70,
      spread: 100,
      startVelocity: 24,
      gravity: 0.7,
      decay: 0.92,
      ticks: 180,
      scalar: 0.8,
      origin: { x: 0.5, y: 0.88 },
      colors: CONFETTI_COLORS,
    });
  }

  return (
    <ShowcaseCard
      title="Agents negotiate"
      className={className}
      overlay={<canvas ref={canvasRef} className="size-full" />}
    >
      <MotionConfig reducedMotion="user">
        {/* Fills the card's height (it sits beside the taller strategy card)
            by spacing the turns out instead of leaving a gap at the bottom. */}
        <div className="flex h-full flex-col justify-between gap-4">
          <ol className="space-y-3">
            {THREAD.map((turn, index) => {
              const mine = turn.side === "buyer";
              const agent = mine ? BUYER : SELLER;
              return (
                <motion.li
                  key={turn.text}
                  initial={{ opacity: 0, x: mine ? 12 : -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: FIRST_TURN_DELAY_S + index * TURN_STAGGER_S,
                    duration: 0.35,
                    ease: [0.2, 0, 0, 1],
                  }}
                  className={cn("flex items-center gap-2", mine ? "flex-row-reverse" : "flex-row")}
                >
                  <AgentChip animal={agent.emoji} accent={agent.accentColor} size={26} />
                  <span
                    className={cn(
                      "rounded-xl px-3 py-1.5 font-medium text-sm",
                      // Same pair as ChatBubble / the messaging thread.
                      mine
                        ? "rounded-br-sm bg-cta text-on-cta"
                        : "rounded-bl-sm border border-line bg-surface-sunken text-ink",
                    )}
                  >
                    {turn.text}
                  </span>
                </motion.li>
              );
            })}
          </ol>
          <DealRow delay={dealDelay} onLanded={celebrate} />
        </div>
      </MotionConfig>
    </ShowcaseCard>
  );
}

/** Gold, navy and the success green — the palette, not rainbow party colours. */
const CONFETTI_COLORS = ["#d69a4c", "#1b2a4a", "#10b981", "#e6bc74"];

/**
 * The outcome, on one line: "Deal succeeded" and the agreed price. The green
 * row and the confetti carry the success; nothing else needs to.
 * `onLanded` fires once the row has finished appearing.
 */
function DealRow({ delay, onLanded }: { delay: number; onLanded: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.4, ease: [0.34, 1.4, 0.64, 1] }}
      onAnimationComplete={onLanded}
      className="flex items-center justify-between gap-3 rounded-xl border border-success/20 bg-success-soft px-4 py-2"
    >
      <span className="flex items-center gap-2 font-semibold text-sm text-success">
        <Check className="size-4 shrink-0" strokeWidth={3} aria-hidden="true" />
        Deal succeeded
      </span>
      <span className="font-bold text-base text-ink tabular-nums">$250</span>
    </motion.div>
  );
}
