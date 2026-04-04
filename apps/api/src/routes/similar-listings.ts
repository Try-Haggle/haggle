import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { getSimilarListingsForPublicId } from "../services/similar-listings.service.js";

export function registerSimilarListingsRoutes(app: FastifyInstance, db: Database) {
  // GET /api/public/listings/:publicId/similar
  app.get<{
    Params: { publicId: string };
    Querystring: { limit?: string; userId?: string };
  }>("/api/public/listings/:publicId/similar", async (request, reply) => {
    const { publicId } = request.params;
    const limit = Math.min(parseInt(request.query.limit || "10", 10), 20);
    const userId = request.query.userId || null;

    const result = await getSimilarListingsForPublicId(db, publicId, { limit, userId });

    if (!result) {
      return reply.status(404).send({ ok: false, error: "listing_not_found" });
    }

    return reply.send({ ok: true, ...result });
  });
}
