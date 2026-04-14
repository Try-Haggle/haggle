import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { claimListing } from "../services/draft.service.js";

/**
 * POST /api/claim
 * Body: { claimToken: string, userId: string }
 *
 * Verifies the claim token and links the listing to the user.
 * The userId comes from the authenticated Supabase session (verified by the web app).
 */
export function registerClaimRoutes(app: FastifyInstance, db: Database) {
  app.post<{
    Body: { claimToken: string };
  }>("/api/claim", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const { claimToken } = request.body ?? {};

    if (!claimToken) {
      return reply.status(400).send({
        ok: false,
        error: "missing_fields",
        message: "claimToken is required",
      });
    }

    const result = await claimListing(db, claimToken, userId);

    if (!result.ok) {
      const statusMap = {
        invalid_token: 404,
        expired: 410,
        already_claimed: 409,
      } as const;
      return reply.status(statusMap[result.error]).send(result);
    }

    return reply.send(result);
  });
}
