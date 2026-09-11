import { cn } from "@/lib/cn";

export interface PublicTrustSummary {
  score: number | null;
  status: "NEW" | "SCORING" | "MATURE";
  completedTransactions: number;
}

/**
 * Compact seller-trust line for listing-detail v2 and browse cards.
 * Numbers are the signal; no color-only meaning, no rawInputs.
 */
export function TrustScoreChip({
  trust,
  className,
}: {
  trust: PublicTrustSummary | null | undefined;
  className?: string;
}) {
  if (!trust) return null;
  const scoreLabel = trust.score == null ? "New" : String(Math.round(trust.score));
  const deals = trust.completedTransactions;
  return (
    <p className={cn("text-ink-muted text-xs", className)}>
      Trust {scoreLabel}
      {deals > 0 ? ` · ${deals} deals` : ""}
    </p>
  );
}
