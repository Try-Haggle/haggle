"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import type { ListingDetail } from "./page";
import { useAmplitude } from "@/providers/amplitude-provider";

export function DetailContent({ listing }: { listing: ListingDetail }) {
  const [copied, setCopied] = useState(false);

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const shareUrl = `${origin}/l/${listing.publicId}`;
  const price = listing.targetPrice
    ? `$${Number(listing.targetPrice).toLocaleString()}`
    : "\u2014";

  const agentPreset = listing.strategyConfig?.preset as string | undefined;
  const agentLabel = agentPreset
    ? agentPreset.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  const timeLeft = useTimeLeft(listing.sellingDeadline);

  const { track } = useAmplitude();

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    track("Share Link Copied", { public_id: listing.publicId, source: "listing_detail" });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      {/* Back link */}
      <Link
        href="/sell/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
              <rect x="3" y="3" width="6" height="18" rx="1" />
              <rect x="9" y="9" width="6" height="12" rx="1" />
              <rect x="15" y="6" width="6" height="15" rx="1" />
            </svg>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{listing.title ?? "Untitled"}</h1>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
              {listing.status === "published" ? "active" : listing.status}
            </span>
          </div>
          <p className="text-sm text-slate-400">
            Asking <span className="font-semibold text-white">{price}</span>
            {agentLabel && (
              <>
                {" \u00b7 Agent: "}
                <span className="text-cyan-400">{agentLabel}</span>
              </>
            )}
          </p>
        </div>

        {/* Share URL */}
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-full border border-slate-700 bg-bg-card px-4 py-2 text-sm text-slate-300 hover:border-slate-600 transition-colors shrink-0 self-start cursor-pointer"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span className="max-w-32 sm:max-w-50 truncate">{shareUrl}</span>
          {copied ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          iconColor="text-cyan-400"
          iconBg="bg-cyan-500/10"
          value="0"
          label="Total Negotiations"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          value={"\u2014"}
          label="Avg. Offer Price"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          }
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          value={"\u2014"}
          label="Best Offer"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          iconColor={timeLeft.expired ? "text-red-400" : "text-amber-400"}
          iconBg={timeLeft.expired ? "bg-red-500/10" : "bg-amber-500/10"}
          value={timeLeft.label}
          label="Time Left"
        />
      </div>

      {/* Negotiation History */}
      <h2 className="text-lg font-bold text-white mb-4">Negotiation History</h2>
      <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-8 sm:p-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-slate-800">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-slate-300 mb-1">No negotiations yet</h3>
        <p className="text-sm text-slate-500">
          Share your link to start receiving offers from buyers&apos; AI agents
        </p>
      </div>
    </main>
  );
}

function computeTimeLeft(deadline: string | null): { label: string; expired: boolean } {
  if (!deadline) return { label: "\u2014", expired: false };

  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", expired: true };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return { label: `${days}d ${hours}h`, expired: false };
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return { label: `${hours}h ${mins}m`, expired: false };
}

function useTimeLeft(deadline: string | null) {
  const [timeLeft, setTimeLeft] = useState(() => computeTimeLeft(deadline));

  useEffect(() => {
    if (!deadline) return;

    const update = () => setTimeLeft(computeTimeLeft(deadline));
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [deadline]);

  return timeLeft;
}

function KpiCard({
  icon,
  iconColor,
  iconBg,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-3 sm:p-4">
      <div className={`mb-2 sm:mb-3 flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-white">{value}</p>
      <p className="text-xs sm:text-sm text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}
