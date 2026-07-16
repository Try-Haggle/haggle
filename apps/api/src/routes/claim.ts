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

    // Claim every accepted downstream record in the same statement. An
    // accepted guest negotiation already has a settlement approval keyed by
    // the session id, so moving only negotiation_sessions would leave the new
    // account unable to enter checkout. A session with an order is not
    // claimable because transferring a funded payment requires a separate,
    // audited ownership-transfer flow.
    const placeholders = sql.join(
      guestIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const result = await db.execute(sql`
        WITH claimable_sessions AS (
          SELECT session.id
          FROM negotiation_sessions AS session
          WHERE session.buyer_id IN (${placeholders})
            AND session.seller_id <> ${userId}::uuid
            AND NOT EXISTS (
              SELECT 1
              FROM commerce_orders AS commerce_order
              WHERE commerce_order.settlement_approval_id = session.id
            )
        ),
        claimed_sessions AS (
          UPDATE negotiation_sessions
          SET buyer_id = ${userId}::uuid,
              updated_at = NOW(),
              version = version + 1
          WHERE id IN (SELECT id FROM claimable_sessions)
            AND buyer_id IN (${placeholders})
            AND seller_id <> ${userId}::uuid
          RETURNING id
        ),
        claimed_approvals AS (
          UPDATE settlement_approvals AS approval
          SET buyer_id = ${userId}::uuid,
              terms_snapshot = jsonb_set(
                approval.terms_snapshot,
                '{buyer_id}',
                to_jsonb(${userId}::text),
                true
              ),
              updated_at = NOW()
          WHERE approval.id IN (SELECT id FROM claimed_sessions)
            AND approval.buyer_id IN (${placeholders})
          RETURNING approval.id
        )
        SELECT
          (SELECT COUNT(*)::int FROM claimed_sessions) AS claimed_count,
          (SELECT COUNT(*)::int FROM claimed_approvals) AS claimed_approval_count
      `);

    const resultRows = Array.isArray(result)
      ? result
      : ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    const claimedCount = Number(resultRows[0]?.claimed_count);
    const rowCount = (result as unknown as { rowCount?: number }).rowCount;
    const count =
      Number.isInteger(claimedCount) && claimedCount >= 0
        ? claimedCount
        : typeof rowCount === "number"
          ? rowCount
          : 0;
    return reply.send({ ok: true, claimed_count: count });
  });
}

const claimSessionsSchema = z.object({
  guest_buyer_ids: z.array(z.string().uuid()).min(1).max(64),
});
