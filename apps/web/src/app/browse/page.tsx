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
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">
          Browse listings
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Explore what's up for negotiation.
        </p>
      </div>

      <CategoryTabs activeCategory={activeCategory} />

      <div className="mt-8">
        <ListingGrid listings={listings} activeCategory={activeCategory} />
      </div>
    </main>
  );
}
