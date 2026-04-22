"use client";

import Link from "next/link";
import type { ViewedListing, ActiveNegotiation } from "./page";
import { RecommendedForYou } from "./recommended";

const RECENTLY_VIEWED_INITIAL_SHOW = 4;

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "text-cyan-400 bg-cyan-500/10",
    NEAR_DEAL: "text-emerald-400 bg-emerald-500/10",
    ACCEPTED: "text-emerald-400 bg-emerald-500/15",
    REJECTED: "text-red-400 bg-red-500/10",
    STALLED: "text-amber-400 bg-amber-500/10",
    EXPIRED: "text-slate-500 bg-slate-800",
    WAITING: "text-amber-400 bg-amber-500/10",
  };
  return map[status] ?? "text-slate-400 bg-slate-800";
}

function formatMinorPrice(priceMinor: number | null): string {
  if (priceMinor === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceMinor / 100);
}

export function BuyerDashboardContent({
  userId,
  viewedListings,
  activeNegotiations,
}: {
  userId: string;
  viewedListings: ViewedListing[];
  activeNegotiations: ActiveNegotiation[];
}) {
  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
              <circle cx="8" cy="21" r="1" />
              <circle cx="19" cy="21" r="1" />
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
            <h1 className="text-2xl font-bold text-white">Buyer Dashboard</h1>
          </div>
          <p className="text-sm text-slate-400">Browse listings and track your negotiations</p>
        </div>
      </div>

      {/* Recommended for You */}
      <RecommendedForYou userId={userId} />

      {/* Recently Viewed Listings */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Recently Viewed</h2>
        {viewedListings.length > RECENTLY_VIEWED_INITIAL_SHOW && (
          <Link
            href="/buy/dashboard/recently-viewed"
            className="text-sm text-slate-400 transition-colors hover:text-white"
          >
            View all →
          </Link>
        )}
      </div>

      {viewedListings.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-1">No recently viewed listings</h3>
          <p className="text-sm text-slate-500">
            When you visit a seller&apos;s listing link, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {viewedListings.slice(0, RECENTLY_VIEWED_INITIAL_SHOW).map((listing) => (
            <ViewedListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {/* Active Negotiations */}
      <h2 className="text-lg font-bold text-white mb-4">Active Negotiations</h2>
      {activeNegotiations.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-1">No active negotiations</h3>
          <p className="text-sm text-slate-500">
            Start a negotiation on a listing to track it here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeNegotiations.map((neg) => (
            <Link
              key={neg.id}
              href={`/buy/negotiations/${neg.id}`}
              className="flex items-center gap-3 sm:gap-4 rounded-xl border border-slate-800 bg-bg-card/50 p-3 sm:p-4 hover:border-slate-700 transition-colors"
            >
              <div className="shrink-0 h-12 w-12 rounded-lg bg-slate-800 flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-white truncate font-mono">
                    {neg.id.slice(0, 8)}...
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(neg.status)}`}>
                    {neg.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Round {neg.current_round} · Last offer: {formatMinorPrice(neg.last_offer_price_minor)}
                </p>
              </div>
              <div className="shrink-0 text-right mr-1">
                <p className="text-xs text-slate-500">{formatTimeAgo(neg.updated_at)}</p>
              </div>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function ViewedListingCard({ listing }: { listing: ViewedListing }) {
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
      href={`/l/${listing.publicId}?from=buy-dashboard`}
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
          <span className="font-semibold text-white truncate text-sm sm:text-base">
            {listing.title ?? "Untitled"}
          </span>
        </div>
        {meta && <p className="text-xs sm:text-sm text-slate-400">{meta}</p>}
      </div>

      {/* Price + last viewed */}
      <div className="shrink-0 text-right mr-1 sm:mr-2">
        <p className="font-semibold text-white text-sm sm:text-base">{price}</p>
        <p className="text-xs sm:text-sm text-slate-400">
          {formatTimeAgo(listing.lastViewedAt)}
        </p>
      </div>

      {/* Chevron */}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 shrink-0">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
