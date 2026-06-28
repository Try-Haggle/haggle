"use client";

import type { NegotiationWeights } from "@haggle/shared";
import { Radar } from "@/components/ui";

interface WeightRadarProps {
  weights: NegotiationWeights;
  /** Diameter in px (square). */
  size?: number;
  /** Show P/T/R/S labels around vertices. */
  labels?: boolean;
  className?: string;
}

const AXES = [
  { key: "w_p", label: "P" },
  { key: "w_t", label: "T" },
  { key: "w_r", label: "R" },
  { key: "w_s", label: "S" },
] as const;

// Weights sum to 1.0; the dominant one tops out around 0.5. Scale so the
// dominant weight fills the radar visually.
const SCALE = 2.0;

/** 4-axis weight diamond. Renders via the shared {@link Radar} (brand series color). */
export function WeightRadar({ weights, size = 88, labels = false, className }: WeightRadarProps) {
  const axes = AXES.map(({ key, label }) => ({
    key,
    label,
    value: Math.min(weights[key] * SCALE, 1),
  }));

  return (
    <Radar
      axes={axes}
      max={1}
      levels={4}
      size={size}
      showLabels={labels}
      ariaLabel="Negotiation weights radar"
      className={className}
    />
  );
}
