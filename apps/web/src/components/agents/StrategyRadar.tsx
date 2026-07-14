"use client";

import type { NegotiationAgentPreset } from "@haggle/shared";
import { Radar } from "@/components/ui";

interface StrategyRadarProps {
  preset: NegotiationAgentPreset;
  /** Diameter in px (square). */
  size?: number;
  /** Show short axis labels (P/T/R/S/α/β/uT/uA) around vertices. */
  labels?: boolean;
  className?: string;
}

/**
 * 8 axes of the new preset system. Each axis has its own envelope and is
 * normalized to [0, 1] for visualization.
 *
 *   12 o'clock → clockwise: P · T · R · S · α · β · uT · uA
 */
const AXES = [
  { key: "w_p" as const, label: "P", envelope: [0, 1] as const },
  { key: "w_t" as const, label: "T", envelope: [0, 1] as const },
  { key: "w_r" as const, label: "R", envelope: [0, 1] as const },
  { key: "w_s" as const, label: "S", envelope: [0, 1] as const },
  { key: "alpha" as const, label: "α", envelope: [0.3, 3.0] as const },
  { key: "beta" as const, label: "β", envelope: [0.3, 3.0] as const },
  { key: "u_threshold" as const, label: "uT", envelope: [0.3, 0.85] as const },
  { key: "u_aspiration" as const, label: "uA", envelope: [0.3, 0.85] as const },
];

// Weights top out near 0.5 in practice. Scale them so the dominant weight
// reaches ~100% on the radar (visual differentiation).
const WEIGHT_DISPLAY_SCALE = 2.0;

function normalize(
  key: (typeof AXES)[number]["key"],
  value: number,
  envelope: readonly [number, number],
): number {
  if (key === "w_p" || key === "w_t" || key === "w_r" || key === "w_s") {
    return Math.min(value * WEIGHT_DISPLAY_SCALE, 1);
  }
  const [min, max] = envelope;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** 8-axis strategy matrix. Renders via the shared {@link Radar} (brand series color). */
export function StrategyRadar({
  preset,
  size = 220,
  labels = true,
  className,
}: StrategyRadarProps) {
  const axes = AXES.map((axis) => {
    const raw =
      axis.key === "w_p"
        ? preset.weights.w_p
        : axis.key === "w_t"
          ? preset.weights.w_t
          : axis.key === "w_r"
            ? preset.weights.w_r
            : axis.key === "w_s"
              ? preset.weights.w_s
              : (preset[axis.key] as number);
    return { key: axis.key, label: axis.label, value: normalize(axis.key, raw, axis.envelope) };
  });

  return (
    <Radar
      axes={axes}
      max={1}
      levels={4}
      size={size}
      showLabels={labels}
      ariaLabel="Strategy matrix radar"
      className={className}
    />
  );
}
