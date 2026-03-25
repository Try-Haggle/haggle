import type { FastifyInstance } from "fastify";
import {
  type Database,
  buyerListings,
  listingsPublished,
  listingDrafts,
  eq,
  desc,
} from "@haggle/db";

export function registerBuyerListingsRoutes(
  app: FastifyInstance,
  db: Database,
) {
  // POST /api/viewed — record a listing view for a logged-in buyer
  app.post<{
    Body: { userId: string; publicId: string };
  }>("/api/viewed", async (request, reply) => {
    const { userId, publicId } = request.body ?? {};

    if (!userId || !publicId) {
      return reply
        .status(400)
        .send({ ok: false, error: "userId and publicId are required" });
    }

    // Resolve publicId → published listing ID
    const published = await db.query.listingsPublished.findFirst({
      where: (fields, ops) => ops.eq(fields.publicId, publicId),
    });

    if (!published) {
      return reply
        .status(404)
        .send({ ok: false, error: "listing_not_found" });
    }

    // Skip if the viewer is the seller (owner of the listing)
    const draft = await db.query.listingDrafts.findFirst({
      where: (fields, ops) => ops.eq(fields.id, published.draftId),
      columns: { userId: true },
    });

    if (draft?.userId === userId) {
      return reply.send({ ok: true, action: "skipped", reason: "own_listing" });
    }

    // Upsert: insert or update last_viewed_at
    const existing = await db.query.buyerListings.findFirst({
      where: (fields, ops) =>
        ops.and(
          ops.eq(fields.userId, userId),
          ops.eq(fields.publishedListingId, published.id),
        ),
    });

    if (existing) {
      await db
        .update(buyerListings)
        .set({ lastViewedAt: new Date(), updatedAt: new Date() })
        .where(eq(buyerListings.id, existing.id));

      return reply.send({ ok: true, action: "updated" });
    }

    try {
      await db.insert(buyerListings).values({
        userId,
        publishedListingId: published.id,
        status: "viewed",
      });
      return reply.send({ ok: true, action: "created" });
    } catch (err: unknown) {
      // Unique index conflict from concurrent request — treat as update
      const message = err instanceof Error ? err.message : "";
      if (message.includes("buyer_listings_user_listing_idx")) {
        await db
          .update(buyerListings)
          .set({ lastViewedAt: new Date(), updatedAt: new Date() })
          .where(
            eq(
              buyerListings.id,
              (
                await db.query.buyerListings.findFirst({
                  where: (fields, ops) =>
                    ops.and(
                      ops.eq(fields.userId, userId),
                      ops.eq(fields.publishedListingId, published.id),
                    ),
                })
              )!.id,
            ),
          );
        return reply.send({ ok: true, action: "updated" });
      }
      throw err;
    }
  });

  // GET /api/viewed?userId= — fetch buyer's recently viewed listings
  app.get<{
    Querystring: { userId: string };
  }>("/api/viewed", async (request, reply) => {
    const { userId } = request.query;

    if (!userId) {
      return reply
        .status(400)
        .send({ ok: false, error: "userId is required" });
    }

    const rows = await db
      .select({
        id: buyerListings.id,
        status: buyerListings.status,
        firstViewedAt: buyerListings.firstViewedAt,
        lastViewedAt: buyerListings.lastViewedAt,
        negotiationStartedAt: buyerListings.negotiationStartedAt,
        publicId: listingsPublished.publicId,
        title: listingDrafts.title,
        category: listingDrafts.category,
        condition: listingDrafts.condition,
        photoUrl: listingDrafts.photoUrl,
        targetPrice: listingDrafts.targetPrice,
      })
      .from(buyerListings)
      .innerJoin(
        listingsPublished,
        eq(listingsPublished.id, buyerListings.publishedListingId),
      )
      .innerJoin(
        listingDrafts,
        eq(listingDrafts.id, listingsPublished.draftId),
      )
      .where(eq(buyerListings.userId, userId))
      .orderBy(desc(buyerListings.lastViewedAt));

    return reply.send({ ok: true, listings: rows });
  });
}
