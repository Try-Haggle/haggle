import { ITEM_CONDITIONS, LISTING_CATEGORIES } from "@haggle/shared";
import type { Metadata } from "next";
import { serverApi } from "@/lib/api-server";
import { BrowseToolbar } from "./_components/browse-toolbar";
import { ListingGrid } from "./_components/listing-grid";
import { StickyToolbar } from "./_components/sticky-toolbar";

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

export type BrowseSort = "newest" | "price_asc" | "price_desc";

type Category = (typeof LISTING_CATEGORIES)[number];
type Condition = (typeof ITEM_CONDITIONS)[number];

function isSort(value: string | undefined): value is BrowseSort {
  return value === "newest" || value === "price_asc" || value === "price_desc";
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseCsv<T extends string>(value: string | undefined, whitelist: readonly T[]): T[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (whitelist as readonly string[]).includes(s));
}

export interface BrowseFilters {
  categories: Category[];
  minPrice: number | undefined;
  maxPrice: number | undefined;
  conditions: Condition[];
  q: string;
  sort: BrowseSort;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    condition?: string;
    q?: string;
    sort?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters: BrowseFilters = {
    categories: parseCsv(sp.category, LISTING_CATEGORIES),
    minPrice: parsePositiveNumber(sp.minPrice),
    maxPrice: parsePositiveNumber(sp.maxPrice),
    conditions: parseCsv(sp.condition, ITEM_CONDITIONS),
    q: (sp.q ?? "").trim().slice(0, 100),
    sort: isSort(sp.sort) ? sp.sort : "newest",
  };

  const params = new URLSearchParams();
  if (filters.categories.length > 0) params.set("category", filters.categories.join(","));
  if (filters.minPrice !== undefined) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("maxPrice", String(filters.maxPrice));
  if (filters.conditions.length > 0) params.set("condition", filters.conditions.join(","));
  if (filters.q) params.set("q", filters.q);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  const query = params.toString();

  let listings: BrowseListing[] = [];
  let nextCursor: string | null = null;
  let priceRange: { min: number; max: number } | null = null;
  let priceBuckets: Array<{ min: number; max: number | null; count: number }> = [];
  try {
    const data = await serverApi.get<{
      ok: boolean;
      listings: BrowseListing[];
      nextCursor: string | null;
      priceRange: { min: number; max: number } | null;
      priceBuckets: Array<{ min: number; max: number | null; count: number }>;
    }>(`/api/public/listings${query ? `?${query}` : ""}`, { skipAuth: true });
    if (data.ok) {
      listings = data.listings;
      nextCursor = data.nextCursor ?? null;
      priceRange = data.priceRange ?? null;
      priceBuckets = data.priceBuckets ?? [];
    }
  } catch {
    listings = [];
  }

  return (
    <main className="min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-action-primary"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <h1 className="font-bold text-2xl text-ink">Browse listings</h1>
            </div>
            <p className="text-ink-secondary text-sm">Find items open to negotiation.</p>
          </div>
        </div>
      </div>

      <StickyToolbar>
        <BrowseToolbar filters={filters} priceRange={priceRange} priceBuckets={priceBuckets} />
      </StickyToolbar>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <ListingGrid initialListings={listings} initialNextCursor={nextCursor} filters={filters} />
      </div>
    </main>
  );
}
