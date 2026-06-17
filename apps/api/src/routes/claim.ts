import { type Database, sql } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import { claimListing } from "../services/draft.service.js";

/**
 * Claim flow — wire ownership of guest-created entities to a real user account.
 *
 *  • POST /api/claim                — MCP-created listing draft claim (legacy)
 *  • POST /claim/negotiation-sessions — guest buyer's auto-played sessions
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

  // ─── POST /claim/negotiation-sessions ──────────────────────────────────
  //
  // Buyer ran negotiations as a guest (`POST /negotiations/start` minted a
  // random UUID for buyer_id). After sign-up, the web app collects those
  // guest UUIDs from localStorage and POSTs them here so the new user owns
  // the resulting sessions.
  app.post("/claim/negotiation-sessions", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = claimSessionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }
    const guestIds = parsed.data.guest_buyer_ids.filter((id) => id !== userId);
    if (guestIds.length === 0) {
      return reply.send({ ok: true, claimed_count: 0 });
    }

    // Direct UPDATE keeps the call cheap. buyer_id is a uuid column so the
    // parameterised IN list has no injection vector; seller_id check stops
    // a malicious caller from claiming the wrong side of a session.
    const placeholders = sql.join(
      guestIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const result = await db.execute(sql`
        UPDATE negotiation_sessions
        SET buyer_id = ${userId}::uuid,
            updated_at = NOW(),
            version = version + 1
        WHERE buyer_id IN (${placeholders})
          AND seller_id <> ${userId}::uuid
      `);

    const rowCount = (result as unknown as { rowCount?: number }).rowCount;
    const count =
      typeof rowCount === "number" ? rowCount : Array.isArray(result) ? result.length : 0;
    return reply.send({ ok: true, claimed_count: count });
  });
}

const claimSessionsSchema = z.object({
  guest_buyer_ids: z.array(z.string().uuid()).min(1).max(64),
});
