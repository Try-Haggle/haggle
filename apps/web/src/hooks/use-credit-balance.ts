"use client";

import { useCallback, useEffect, useState } from "react";
import { type CreditBalanceState, fetchCreditBalance } from "@/lib/credit-balance";

const INITIAL: CreditBalanceState = {
  source: "stub",
  balance: null,
  unlimited: false,
  accountId: null,
  reason: "CREDIT_BALANCE_LOADING",
};

/**
 * Soft AI credit balance for Settings + negotiation chrome (SoT §6).
 * Reloads on demand after start / Auto-ON attempts so insufficient UX can refresh.
 */
export function useCreditBalance(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const [state, setState] = useState<CreditBalanceState>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchCreditBalance();
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Soft credits.");
      setState({
        source: "stub",
        balance: null,
        unlimited: false,
        accountId: null,
        reason: "CREDIT_BALANCE_FETCH_ERROR",
      });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, loading, error, reload };
}
