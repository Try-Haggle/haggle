"use client";

import { useMemo } from "react";
import type { BrowseListing } from "../page";
import { LISTING_CATEGORIES } from "@haggle/shared";
import { ListingCard } from "@/components/listing-card";
import { BrowseEmptyState } from "./empty-state";
import { useTrustCardsBatch } from "@/hooks/use-trust-card";

type Category = (typeof LISTING_CATEGORIES)[number];

export function ListingGrid({
  listings,
  activeCategory,
}: {
  listings: BrowseListing[];
  activeCategory: Category | null;
}) {
  const sellerIds = useMemo(
    () =>
      Array.from(
        new Set(listings.map((l) => l.sellerId).filter((id): id is string => !!id)),
      ),
    [listings],
  );

  const { cards } = useTrustCardsBatch(sellerIds, { role: "seller" });

  if (listings.length === 0) {
    return <BrowseEmptyState activeCategory={activeCategory} />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {listings.map((listing) => (
        <ListingCard
          key={listing.publicId}
          listing={listing}
          from="browse"
          trustCard={listing.sellerId ? cards[listing.sellerId] : undefined}
        />
      ))}
    </div>
  );
}
