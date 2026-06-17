/**
 * Strategy Matrix radar — 8 axes (4 weights + 4 behavior curves).
 * Each axis has its own envelope and is normalized to [0, 1] for the polygon.
 *
 * Order, clockwise from 12 o'clock: P · T · R · S · α · β · uT · uA
 */
import type { NegotiationAgentPreset } from "@haggle/shared";

interface RadarChartProps {
  preset: NegotiationAgentPreset;
  /** Show short axis labels (P/T/R/S/α/β/uT/uA) around vertices. */
  labels?: boolean;
  /** Diameter in px. Default 250. */
  size?: number;
}

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

function vertex(i: number, r: number, cx: number, cy: number): [number, number] {
  const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function octagon(r: number, cx: number, cy: number): string {
  return Array.from({ length: 8 }, (_, i) => {
    const [x, y] = vertex(i, r, cx, cy);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];

export default function RadarChart({ preset, labels = false, size = 250 }: RadarChartProps) {
  const center = size / 2;
  const labelMargin = labels ? 24 : 8;
  const radius = size / 2 - labelMargin;
  const labelOffset = radius + 14;

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
      style={{ display: "block", width: "100%", maxWidth: size }}
      role="img"
      aria-label="Strategy matrix radar"
    >
      {GRID_LEVELS.map((level) => (
        <polygon
          key={level}
          points={octagon(level * radius, center, center)}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
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
            stroke="rgba(148,163,184,0.18)"
          />
        );
      })}
      <polygon
        points={shapePoints}
        fill="rgba(6,182,212,0.18)"
        stroke="rgba(6,182,212,0.85)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {values.map((v, i) => {
        const [x, y] = vertex(i, v * radius, center, center);
        return (
          <circle key={AXES[i].key} cx={x.toFixed(2)} cy={y.toFixed(2)} r={2.5} fill="#06b6d4" />
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
              fill="#94a3b8"
              fontSize={10}
            >
              {label}
            </text>
          );
        })}
    </svg>
  );
}
