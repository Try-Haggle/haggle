"use client";

import { type FieldDescriptor, fieldsByTier, type NegotiationAgentPreset } from "@haggle/shared";
import { useEffect, useState } from "react";
import { Button, Disclosure, Modal, Slider } from "@/components/ui";

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

  // Reset when preset changes or modal reopens
  useEffect(() => {
    if (open) {
      setState({ ...presetToOverrides(preset), ...initial });
    }
  }, [open, preset, initial]);

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
    <Modal
      open={open}
      onClose={onClose}
      title="Advanced Settings"
      size="lg"
      className="max-w-[640px]"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Reset to preset
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => onApply(state)}>
              Apply
            </Button>
          </div>
        </div>
      }
    >
      <p className="mb-5 text-[12px] text-ink-secondary">
        Starting from <span className="text-action-primary">{preset.copy.seller.name}</span> ·
        adjust 16 engine fields freely.
      </p>

      <div className="space-y-6">
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

        <Section title="Behavior Curves" subtitle="Each slider is independent within its envelope.">
          {tier2.map((d) => (
            <SliderRow
              key={d.field}
              descriptor={d}
              value={readField(state, d.field)}
              onChange={(v) => handleChange(d, v)}
            />
          ))}
        </Section>

        <Disclosure title="Expert — Sub-parameters (8)">
          <div className="space-y-3">
            {tier3.map((d) => (
              <SliderRow
                key={d.field}
                descriptor={d}
                value={readField(state, d.field)}
                onChange={(v) => handleChange(d, v)}
              />
            ))}
          </div>
        </Disclosure>
      </div>
    </Modal>
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
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-medium text-[13px] text-ink">{descriptor.label}</span>
        <span className="font-mono text-[12px] text-action-primary">{display}</span>
      </div>
      <Slider
        aria-label={descriptor.label}
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={onChange}
      />
      <div className="mt-1 flex justify-between gap-2 text-[10px] text-ink-muted">
        <span className="flex-1 text-left leading-tight">{descriptor.left}</span>
        <span className="flex-1 text-right leading-tight">{descriptor.right}</span>
      </div>
    </div>
  );
}
