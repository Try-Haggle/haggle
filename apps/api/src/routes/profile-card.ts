import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import {
  getProfileCard,
  getProfileCardsBatch,
  getPenaltyHistory,
  type TrustCardRole,
} from "../services/profile-card.service.js";

const ROLES: TrustCardRole[] = ["buyer", "seller", "combined"];

function parseRole(value: unknown): TrustCardRole {
  if (typeof value === "string" && (ROLES as string[]).includes(value)) {
    return value as TrustCardRole;
  }
  return "seller";
}

const batchSchema = z.object({
  actorIds: z.array(z.string().uuid()).min(1).max(50),
  role: z.enum(["buyer", "seller", "combined"]).optional(),
});

export function registerProfileCardRoutes(app: FastifyInstance, db: Database) {
  // GET /sellers/:actorId/profile-card?role=seller
  // Public — trust data is intentionally public-facing for buyer trust signals.
  app.get<{
    Params: { actorId: string };
    Querystring: { role?: string };
  }>("/sellers/:actorId/profile-card", async (request, reply) => {
    const { actorId } = request.params;
    const role = parseRole(request.query.role);
    const data = await getProfileCard(db, actorId, role);
    if (!data) {
      return reply.code(404).send({ error: "PROFILE_CARD_NOT_FOUND" });
    }
    return reply.send({ profile_card: data });
  });

  // POST /sellers/profile-cards — batch fetch for grids. Public for the same reason.
  app.post("/sellers/profile-cards", async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_BATCH_REQUEST", issues: parsed.error.issues });
    }
    const { actorIds, role } = parsed.data;
    const cards = await getProfileCardsBatch(db, actorIds, role ?? "seller");
    return reply.send({ profile_cards: cards });
  });

  // GET /me/penalty-history — self view, used by /profile/level dashboard.
  app.get(
    "/me/penalty-history",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const history = await getPenaltyHistory(db, userId);
      return reply.send({ penalty_history: history });
    },
  );
}
