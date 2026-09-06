"use client";

import {
  type AgentAnimal,
  type AgentBuilderState,
  isBuilderCustomized,
  type NegotiationAgentPreset,
  type NegotiationWeights,
} from "@haggle/shared";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Gauge,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Tag,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { useId } from "react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { AgentAvatarPicker } from "@/components/agents/agent-avatar-picker";
import { DURATION, EASE } from "@/components/listing-detail/motion";
import { MotionRadar } from "@/components/listing-detail/motion-radar";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { NegotiationAgentBuilderMemory } from "@/lib/negotiation-agent-builder-types";
import { WeightTuner } from "./weight-tuner";

/**
 * The identity panel — the character sheet of the agent being built.
 *
 * This is the payoff surface of the studio. The conversation happens in the
 * middle pane, but the *consequences* land here: the radar morphs as the chat
 * numericizes what you said, the four core weights sit directly under it as
 * live dials, and everything the agent has learned about you (budget,
 * must-haves, deal-breakers) accumulates as traits. Watching the sheet fill
 * in is what makes the build feel like creating a character rather than
 * filling out a form.
 *
 * Everything is derived from the one build state + the chat memory — the
 * panel owns no state of its own except what the parent hands it.
 */

const chipClass = "flex size-12 items-center justify-center rounded-full text-[22px]";
const chipStyle = (accent: string) => ({
  backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
  border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
});

interface IdentityPanelProps {
  /** Effective preset — base preset with any chat/advanced overrides merged. */
  effective: NegotiationAgentPreset;
  state: AgentBuilderState;
  role: "buyer" | "seller";
  memory: NegotiationAgentBuilderMemory | null;
  name: string;
  onNameChange?: (name: string) => void;
  /** Pick a face. Absent (read-only surfaces) leaves the chip static. */
  onAvatarChange?: (animal: AgentAnimal) => void;
  /** Live weight edits from the inline tuner. */
  onWeightsChange?: (weights: NegotiationWeights) => void;
  /** Drop all overrides, back to the bare preset. Shown only when customized. */
  onResetToPreset?: () => void;
  onOpenAdvanced?: () => void;
  onSave?: () => void;
  saving?: boolean;
  /** Brief post-save confirmation state (the button shows a check). */
  saved?: boolean;
  saveLabel?: string;
  /** Delete this agent. Only passed for saved agents — a preset is a template,
   *  not something the user owns, so there is nothing to delete. */
  onDelete?: () => void;
  deleting?: boolean;
  /** Surfaced under the commit buttons when a save or delete fails. */
  error?: string | null;
  className?: string;
}

export function AgentIdentityPanel({
  effective,
  state,
  role,
  memory,
  name,
  onNameChange,
  onAvatarChange,
  onWeightsChange,
  onResetToPreset,
  onOpenAdvanced,
  onSave,
  saving = false,
  saved = false,
  saveLabel = "Save agent",
  onDelete,
  deleting = false,
  error = null,
  className,
}: IdentityPanelProps) {
  const copy = effective.copy[role];
  const customized = isBuilderCustomized(state);
  const traits = traitsFromMemory(memory);
  // The studio renders this panel twice — the desktop aside stays mounted (it
  // is only hidden by a breakpoint class) while the mobile sheet renders its
  // own copy. A hardcoded id would collide, and the label would then point at
  // whichever copy is hidden, so each instance derives its own.
  const nameId = useId();

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      {/* Accent ambience — a quiet wash of the agent's colour behind the top of
          the sheet. CSS transitions the gradient when the agent (and thus the
          accent) changes; framer can't tween a color-mix() string. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 transition-[background] duration-(--motion-slow)"
        style={{
          background: `radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, ${effective.accentColor} 9%, transparent) 0%, transparent 70%)`,
        }}
      />

      <div className="relative min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {/* ── Who ── */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={effective.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DURATION.quick, ease: EASE.standard }}
            className="flex items-start gap-3"
          >
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: DURATION.base, ease: EASE.select }}
              className="shrink-0"
            >
              {onAvatarChange ? (
                // The chip is the picker's trigger: tapping the face is the
                // obvious way to change it, and it costs no extra control.
                <AgentAvatarPicker
                  value={effective.emoji}
                  onChange={onAvatarChange}
                  trigger={
                    <button
                      type="button"
                      aria-label="Change face"
                      className={cn(
                        chipClass,
                        "cursor-pointer transition-transform hover:scale-105",
                        "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2",
                      )}
                      style={chipStyle(effective.accentColor)}
                    >
                      <AgentAvatar value={effective.emoji} />
                    </button>
                  }
                />
              ) : (
                <span
                  className={chipClass}
                  style={chipStyle(effective.accentColor)}
                  aria-hidden="true"
                >
                  <AgentAvatar value={effective.emoji} />
                </span>
              )}
            </motion.span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[15px] text-ink leading-tight">{copy.name}</p>
              <p
                className="mt-0.5 truncate font-medium text-[12px]"
                style={{ color: effective.accentColor }}
              >
                {copy.tagline}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 font-semibold text-[10px] text-ink-secondary uppercase tracking-wider">
                  {role}
                </span>
                {customized && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: DURATION.quick, ease: EASE.select }}
                    className="flex items-center gap-1 rounded-full bg-badge px-2 py-0.5 font-semibold text-[10px] text-badge-text"
                  >
                    <Sparkles className="size-2.5" aria-hidden="true" />
                    Customized
                  </motion.span>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* ── Name ── */}
        {onNameChange && (
          <div>
            <label htmlFor={nameId} className="mb-1.5 block text-label text-ink-muted">
              Agent name
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={copy.name}
            />
          </div>
        )}

        {/* ── Strategy: shape + the four dials that shape it ── */}
        <div className="rounded-xl border border-line-subtle bg-surface-raised/60 p-3">
          <p className="mb-1 text-center text-label text-ink-muted">Strategy matrix</p>
          <div className="flex justify-center">
            <MotionRadar preset={effective} size={196} />
          </div>

          {onWeightsChange && (
            <div className="mt-3 border-line-subtle border-t pt-3">
              <WeightTuner
                weights={effective.weights}
                accent={effective.accentColor}
                onChange={onWeightsChange}
              />
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-line-subtle border-t pt-2">
            {/* Reset only exists once there is something to reset — appearing
                is itself the signal that the build has diverged. */}
            <AnimatePresence initial={false}>
              {customized && onResetToPreset ? (
                <motion.button
                  key="reset"
                  type="button"
                  onClick={onResetToPreset}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: DURATION.quick, ease: EASE.standard }}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-[11.5px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Reset
                </motion.button>
              ) : (
                <span key="spacer" />
              )}
            </AnimatePresence>
            {onOpenAdvanced && (
              <button
                type="button"
                onClick={onOpenAdvanced}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 font-medium text-[11.5px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
              >
                <Sliders className="size-3" aria-hidden="true" />
                All 16 parameters
              </button>
            )}
          </div>
        </div>

        {/* ── What it has learned ── */}
        <div>
          <p className="mb-2 text-label text-ink-muted">Briefing</p>
          {traits.length === 0 ? (
            <p className="rounded-xl border border-line-subtle border-dashed px-3 py-4 text-center text-[11.5px] text-ink-muted leading-relaxed">
              Nothing yet — everything you tell it in the chat shows up here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {traits.map((trait) => (
                <motion.li
                  key={trait.key}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: DURATION.quick, ease: EASE.decelerate }}
                  className="flex items-start gap-2 rounded-lg bg-surface-sunken/60 px-2.5 py-2"
                >
                  <trait.icon
                    className="mt-0.5 size-3.5 shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 text-[12px] leading-snug">
                    <span className="text-ink-muted">{trait.label} · </span>
                    <span className="font-medium text-ink">{trait.value}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Commit ── */}
      {(onSave || onDelete) && (
        <div className="relative shrink-0 space-y-2.5 border-line-subtle border-t p-4">
          {/* A failed write has to be visible where the button that failed is,
              not as a toast that has already gone by the time the eyes move. */}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-[11.5px] text-error leading-relaxed"
            >
              {error}
            </p>
          )}

          {onSave && (
            <Button
              fullWidth
              variant={saved ? "success" : "primary"}
              loading={saving}
              disabled={deleting}
              onClick={onSave}
            >
              {saved ? (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  Saved
                </>
              ) : saving ? (
                "Saving…"
              ) : (
                saveLabel
              )}
            </Button>
          )}

          {onDelete && (
            <Button
              fullWidth
              variant="ghost"
              size="sm"
              loading={deleting}
              disabled={saving}
              onClick={onDelete}
              className="text-error hover:bg-error-soft hover:text-error"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete agent"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Memory → traits ─────────────────────────────────────── */

interface Trait {
  key: string;
  icon: typeof Target;
  label: string;
  value: string;
}

/**
 * The chat component declares its own richer copy of the memory type (with
 * `dealBreakers`, `urgency`, …) that has drifted ahead of the shared one in
 * lib/negotiation-agent-builder-types. Reaching into app/ from components/
 * to import it would invert layering, so model the extra fields here until
 * the two declarations are unified.
 */
type DriftedMemoryFields = {
  dealBreakers?: string[];
  urgency?: string;
};

/**
 * Flatten the builder-chat memory into the character sheet's trait list.
 * Order is deliberate: money first (the thing negotiations are about), then
 * hard constraints, then style.
 */
function traitsFromMemory(raw: NegotiationAgentBuilderMemory | null): Trait[] {
  if (!raw) return [];
  const memory = raw as NegotiationAgentBuilderMemory & DriftedMemoryFields;
  const traits: Trait[] = [];

  if (memory.targetPrice) {
    traits.push({
      key: "target",
      icon: Target,
      label: "Target",
      value: `$${memory.targetPrice.toLocaleString()}`,
    });
  }
  if (memory.budgetMax) {
    traits.push({
      key: "budget",
      icon: Gauge,
      label: "Max budget",
      value: `$${memory.budgetMax.toLocaleString()}`,
    });
  }
  for (const item of memory.mustHave ?? []) {
    traits.push({ key: `must:${item}`, icon: ShieldCheck, label: "Must have", value: item });
  }
  for (const item of memory.dealBreakers ?? []) {
    traits.push({ key: `break:${item}`, icon: Zap, label: "Deal-breaker", value: item });
  }
  for (const item of memory.avoid ?? []) {
    traits.push({ key: `avoid:${item}`, icon: Tag, label: "Avoid", value: item });
  }
  for (const criterion of memory.categoryCriteria ?? []) {
    if (!criterion.stance) continue;
    traits.push({
      key: `crit:${criterion.checkId}`,
      icon: ShieldCheck,
      label: "Stance",
      value: criterion.stance,
    });
  }
  if (memory.urgency) {
    traits.push({ key: "urgency", icon: Zap, label: "Urgency", value: memory.urgency });
  }
  return traits;
}
