"use client";

import { fieldsByTier, type NegotiationWeights } from "@haggle/shared";
import { normalizeWeights } from "@/components/agents/AdvancedSettingsModal";
import { Slider } from "@/components/ui";

/**
 * Inline weight tuner — the four dials that matter, right on the sheet.
 *
 * The full 16-knob editor stays in the Advanced modal, but burying ALL
 * parameter control there made tuning feel like a separate errand from
 * building. These four weights (price / time / risk / social) are the ones
 * that visibly change who the agent is, so they live on the character sheet
 * itself, wired straight into the build state: drag Price and the radar
 * morphs while your thumb is still on the slider. That live loop — not the
 * modal — is what makes the strategy feel hand-shaped.
 *
 * Weights always sum to 1.0; moving one rebalances the rest by the same
 * `normalizeWeights` rule the Advanced modal uses, so the two surfaces can
 * never disagree about what a drag means.
 */

interface WeightTunerProps {
  weights: NegotiationWeights;
  accent: string;
  onChange: (weights: NegotiationWeights) => void;
}

const WEIGHT_FIELDS = fieldsByTier(1);

export function WeightTuner({ weights, accent, onChange }: WeightTunerProps) {
  return (
    <div className="space-y-2.5">
      {WEIGHT_FIELDS.map((descriptor) => {
        const field = descriptor.field as keyof NegotiationWeights;
        const value = weights[field];
        return (
          <div key={descriptor.field}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="font-medium text-[11.5px] text-ink-secondary">
                {descriptor.label}
              </span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: accent }}>
                {Math.round(value * 100)}%
              </span>
            </div>
            <Slider
              aria-label={`${descriptor.label} weight`}
              min={0}
              max={1}
              step={0.01}
              value={value}
              onValueChange={(next) => onChange(normalizeWeights(weights, field, next))}
            />
          </div>
        );
      })}
    </div>
  );
}
