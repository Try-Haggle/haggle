"use client";

import { useEffect, useState } from "react";
import { adminApi, type InboxSummary } from "@/lib/admin-api";

interface Props {
  /** Optional injected fetcher for tests. Defaults to live API. */
  fetchSummary?: () => Promise<InboxSummary>;
}

const CARD_BASE = "rounded-lg border border-line bg-surface-raised p-4 shadow-sm";

export function SummaryCards({ fetchSummary }: Props = {}) {
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = fetchSummary ?? (() => adminApi.inbox.summary());
    setLoading(true);
    load()
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load summary");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSummary]);

  const tags = summary?.tags.pending ?? 0;
  const disputesOpen = summary?.disputes.open ?? 0;
  const disputesReview = summary?.disputes.underReview ?? 0;
  const disputesWaiting = summary?.disputes.waiting ?? 0;
  const disputes = disputesOpen + disputesReview + disputesWaiting;
  const payments = summary?.payments.failed ?? 0;
  const total = tags + disputes + payments;

  return (
    <section
      aria-label="Inbox summary"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className={CARD_BASE} data-testid="card-total">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Total Open</div>
        <div className="mt-1 text-2xl font-semibold text-ink">{loading ? "…" : total}</div>
      </div>
      <div className={CARD_BASE} data-testid="card-tags">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Tags Pending</div>
        <div className="mt-1 text-2xl font-semibold text-ink">{loading ? "…" : tags}</div>
      </div>
      <div className={CARD_BASE} data-testid="card-disputes">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Disputes Open</div>
        <div className="mt-1 text-2xl font-semibold text-ink">{loading ? "…" : disputes}</div>
      </div>
      <div className={CARD_BASE} data-testid="card-payments">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Payments Flagged</div>
        <div className="mt-1 text-2xl font-semibold text-ink">{loading ? "…" : payments}</div>
      </div>
      {error && (
        <div className="col-span-full text-sm text-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
