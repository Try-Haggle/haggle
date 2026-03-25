import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { getPublishedListingByPublicId } from "../services/draft.service.js";

export function registerPublicListingRoutes(
  app: FastifyInstance,
  db: Database,
) {
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
