import type { Database } from "@haggle/db";
import { ITEM_CONDITIONS, LISTING_CATEGORIES } from "@haggle/shared";
import type { FastifyInstance } from "fastify";
import {
  getPublishedListingByPublicId,
  getPublishedPriceBuckets,
  getPublishedPriceRange,
  type ListPublishedSort,
  listPublishedListings,
} from "../services/draft.service.js";
import { toPublicListingView } from "../services/public-listing-view.js";

const SORT_VALUES = ["newest", "price_asc", "price_desc"] as const;

export function registerPublicListingRoutes(app: FastifyInstance, db: Database) {
  // GET /api/public/listings — no auth required
  // Query params:
  //   category?    (one of LISTING_CATEGORIES)
  //   minPrice?    (positive number)
  //   maxPrice?    (positive number, >= minPrice)
  //   condition?   (csv of ITEM_CONDITIONS, e.g. "new,like_new")
  //   sort?        (newest | price_asc | price_desc; default newest)
  //   limit?       (default 40, max 100)
  //   cursor?      (format `${sortKey}_${publicId}` — from previous response's nextCursor;
  //                sortKey is ISO timestamp for sort=newest, numeric string for price sorts)
  app.get<{
    Querystring: {
      category?: string;
      minPrice?: string;
      maxPrice?: string;
      condition?: string;
      q?: string;
      sort?: string;
      limit?: string;
      cursor?: string;
    };
  }>("/api/public/listings", async (request, reply) => {
    const {
      category,
      minPrice: minPriceRaw,
      maxPrice: maxPriceRaw,
      condition: conditionRaw,
      q: qRaw,
      sort: sortRaw,
      limit,
      cursor: cursorRaw,
    } = request.query;

    // Cap search input length to keep ILIKE patterns sane.
    const q = qRaw?.trim().slice(0, 100) || undefined;

    let categories: string[] | undefined;
    if (category) {
      const list = category
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = list.filter(
        (c) => !LISTING_CATEGORIES.includes(c as (typeof LISTING_CATEGORIES)[number]),
      );
      if (invalid.length > 0) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_category",
          message: `category must be a csv of: ${LISTING_CATEGORIES.join(", ")}`,
        });
      }
      categories = list;
    }

    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_limit",
        message: "limit must be a positive integer",
      });
    }

    const parsePrice = (raw: string | undefined, name: string) => {
      if (raw === undefined || raw === "") return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${name} must be a non-negative number`);
      }
      return n;
    };

    let minPrice: number | undefined;
    let maxPrice: number | undefined;
    try {
      minPrice = parsePrice(minPriceRaw, "minPrice");
      maxPrice = parsePrice(maxPriceRaw, "maxPrice");
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_price",
        message: (e as Error).message,
      });
    }
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_price",
        message: "minPrice must be <= maxPrice",
      });
    }

    let conditions: string[] | undefined;
    if (conditionRaw) {
      const list = conditionRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = list.filter(
        (c) => !ITEM_CONDITIONS.includes(c as (typeof ITEM_CONDITIONS)[number]),
      );
      if (invalid.length > 0) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_condition",
          message: `condition must be a csv of: ${ITEM_CONDITIONS.join(", ")}`,
        });
      }
      conditions = list;
    }

    let sort: ListPublishedSort = "newest";
    if (sortRaw) {
      if (!SORT_VALUES.includes(sortRaw as (typeof SORT_VALUES)[number])) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_sort",
          message: `sort must be one of: ${SORT_VALUES.join(", ")}`,
        });
      }
      sort = sortRaw as ListPublishedSort;
    }

    let cursor: { sortKey: string; publicId: string } | undefined;
    if (cursorRaw) {
      const sep = cursorRaw.indexOf("_");
      if (sep === -1) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_cursor",
          message: "cursor must be in format <sortKey>_<publicId>",
        });
      }
      const sortKey = cursorRaw.slice(0, sep);
      const publicId = cursorRaw.slice(sep + 1);
      if (!sortKey || !publicId) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_cursor",
          message: "cursor sortKey or publicId is empty",
        });
      }
      if (sort === "newest" && Number.isNaN(new Date(sortKey).getTime())) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_cursor",
          message: "cursor sortKey for sort=newest must be ISO timestamp",
        });
      }
      if (sort !== "newest" && !Number.isFinite(Number(sortKey))) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_cursor",
          message: "cursor sortKey for price sort must be numeric",
        });
      }
      cursor = { sortKey, publicId };
    }

    const effectiveLimit = Math.min(Math.max(parsedLimit ?? 40, 1), 100);

    const listings = await listPublishedListings(db, {
      categories,
      minPrice,
      maxPrice,
      conditions,
      q,
      sort,
      limit: effectiveLimit,
      cursor,
    });

    let nextCursor: string | null = null;
    if (listings.length === effectiveLimit) {
      const last = listings[listings.length - 1];
      const sortKey =
        sort === "newest" ? last.publishedAt.toISOString() : (last.targetPrice ?? "0");
      nextCursor = `${sortKey}_${last.publicId}`;
    }

    // Price range + bucket histogram are only computed on the initial page
    // request. They drive the slider bounds and the dynamic preset chips in
    // the toolbar; subsequent cursor fetches don't need either.
    const [priceRange, priceBuckets] = cursor
      ? [null, []]
      : await Promise.all([
          getPublishedPriceRange(db, { categories, conditions, q }),
          getPublishedPriceBuckets(db, { categories, conditions, q }),
        ]);

    return reply.send({
      ok: true,
      listings,
      nextCursor,
      priceRange,
      priceBuckets,
    });
  });

  // GET /api/public/listings/:publicId — no auth required
  app.get<{
    Params: { publicId: string };
  }>("/api/public/listings/:publicId", async (request, reply) => {
    const { publicId } = request.params;

    const listing = await getPublishedListingByPublicId(db, publicId);

    if (!listing) {
      return reply.status(404).send({
        ok: false,
        error: "not_found",
        message: "Listing not found",
      });
    }

    // Shared with the messaging detail panel so both show the same redacted view.
    const view = toPublicListingView(listing);

    return reply.send({
      ok: true,
      listing: view.listing,
      // Included for ownership check — not sensitive (just a UUID)
      sellerId: view.sellerId,
    });
  });
}
