"use client";

import {
  type FieldDescriptor,
  fieldsByTier,
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
} from "@haggle/shared";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { WeightTuner } from "@/components/agent-studio/weight-tuner";
import { Carousel, Slider } from "@/components/ui";
import { type AgentSelection, AgentTile, type SavedAgentOption } from "./agent-picker";
import { DURATION, EASE, expandPanel } from "./motion";
import type { StrategyOverride } from "./types";

/**
 * The negotiator panel — everything about configuring YOUR agent, in the
 * drawer, so the listing page itself stays minimal.
 *
 * The conversation is the hero. This product's premise is that an agent is
 * built by talking to it, so the panel is laid out like a messenger, not a
 * settings form: a compact roster on top, the briefing chat filling
 * everything below, and the numeric strategy (radar, weight dials, the
 * advanced engine knobs) folded into one slim strip between them. The
 * strip's thumbnail radar is live — when the chat numericizes what you said,
 * the shape morphs even while the strip is closed, which is how the buyer
 * learns the conversation has consequences.
 *
 * Advanced settings render inline (a disclosure inside the strip) rather
 * than in the old modal — a modal stacked on a drawer is two layers of
 * overlay, and the point of this panel is that configuration never leaves it.
 */

interface NegotiatorPanelProps {
  selection: AgentSelection | null;
  onSelect: (selection: AgentSelection) => void;
  savedAgents?: SavedAgentOption[];
  /** Selected preset with this deal's overrides merged (drives radar + sliders). */
  effective?: NegotiationAgentPreset;
  override: StrategyOverride | null;
  onOverrideChange: (next: StrategyOverride) => void;
  onResetOverride: () => void;
  /** The briefing chat for the current selection — rendered by the page. */
  chatSlot?: React.ReactNode;
}

export function NegotiatorPanel({
  selection,
  onSelect,
  savedAgents = [],
  effective,
  override,
  onOverrideChange,
  onResetOverride,
  chatSlot,
}: NegotiatorPanelProps) {
  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      {/* ── Roster (compact) ── */}
      <section className="shrink-0">
        <p className="text-label text-ink-muted">Presets</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {NEGOTIATION_AGENT_PRESETS.map((preset) => (
            <AgentTile
              key={preset.id}
              emoji={preset.emoji}
              label={preset.copy.buyer.name}
              accent={preset.accentColor}
              selected={selection?.kind === "preset" && selection.id === preset.id}
              onClick={() => onSelect({ kind: "preset", id: preset.id })}
            />
          ))}
        </div>

        {savedAgents.length > 0 && (
          <Carousel
            className="mt-3"
            ariaLabel="Saved agents"
            title={<p className="text-label text-ink-muted">Saved agents</p>}
            scrollBy="card"
            cardsPerScroll={4}
            snap="proximity"
            trackClassName="gap-2"
          >
            {savedAgents.map((agent) => (
              <div key={agent.id} className="w-[calc(25%-6px)] shrink-0 snap-start">
                <AgentTile
                  emoji={agent.emoji ?? "✦"}
                  label={agent.name}
                  accent="var(--action-primary)"
                  selected={selection?.kind === "saved" && selection.id === agent.id}
                  onClick={() =>
                    onSelect({ kind: "saved", id: agent.id, presetId: agent.presetId })
                  }
                />
              </div>
            ))}
          </Carousel>
        )}
      </section>

      {effective ? (
        <>
          {/* ── Strategy, folded to a strip so the chat keeps the stage ── */}
          <StrategyStrip
            effective={effective}
            customized={override !== null}
            override={override}
            onOverrideChange={onOverrideChange}
            onResetOverride={onResetOverride}
          />

          {/* ── The briefing conversation — the hero ── */}
          {chatSlot && (
            <section className="mt-4 flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-90 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface-raised">
                {chatSlot}
              </div>
            </section>
          )}
        </>
      ) : (
        /* Nothing picked: the empty stage itself teaches the premise. */
        <div className="mt-4 flex min-h-90 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-line-subtle border-dashed p-6">
          <p className="font-semibold text-[14px] text-ink">Pick a negotiator above</p>
          <p className="max-w-70 text-center text-[12px] text-ink-muted leading-relaxed">
            Then tell it what matters — your budget, deal-breakers, how hard to push. It takes shape
            as you talk.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Strategy strip (radar thumb → tuner + advanced) ─────── */

function StrategyStrip({
  effective,
  customized,
  override,
  onOverrideChange,
  onResetOverride,
}: {
  effective: NegotiationAgentPreset;
  customized: boolean;
  override: StrategyOverride | null;
  onOverrideChange: (next: StrategyOverride) => void;
  onResetOverride: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="mt-4 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-raised">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-surface-sunken/60"
      >
        {/* Same circle-badge anatomy as the rail's Fine-tune/Ready rows.
            This used to be a 40px radar thumbnail — at that size, unlabeled,
            it read as an inscrutable doodle. The full labeled radar still
            lives inside, next to the dials that change it. */}
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-action-primary/10"
          aria-hidden="true"
        >
          <SlidersHorizontal className="size-4 text-action-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[12.5px] text-ink">Strategy</span>
          <span className="block truncate text-[10.5px] text-ink-muted">
            {customized ? "Tuned for this deal" : effective.copy.buyer.name} · tap to tune
          </span>
        </span>
        {customized && (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: effective.accentColor }}
            aria-hidden="true"
          />
        )}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: DURATION.quick, ease: EASE.standard }}
          className="flex shrink-0"
          aria-hidden="true"
        >
          <ChevronDown className="size-4 text-ink-muted" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            variants={expandPanel}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="border-line-subtle border-t px-3.5 pt-3 pb-3">
              <WeightTuner
                weights={effective.weights}
                accent={effective.accentColor}
                onChange={(weights) =>
                  onOverrideChange({ ...(override ?? {}), weights: { ...weights } })
                }
              />

              <AdvancedDisclosure
                effective={effective}
                override={override}
                onOverrideChange={onOverrideChange}
              />

              <AnimatePresence initial={false}>
                {customized && (
                  <motion.button
                    key="reset"
                    type="button"
                    onClick={onResetOverride}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: DURATION.quick }}
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-[11px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    <RotateCcw className="size-3" aria-hidden="true" />
                    Reset to preset
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Advanced (the remaining engine knobs), inline ────────── */

function AdvancedDisclosure({
  effective,
  override,
  onOverrideChange,
}: {
  effective: NegotiationAgentPreset;
  override: StrategyOverride | null;
  onOverrideChange: (next: StrategyOverride) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // Weights live in the tuner above; here: behaviour curves + sub-parameters.
  const descriptors = [...fieldsByTier(2), ...fieldsByTier(3)];

  function readValue(descriptor: FieldDescriptor): number {
    const key = descriptor.field as keyof Omit<StrategyOverride, "weights">;
    return override?.[key] ?? (effective[key as keyof NegotiationAgentPreset] as number);
  }

  function writeValue(descriptor: FieldDescriptor, raw: number) {
    const value = descriptor.integer ? Math.round(raw) : raw;
    onOverrideChange({
      // First advanced edit on a bare preset: seed weights so the override is
      // complete on its own.
      weights: { ...effective.weights },
      ...override,
      [descriptor.field]: value,
    });
  }

  return (
    <div className="mt-3 border-line-subtle border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-surface-sunken/60"
      >
        <span className="font-medium text-[12px] text-ink-secondary">
          Advanced · {descriptors.length} parameters
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: DURATION.quick, ease: EASE.standard }}
          className="flex"
          aria-hidden="true"
        >
          <ChevronDown className="size-4 text-ink-muted" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            variants={expandPanel}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="space-y-3 px-1 pt-2 pb-1">
              {descriptors.map((descriptor) => {
                const value = readValue(descriptor);
                const [min, max] = descriptor.envelope;
                return (
                  <div key={descriptor.field}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="font-medium text-[11.5px] text-ink-secondary">
                        {descriptor.label}
                      </span>
                      <span className="font-mono text-[11px] text-action-primary tabular-nums">
                        {descriptor.integer ? Math.round(value) : value.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      aria-label={descriptor.label}
                      min={min}
                      max={max}
                      step={descriptor.step ?? 0.01}
                      value={value}
                      onValueChange={(next) => writeValue(descriptor, next)}
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
