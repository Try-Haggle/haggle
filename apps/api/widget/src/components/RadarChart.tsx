import { useState, useEffect, useRef } from "react";
import type { AgentStats } from "../agentPresets";
import { RADAR_LABELS } from "../agentPresets";

interface RadarChartProps {
  stats: AgentStats;
}

const STAT_KEYS: (keyof AgentStats)[] = [
  "priceAggression",
  "patienceLevel",
  "riskTolerance",
  "speedBias",
  "detailFocus",
];

const SIZE = 250;
const CENTER = SIZE / 2;
const RADIUS = 85;
const LABEL_OFFSET = 24;
const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];

/** Get (x, y) for vertex i at a given distance from center. */
function vertex(i: number, r: number): [number, number] {
  const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

/** Build an SVG polygon points string. */
function polygonPoints(values: number[]): string {
  return values
    .map((v, i) => {
      const [x, y] = vertex(i, (v / 100) * RADIUS);
      return `${x},${y}`;
    })
    .join(" ");
}

function gridPolygon(level: number): string {
  return Array.from({ length: 5 }, (_, i) => {
    const [x, y] = vertex(i, level * RADIUS);
    return `${x},${y}`;
  }).join(" ");
}

export default function RadarChart({ stats }: RadarChartProps) {
  const [display, setDisplay] = useState<number[]>(
    STAT_KEYS.map((k) => stats[k]),
  );
  const currentRef = useRef<number[]>(STAT_KEYS.map((k) => stats[k]));
  const animRef = useRef<number>(0);

  useEffect(() => {
    const target = STAT_KEYS.map((k) => stats[k]);
    const from = [...currentRef.current];
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / 600, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      const next = from.map((f, i) => f + (target[i] - f) * ease);
      currentRef.current = next;
      setDisplay(next);

      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [stats]);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="radar-chart"
      role="img"
      aria-label="Strategy matrix radar chart"
    >
      {/* Background grid pentagons */}
      {GRID_LEVELS.map((level) => (
        <polygon
          key={level}
          points={gridPolygon(level)}
          fill="none"
          stroke="rgba(148, 163, 184, 0.3)"
          strokeWidth="1"
        />
      ))}

      {/* Axis lines from center to each vertex */}
      {Array.from({ length: 5 }, (_, i) => {
        const [x, y] = vertex(i, RADIUS);
        return (
          <line
            key={i}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="1"
          />
        );
      })}

      {/* Data polygon (filled area) */}
      <polygon
        points={polygonPoints(display)}
        fill="rgba(6, 182, 212, 0.12)"
        stroke="rgba(6, 182, 212, 0.7)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Data vertex dots */}
      {display.map((v, i) => {
        const [x, y] = vertex(i, (v / 100) * RADIUS);
        return <circle key={i} cx={x} cy={y} r="3.5" fill="#06b6d4" />;
      })}

      {/* Axis labels */}
      {RADAR_LABELS.map((label, i) => {
        const [x, y] = vertex(i, RADIUS + LABEL_OFFSET);
        return (
          <text
            key={label}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--text-secondary)"
            fontSize="11"
            fontFamily="inherit"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
