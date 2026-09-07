/**
 * Case Guide API — first-party party-scoped evidence / claim organization (F1).
 *
 * POST /disputes/:id/case-guide
 *
 * Security:
 *   - requireAuth: JWT authentication required
 *   - requireDisputeParty: user must be buyer or seller of the dispute
 *   - Requested `party` must match the authenticated user's party (IDOR reject)
 *   - Role name is always Case Guide (`dispute_ai_case_guide_v1`)
 *   - Money-inert: never finalize / refund / release
 */

import type { Database } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INPUT_LIMITS } from "../lib/input-limits.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { requireAuth } from "../middleware/require-auth.js";
import { runDisputeCaseGuide } from "../services/dispute-case-guide.service.js";

const caseGuideBodySchema = z.object({
  party: z.enum(["buyer", "seller"]),
  message: z.string().min(1).max(INPUT_LIMITS.advisorMessageChars).optional(),
  context: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars).optional(),
});

type OrderResource = { buyerId: string; sellerId: string };

function resolveAuthenticatedParty(
  userId: string,
  orderResource: OrderResource | undefined,
): "buyer" | "seller" | null {
  if (!orderResource) return null;
  if (userId === orderResource.buyerId) return "buyer";
  if (userId === orderResource.sellerId) return "seller";
  return null;
}

export function registerDisputeCaseGuideRoutes(app: FastifyInstance, db: Database) {
  const { requireDisputeParty } = createOwnershipMiddleware(db);

  app.post<{ Params: { id: string } }>(
    "/disputes/:id/case-guide",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = caseGuideBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_CASE_GUIDE_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const orderResource = (request as unknown as Record<string, unknown>).orderResource as
        | OrderResource
        | undefined;
      const userId = request.user!.id;
      const authenticatedParty = resolveAuthenticatedParty(userId, orderResource);

      // Admin may call for either party; non-admin must match their own party.
      const isAdmin = request.user?.role === "admin";
      if (!isAdmin) {
        if (!authenticatedParty) {
          return reply.code(403).send({
            error: "FORBIDDEN",
            message: "Cannot determine your role in this dispute",
          });
        }
        if (parsed.data.party !== authenticatedParty) {
          return reply.code(403).send({
            error: "CASE_GUIDE_PARTY_MISMATCH",
            message: "You may only request Case Guide for your own party on this dispute",
            authenticated_party: authenticatedParty,
            requested_party: parsed.data.party,
          });
        }
      }

      try {
        const outcome = await runDisputeCaseGuide(db, id, {
          party: parsed.data.party,
          message: parsed.data.message,
          context: parsed.data.context,
        });

        if (!outcome.ok) {
          return reply.code(outcome.statusCode).send({
            error: outcome.error,
            message: outcome.message,
            issues: outcome.issues,
            context_hash: outcome.context_hash,
            money_moved: false,
            auto_applied: false,
          });
        }

        return reply.send(outcome.result);
      } catch (err) {
        console.error("[case-guide] unexpected error:", err);
        return reply.code(500).send({
          error: "CASE_GUIDE_ERROR",
          message: "An unexpected error occurred",
          money_moved: false,
          auto_applied: false,
        });
      }
    },
  );
}
