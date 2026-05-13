"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowseFilters, BrowseListing } from "../page";
import { ListingCard, ListingCardSkeleton } from "@/components/listing-card";
import { BrowseEmptyState } from "./empty-state";
import { api } from "@/lib/api-client";

function buildQuery(filters: BrowseFilters, cursor: string): string {
  const p = new URLSearchParams();
  if (filters.categories.length > 0) p.set("category", filters.categories.join(","));
  if (filters.minPrice !== undefined) p.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) p.set("maxPrice", String(filters.maxPrice));
  if (filters.conditions.length > 0) p.set("condition", filters.conditions.join(","));
  if (filters.sort !== "newest") p.set("sort", filters.sort);
  p.set("cursor", cursor);
  return p.toString();
}

export function ListingGrid({
  initialListings,
  initialNextCursor,
  filters,
}: {
  initialListings: BrowseListing[];
  initialNextCursor: string | null;
  filters: BrowseFilters;
}) {
  const [listings, setListings] = useState<BrowseListing[]>(initialListings);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when SSR props change (filter/category/sort changed)
  useEffect(() => {
    setListings(initialListings);
    setNextCursor(initialNextCursor);
    loadingRef.current = false;
    setLoading(false);
  }, [initialListings, initialNextCursor]);

  useEffect(() => {
    if (!nextCursor) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (loadingRef.current || !nextCursor) return;
        loadingRef.current = true;
        setLoading(true);
        (async () => {
          try {
            const qs = buildQuery(filters, nextCursor);
            const res = await api.get<{
              ok: boolean;
              listings: BrowseListing[];
              nextCursor: string | null;
            }>(`/api/public/listings?${qs}`, { skipAuth: true });
            if (res.ok) {
              setListings((prev) => [...prev, ...res.listings]);
              setNextCursor(res.nextCursor ?? null);
            }
          } catch {
            // Swallow; user can retry by scrolling again
          } finally {
            loadingRef.current = false;
            setLoading(false);
          }
        })();
      },
      { rootMargin: "400px" },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [nextCursor, filters]);

  if (listings.length === 0) {
    return <BrowseEmptyState categories={filters.categories} />;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {listings.map((listing) => (
          <ListingCard key={listing.publicId} listing={listing} from="browse" />
        ))}
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <ListingCardSkeleton key={`sk-${i}`} />
          ))}
      </div>
      {nextCursor && <div ref={sentinelRef} className="h-10" />}
    </>
  );
}
