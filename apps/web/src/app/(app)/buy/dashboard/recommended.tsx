"use client";

import { useEffect, useRef, useState } from "react";
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

export function RecommendedForYou({ userId }: { userId: string }) {
  const { track } = useAmplitude();
  const [listings, setListings] = useState<RecommendedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("empty");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check scroll affordances when listings change
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
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Recommended For You</h2>
        {!loading && listings.length > 0 && (canScrollLeft || canScrollRight) && (
          <div className="flex gap-2 xl:hidden">
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-line transition-colors ${
                canScrollLeft
                  ? "text-ink hover:bg-surface-sunken cursor-pointer"
                  : "text-ink-muted cursor-default"
              }`}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-line transition-colors ${
                canScrollRight
                  ? "text-ink hover:bg-surface-sunken cursor-pointer"
                  : "text-ink-muted cursor-default"
              }`}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {["s1", "s2", "s3", "s4"].map((key) => (
            <div
              key={key}
              className="animate-pulse rounded-xl border border-line bg-surface-raised/50 p-3"
            >
              <div className="mb-3 aspect-square rounded-lg bg-surface-sunken" />
              <div className="mb-2 h-4 w-3/4 rounded bg-surface-sunken" />
              <div className="h-3 w-1/2 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-raised/50 p-8 sm:p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-surface-sunken">
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
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-ink-secondary mb-1">
            {source === "empty"
              ? "Start browsing to get personalized recommendations"
              : "No recommendations found yet"}
          </h3>
          <p className="text-sm text-ink-muted">
            Visit some listings and we&apos;ll recommend similar items for you.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Left arrow — desktop only */}
          {canScrollLeft && (
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scroll("left")}
              className="absolute -left-12 top-1/3 z-10 hidden xl:flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-raised text-ink transition-colors hover:bg-surface-sunken"
            >
              <svg
                aria-hidden="true"
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

          {/* Right arrow — desktop only */}
          {canScrollRight && (
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scroll("right")}
              className="absolute -right-12 top-1/3 z-10 hidden xl:flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-raised text-ink transition-colors hover:bg-surface-sunken"
            >
              <svg
                aria-hidden="true"
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
                href={`/l/${item.publicId}?from=buy-dashboard`}
                onClick={() => {
                  api.patch(`/api/recommendations/log/${item.logId}/click`).catch(() => {});
                  track("recommendation_clicked", {
                    context: "dashboard",
                    recommended_listing_id: item.publicId,
                  });
                }}
                className="group w-[calc(50%-6px)] shrink-0 cursor-pointer rounded-xl border border-line bg-surface-raised/50 p-3 transition-colors hover:border-line hover:bg-surface-sunken/50 sm:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)]"
                style={{ scrollSnapAlign: "start" }}
              >
                <div className="mb-3 aspect-square overflow-hidden rounded-lg bg-surface-sunken">
                  {item.photoUrl ? (
                    // biome-ignore lint/performance/noImgElement: remote listing photo
                    <img
                      src={item.photoUrl}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-muted">
                      <svg
                        aria-hidden="true"
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
                <h3 className="mb-1 truncate text-[13px] font-medium text-ink">{item.title}</h3>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-secondary">
                  {item.category && <span className="capitalize">{item.category}</span>}
                  {item.category && item.condition && <span>·</span>}
                  {item.condition && <span>{formatCondition(item.condition)}</span>}
                </div>
                <div className="text-[15px] font-semibold text-success">
                  {formatPrice(item.targetPrice)}
                </div>
                {item.matchReasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.matchReasons.slice(0, 2).map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-secondary"
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
      )}
    </section>
  );
}
