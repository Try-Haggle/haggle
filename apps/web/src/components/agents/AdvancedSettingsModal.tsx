"use client";

import { useEffect, useState } from "react";
import {
  FIELD_DESCRIPTORS,
  fieldsByTier,
  type FieldDescriptor,
  type NegotiationAgentPreset,
} from "@haggle/shared";

/**
 * Overrides editable in Advanced Settings. Mirrors the 16 preset-declared
 * EngineParameters fields (w_info is derived, market-3 stay neutral).
 */
export interface AdvancedOverrides {
  weights: { w_p: number; w_t: number; w_r: number; w_s: number };
  alpha: number;
  beta: number;
  u_threshold: number;
  u_aspiration: number;
  anchor_ratio: number;
  v_t_floor: number;
  w_rep: number;
  r_score_minimum: number;
  i_completeness_minimum: number;
  v_s_base: number;
  n_threshold: number;
  late_round_aggression_modifier: number;
}

interface AdvancedSettingsModalProps {
  open: boolean;
  preset: NegotiationAgentPreset;
  initial?: Partial<AdvancedOverrides>;
  onClose: () => void;
  onApply: (overrides: AdvancedOverrides) => void;
}

function presetToOverrides(preset: NegotiationAgentPreset): AdvancedOverrides {
  return {
    weights: { ...preset.weights },
    alpha: preset.alpha,
    beta: preset.beta,
    u_threshold: preset.u_threshold,
    u_aspiration: preset.u_aspiration,
    anchor_ratio: preset.anchor_ratio,
    v_t_floor: preset.v_t_floor,
    w_rep: preset.w_rep,
    r_score_minimum: preset.r_score_minimum,
    i_completeness_minimum: preset.i_completeness_minimum,
    v_s_base: preset.v_s_base,
    n_threshold: preset.n_threshold,
    late_round_aggression_modifier: preset.late_round_aggression_modifier,
  };
}

function readField(state: AdvancedOverrides, field: string): number {
  if (field === "w_p" || field === "w_t" || field === "w_r" || field === "w_s") {
    return state.weights[field];
  }
  return (state as unknown as Record<string, number>)[field];
}

/** Weights must sum to 1.0. When one is moved, normalize the others. */
function normalizeWeights(
  weights: AdvancedOverrides["weights"],
  changedKey: keyof AdvancedOverrides["weights"],
  newValue: number,
): AdvancedOverrides["weights"] {
  const clamped = Math.max(0, Math.min(1, newValue));
  const others = (Object.keys(weights) as Array<keyof typeof weights>).filter(
    (k) => k !== changedKey,
  );
  const remaining = 1 - clamped;
  const othersSum = others.reduce((s, k) => s + weights[k], 0);
  const next = { ...weights, [changedKey]: clamped };
  if (othersSum > 0) {
    for (const k of others) {
      next[k] = (weights[k] / othersSum) * remaining;
    }
  } else {
    const equal = remaining / others.length;
    for (const k of others) next[k] = equal;
  }
  return next;
}

export function AdvancedSettingsModal({
  open,
  preset,
  initial,
  onClose,
  onApply,
}: AdvancedSettingsModalProps) {
  const [state, setState] = useState<AdvancedOverrides>(() => ({
    ...presetToOverrides(preset),
    ...initial,
  }));
  const [showExpert, setShowExpert] = useState(false);

  // Reset when preset changes or modal reopens
  useEffect(() => {
    if (open) {
      setState({ ...presetToOverrides(preset), ...initial });
    }
  }, [open, preset, initial]);

  if (!open) return null;

  const handleChange = (descriptor: FieldDescriptor, raw: number) => {
    const value = descriptor.integer ? Math.round(raw) : raw;
    if (descriptor.tier === 1) {
      setState((s) => ({
        ...s,
        weights: normalizeWeights(
          s.weights,
          descriptor.field as keyof AdvancedOverrides["weights"],
          value,
        ),
      }));
    } else {
      setState((s) => ({ ...s, [descriptor.field]: value }));
    }
  };

  const handleReset = () => {
    setState(presetToOverrides(preset));
  };

  const tier1 = fieldsByTier(1);
  const tier2 = fieldsByTier(2);
  const tier3 = fieldsByTier(3);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Advanced Settings"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 z-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-10 bg-surface-raised border border-line rounded-xl w-full max-w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-ink">Advanced Settings</h2>
            <p className="text-[12px] text-ink-secondary mt-0.5">
              Starting from <span className="text-action-primary">{preset.copy.seller.name}</span> ·
              adjust 16 engine fields freely.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-secondary hover:text-ink text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <Section title="Weights" subtitle="Sum = 1.0. Moving one auto-balances the rest.">
            {tier1.map((d) => (
              <SliderRow
                key={d.field}
                descriptor={d}
                value={readField(state, d.field)}
                onChange={(v) => handleChange(d, v)}
              />
            ))}
          </Section>

          <Section
            title="Behavior Curves"
            subtitle="Each slider is independent within its envelope."
          >
            {tier2.map((d) => (
              <SliderRow
                key={d.field}
                descriptor={d}
                value={readField(state, d.field)}
                onChange={(v) => handleChange(d, v)}
              />
            ))}
          </Section>

          <div>
            <button
              type="button"
              onClick={() => setShowExpert((v) => !v)}
              className="text-[12px] font-bold tracking-wider uppercase text-info hover:text-info"
            >
              {showExpert ? "▾" : "▸"} Expert — Sub-parameters (8)
            </button>
            {showExpert && (
              <div className="mt-3 space-y-3">
                {tier3.map((d) => (
                  <SliderRow
                    key={d.field}
                    descriptor={d}
                    value={readField(state, d.field)}
                    onChange={(v) => handleChange(d, v)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-line flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="text-[13px] text-ink-secondary hover:text-ink"
          >
            Reset to preset
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md text-ink-secondary hover:text-ink border border-transparent hover:border-line-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onApply(state)}
              className="px-4 py-2 text-sm font-bold rounded-md bg-success text-on-accent hover:bg-success"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[12px] font-bold tracking-wider uppercase text-ink-secondary mb-1">
        {title}
      </h3>
      {subtitle && <p className="text-[11px] text-ink-muted mb-3">{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SliderRow({
  descriptor,
  value,
  onChange,
}: {
  descriptor: FieldDescriptor;
  value: number;
  onChange: (v: number) => void;
}) {
  const [min, max] = descriptor.envelope;
  const step = descriptor.step ?? 0.01;
  const display = descriptor.integer ? Math.round(value) : value.toFixed(2);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label htmlFor={`slider-${descriptor.field}`} className="text-[13px] font-medium text-ink">
          {descriptor.label}
        </label>
        <span className="text-[12px] font-mono text-action-primary">{display}</span>
      </div>
      <input
        id={`slider-${descriptor.field}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-action-primary"
      />
      <div className="flex justify-between text-[10px] text-ink-muted mt-1 gap-2">
        <span className="flex-1 text-left leading-tight">{descriptor.left}</span>
        <span className="flex-1 text-right leading-tight">{descriptor.right}</span>
      </div>
    </div>
  );
}
