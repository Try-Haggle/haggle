"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";

const REASON_CODES = [
  { value: "ITEM_NOT_RECEIVED", label: "Item Not Received" },
  { value: "ITEM_NOT_AS_DESCRIBED", label: "Item Not As Described" },
  { value: "ITEM_DAMAGED", label: "Item Damaged" },
  { value: "UNAUTHORIZED_TRANSACTION", label: "Unauthorized Transaction" },
  { value: "DUPLICATE_CHARGE", label: "Duplicate Charge" },
  { value: "OTHER", label: "Other" },
] as const;

function NewDisputeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [orderId, setOrderId] = useState(searchParams.get("orderId") ?? "");
  const [reasonCode, setReasonCode] = useState<string>(REASON_CODES[0].value);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const oid = searchParams.get("orderId");
    if (oid) setOrderId(oid);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId.trim()) {
      setError("Order ID is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await api.post<{ dispute: { id: string } }>("/disputes", {
        order_id: orderId.trim(),
        reason_code: reasonCode,
        opened_by: "buyer",
        evidence: description.trim()
          ? [
              {
                submitted_by: "buyer",
                type: "text",
                text: description.trim(),
              },
            ]
          : [],
      });
      router.push(`/disputes/${result.dispute.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open dispute");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-xl mx-auto">
      <Link
        href="/buy/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-white mb-1">Report an Issue</h1>
        <p className="text-sm text-slate-400">Open a dispute for a completed order</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-bg-card/50 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Order ID <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. order_abc123"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-700 bg-bg-card px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Reason <span className="text-red-400">*</span>
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-bg-card px-3 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
            >
              {REASON_CODES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Description
            </label>
            <textarea
              rows={4}
              placeholder="Describe what happened in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-bg-card px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none resize-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !orderId.trim()}
            className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Opening dispute..." : "Open Dispute"}
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-500 text-center mt-4">
        Disputes are reviewed within 3–5 business days.
      </p>
    </main>
  );
}

export default function NewDisputePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading...</div>}>
      <NewDisputeForm />
    </Suspense>
  );
}
