"use client";

import { useState } from "react";
import type { TrustCardData } from "@/lib/profile-card-api";
import { TrustCardPopover } from "./trust-card-popover";

export type TrustCardVariant = "compact" | "inline" | "full";

interface TrustCardProps {
  data: TrustCardData;
  variant: TrustCardVariant;
  className?: string;
}

// ── Color thresholds ─────────────────────────────────────────────
// Numbers are the source of truth; color is a categorical assist
// (≥75 emerald, 40–74 amber, <40 rose). Always paired with a number
// for accessibility — no color-only signals.

function scoreColor(score: number): {
  text: string;
  stroke: string;
  fill: string;
} {
  if (score >= 75)
    return {
      text: "text-emerald-400",
      stroke: "stroke-emerald-400",
      fill: "fill-emerald-400",
    };
  if (score >= 40)
    return {
      text: "text-amber-400",
      stroke: "stroke-amber-400",
      fill: "fill-amber-400",
    };
  return {
    text: "text-rose-400",
    stroke: "stroke-rose-400",
    fill: "fill-rose-400",
  };
}

function summaryLabel(score: number): string {
  if (score >= 75) return "Trustworthy seller";
  if (score >= 40) return "Building reputation";
  return "Caution advised";
}

function joinedAgo(joinedAt: string): string {
  const diff = Date.now() - new Date(joinedAt).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 7) return `Joined ${days || 1}d ago`;
  if (days < 30) return `Joined ${Math.floor(days / 7)}w ago`;
  if (days < 365) return `Joined ${Math.floor(days / 30)}mo ago`;
  const years = Math.floor(days / 365);
  return `Joined ${years}y ago`;
}

function formatResponseTime(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `~${minutes}m response`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `~${hours}h response`;
  return `~${Math.round(hours / 24)}d response`;
}

// ── Donut Gauge ──────────────────────────────────────────────────

function DonutGauge({
  score,
  size,
  strokeWidth,
}: {
  score: number;
  size: number;
  strokeWidth: number;
}) {
  const colors = scoreColor(score);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Trust score ${score} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-slate-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={`fill-none ${colors.stroke} transition-[stroke-dashoffset] duration-700 ease-out`}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      <span
        className={`absolute font-semibold ${colors.text}`}
        style={{ fontSize: size * 0.35 }}
      >
        {score}
      </span>
    </div>
  );
}

// ── Compact (24-28px) — grid card slot ──────────────────────────

function CompactCard({ data, className }: { data: TrustCardData; className?: string }) {
  const { status, score, completedDeals, disputeMarker } = data;

  if (status === "NEW" || score === null) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs text-cyan-400 ${className ?? ""}`}
        aria-label="New seller"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
        New seller
      </span>
    );
  }

  const colors = scoreColor(score);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${className ?? ""}`}
      aria-label={`Trust score ${score}, ${completedDeals} completed deals`}
    >
      {disputeMarker.show ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-amber-400"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ) : (
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors.fill.replace("fill-", "bg-")}`} />
      )}
      <span className={`font-semibold ${colors.text}`}>{score}</span>
      <span className="text-slate-500">·</span>
      <span className="text-slate-400">{completedDeals}</span>
    </span>
  );
}

// ── Inline — listing detail / negotiation header ────────────────

function InlineCard({
  data,
  className,
}: {
  data: TrustCardData;
  className?: string;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { status, score, completedDeals, displayName, joinedAt, disputeMarker, signals } = data;
  const isNew = status === "NEW" || score === null;
  const colors = isNew ? null : scoreColor(score);
  const responseLine = formatResponseTime(signals.avgResponseMinutes);

  return (
    <>
      <button
        type="button"
        onClick={() => setPopoverOpen(true)}
        className={`group block w-full cursor-pointer rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-left transition-colors hover:border-slate-700 sm:p-4 ${className ?? ""}`}
        aria-label={
          isNew
            ? `New seller ${displayName}`
            : `${displayName} — trust score ${score}, ${completedDeals} deals`
        }
      >
        <div className="flex items-center gap-3">
          {isNew ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-semibold text-cyan-400">
              NEW
            </div>
          ) : (
            <DonutGauge score={score!} size={40} strokeWidth={4} />
          )}

          <div className="min-w-0 flex-1">
            {/* Main text: for MATURE the trust state label, for NEW the seller name
                (the left circle already conveys NEW status — avoid redundancy). */}
            <div className="flex items-center gap-2">
              <p
                className={`truncate text-sm font-medium ${
                  isNew ? "text-slate-200" : colors!.text
                }`}
              >
                {isNew ? displayName : summaryLabel(score!)}
              </p>
              {!isNew && (
                <span className="shrink-0 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                  {completedDeals} deals
                </span>
              )}
            </div>
            {/* Meta line: identity + tenure for MATURE; tenure + response for NEW. */}
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              {!isNew && (
                <>
                  <span className="truncate">{displayName}</span>
                  <span>·</span>
                </>
              )}
              <span className="shrink-0">{joinedAgo(joinedAt)}</span>
              {isNew && responseLine && (
                <>
                  <span>·</span>
                  <span className="shrink-0">{responseLine}</span>
                </>
              )}
              {disputeMarker.show && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {disputeMarker.activeCount} open
                  </span>
                </>
              )}
            </div>
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
            className="shrink-0 text-slate-600 transition-colors group-hover:text-slate-400"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </button>

      {popoverOpen && (
        <TrustCardPopover data={data} onClose={() => setPopoverOpen(false)} />
      )}
    </>
  );
}

// ── Full — self dashboard / public profile ──────────────────────

function ComponentBar({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: "percent" | "rating";
}) {
  if (value === null) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-slate-500">{label}</span>
          <span className="text-slate-600">No data</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/50">
          <div className="h-full w-0" />
        </div>
      </div>
    );
  }

  const pct = format === "percent" ? value * 100 : (value / 5) * 100;
  const display =
    format === "percent" ? `${Math.round(value * 100)}%` : `${value.toFixed(1)}/5`;
  const colors = scoreColor(pct);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`font-semibold ${colors.text}`}>{display}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${colors.fill.replace("fill-", "bg-")} transition-[width] duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FullCard({
  data,
  className,
}: {
  data: TrustCardData;
  className?: string;
}) {
  const { status, score, completedDeals, displayName, joinedAt, components, signals, disputeMarker } = data;
  const isNew = status === "NEW" || score === null;

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-6 ${className ?? ""}`}>
      <div className="flex items-start gap-5">
        {isNew ? (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-sm font-semibold text-cyan-400">
            NEW
          </div>
        ) : (
          <DonutGauge score={score!} size={96} strokeWidth={8} />
        )}

        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-white">
            {isNew ? "New seller" : summaryLabel(score!)}
          </h3>
          <p className="mt-1 text-sm text-slate-400">{displayName}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {!isNew && <span>{completedDeals} completed deals</span>}
            {!isNew && <span>·</span>}
            <span>{joinedAgo(joinedAt)}</span>
            {disputeMarker.show && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {disputeMarker.activeCount} open dispute{disputeMarker.activeCount === 1 ? "" : "s"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Verification chips */}
      <div className="mt-5 flex flex-wrap gap-2">
        <VerificationChip
          label="Email"
          verified={signals.emailVerified}
        />
        <VerificationChip
          label="Wallet"
          verified={signals.walletVerified}
        />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300">
          <span className="text-slate-500">Active listings:</span>
          <span className="font-medium">{signals.activeListings}</span>
        </span>
        {signals.avgResponseMinutes !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300">
            <span className="text-slate-500">Avg response:</span>
            <span className="font-medium">{formatResponseTime(signals.avgResponseMinutes)}</span>
          </span>
        )}
      </div>

      {/* Component breakdown — only for non-NEW */}
      {!isNew && components && (
        <div className="mt-6 border-t border-slate-800 pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Score breakdown
          </p>
          <div className="space-y-3">
            <ComponentBar label="Completion rate" value={components.completionRate} format="percent" />
            <ComponentBar
              label="Dispute rate (lower is better)"
              value={components.disputeRate === null ? null : 1 - components.disputeRate}
              format="percent"
            />
            {components.slaCompliance !== null && (
              <ComponentBar label="SLA compliance" value={components.slaCompliance} format="percent" />
            )}
            {components.peerRating !== null && (
              <ComponentBar label="Peer rating" value={components.peerRating} format="rating" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VerificationChip({ label, verified }: { label: string; verified: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        verified
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-slate-700 bg-slate-800/40 text-slate-500"
      }`}
    >
      {verified ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      )}
      {label} {verified ? "verified" : "unverified"}
    </span>
  );
}

// ── Main dispatcher ──────────────────────────────────────────────

export function TrustCard({ data, variant, className }: TrustCardProps) {
  if (variant === "compact") return <CompactCard data={data} className={className} />;
  if (variant === "inline") return <InlineCard data={data} className={className} />;
  return <FullCard data={data} className={className} />;
}

// ── Skeleton (loading state) ─────────────────────────────────────

export function TrustCardSkeleton({
  variant,
  className,
}: {
  variant: TrustCardVariant;
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-700" />
        <span className="h-3 w-8 animate-pulse rounded bg-slate-800" />
      </span>
    );
  }
  if (variant === "inline") {
    return (
      <div className={`rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:p-4 ${className ?? ""}`}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-slate-800" />
            <div className="h-2.5 w-44 animate-pulse rounded bg-slate-800/60" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-6 ${className ?? ""}`}>
      <div className="flex items-start gap-5">
        <div className="h-24 w-24 animate-pulse rounded-full bg-slate-800" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
          <div className="h-3 w-32 animate-pulse rounded bg-slate-800/60" />
          <div className="h-3 w-56 animate-pulse rounded bg-slate-800/60" />
        </div>
      </div>
    </div>
  );
}
