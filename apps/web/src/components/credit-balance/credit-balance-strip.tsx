"use client";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  CREDIT_BALANCE_UI,
  type CreditBalanceState,
  creditBalanceShortLabel,
} from "@/lib/credit-balance";

export interface CreditBalanceStripProps {
  state: CreditBalanceState;
  loading?: boolean;
  className?: string;
}

/**
 * CU-ready Soft credit balance strip for negotiation chrome (SoT §6).
 * Server balance only — stub shows "—" with clear tolerance, never fake math.
 */
export function CreditBalanceStrip({ state, loading = false, className }: CreditBalanceStripProps) {
  const label = loading ? CREDIT_BALANCE_UI.loadingLabel : creditBalanceShortLabel(state);
  const stubbed = !loading && state.source === "stub";

  return (
    <div
      data-testid="credit-balance-strip"
      data-source={state.source}
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 text-xs sm:text-[13px]",
        className,
      )}
    >
      <span className="font-semibold text-ink-secondary tracking-wide uppercase text-[10px]">
        {CREDIT_BALANCE_UI.stripLabel}
      </span>
      <Badge
        tone={stubbed ? "neutral" : state.unlimited ? "info" : "neutral"}
        size="sm"
        data-testid="credit-balance-value"
        aria-label={label}
      >
        {label}
      </Badge>
      {state.unlimited && (
        <span className="text-ink-muted" data-testid="credit-balance-unlimited">
          {CREDIT_BALANCE_UI.unlimitedLabel}
        </span>
      )}
      {stubbed && (
        <span className="text-ink-muted" data-testid="credit-balance-stub">
          {CREDIT_BALANCE_UI.stubNote}
        </span>
      )}
    </div>
  );
}
