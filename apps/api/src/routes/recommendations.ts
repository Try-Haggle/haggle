import type { FastifyInstance } from "fastify";
import { type Database, recommendationLogs, eq } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { getDashboardRecommendations } from "../services/similar-listings.service.js";

export function registerRecommendationsRoutes(app: FastifyInstance, db: Database) {
  // GET /api/recommendations/dashboard
  app.get<{
    Querystring: { limit?: string };
  }>("/api/recommendations/dashboard", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

    const limit = Math.min(parseInt(request.query.limit || "10", 10), 20);

    const result = await getDashboardRecommendations(db, userId, { limit });

    return reply.send({ ok: true, ...result });
  });

  // PATCH /api/recommendations/log/:logId/click
  app.patch<{
    Params: { logId: string };
  }>("/api/recommendations/log/:logId/click", { preHandler: [requireAuth] }, async (request, reply) => {
    const { logId } = request.params;

    await db
      .update(recommendationLogs)
      .set({ clicked: true, clickedAt: new Date() })
      .where(eq(recommendationLogs.id, logId));

    return reply.status(204).send();
  });
}
