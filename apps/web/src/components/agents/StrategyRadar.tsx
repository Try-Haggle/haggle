"use client";

import type { NegotiationPreset } from "@haggle/shared";

interface StrategyRadarProps {
  preset: NegotiationPreset;
  /** Diameter in px (square). */
  size?: number;
  /** Show short axis labels (P/T/R/S/α/β/uT/uA) around vertices. */
  labels?: boolean;
  className?: string;
}

const SHAPE_FILL = "rgba(6,182,212,0.18)";
const SHAPE_STROKE = "rgba(6,182,212,0.85)";
const VERTEX_FILL = "#06b6d4";
const GRID_STROKE = "rgba(148,163,184,0.18)";
const LABEL_FILL = "#94a3b8";

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

function vertex(
  i: number,
  r: number,
  cx: number,
  cy: number,
): [number, number] {
  const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function octagon(r: number, cx: number, cy: number): string {
  return Array.from({ length: 8 }, (_, i) => {
    const [x, y] = vertex(i, r, cx, cy);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function StrategyRadar({
  preset,
  size = 220,
  labels = true,
  className,
}: StrategyRadarProps) {
  const center = size / 2;
  const radius = size / 2 - (labels ? 20 : 8);
  const labelOffset = radius + 12;

  const values = AXES.map((axis) => {
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
    return normalize(axis.key, raw, axis.envelope);
  });

  const shapePoints = values
    .map((v, i) => {
      const [x, y] = vertex(i, v * radius, center, center);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className ?? "block w-full"}
      role="img"
      aria-label="Strategy matrix radar"
    >
      {[0.25, 0.5, 0.75, 1.0].map((level) => (
        <polygon
          key={level}
          points={octagon(level * radius, center, center)}
          fill="none"
          stroke={GRID_STROKE}
        />
      ))}
      {AXES.map((_, i) => {
        const [x, y] = vertex(i, radius, center, center);
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={x.toFixed(2)}
            y2={y.toFixed(2)}
            stroke={GRID_STROKE}
          />
        );
      })}
      <polygon
        points={shapePoints}
        fill={SHAPE_FILL}
        stroke={SHAPE_STROKE}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {values.map((v, i) => {
        const [x, y] = vertex(i, v * radius, center, center);
        return (
          <circle
            key={i}
            cx={x.toFixed(2)}
            cy={y.toFixed(2)}
            r={2.5}
            fill={VERTEX_FILL}
          />
        );
      })}
      {labels &&
        AXES.map(({ key, label }, i) => {
          const [x, y] = vertex(i, labelOffset, center, center);
          return (
            <text
              key={key}
              x={x.toFixed(2)}
              y={y.toFixed(2)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={LABEL_FILL}
              fontSize={10}
            >
              {label}
            </text>
          );
        })}
    </svg>
  );
}
