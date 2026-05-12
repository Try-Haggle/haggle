import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { LISTING_CATEGORIES } from "@haggle/shared";
import {
  getPublishedListingByPublicId,
  listPublishedListings,
} from "../services/draft.service.js";

export function registerPublicListingRoutes(
  app: FastifyInstance,
  db: Database,
) {
  // GET /api/public/listings — no auth required
  // Query params:
  //   category? (one of LISTING_CATEGORIES)
  //   limit?   (default 40, max 100)
  //   cursor?  (format: `${publishedAtIso}_${publicId}` — from previous response's nextCursor)
  app.get<{
    Querystring: { category?: string; limit?: string; cursor?: string };
  }>("/api/public/listings", async (request, reply) => {
    const { category, limit, cursor: cursorRaw } = request.query;

    if (category && !LISTING_CATEGORIES.includes(category as (typeof LISTING_CATEGORIES)[number])) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_category",
        message: `category must be one of: ${LISTING_CATEGORIES.join(", ")}`,
      });
    }

    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      return reply.status(400).send({
        ok: false,
        error: "invalid_limit",
        message: "limit must be a positive integer",
      });
    }

    let cursor: { publishedAt: Date; publicId: string } | undefined;
    if (cursorRaw) {
      const sep = cursorRaw.indexOf("_");
      if (sep === -1) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_cursor",
          message: "cursor must be in format `${iso}_${publicId}`",
        });
      }
      const iso = cursorRaw.slice(0, sep);
      const publicId = cursorRaw.slice(sep + 1);
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime()) || !publicId) {
        return reply.status(400).send({
          ok: false,
          error: "invalid_cursor",
          message: "cursor publishedAt or publicId is invalid",
        });
      }
      cursor = { publishedAt: dt, publicId };
    }

    const effectiveLimit = Math.min(Math.max(parsedLimit ?? 40, 1), 100);

    const listings = await listPublishedListings(db, {
      category,
      limit: effectiveLimit,
      cursor,
    });

    const nextCursor =
      listings.length === effectiveLimit
        ? `${listings[listings.length - 1].publishedAt.toISOString()}_${listings[listings.length - 1].publicId}`
        : null;

    return reply.send({ ok: true, listings, nextCursor });
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

    // Don't expose floorPrice, sellerId, or internal strategy details to buyers
    const { strategyConfig, sellerId, ...publicFields } = listing;

    // Only expose the seller's agent preset name (not thresholds)
    const sellerAgentPreset =
      (strategyConfig as Record<string, unknown> | null)?.preset ?? null;

    return reply.send({
      ok: true,
      listing: {
        ...publicFields,
        sellerAgentPreset,
      },
      // Included for ownership check — not sensitive (just a UUID)
      sellerId,
    });
  });
}
