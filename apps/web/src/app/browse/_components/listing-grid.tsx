"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowseListing } from "../page";
import { LISTING_CATEGORIES } from "@haggle/shared";
import { ListingCard, ListingCardSkeleton } from "@/components/listing-card";
import { BrowseEmptyState } from "./empty-state";
import { api } from "@/lib/api-client";

type Category = (typeof LISTING_CATEGORIES)[number];

export function ListingGrid({
  initialListings,
  initialNextCursor,
  activeCategory,
}: {
  initialListings: BrowseListing[];
  initialNextCursor: string | null;
  activeCategory: Category | null;
}) {
  const [listings, setListings] = useState<BrowseListing[]>(initialListings);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when SSR props change (category switched)
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
            const qs = new URLSearchParams();
            if (activeCategory) qs.set("category", activeCategory);
            qs.set("cursor", nextCursor);
            const res = await api.get<{
              ok: boolean;
              listings: BrowseListing[];
              nextCursor: string | null;
            }>(`/api/public/listings?${qs.toString()}`, { skipAuth: true });
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
  }, [nextCursor, activeCategory]);

  if (listings.length === 0) {
    return <BrowseEmptyState activeCategory={activeCategory} />;
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
