"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TrustCardData } from "@/lib/profile-card-api";

interface TrustCardPopoverProps {
  data: TrustCardData;
  onClose: () => void;
}

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function rating(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}/5`;
}

function colorFor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-rose-400";
}

export function TrustCardPopover({ data, onClose }: TrustCardPopoverProps) {
  // Mount-guard for SSR — createPortal needs document.body which only exists client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Esc to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const { status, score, completedDeals, displayName, components, signals, disputeMarker } = data;
  const isNew = status === "NEW" || score === null;

  if (!mounted) return null;

  // Render via portal at document.body so no ancestor `transform`/`filter`/etc
  // can hijack our `position: fixed` containing block — backdrop reliably
  // covers the entire viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} trust details`}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — modal title + close */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white">User Profile Card</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Dispute marker callout */}
        {disputeMarker.show && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
            <p className="font-medium">⚠ {disputeMarker.activeCount} open dispute{disputeMarker.activeCount === 1 ? "" : "s"}</p>
            {disputeMarker.recentRatio !== null && (
              <p className="mt-0.5 text-amber-400/80">
                {Math.round(disputeMarker.recentRatio * 100)}% of recent transactions involved a dispute.
              </p>
            )}
          </div>
        )}

        {/* Identity rows — key:value for Name/Status (who they are) */}
        <div className="mb-4 space-y-2 text-sm">
          <IdentityRow label="Name" value={<span className="text-slate-200">{displayName}</span>} />
          <IdentityRow
            label="Status"
            value={
              isNew ? (
                <StatusPill label="New" tone="new" />
              ) : (
                <StatusPill
                  label={String(score)}
                  tone={
                    score !== null && score >= 75
                      ? "good"
                      : score !== null && score >= 40
                        ? "warn"
                        : "bad"
                  }
                />
              )
            }
          />
        </div>

        {/* Signal chips — activity data about the user */}
        <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
          <SignalChip
            label="Email"
            value={signals.emailVerified ? "Verified" : "Unverified"}
            tone={signals.emailVerified ? "good" : "default"}
          />
          <SignalChip
            label="Wallet"
            value={signals.walletVerified ? "Connected" : "Not connected"}
            tone={signals.walletVerified ? "good" : "default"}
          />
          <SignalChip label="Active listings" value={String(signals.activeListings)} />
          <SignalChip
            label="Avg response"
            value={
              signals.avgResponseMinutes !== null
                ? signals.avgResponseMinutes < 60
                  ? `~${signals.avgResponseMinutes}m`
                  : `~${Math.round(signals.avgResponseMinutes / 60)}h`
                : "No data yet"
            }
          />
        </div>

        {/* Components — non-NEW only */}
        {!isNew && components && (
          <div className="mb-4 border-t border-slate-800 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Score breakdown
            </p>
            <dl className="space-y-2 text-sm">
              <Row label="Completion rate" value={pct(components.completionRate)} />
              <Row
                label="Dispute rate"
                value={pct(components.disputeRate)}
                note="lower is better"
              />
              {components.slaCompliance !== null && (
                <Row label="SLA compliance" value={pct(components.slaCompliance)} />
              )}
              {components.peerRating !== null && (
                <Row label="Peer rating" value={rating(components.peerRating)} />
              )}
            </dl>
          </div>
        )}

      </div>
    </div>,
    document.body,
  );
}

function IdentityRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="min-w-0 flex-1 truncate font-medium">{value}</div>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "new" | "good" | "warn" | "bad";
}) {
  const styles =
    tone === "new"
      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
      : tone === "good"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        : tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
          : "border-rose-500/30 bg-rose-500/10 text-rose-400";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles}`}
    >
      {label}
    </span>
  );
}

function SignalChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad" | "new";
}) {
  // Semantic tones for value text. "default" matches surrounding chips so the
  // grid reads uniformly — accents are reserved for status meaning.
  const valueColor =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-rose-400"
          : tone === "new"
            ? "text-cyan-400"
            : "text-slate-200";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2">
      <p className="text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-400">
        {label}
        {note && <span className="ml-1.5 text-xs text-slate-600">({note})</span>}
      </span>
      <span className="font-semibold text-slate-100">{value}</span>
    </div>
  );
}
