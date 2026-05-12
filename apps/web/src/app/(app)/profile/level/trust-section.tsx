"use client";

import { useEffect, useState } from "react";
import { TrustCard, TrustCardSkeleton } from "@/components/trust-card";
import { useTrustCard } from "@/hooks/use-trust-card";
import {
  fetchPenaltyHistory,
  type PenaltyHistoryItem,
} from "@/lib/profile-card-api";

const REASON_LABEL: Record<string, string> = {
  BUYER_APPROVED_BUT_NOT_PAID: "Approved but did not pay",
  SELLER_APPROVED_BUT_NOT_FULFILLED: "Approved but did not fulfill",
  SHIPMENT_INFO_SLA_MISSED: "Shipment info SLA missed",
  DISPUTE_LOSS: "Lost dispute",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function TrustSection({ userId }: { userId: string }) {
  const { data, loading } = useTrustCard(userId, { role: "combined" });
  const [history, setHistory] = useState<PenaltyHistoryItem[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    fetchPenaltyHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-white">Your trust profile</h2>
      <p className="mb-4 text-sm text-slate-400">
        How buyers and sellers see you across Haggle. Score updates after each
        completed transaction or resolved dispute.
      </p>

      {loading ? (
        <TrustCardSkeleton variant="full" />
      ) : data ? (
        <TrustCard data={data} variant="full" />
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-500">
          Trust info unavailable.
        </div>
      )}

      {/* Penalty history */}
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/30">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-900/50"
        >
          <div>
            <p className="text-sm font-medium text-slate-200">Score history</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {history === null
                ? "Loading…"
                : history.length === 0
                  ? "No penalties on record"
                  : `${history.length} event${history.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-slate-500 transition-transform ${historyOpen ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {historyOpen && history && history.length > 0 && (
          <ul className="divide-y divide-slate-800 border-t border-slate-800">
            {history.map((item) => (
              <li key={item.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <p className="text-slate-200">
                    {REASON_LABEL[item.reason] ?? item.reason}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(item.createdAt)}
                  </p>
                </div>
                <span className="font-mono text-xs text-rose-400">
                  −{item.penaltyScore.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
