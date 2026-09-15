"use client";

import { cn } from "@/lib/cn";
import {
  CREDIT_BALANCE_UI,
  type CreditBalanceState,
  creditBalanceShortLabel,
} from "@/lib/credit-balance";

export interface CreditBalanceChipProps {
  state: CreditBalanceState;
  loading?: boolean;
  className?: string;
}

/**
 * Compact Haggle credits chip for profile-adjacent chrome.
 * Server balance only — stub shows "—" without inventing math.
 */
export function CreditBalanceChip({ state, loading = false, className }: CreditBalanceChipProps) {
  const label = loading ? CREDIT_BALANCE_UI.loadingLabel : creditBalanceShortLabel(state);
  const display =
    loading || state.source === "stub" || state.balance == null
      ? "—"
      : state.unlimited
        ? "∞"
        : String(state.balance);

  return (
    <span
      data-testid="credit-balance-chip"
      data-source={state.source}
      role="status"
      aria-live="polite"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-secondary",
        className,
      )}
    >
      <span className="truncate text-ink-muted">{CREDIT_BALANCE_UI.stripLabel}</span>
      <span data-testid="credit-balance-chip-value" className="tabular-nums text-ink">
        {display}
      </span>
    </span>
  );
}
