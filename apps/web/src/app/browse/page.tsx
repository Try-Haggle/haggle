import type { Metadata } from "next";
import { serverApi } from "@/lib/api-server";
import { LISTING_CATEGORIES } from "@haggle/shared";
import { CategoryTabs } from "./_components/category-tabs";
import { ListingGrid } from "./_components/listing-grid";

export const metadata: Metadata = {
  title: "Browse listings · Haggle",
  description:
    "Browse items up for AI-powered negotiation on Haggle. Discover deals where agents haggle on your behalf.",
};

export interface BrowseListing {
  publicId: string;
  publishedAt: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  tags: string[] | null;
}

type Category = (typeof LISTING_CATEGORIES)[number];

function isCategory(value: string | undefined): value is Category {
  return !!value && (LISTING_CATEGORIES as readonly string[]).includes(value);
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const activeCategory = isCategory(category) ? category : null;

  const query = activeCategory ? `?category=${activeCategory}` : "";

  let listings: BrowseListing[] = [];
  try {
    const data = await serverApi.get<{
      ok: boolean;
      listings: BrowseListing[];
    }>(`/api/public/listings${query}`, { skipAuth: true });
    if (data.ok) listings = data.listings;
  } catch {
    listings = [];
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400 shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <h1 className="text-2xl font-bold text-white">Browse listings</h1>
          </div>
          <p className="text-sm text-slate-400">Find items open to negotiation.</p>
        </div>
      </div>

      <CategoryTabs activeCategory={activeCategory} />

      <div className="mt-8">
        <ListingGrid listings={listings} activeCategory={activeCategory} />
      </div>
    </main>
  );
}
