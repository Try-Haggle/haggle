import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Categorical rank palette (BRONZE→DIAMOND) — intentional literals with dark variants. */
const RANK: Record<string, string> = {
  BRONZE: "bg-[#f6e3d2] text-[#9a5a2c] dark:bg-[#3a2a1a] dark:text-[#d8a878]",
  SILVER: "bg-[#e9ecf0] text-[#5b6470] dark:bg-[#2a2f37] dark:text-[#b8c0cc]",
  GOLD: "bg-badge text-badge-text",
  PLATINUM: "bg-[#dff0ee] text-[#2f7d77] dark:bg-[#16302e] dark:text-[#7fcfc7]",
  DIAMOND: "bg-[#e3edfb] text-[#2f6bd6] dark:bg-[#162540] dark:text-[#8fb6ee]",
};

/** Categorical rarity palette (COMMON→MYTHIC). */
const RARITY: Record<string, string> = {
  COMMON: "bg-surface-sunken text-ink-muted",
  UNCOMMON: "bg-success-soft text-success",
  RARE: "bg-info-soft text-info",
  EPIC: "bg-[#efe6fb] text-[#7c3aed] dark:bg-[#241a3a] dark:text-[#b794f6]",
  LEGENDARY: "bg-warning-soft text-warning",
  MYTHIC: "bg-error-soft text-error",
};

export interface TierBadgeProps {
  tier: string;
  palette?: "rank" | "rarity";
  size?: "sm" | "md";
  className?: string;
  /** Override the rendered content (e.g. add a star prefix); palette still derives from `tier`. */
  children?: ReactNode;
}

export function TierBadge({
  tier,
  palette = "rank",
  size = "md",
  className,
  children,
}: TierBadgeProps) {
  const map = palette === "rank" ? RANK : RARITY;
  const tone = map[tier.toUpperCase()] ?? "bg-surface-sunken text-ink-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wide",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        tone,
        className,
      )}
    >
      {children ?? tier}
    </span>
  );
}
