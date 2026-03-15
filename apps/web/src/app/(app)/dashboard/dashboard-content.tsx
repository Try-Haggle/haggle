"use client";

import Link from "next/link";
import { useState } from "react";
import type { ListingSummary } from "./page";

export function DashboardContent({
  userEmail,
  claimResult,
  listings,
}: {
  userEmail: string;
  claimResult: { ok: boolean; error?: string } | null;
  listings: ListingSummary[];
}) {
  const activeCount = listings.filter((l) => l.status === "published").length;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      {/* Claim Result Banner */}
      {claimResult && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            claimResult.ok
              ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
              : "border-red-500/30 bg-red-500/8 text-red-300"
          }`}
        >
          {claimResult.ok ? (
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Listing claimed successfully! It&apos;s now linked to your account.
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {claimResult.error === "expired"
                ? "This claim link has expired. Listings must be claimed within 24 hours."
                : claimResult.error === "already_claimed"
                  ? "This listing has already been claimed."
                  : claimResult.error === "invalid_token"
                    ? "Invalid claim link. Please check your link and try again."
                    : "Failed to process claim. Please try again."}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
              <rect x="3" y="3" width="6" height="18" rx="1" />
              <rect x="9" y="9" width="6" height="12" rx="1" />
              <rect x="15" y="6" width="6" height="15" rx="1" />
            </svg>
            <h1 className="text-2xl font-bold text-white">Seller Dashboard</h1>
          </div>
          <p className="text-sm text-slate-400">Manage your listings and track AI negotiations</p>
        </div>
        <button
          disabled
          className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 opacity-50 cursor-not-allowed shrink-0 self-start sm:self-auto"
          title="Coming soon — create listings with /haggle in ChatGPT"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Listing
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7h-9" />
              <path d="M14 17H5" />
              <circle cx="17" cy="17" r="3" />
              <circle cx="7" cy="7" r="3" />
            </svg>
          }
          iconColor="text-cyan-400"
          iconBg="bg-cyan-500/10"
          value={String(activeCount)}
          label="Active Listings"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          iconColor="text-purple-400"
          iconBg="bg-purple-500/10"
          value="0"
          label="Total Negotiations"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          }
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          value="0"
          label="Deals Closed"
        />
        <KpiCard
          icon={
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
          iconColor="text-amber-400"
          iconBg="bg-amber-500/10"
          value="$0"
          label="Revenue"
        />
      </div>

      {/* Listings Section */}
      <h2 className="text-lg font-bold text-white mb-4">Your Listings</h2>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <path d="M20 7h-9" />
              <path d="M14 17H5" />
              <circle cx="17" cy="17" r="3" />
              <circle cx="7" cy="7" r="3" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-1">No listings yet</h3>
          <p className="text-sm text-slate-500">
            Create one with <span className="text-cyan-400 font-mono">/haggle</span> in ChatGPT, then claim it to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

    </main>
  );
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
    <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function ListingCard({ listing }: { listing: ListingSummary }) {
  const price = listing.targetPrice
    ? `$${Number(listing.targetPrice).toLocaleString()}`
    : "\u2014";

  const conditionLabel = listing.condition
    ? listing.condition.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  const meta = [conditionLabel, listing.category]
    .filter(Boolean)
    .join(" \u00b7 ");

  return (
    <Link
      href={`/dashboard/${listing.id}`}
      className="flex items-center gap-3 sm:gap-4 rounded-xl border border-slate-800 bg-bg-card/50 p-3 sm:p-4 hover:border-slate-700 transition-colors"
    >
      {/* Photo or placeholder */}
      <div className="shrink-0 h-12 w-12 sm:h-14 sm:w-14 rounded-lg bg-slate-800 overflow-hidden flex items-center justify-center">
        {listing.photoUrl ? (
          <img
            src={listing.photoUrl}
            alt={listing.title ?? "Listing"}
            className="h-full w-full object-cover"
          />
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-white truncate text-sm sm:text-base">{listing.title ?? "Untitled"}</span>
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
            {listing.status === "published" ? "active" : listing.status}
          </span>
        </div>
        {meta && <p className="text-xs sm:text-sm text-slate-400">{meta}</p>}
      </div>

      {/* Price + negotiations */}
      <div className="shrink-0 text-right mr-1 sm:mr-2">
        <p className="font-semibold text-white text-sm sm:text-base">{price}</p>
        <p className="text-xs sm:text-sm text-slate-400">0 negotiations</p>
      </div>

      {/* Action icons */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <ShareButton publicId={listing.publicId} />
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {/* Mobile chevron only */}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 sm:hidden shrink-0">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}

function ShareButton({ publicId }: { publicId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        const url = `${window.location.origin}/l/${publicId}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
      title="Copy share link"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      )}
    </button>
  );
}

