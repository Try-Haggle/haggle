"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Time left before the seller's deadline.
 *
 * The page computed this once at render, which produced a string that looked
 * live and wasn't — "3d 5h remaining" sat there unchanged for an hour. Either
 * it ticks or it shouldn't imply urgency, so it ticks.
 */

interface CountdownProps {
  /** ISO timestamp. */
  deadline: string;
  className?: string;
}

/** Under this, the deadline is close enough to warrant a warning tone. */
const URGENT_MS = 24 * 3_600_000;

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function remainingFrom(deadline: string): Remaining {
  const total = Math.max(0, new Date(deadline).getTime() - Date.now());
  return {
    days: Math.floor(total / 86_400_000),
    hours: Math.floor((total % 86_400_000) / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
    total,
  };
}

export function Countdown({ deadline, className }: CountdownProps) {
  const reduceMotion = useReducedMotion();
  // Null until mounted: the server has a different `now` than the client, and
  // rendering a time on both sides guarantees a hydration mismatch.
  const [left, setLeft] = useState<Remaining | null>(null);

  useEffect(() => {
    setLeft(remainingFrom(deadline));
    const timer = window.setInterval(() => setLeft(remainingFrom(deadline)), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  if (!left) {
    return <span className={className} aria-hidden="true" />;
  }

  if (left.total === 0) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-medium text-[12px] text-ink-muted ${className ?? ""}`}
      >
        <Clock className="size-3.5" aria-hidden="true" />
        Listing expired
      </span>
    );
  }

  const urgent = left.total < URGENT_MS;
  // Seconds only matter once the number is small enough to watch.
  const showSeconds = left.total < 3_600_000;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium text-[12px] ${
        urgent ? "text-warning" : "text-ink-secondary"
      } ${className ?? ""}`}
    >
      <motion.span
        className="flex"
        animate={urgent && !reduceMotion ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
        transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        aria-hidden="true"
      >
        <Clock className="size-3.5" />
      </motion.span>
      <span className="tabular-nums">
        {left.days > 0 && `${left.days}d `}
        {(left.days > 0 || left.hours > 0) && `${left.hours}h `}
        {`${left.minutes}m`}
        {showSeconds && ` ${String(left.seconds).padStart(2, "0")}s`}
      </span>
      <span className="text-ink-muted">left</span>
    </span>
  );
}
