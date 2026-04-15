"use client";

import { useState, useEffect, useRef } from "react";
import { useAmplitude } from "@/providers/amplitude-provider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://haggle-production-7dee.up.railway.app";

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

function formatPrice(price: string | null): string {
  if (!price) return "$0";
  const n = parseFloat(price);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCondition(condition: string | null): string {
  if (!condition) return "";
  const map: Record<string, string> = {
    new: "New",
    like_new: "Like New",
    good: "Good",
    fair: "Fair",
    poor: "Poor",
  };
  return map[condition] ?? condition;
}

export function SimilarListings({
  publicId,
  userId,
}: {
  publicId: string;
  userId?: string | null;
}) {
  const { track } = useAmplitude();
  const [listings, setListings] = useState<SimilarListing[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) el.addEventListener("scroll", checkScroll);
    return () => el?.removeEventListener("scroll", checkScroll);
  }, [listings]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.querySelector("a")?.offsetWidth ?? 250;
    el.scrollBy({
      left: direction === "left" ? -cardWidth * 2 : cardWidth * 2,
      behavior: "smooth",
    });
  };

  return (
    <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[18px] font-semibold text-white">
          Similar Listings
        </h2>
        {!loading && listings.length > 0 && (canScrollLeft || canScrollRight) && (
          <div className="flex gap-2 xl:hidden">
            <button
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 transition-colors ${
                canScrollLeft ? "text-white hover:bg-slate-800 cursor-pointer" : "text-slate-700 cursor-default"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 transition-colors ${
                canScrollRight ? "text-white hover:bg-slate-800 cursor-pointer" : "text-slate-700 cursor-default"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-slate-800 bg-slate-900/50 p-3"
            >
              <div className="mb-3 aspect-square rounded-lg bg-slate-800" />
              <div className="mb-2 h-4 w-3/4 rounded bg-slate-800" />
              <div className="h-3 w-1/2 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-8 sm:p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-slate-800">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-slate-500"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-slate-300 mb-1">
            No similar listings found yet
          </h3>
          <p className="text-sm text-slate-500">
            Similar listings will appear here as more items are posted.
          </p>
        </div>
      ) : (
        <CarouselGrid
          listings={listings}
          publicId={publicId}
          track={track}
          scrollRef={scrollRef}
          canScrollLeft={canScrollLeft}
          canScrollRight={canScrollRight}
          scroll={scroll}
        />
      )}
    </section>
  );
}

// ─── Carousel Grid ──────────────────────────────────────

function CarouselGrid({
  listings,
  publicId,
  track,
  scrollRef,
  canScrollLeft,
  canScrollRight,
  scroll,
}: {
  listings: SimilarListing[];
  publicId: string;
  track: (event: string, props?: Record<string, unknown>) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scroll: (direction: "left" | "right") => void;
}) {
  return (
    <div className="relative">
      {/* Left arrow — absolute, outside cards to the left */}
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="absolute -left-12 top-1/3 z-10 hidden xl:flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-white transition-colors hover:bg-slate-800"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}

      {/* Right arrow — absolute, outside cards to the right */}
      {canScrollRight && (
        <button
          onClick={() => scroll("right")}
          className="absolute -right-12 top-1/3 z-10 hidden xl:flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-white transition-colors hover:bg-slate-800"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}

      {/* Cards */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {listings.map((item) => (
          <a
            key={item.publicId}
            href={`/l/${item.publicId}`}
            onClick={() => {
              fetch(`${API_URL}/api/recommendations/log/${item.logId}/click`, {
                method: "PATCH",
              }).catch(() => {});
              track("recommendation_clicked", {
                context: "detail_page",
                source_listing_id: publicId,
                recommended_listing_id: item.publicId,
              });
            }}
            className="group w-[calc(50%-6px)] shrink-0 cursor-pointer rounded-xl border border-slate-800 bg-slate-900/50 p-3 transition-colors hover:border-slate-700 hover:bg-slate-800/50 sm:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)]"
            style={{ scrollSnapAlign: "start" }}
          >
            <div className="mb-3 aspect-square overflow-hidden rounded-lg bg-slate-800">
              {item.photoUrl ? (
                <img
                  src={item.photoUrl}
                  alt={item.title}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-600">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                </div>
              )}
            </div>
            <h3 className="mb-1 truncate text-[13px] font-medium text-white">
              {item.title}
            </h3>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              {item.category && (
                <span className="capitalize">{item.category}</span>
              )}
              {item.category && item.condition && <span>·</span>}
              {item.condition && <span>{formatCondition(item.condition)}</span>}
            </div>
            <div className="text-[15px] font-semibold text-emerald-400">
              {formatPrice(item.targetPrice)}
            </div>
            {item.matchReasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.matchReasons.slice(0, 2).map((reason) => (
                  <span
                    key={reason}
                    className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400"
                  >
                    {reason}
                  </span>
                ))}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
