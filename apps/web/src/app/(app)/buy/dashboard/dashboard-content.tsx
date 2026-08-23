"use client";

import { MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Price } from "@/components/ui/price";
import { formatCondition, formatTimeAgo } from "@/lib/format";
import type { ActiveNegotiation, ViewedListing } from "./page";
import { RecommendedForYou } from "./recommended";

const RECENTLY_VIEWED_INITIAL_SHOW = 4;

const STATUS_TONE: Record<string, BadgeProps["tone"]> = {
  ACTIVE: "gold",
  NEAR_DEAL: "success",
  ACCEPTED: "success",
  REJECTED: "error",
  STALLED: "warning",
  WAITING: "warning",
  EXPIRED: "neutral",
};

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
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 py-6 sm:p-6">
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-action-primary"
            >
              <circle cx="8" cy="21" r="1" />
              <circle cx="19" cy="21" r="1" />
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
            <h1 className="font-bold text-2xl text-ink">Buyer Dashboard</h1>
          </div>
          <p className="text-ink-secondary text-sm">Browse listings and track your negotiations</p>
        </div>
      </div>

      {/* Recommended for You */}
      <RecommendedForYou userId={userId} />

      {/* Recently Viewed Listings */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold text-ink text-lg">Recently Viewed</h2>
        {viewedListings.length > RECENTLY_VIEWED_INITIAL_SHOW && (
          <Link
            href="/buy/dashboard/recently-viewed"
            className="text-ink-secondary text-sm transition-colors hover:text-ink"
          >
            View all →
          </Link>
        )}
      </div>

      {viewedListings.length === 0 ? (
        <EmptyState
          className="mb-8"
          icon={<Search className="size-6" />}
          title="No recently viewed listings"
          description="When you visit a seller's listing link, it will appear here."
        />
      ) : (
        <div className="mb-8 space-y-3">
          {viewedListings.slice(0, RECENTLY_VIEWED_INITIAL_SHOW).map((listing) => (
            <ViewedListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {/* Active Negotiations */}
      <h2 className="mb-4 font-bold text-ink text-lg">Active Negotiations</h2>
      {activeNegotiations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-6" />}
          title="No active negotiations"
          description="Start a negotiation on a listing to track it here."
        />
      ) : (
        <div className="space-y-3">
          {activeNegotiations.map((neg) => (
            <ListRow
              key={neg.id}
              href={`/buy/negotiations/${neg.id}`}
              showChevron
              leading={
                <div className="flex size-12 items-center justify-center rounded-lg bg-surface-sunken text-action-primary">
                  <MessageSquare className="size-5" />
                </div>
              }
              title={<span className="font-mono">{neg.id.slice(0, 8)}...</span>}
              badges={
                <Badge tone={STATUS_TONE[neg.status] ?? "neutral"} size="sm">
                  {neg.status}
                </Badge>
              }
              meta={`Round ${neg.current_round} · Last offer: ${formatMinorPrice(neg.last_offer_price_minor)}`}
              trailing={
                <span className="text-ink-muted text-xs">{formatTimeAgo(neg.updated_at)}</span>
              }
            />
          ))}
        </div>
      )}
    </main>
  );
}

function ViewedListingCard({ listing }: { listing: ViewedListing }) {
  const conditionLabel = formatCondition(listing.condition);
  const meta = [conditionLabel, listing.category].filter(Boolean).join(" · ");

  return (
    <ListRow
      href={`/l/${listing.publicId}?from=buy-dashboard`}
      showChevron
      leading={
        <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken sm:size-14">
          {listing.photoUrl ? (
            // biome-ignore lint/performance/noImgElement: remote listing photo
            <img
              src={listing.photoUrl}
              alt={listing.title ?? "Listing"}
              className="h-full w-full object-cover"
            />
          ) : (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-muted"
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          )}
        </div>
      }
      title={listing.title ?? "Untitled"}
      meta={meta || undefined}
      trailing={
        <div>
          {listing.targetPrice ? (
            <Price amount={Number(listing.targetPrice)} size="sm" />
          ) : (
            <p className="font-semibold text-ink text-sm">—</p>
          )}
          <p className="text-ink-secondary text-xs">{formatTimeAgo(listing.lastViewedAt)}</p>
        </div>
      }
    />
  );
}
