import { cn } from "@/lib/cn";

export interface RadarAxis {
  key: string;
  label?: string;
  /** 0..max */
  value: number;
}

export interface RadarProps {
  axes: RadarAxis[];
  size?: number;
  max?: number;
  levels?: number;
  showLabels?: boolean;
  /** Series color (CSS color). Defaults to the brand action color. */
  color?: string;
  /** When set, the chart is exposed as an accessible `img` with this label;
   *  otherwise it is `aria-hidden` (decorative). */
  ariaLabel?: string;
  className?: string;
}

/** Generic radar/spider chart for any axis count. Theme-aware via currentColor on grid/series. */
export function Radar({
  axes,
  size = 180,
  max = 1,
  levels = 4,
  showLabels = true,
  color,
  ariaLabel,
  className,
}: RadarProps) {
  const pad = showLabels ? 28 : 8;
  const r = size / 2 - pad;
  const cx = size / 2;
  const cy = size / 2;
  const n = axes.length;
  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const coord = (i: number, radius: number): [number, number] => [
    cx + radius * Math.cos(angleAt(i)),
    cy + radius * Math.sin(angleAt(i)),
  ];
  const points = (radius: (i: number) => number) =>
    axes.map((_, i) => coord(i, radius(i)).join(",")).join(" ");

  const valueRadius = (i: number) => r * Math.max(0, Math.min(1, (axes[i].value ?? 0) / max));

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("h-auto w-full", className)}
      style={{ maxWidth: size }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <g className="text-line" stroke="currentColor" fill="none">
        {Array.from({ length: levels }, (_, l) => l + 1).map((level) => (
          <polygon key={`ring-${level}`} points={points(() => (r * level) / levels)} />
        ))}
        {axes.map((a, i) => {
          const [x, y] = coord(i, r);
          return <line key={a.key} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </g>

      <g style={color ? { color } : undefined} className={cn(!color && "text-action-primary")}>
        <polygon
          points={points(valueRadius)}
          fill="currentColor"
          fillOpacity={0.18}
          stroke="currentColor"
          strokeWidth={2}
        />
        {axes.map((a, i) => {
          const [x, y] = coord(i, valueRadius(i));
          return <circle key={a.key} cx={x} cy={y} r={2.5} fill="currentColor" />;
        })}
      </g>

      {showLabels &&
        axes.map((a, i) => {
          const [x, y] = coord(i, r + 12);
          return (
            <text
              key={a.key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-ink-muted text-[9px]"
            >
              {a.label ?? a.key}
            </text>
          );
        })}
    </svg>
  );
}
