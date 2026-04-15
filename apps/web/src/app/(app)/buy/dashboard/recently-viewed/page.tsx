import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ViewedListing } from "../page";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://haggle-production-7dee.up.railway.app";

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default async function RecentlyViewedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  let viewedListings: ViewedListing[] = [];
  try {
    const res = await fetch(`${API_URL}/api/viewed?userId=${user.id}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (data.ok) {
      viewedListings = data.listings;
    }
  } catch {
    // API down
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/buy/dashboard"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors mb-3"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-white">Recently Viewed</h1>
        <p className="text-sm text-slate-400 mt-1">
          {viewedListings.length} listing
          {viewedListings.length !== 1 ? "s" : ""} viewed
        </p>
      </div>

      {/* List */}
      {viewedListings.length === 0 ? (
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
            No recently viewed listings
          </h3>
          <p className="text-sm text-slate-500">
            When you visit a seller&apos;s listing link, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {viewedListings.filter(Boolean).map((listing) => {
            const price = listing.targetPrice
              ? `$${Number(listing.targetPrice).toLocaleString()}`
              : "\u2014";
            const conditionLabel = listing.condition
              ? listing.condition
                  .replace("_", " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase())
              : null;
            const meta = [conditionLabel, listing.category]
              .filter(Boolean)
              .join(" \u00b7 ");

            return (
              <Link
                key={listing.id}
                href={`/l/${listing.publicId}`}
                className="flex items-center gap-3 sm:gap-4 rounded-xl border border-slate-800 bg-bg-card/50 p-3 sm:p-4 hover:border-slate-700 transition-colors"
              >
                <div className="shrink-0 h-12 w-12 sm:h-14 sm:w-14 rounded-lg bg-slate-800 overflow-hidden flex items-center justify-center">
                  {listing.photoUrl ? (
                    <img
                      src={listing.photoUrl}
                      alt={listing.title ?? "Listing"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="24"
                      height="24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-slate-600"
                    >
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-white truncate text-sm sm:text-base block">
                    {listing.title ?? "Untitled"}
                  </span>
                  {meta && (
                    <p className="text-xs sm:text-sm text-slate-400">{meta}</p>
                  )}
                </div>
                <div className="shrink-0 text-right mr-1 sm:mr-2">
                  <p className="font-semibold text-white text-sm sm:text-base">
                    {price}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-400">
                    {formatTimeAgo(listing.lastViewedAt)}
                  </p>
                </div>
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-slate-500 shrink-0"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
