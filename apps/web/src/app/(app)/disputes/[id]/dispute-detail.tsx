"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { Dispute, DisputeEvidence } from "./page";

const EVIDENCE_TYPES = [
  { value: "text", label: "Text Description" },
  { value: "image", label: "Image" },
  { value: "tracking_snapshot", label: "Tracking Snapshot" },
  { value: "payment_proof", label: "Payment Proof" },
  { value: "other", label: "Other" },
] as const;

function statusBadge(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    OPEN: { label: "Open", color: "text-amber-400 bg-amber-500/10" },
    UNDER_REVIEW: { label: "Under Review", color: "text-cyan-400 bg-cyan-500/10" },
    AWAITING_BUYER_EVIDENCE: { label: "Awaiting Your Evidence", color: "text-purple-400 bg-purple-500/10" },
    AWAITING_SELLER_EVIDENCE: { label: "Awaiting Seller Evidence", color: "text-purple-400 bg-purple-500/10" },
    ESCALATED: { label: "Escalated", color: "text-orange-400 bg-orange-500/10" },
    RESOLVED: { label: "Resolved", color: "text-emerald-400 bg-emerald-500/10" },
    CLOSED: { label: "Closed", color: "text-slate-400 bg-slate-800" },
  };
  return map[status] ?? { label: status, color: "text-slate-400 bg-slate-800" };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EvidenceItem({ evidence }: { evidence: DisputeEvidence }) {
  const typeLabel = EVIDENCE_TYPES.find((t) => t.value === evidence.type)?.label ?? evidence.type;
  return (
    <div className="rounded-lg border border-slate-800 bg-bg-card/30 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-slate-300">{typeLabel}</span>
        <span className="text-xs text-slate-500">by {evidence.submitted_by}</span>
        <span className="ml-auto text-xs text-slate-600">{formatDate(evidence.submitted_at)}</span>
      </div>
      {evidence.text && (
        <p className="text-sm text-slate-300 mt-1">{evidence.text}</p>
      )}
      {evidence.uri && (
        <a
          href={evidence.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cyan-400 hover:text-cyan-300 mt-1 inline-block break-all"
        >
          View attachment
        </a>
      )}
    </div>
  );
}

export function DisputeDetail({
  dispute: initialDispute,
  userId: _userId,
}: {
  dispute: Dispute;
  userId: string;
}) {
  const [dispute, setDispute] = useState<Dispute>(initialDispute);
  const [evidenceType, setEvidenceType] = useState<"text" | "image" | "tracking_snapshot" | "payment_proof" | "other">("text");
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const badge = statusBadge(dispute.status);
  const isResolved = dispute.status === "RESOLVED" || dispute.status === "CLOSED";

  async function handleSubmitEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!evidenceText && !evidenceUri) {
      setError("Provide either a text description or a URI");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await api.post<{ dispute: Dispute }>(`/disputes/${dispute.id}/evidence`, {
        submitted_by: "buyer",
        type: evidenceType,
        ...(evidenceText ? { text: evidenceText } : {}),
        ...(evidenceUri ? { uri: evidenceUri } : {}),
      });
      setDispute(result.dispute);
      setEvidenceText("");
      setEvidenceUri("");
      setSuccess("Evidence submitted successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit evidence");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      <Link
        href="/buy/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">Dispute</h1>
          <p className="text-xs text-slate-500 font-mono">{dispute.id}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3">
          <p className="text-xs text-slate-500 mb-1">Order ID</p>
          <p className="text-sm text-white font-mono truncate">{dispute.order_id}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3">
          <p className="text-xs text-slate-500 mb-1">Reason</p>
          <p className="text-sm text-white">{dispute.reason_code.replace(/_/g, " ")}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3">
          <p className="text-xs text-slate-500 mb-1">Opened By</p>
          <p className="text-sm text-white capitalize">{dispute.opened_by}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3">
          <p className="text-xs text-slate-500 mb-1">Created</p>
          <p className="text-sm text-white">{formatDate(dispute.created_at)}</p>
        </div>
      </div>

      {/* Evidence list */}
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-sm font-semibold text-white">Evidence</span>
          <span className="ml-auto text-xs text-slate-500">{dispute.evidence.length} item{dispute.evidence.length !== 1 ? "s" : ""}</span>
        </div>

        {dispute.evidence.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No evidence submitted yet.
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {dispute.evidence.map((ev, i) => (
              <EvidenceItem key={ev.id ?? i} evidence={ev} />
            ))}
          </div>
        )}
      </div>

      {/* Submit evidence form */}
      {!isResolved && (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-800">
            <span className="text-sm font-semibold text-white">Submit Evidence</span>
          </div>
          <form onSubmit={handleSubmitEvidence} className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Evidence Type</label>
              <select
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value as typeof evidenceType)}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                {EVIDENCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
              <textarea
                rows={3}
                placeholder="Describe the issue in detail..."
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Attachment URL (optional)</label>
              <input
                type="url"
                placeholder="https://..."
                value={evidenceUri}
                onChange={(e) => setEvidenceUri(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-bg-card px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Evidence"}
            </button>
          </form>
        </div>
      )}

      {isResolved && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
          <p className="text-sm font-medium text-emerald-400">This dispute has been {dispute.status.toLowerCase()}.</p>
        </div>
      )}
    </main>
  );
}
