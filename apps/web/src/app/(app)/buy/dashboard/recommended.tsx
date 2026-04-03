"use client";

import { useState, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  const [listings, setListings] = useState<RecommendedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("empty");

  useEffect(() => {
    fetch(`${API_URL}/api/recommendations/dashboard?userId=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setListings(data.listings ?? []);
          setSource(data.meta?.source ?? "empty");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white mb-4">Recommended For You</h2>

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
        <div className="rounded-xl border border-slate-800 bg-bg-card/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-1">
            {source === "empty"
              ? "Start browsing to get personalized recommendations"
              : "No recommendations found yet"}
          </h3>
          <p className="text-sm text-slate-500">
            Visit some listings and we&apos;ll recommend similar items for you.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((item) => (
            <a
              key={item.publicId}
              href={`/l/${item.publicId}`}
              onClick={() => {
                fetch(`${API_URL}/api/recommendations/log/${item.logId}/click`, {
                  method: "PATCH",
                }).catch(() => {});
              }}
              className="group cursor-pointer rounded-xl border border-slate-800 bg-slate-900/50 p-3 transition-colors hover:border-slate-700 hover:bg-slate-800/50"
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
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  </div>
                )}
              </div>

              <h3 className="mb-1 truncate text-[13px] font-medium text-white">{item.title}</h3>

              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                {item.category && <span className="capitalize">{item.category}</span>}
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
      )}
    </section>
  );
}
