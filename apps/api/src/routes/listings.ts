import type { Database } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import {
  getListingByIdForUser,
  getListingsByUserId,
  withdrawOwnedListing,
} from "../services/draft.service.js";

const WITHDRAW_ERROR: Record<
  "NOT_FOUND" | "NOT_PUBLISHED" | "LISTING_HAS_ACTIVE_SALE" | "LISTING_HAS_ACCEPTED_DEAL",
  { status: number; message: string }
> = {
  NOT_FOUND: { status: 404, message: "Listing not found or access denied" },
  NOT_PUBLISHED: { status: 409, message: "Only a published listing can be deleted" },
  LISTING_HAS_ACTIVE_SALE: {
    status: 409,
    message: "This listing has an active sale and cannot be deleted yet",
  },
  LISTING_HAS_ACCEPTED_DEAL: {
    status: 409,
    message: "This listing has an accepted deal and cannot be deleted yet",
  },
};

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

  // DELETE /api/listings/:id — owner soft-withdraws; row stays 90 days
  app.delete<{
    Params: { id: string };
  }>("/api/listings/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const result = await withdrawOwnedListing(db, {
      actorId: request.user!.id,
      listingKey: request.params.id,
    });

    if (!result.ok) {
      const mapped = WITHDRAW_ERROR[result.error];
      return reply.status(mapped.status).send({
        ok: false,
        error: result.error === "NOT_FOUND" ? "not_found" : result.error,
        message: mapped.message,
      });
    }

    return reply.send({ ok: true });
  });
}
