"use client";

import { MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { NegotiationRosterRow } from "@/components/negotiations/negotiation-roster-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Price } from "@/components/ui/price";
import { formatCondition, formatTimeAgo } from "@/lib/format";
import { GetStarted } from "./get-started";
import type { ActiveNegotiation, ViewedListing } from "./page";
import { RecommendedForYou } from "./recommended";

const RECENTLY_VIEWED_INITIAL_SHOW = 4;

export function BuyerDashboardContent({
  getStarted,
  userId,
  firstName,
  viewedListings,
  activeNegotiations,
}: {
  getStarted: ComponentProps<typeof GetStarted>;
  userId: string;
  firstName: string | null;
  viewedListings: ViewedListing[];
  activeNegotiations: ActiveNegotiation[];
}) {
  return (
    <main className="mx-auto min-h-[calc(100vh-var(--spacing-header))] max-w-7xl px-4 py-6 sm:p-6">
      {/* One line of greeting; the sections below say what the page is for. */}
      <h1 className="mb-8 font-bold text-3xl text-ink tracking-tight">
        {firstName ? `Welcome back, ${firstName}!` : "Welcome back!"}
      </h1>

      <GetStarted {...getStarted} />

      {/* Recommended for You */}
      <RecommendedForYou userId={userId} />

      {/* Recently Viewed Listings */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-ink text-section">Recently viewed</h2>
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
      <h2 className="mb-4 text-ink text-section">Active negotiations</h2>
      {activeNegotiations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-6" />}
          title="No active negotiations"
          description="Start a negotiation on a listing to track it here."
        />
      ) : (
        <div className="space-y-3">
          {activeNegotiations.map((neg) => (
            <NegotiationRosterRow
              key={neg.id}
              negotiation={neg}
              side="BUYER"
              href={`/buy/negotiations/${neg.id}`}
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
