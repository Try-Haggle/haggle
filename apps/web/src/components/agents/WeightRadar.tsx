"use client";

import type { NegotiationWeights } from "@haggle/shared";

interface WeightRadarProps {
  weights: NegotiationWeights;
  /** Diameter in px (square). */
  size?: number;
  /** Show P/T/R/S labels around vertices. */
  labels?: boolean;
  className?: string;
}

// Chart data-series hues (cyan) are intentional and preserved literally.
const SHAPE_FILL = "rgba(6,182,212,0.18)";
const SHAPE_STROKE = "rgba(6,182,212,0.85)";
const VERTEX_FILL = "#06b6d4";
// Incidental chart chrome (grid lines + axis labels) follows the token system.
const GRID_STROKE = "var(--border-subtle)";
const LABEL_FILL = "var(--text-muted)";

const AXES = [
  { key: "w_p", label: "P" },
  { key: "w_t", label: "T" },
  { key: "w_r", label: "R" },
  { key: "w_s", label: "S" },
] as const;

// Weights sum to 1.0; the dominant one tops out around 0.5. Scale so the
// dominant weight fills the radar visually.
const SCALE = 2.0;

function vertex(i: number, r: number, cx: number, cy: number): [number, number] {
  const angle = (Math.PI * 2 * i) / 4 - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function diamond(r: number, cx: number, cy: number): string {
  return Array.from({ length: 4 }, (_, i) => {
    const [x, y] = vertex(i, r, cx, cy);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function WeightRadar({ weights, size = 88, labels = false, className }: WeightRadarProps) {
  const center = size / 2;
  const radius = size / 2 - (labels ? 16 : 6);
  const labelOffset = radius + 10;

  const values = AXES.map(({ key }) => Math.min(weights[key] * SCALE, 1));

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
      aria-label="Negotiation weights radar"
    >
      {[0.25, 0.5, 0.75, 1.0].map((level) => (
        <polygon
          key={level}
          points={diamond(level * radius, center, center)}
          fill="none"
          stroke={GRID_STROKE}
        />
      ))}
      {AXES.map((axis, i) => {
        const [x, y] = vertex(i, radius, center, center);
        return (
          <line
            key={axis.key}
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
            key={AXES[i].key}
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
              fontSize={9}
            >
              {label}
            </text>
          );
        })}
    </svg>
  );
}
