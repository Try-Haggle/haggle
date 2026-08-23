"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ListingCard, ListingCardSkeleton } from "@/components/listing-card";
import { Carousel } from "@/components/ui/carousel";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api-client";
import { useAmplitude } from "@/providers/amplitude-provider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.tryhaggle.ai";

const CARD_WIDTH =
  "w-[calc(50%-8px)] shrink-0 snap-start sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]";

interface SimilarListing {
  publicId: string;
  title: string;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  similarityScore: number;
  matchReasons: string[];
  logId: string;
}

export function SimilarListings({
  publicId,
  userId,
  from = null,
}: {
  publicId: string;
  userId?: string | null;
  from?: "browse" | "buy-dashboard" | "sell-dashboard" | null;
}) {
  const { track } = useAmplitude();
  const [listings, setListings] = useState<SimilarListing[]>([]);
  const [loading, setLoading] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when listing/user changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (userId) params.set("userId", userId);

    fetch(`${API_URL}/api/public/listings/${publicId}/similar?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.listings) {
          setListings(data.listings);
          if (data.listings.length > 0) {
            track("recommendation_impressed", {
              context: "detail_page",
              source_listing_id: publicId,
              count: data.listings.length,
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [publicId, userId]);

  return (
    <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
      {loading ? (
        <>
          <h2 className="mb-4 font-bold text-ink text-lg">Similar Listings</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {["s1", "s2", "s3", "s4"].map((key) => (
              <ListingCardSkeleton key={key} imageAspect="square" />
            ))}
          </div>
        </>
      ) : listings.length === 0 ? (
        <>
          <h2 className="mb-4 font-bold text-ink text-lg">Similar Listings</h2>
          <EmptyState
            icon={<Search className="size-6" />}
            title="No similar listings found yet"
            description="Similar listings will appear here as more items are posted."
          />
        </>
      ) : (
        <Carousel
          title="Similar Listings"
          scrollBy="card"
          snap="mandatory"
          ariaLabel="Similar listings"
        >
          {listings.map((item) => (
            <ListingCard
              key={item.publicId}
              listing={item}
              matchReasons={item.matchReasons}
              imageAspect="square"
              from={from}
              className={CARD_WIDTH}
              onClick={() => {
                api.patch(`/api/recommendations/log/${item.logId}/click`).catch(() => {});
                track("recommendation_clicked", {
                  context: "detail_page",
                  source_listing_id: publicId,
                  recommended_listing_id: item.publicId,
                });
              }}
            />
          ))}
        </Carousel>
      )}
    </section>
  );
}
