"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ListingCard, ListingCardSkeleton } from "@/components/listing-card";
import { Carousel } from "@/components/ui/carousel";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api-client";
import { useAmplitude } from "@/providers/amplitude-provider";

interface RecommendedListing {
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

const CARD_WIDTH =
  "w-[calc(50%-8px)] shrink-0 snap-start sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)]";

export function RecommendedForYou({ userId }: { userId: string }) {
  const { track } = useAmplitude();
  const [listings, setListings] = useState<RecommendedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("empty");

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetch only when user changes
  useEffect(() => {
    api
      .get<{
        ok: boolean;
        listings?: RecommendedListing[];
        meta?: { source?: string };
      }>(`/api/recommendations/dashboard`)
      .then((data) => {
        if (data.ok) {
          setListings(data.listings ?? []);
          setSource(data.meta?.source ?? "empty");
          if (data.listings && data.listings.length > 0) {
            track("recommendation_impressed", {
              context: "dashboard",
              count: data.listings.length,
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <section className="mb-8">
      {loading ? (
        <>
          <h2 className="mb-4 font-bold text-ink text-lg">Recommended For You</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {["s1", "s2", "s3", "s4"].map((key) => (
              <ListingCardSkeleton key={key} imageAspect="square" />
            ))}
          </div>
        </>
      ) : listings.length === 0 ? (
        <>
          <h2 className="mb-4 font-bold text-ink text-lg">Recommended For You</h2>
          <EmptyState
            icon={<Search className="size-6" />}
            title={
              source === "empty"
                ? "Start browsing to get personalized recommendations"
                : "No recommendations found yet"
            }
            description="Visit some listings and we'll recommend similar items for you."
          />
        </>
      ) : (
        <Carousel
          title="Recommended For You"
          scrollBy="card"
          snap="mandatory"
          ariaLabel="Recommended listings"
        >
          {listings.map((item) => (
            <ListingCard
              key={item.publicId}
              listing={item}
              matchReasons={item.matchReasons}
              imageAspect="square"
              from="buy-dashboard"
              className={CARD_WIDTH}
              onClick={() => {
                api.patch(`/api/recommendations/log/${item.logId}/click`).catch(() => {});
                track("recommendation_clicked", {
                  context: "dashboard",
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
