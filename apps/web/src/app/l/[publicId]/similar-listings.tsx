"use client";

import { useState, useEffect } from "react";
import { useAmplitude } from "@/providers/amplitude-provider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

export function SimilarListings({ publicId, userId }: { publicId: string; userId?: string | null }) {
  const { track } = useAmplitude();
  const [listings, setListings] = useState<SimilarListing[]>([]);
  const [loading, setLoading] = useState(true);

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
      .catch(() => {
        // Silent fail — similar listings are non-critical
      })
      .finally(() => setLoading(false));
  }, [publicId, userId]);

  return (
    <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <h2 className="mb-4 text-[18px] font-semibold text-white">Similar Listings</h2>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <div className="mb-3 aspect-square rounded-lg bg-slate-800" />
              <div className="mb-2 h-4 w-3/4 rounded bg-slate-800" />
              <div className="h-3 w-1/2 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-6 py-10 text-center">
          <p className="text-[14px] text-slate-400">No similar listings found yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((item) => (
            <a
              key={item.publicId}
              href={`/l/${item.publicId}`}
              onClick={() => {
                // Fire-and-forget click tracking
                fetch(`${API_URL}/api/recommendations/log/${item.logId}/click`, {
                  method: "PATCH",
                }).catch(() => {});
                track("recommendation_clicked", {
                  context: "detail_page",
                  source_listing_id: publicId,
                  recommended_listing_id: item.publicId,
                });
              }}
              className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/50 p-3 transition-colors hover:border-slate-700 hover:bg-slate-800/50"
            >
              {/* Image */}
              <div className="mb-3 aspect-square overflow-hidden rounded-lg bg-slate-800">
                {item.photoUrl ? (
                  <img
                    src={item.photoUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-600">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Title */}
              <h3 className="mb-1 truncate text-[13px] font-medium text-white">{item.title}</h3>

              {/* Category + Condition */}
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                {item.category && <span className="capitalize">{item.category}</span>}
                {item.category && item.condition && <span>·</span>}
                {item.condition && <span>{formatCondition(item.condition)}</span>}
              </div>

              {/* Price */}
              <div className="text-[15px] font-semibold text-emerald-400">
                {formatPrice(item.targetPrice)}
              </div>

              {/* Match Reasons */}
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
      )}
    </section>
  );
}
