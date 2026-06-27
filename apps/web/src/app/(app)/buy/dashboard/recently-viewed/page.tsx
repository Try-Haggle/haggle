import { Search } from "lucide-react";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Price } from "@/components/ui/price";
import { serverApi } from "@/lib/api-server";
import { formatCondition, formatTimeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ViewedListing } from "../page";

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
    const data = await serverApi.get<{ ok: boolean; listings: ViewedListing[] }>(`/api/viewed`);
    if (data.ok) {
      viewedListings = data.listings;
    }
  } catch {
    // API down
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-6 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <BackLink href="/buy/dashboard" className="mb-3">
          Back to Dashboard
        </BackLink>
        <h1 className="font-bold text-2xl text-ink">Recently Viewed</h1>
        <p className="mt-1 text-ink-secondary text-sm">
          {viewedListings.length} listing
          {viewedListings.length !== 1 ? "s" : ""} viewed
        </p>
      </div>

      {/* List */}
      {viewedListings.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="No recently viewed listings"
          description="When you visit a seller's listing link, it will appear here."
        />
      ) : (
        <div className="space-y-3">
          {viewedListings.filter(Boolean).map((listing) => {
            const meta = [formatCondition(listing.condition), listing.category]
              .filter(Boolean)
              .join(" · ");

            return (
              <ListRow
                key={listing.id}
                href={`/l/${listing.publicId}`}
                showChevron
                leading={
                  <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-surface-sunken sm:size-14">
                    {listing.photoUrl ? (
                      // biome-ignore lint/performance/noImgElement: remote listing photo
                      <img
                        src={listing.photoUrl}
                        alt={listing.title ?? "Listing"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
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
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                    )}
                  </div>
                }
                title={listing.title ?? "Untitled"}
                meta={meta || undefined}
                trailing={
                  <div>
                    {listing.targetPrice ? (
                      <Price amount={Number(listing.targetPrice)} size="sm" />
                    ) : (
                      <p className="font-semibold text-ink text-sm">—</p>
                    )}
                    <p className="text-ink-secondary text-xs">
                      {formatTimeAgo(listing.lastViewedAt)}
                    </p>
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
