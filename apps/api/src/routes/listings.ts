import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { getListingsByUserId, getListingByIdForUser } from "../services/draft.service.js";

export function registerListingsRoutes(app: FastifyInstance, db: Database) {
  // GET /api/listings?userId=xxx
  app.get<{
    Querystring: { userId: string };
  }>("/api/listings", async (request, reply) => {
    const { userId } = request.query;

    if (!userId) {
      return reply.status(400).send({
        ok: false,
        error: "missing_userId",
        message: "userId query parameter is required",
      });
    }

    const listings = await getListingsByUserId(db, userId);
    return reply.send({ ok: true, listings });
  });

  // GET /api/listings/:id?userId=xxx
  app.get<{
    Params: { id: string };
    Querystring: { userId: string };
  }>("/api/listings/:id", async (request, reply) => {
    const { id } = request.params;
    const { userId } = request.query;

    if (!userId) {
      return reply.status(400).send({
        ok: false,
        error: "missing_userId",
        message: "userId query parameter is required",
      });
    }

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
