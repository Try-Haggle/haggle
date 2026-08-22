"use client";

import type { NegotiationAgentPreset } from "@haggle/shared";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { STRATEGY_AXES, strategyAxisValues } from "@/components/agents/StrategyRadar";
import { cn } from "@/lib/cn";
import { SPRING } from "./motion";

/**
 * The strategy matrix, morphing between presets.
 *
 * The static radar redraws instantly when the selection changes, so switching
 * agents looks like nothing happened — the one moment where the product should
 * be saying "these are genuinely different". Interpolating the shape makes the
 * difference legible: you watch price pull out as time pulls in.
 *
 * Implementation note: a single `progress` motion value drives every vertex,
 * rather than one spring per axis. That keeps the hook count fixed regardless
 * of axis count, and guarantees the vertices stay in step with each other.
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface MotionRadarProps {
  preset: NegotiationAgentPreset;
  /** Diameter in px (square). */
  size?: number;
  /** Series colour. Defaults to the preset's accent. */
  color?: string;
  showLabels?: boolean;
  className?: string;
}

export function MotionRadar({
  preset,
  size = 168,
  color,
  showLabels = true,
  className,
}: MotionRadarProps) {
  const reduceMotion = useReducedMotion();
  const target = useMemo(() => strategyAxisValues(preset), [preset]);
  const accent = color ?? preset.accentColor;

  const n = STRATEGY_AXES.length;
  const pad = showLabels ? 22 : 8;
  const r = size / 2 - pad;
  const cx = size / 2;
  const cy = size / 2;

  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const coord = (i: number, radius: number): [number, number] => [
    cx + radius * Math.cos(angleAt(i)),
    cy + radius * Math.sin(angleAt(i)),
  ];

  // Start collapsed at the centre so the first paint draws outward.
  const progress = useMotionValue(0);
  const fromRef = useRef<number[]>(target.map(() => 0));
  const toRef = useRef<number[]>(target);

  useEffect(() => {
    // Re-origin from wherever the shape currently *is*, not from the last
    // target — otherwise interrupting a morph snaps before animating.
    //
    // Both t and the re-origined values are clamped to [0,1]: normalized axis
    // space has no meaning outside it, and without the clamp a spring reading
    // taken mid-overshoot extrapolates past the target — repeated re-origins
    // under a slider drag then compound it until vertices leave the chart.
    const t = clamp01(progress.get());
    fromRef.current = fromRef.current.map((f, i) => {
      const to = toRef.current[i] ?? f;
      return clamp01(f + (to - f) * t);
    });
    toRef.current = target;

    if (reduceMotion) {
      progress.set(1);
      return;
    }
    progress.set(0);
    const controls = animate(progress, 1, SPRING.smooth);
    return () => controls.stop();
  }, [target, progress, reduceMotion]);

  /** Interpolated axis value at the current progress. */
  const valueAt = (i: number, t: number) => {
    const from = fromRef.current[i] ?? 0;
    const to = toRef.current[i] ?? 0;
    return clamp01(from + (to - from) * clamp01(t));
  };

  const seriesPoints = useTransform(progress, (t) =>
    toRef.current.map((_, i) => coord(i, r * valueAt(i, t)).join(",")).join(" "),
  );

  // All eight vertex dots as one path — keeps this to a single motion value
  // instead of sixteen (cx/cy per dot).
  const dotsPath = useTransform(progress, (t) => {
    const dr = 2.5;
    return toRef.current
      .map((_, i) => {
        const [x, y] = coord(i, r * valueAt(i, t));
        return `M ${x - dr},${y} a ${dr},${dr} 0 1,0 ${dr * 2},0 a ${dr},${dr} 0 1,0 ${-dr * 2},0`;
      })
      .join(" ");
  });

  const ringPoints = (radius: number) =>
    STRATEGY_AXES.map((_, i) => coord(i, radius).join(",")).join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("h-auto w-full", className)}
      style={{ maxWidth: size }}
      role="img"
      aria-label={`Strategy matrix for ${preset.copy.buyer.name}`}
    >
      {/* Grid */}
      <g className="text-line" stroke="currentColor" fill="none">
        {[1, 2, 3, 4].map((level) => (
          <polygon key={`ring-${level}`} points={ringPoints((r * level) / 4)} />
        ))}
        {STRATEGY_AXES.map((axis, i) => {
          const [x, y] = coord(i, r);
          return <line key={axis.key} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </g>

      {/* Series */}
      <g style={{ color: accent }}>
        <motion.polygon
          points={seriesPoints}
          fill="currentColor"
          fillOpacity={0.16}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <motion.path d={dotsPath} fill="currentColor" />
      </g>

      {showLabels &&
        STRATEGY_AXES.map((axis, i) => {
          const [x, y] = coord(i, r + 11);
          return (
            <text
              key={axis.key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-ink-muted text-[8.5px]"
            >
              {axis.label}
            </text>
          );
        })}
    </svg>
  );
}
