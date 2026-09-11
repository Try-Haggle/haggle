"use client";

import { Alert, Badge } from "@/components/ui";
import { useCreditBalance } from "@/hooks/use-credit-balance";
import { CREDIT_BALANCE_UI, creditBalanceShortLabel } from "@/lib/credit-balance";

/**
 * Settings Soft AI credit balance (credit-ledger-sot.md §6 — balance display).
 * Wires to GET /credits/balance when C1 is present; otherwise stub tolerance.
 */
export function CreditBalanceSettings() {
  const balance = useCreditBalance();

  return (
    <section
      data-testid="credit-balance-settings"
      data-source={balance.source}
      className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6"
    >
      <h2 className="text-base sm:text-lg font-semibold text-ink mb-1">
        {CREDIT_BALANCE_UI.sectionTitle}
      </h2>
      <p className="text-sm text-ink-muted mb-4">
        Soft AI credits meter Haggle-hosted Soft turns only. Hard Authority, fees, and settlement
        are unchanged. Server ledger is source of truth — this UI does not invent credit math.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink" data-testid="credit-balance-settings-label">
            {balance.loading ? CREDIT_BALANCE_UI.loadingLabel : creditBalanceShortLabel(balance)}
          </p>
          <p className="text-xs text-ink-muted">
            {balance.unlimited
              ? CREDIT_BALANCE_UI.unlimitedLabel
              : "Shown for Soft AI start and Auto ON charges."}
          </p>
        </div>
        <Badge
          tone={balance.source === "api" ? "info" : "neutral"}
          size="sm"
          data-testid="credit-balance-settings-badge"
        >
          {balance.loading ? "…" : balance.balance != null ? String(balance.balance) : "—"}
        </Badge>
      </div>

      {balance.source === "stub" && !balance.loading && (
        <Alert tone="info" className="mt-3 text-sm" data-testid="credit-balance-settings-stub">
          {CREDIT_BALANCE_UI.stubNote}. Surfaces: Settings + negotiation chrome; insufficient gate
          at start / Auto ON (see docs/wip/credit-ledger-sot.md §6).
        </Alert>
      )}
      {balance.error && (
        <Alert tone="error" className="mt-3 text-sm">
          {balance.error}
        </Alert>
      )}
    </section>
  );
}
