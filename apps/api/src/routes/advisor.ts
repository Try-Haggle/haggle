/**
 * AI Advisor API Routes — dispute resolution chat system.
 *
 * POST /disputes/:id/advisor/chat    — send a message to the advisor
 * GET  /disputes/:id/advisor/history — load conversation history
 * POST /disputes/:id/advisor/analyze — trigger initial case analysis
 *
 * Security:
 *   - requireAuth: JWT authentication required
 *   - requireDisputeParty: user must be buyer or seller of the dispute
 *   - Role determined server-side (never from client)
 *   - Buyer sees only buyer_* messages, seller sees only seller_*
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { chat, analyzeCase, getHistory } from "../advisor/advisor-service.js";
import { MAX_MESSAGE_LENGTH } from "../advisor/advisor-types.js";
import type { AdvisorRole } from "../advisor/advisor-types.js";

const chatBodySchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty")
    .max(MAX_MESSAGE_LENGTH, `Message exceeds ${MAX_MESSAGE_LENGTH} characters`),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Determine user's role in the dispute from server-side data.
 * Client CANNOT specify their role -- this is critical for security.
 */
function resolveUserRole(
  userId: string,
  orderResource: { buyerId: string; sellerId: string } | undefined,
): AdvisorRole | null {
  if (!orderResource) return null;
  if (userId === orderResource.buyerId) return "buyer";
  if (userId === orderResource.sellerId) return "seller";
  return null;
}

export function registerAdvisorRoutes(app: FastifyInstance, db: Database) {
  const { requireDisputeParty } = createOwnershipMiddleware(db);

  // POST /disputes/:id/advisor/chat
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/advisor/chat",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      // Validate body
      const parsed = chatBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_MESSAGE", issues: parsed.error.issues });
      }

      // Determine role server-side
      const orderResource = (
        request as unknown as Record<string, unknown>
      ).orderResource as
        | { buyerId: string; sellerId: string }
        | undefined;
      const userId = request.user!.id;
      const userRole = resolveUserRole(userId, orderResource);

      if (!userRole) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "Cannot determine your role in this dispute" });
      }

      try {
        const result = await chat(db, {
          dispute_id: id,
          user_role: userRole,
          message: parsed.data.message,
        });
        return reply.send(result);
      } catch (err) {
        console.error("[advisor/chat] unexpected error:", err);
        return reply
          .code(500)
          .send({ error: "ADVISOR_ERROR", message: "An unexpected error occurred" });
      }
    },
  );

  // GET /disputes/:id/advisor/history
  app.get<{ Params: { id: string } }>(
    "/disputes/:id/advisor/history",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = historyQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_QUERY", issues: parsed.error.issues });
      }

      // Determine role server-side
      const orderResource = (
        request as unknown as Record<string, unknown>
      ).orderResource as
        | { buyerId: string; sellerId: string }
        | undefined;
      const userId = request.user!.id;
      const userRole = resolveUserRole(userId, orderResource);

      if (!userRole) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "Cannot determine your role in this dispute" });
      }

      // Role isolation enforced inside getHistory via SQL WHERE clause
      const messages = await getHistory(
        db,
        id,
        userRole,
        parsed.data.limit,
        parsed.data.offset,
      );

      return reply.send({ messages });
    },
  );

  // POST /disputes/:id/advisor/analyze
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/advisor/analyze",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      // Determine role server-side
      const orderResource = (
        request as unknown as Record<string, unknown>
      ).orderResource as
        | { buyerId: string; sellerId: string }
        | undefined;
      const userId = request.user!.id;
      const userRole = resolveUserRole(userId, orderResource);

      if (!userRole) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "Cannot determine your role in this dispute" });
      }

      try {
        const result = await analyzeCase(db, id, userRole);
        return reply.send({
          analysis: result.reply,
          strength: result.strength_assessment,
          action_suggestions: result.action_suggestions,
        });
      } catch (err) {
        console.error("[advisor/analyze] unexpected error:", err);
        return reply
          .code(500)
          .send({ error: "ADVISOR_ERROR", message: "An unexpected error occurred" });
      }
    },
  );
}
