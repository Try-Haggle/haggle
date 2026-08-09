"use client";

import { motion } from "framer-motion";

interface ThinkingDotsProps {
  color?: string;
  label?: string;
}

export function ThinkingDots({ color = "var(--text-secondary)", label }: ThinkingDotsProps) {
  return (
    // Announced, not just animated: without a label this is three moving dots and
    // nothing else — a screen reader gets silence, and the state is unassertable.
    <div
      role="status"
      aria-label={label ?? "Waiting for the next round"}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ background: "var(--bg-sunken)", border: "1px solid var(--border-default)" }}
    >
      {label && (
        <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      )}
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.15,
            }}
          />
        ))}
      </span>
    </div>
  );
}
