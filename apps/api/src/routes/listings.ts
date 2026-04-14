import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { getListingsByUserId, getListingByIdForUser } from "../services/draft.service.js";

export function registerListingsRoutes(app: FastifyInstance, db: Database) {
  // GET /api/listings
  app.get("/api/listings", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

    const listings = await getListingsByUserId(db, userId);
    return reply.send({ ok: true, listings });
  });

  // GET /api/listings/:id
  app.get<{
    Params: { id: string };
  }>("/api/listings/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const listing = await getListingByIdForUser(db, id, userId);

    if (!listing) {
      return reply.status(404).send({
        ok: false,
        error: "not_found",
        message: "Listing not found or access denied",
      });
    }

    return reply.send({ ok: true, listing });
  });
}
