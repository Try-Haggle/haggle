import { cn } from "@/lib/cn";

export interface ProgressRingProps {
  /** Steps completed. */
  value: number;
  /** Total steps. */
  max: number;
  /** What is being tracked, for screen readers ("Get started progress"). */
  label: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

const STROKE = 5;

/**
 * A small step counter drawn as a ring — "1/3" in the middle, the arc filling
 * in emerald. Stands in for a "1 of 3 done" label, so it carries that text for
 * assistive tech as a progressbar.
 */
export function ProgressRing({ value, max, label, size = 44, className }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(value, max));
  const r = (40 - STROKE) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped} of ${max} done`}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-surface-sunken"
        />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / max)}
          className="stroke-success-500 transition-[stroke-dashoffset] duration-500 ease-standard motion-reduce:transition-none"
        />
      </svg>
      <span
        className="absolute font-bold text-ink text-xs tabular-nums tracking-tight"
        aria-hidden="true"
      >
        {clamped}/{max}
      </span>
    </div>
  );
}
