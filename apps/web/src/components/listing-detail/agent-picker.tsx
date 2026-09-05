"use client";

import { getNegotiationAgentPreset, type NegotiationAgentPreset } from "@haggle/shared";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Pencil, Plus } from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Carousel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DURATION, EASE, expandPanel, SPRING } from "./motion";
import type { StrategyOverride } from "./types";

/**
 * The rail's negotiator section — deliberately minimal.
 *
 * The rail shows what the buyer HAS: their saved agents as one-tap tiles, and
 * the current pick as a card. Everything about configuring — choosing a base
 * preset, weight dials, advanced knobs, the briefing chat — lives in the
 * negotiator panel (the drawer), reached from the card's single footer row or
 * from the empty-state CTA. One surface to read, one surface to configure.
 * Presets are not shown inline anymore: a first-time buyer meets them inside
 * the panel, where they can actually be explored, instead of as four cryptic
 * tiles competing with the CTA.
 */

export interface SavedAgentOption {
  id: string;
  name: string;
  emoji: string | null;
  /** Archetype this agent was forked from — resolves its base strategy. */
  presetId: string;
  /**
   * The tuning stored ON the agent, if it was customized when saved. Seeds this
   * page's override so a saved agent negotiates with the numbers it was saved
   * with; without it, picking one would quietly fall back to the bare preset
   * and the customization would be cosmetic.
   */
  strategy?: StrategyOverride;
}

/** Which side of the deal is picking. Copy diverges per side; strategy does not. */
export type AgentRole = "buyer" | "seller";

export type AgentSelection =
  | { kind: "preset"; id: string }
  | { kind: "saved"; id: string; presetId: string };

interface AgentPickerProps {
  /** Buyer on the listing page, seller in the listing wizard. Only copy changes. */
  role?: AgentRole;
  selection: AgentSelection | null;
  onSelect: (selection: AgentSelection) => void;
  /** Selected preset with page-level tuning merged (panel dials, chat).
   *  When provided it drives the detail card, so the radar keeps the tuned
   *  shape after the panel closes. */
  presetOverride?: NegotiationAgentPreset;
  savedAgents?: SavedAgentOption[];
  /** Opens the negotiator panel (all configuration lives there). */
  onOpenPanel?: () => void;
  /** Strategy hints captured by the briefing chat so far. */
  briefHintCount?: number;
  /** Deal-required questions the buyer hasn't answered yet. */
  openRequirementCount?: number;
  className?: string;
}

/** The preset backing a selection, whichever kind it is. */
export function resolveSelectedPreset(
  selection: AgentSelection | null,
): NegotiationAgentPreset | undefined {
  if (!selection) return undefined;
  const id = selection.kind === "preset" ? selection.id : selection.presetId;
  return getNegotiationAgentPreset(id);
}

export function AgentPicker({
  role = "buyer",
  selection,
  onSelect,
  presetOverride,
  savedAgents = [],
  onOpenPanel,
  briefHintCount = 0,
  openRequirementCount = 0,
  className,
}: AgentPickerProps) {
  const preset = presetOverride ?? resolveSelectedPreset(selection);
  const savedRow =
    selection?.kind === "saved"
      ? savedAgents.find((agent) => agent.id === selection.id)
      : undefined;
  const savedName = savedRow?.name;
  const savedEmoji = savedRow?.emoji ?? undefined;

  return (
    <section className={className}>
      <p className="text-label text-ink-muted">Your negotiator</p>

      {/* Saved agents only — the buyer's own, one tap to re-use. Labeled the
          same as the panel's saved section so the two surfaces speak one
          vocabulary. */}
      {savedAgents.length > 0 && (
        <Carousel
          className="mt-2.5"
          ariaLabel="Saved agents"
          title={
            <p className="text-[10px] text-ink-muted uppercase tracking-wider">Saved agents</p>
          }
          scrollBy="card"
          cardsPerScroll={4}
          snap="proximity"
          trackClassName="gap-2"
        >
          {/* Four tiles per view; past four the row slides (arrows appear in
              the label row) instead of wrapping into an ever-taller grid. */}
          {savedAgents.map((agent) => {
            const base = getNegotiationAgentPreset(agent.presetId);
            return (
              <div key={agent.id} className="w-[calc(25%-6px)] shrink-0 snap-start">
                <AgentTile
                  emoji={agent.emoji ?? "✦"}
                  label={agent.name}
                  accent={base?.accentColor ?? "var(--action-primary)"}
                  selected={selection?.kind === "saved" && selection.id === agent.id}
                  onClick={() =>
                    onSelect({ kind: "saved", id: agent.id, presetId: agent.presetId })
                  }
                />
              </div>
            );
          })}
        </Carousel>
      )}

      {/* Two containment rules make this feel smooth instead of stuttery:
          1. Empty-door ↔ card swaps animate HEIGHT (expandPanel), and the two
             blocks run concurrently (no mode="wait"), so the space below
             morphs once instead of collapsing dead and re-expanding — the old
             version double-jumped the CTA under it.
          2. Switching agents never unmounts the card; only the identity row
             crossfades. Killing the whole card to show a nearly identical one
             is what read as jank. */}
      <AnimatePresence initial={false}>
        {preset ? (
          <motion.div
            key="card"
            variants={expandPanel}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="pt-3">
              <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
                {/* Mirror of the opponent card: emoji avatar + name + role
                    line, so the matchup reads as two symmetric sides. Earlier
                    versions put an unlabeled 96px radar here — at that size,
                    with axes named α/β/uT, it communicated nothing to a buyer
                    and read as decoration. The radar lives in the panel,
                    beside the dials that change it, where it has meaning. */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={`${selection?.kind}:${selection?.kind === "saved" ? selection.id : preset.id}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: DURATION.instant, ease: EASE.standard }}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span
                        className="flex size-11 shrink-0 items-center justify-center rounded-full text-xl"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${preset.accentColor} 14%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${preset.accentColor} 32%, transparent)`,
                        }}
                        aria-hidden="true"
                      >
                        <AgentAvatar value={savedEmoji ?? preset.emoji} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-[15px] text-ink">
                          {savedName ?? preset.copy[role].name}
                        </span>
                        {/* Saved agents carry one useful fact the name alone
                            doesn't: which archetype they were forked from. A
                            fresh preset IS its archetype, so it gets the role
                            line instead. */}
                        <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                          {savedRow ? `Based on ${preset.copy[role].name}` : "Your AI negotiator"}
                        </span>
                      </span>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* One row, one destination: everything configurable opens the
                  panel. The hint tells the buyer the most urgent reason to go —
                  unanswered deal questions beat generic copy. */}
                {onOpenPanel && (
                  <button
                    type="button"
                    onClick={onOpenPanel}
                    // Same anatomy as the "Set up a new negotiator" door below:
                    // tinted circle badge + two-line text + chevron, so the
                    // rail's two doors into the panel read as one family. The
                    // badge doubles as the state light — pencil while there is
                    // tuning to do, green check once briefed.
                    className="flex w-full items-center gap-3 border-line-subtle border-t px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        briefHintCount > 0 ? "bg-success-soft" : "bg-action-primary/10",
                      )}
                      aria-hidden="true"
                    >
                      {briefHintCount > 0 ? (
                        <Check className="size-4 text-success" />
                      ) : (
                        <Pencil className="size-4 text-action-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* Verb choice has history: "Set up" was wrong (the
                          agent already exists), "brief" is business jargon
                          that misreads as the adjective, bare "Adjust" was
                          flat. "Fine-tune" is the natural English for precise
                          adjustment of something already working — and the
                          object is implied by the card it sits in. Done-state
                          is "Ready" — the outcome, not the ritual. */}
                      <span className="block font-semibold text-[12.5px] text-ink">
                        {briefHintCount > 0 ? "Ready" : "Fine-tune"}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-muted leading-snug">
                        {briefHintCount > 0
                          ? `${briefHintCount} strategy hint${briefHintCount === 1 ? "" : "s"} captured, tap to keep going`
                          : openRequirementCount > 0
                            ? `This deal has ${openRequirementCount} required question${openRequirementCount === 1 ? "" : "s"} to answer before it can close.`
                            : role === "seller"
                              ? "Tune its strategy and tell it your floor and what you won't accept."
                              : "Tune its strategy and tell it your budget and deal-breakers."}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          /* Nothing picked yet — a single inviting door into the panel.

             It says "new" on purpose: the saved-agent tiles above already
             cover reuse in one tap, so this door's job is the other errand.
             A door labeled "choose" here would say the same thing as the row
             directly above it. What the door promises is also what the panel
             opens onto — the drawer drops its saved section on this visit. */
          <motion.div
            key="empty"
            variants={expandPanel}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            {onOpenPanel && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={onOpenPanel}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3.5 text-left transition-colors hover:border-line-strong hover:bg-surface-sunken/60"
                >
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-action-primary/10"
                    aria-hidden="true"
                  >
                    <Plus className="size-4 text-action-primary" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[13.5px] text-ink">
                      Set up a new negotiator
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                      Pick a style, adjust it, and tell it what matters.
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ─── Tile ────────────────────────────────────────────────── */

/** Compact agent tile — shared by the rail (saved agents) and the negotiator
 *  panel (presets + saved), so picking reads identically in both places. */
export function AgentTile({
  emoji,
  label,
  accent,
  selected,
  onClick,
}: {
  emoji: string;
  label: string;
  accent: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        // A resting border makes each tile read as a card even unselected —
        // borderless emoji floating on the page read as decoration, not
        // options. Selection recolours the tile IN PLACE (transition-colors):
        // an earlier version slid a shared-layout highlight between tiles,
        // and a box flying across the grid read as gimmicky rather than
        // premium. The card unfolding below carries the motion instead.
        "relative flex w-full flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2",
        selected
          ? "text-ink"
          : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink-secondary",
      )}
      style={
        selected
          ? {
              backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
              borderColor: `color-mix(in srgb, ${accent} 55%, transparent)`,
            }
          : undefined
      }
    >
      <motion.span
        className="relative text-[22px] leading-none"
        animate={selected ? { y: -1, scale: 1.08 } : { y: 0, scale: 1 }}
        transition={SPRING.snappy}
        aria-hidden="true"
      >
        <AgentAvatar value={emoji} />
      </motion.span>
      {/* Reserve two lines so one-line and two-line labels produce equal
          tile heights — mixed heights in a row read as misalignment. */}
      <span className="relative flex min-h-[2.4em] items-center">
        <span className="line-clamp-2 text-center font-medium text-[11px] leading-[1.2]">
          {label}
        </span>
      </span>
    </button>
  );
}
