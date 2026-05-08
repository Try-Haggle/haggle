"use client";

import { motion } from "framer-motion";

interface ThinkingDotsProps {
  color?: string;
  label?: string;
}

export function ThinkingDots({ color = "#94a3b8", label }: ThinkingDotsProps) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ background: "#0f172a", border: "1px solid #1e293b" }}
    >
      {label && (
        <span className="text-[11px] font-medium" style={{ color: "#94a3b8" }}>
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
