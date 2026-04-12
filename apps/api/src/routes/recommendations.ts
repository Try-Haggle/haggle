import type { FastifyInstance } from "fastify";
import { type Database, recommendationLogs, eq } from "@haggle/db";
import { getDashboardRecommendations } from "../services/similar-listings.service.js";

export function registerRecommendationsRoutes(app: FastifyInstance, db: Database) {
  // GET /api/recommendations/dashboard
  app.get<{
    Querystring: { userId?: string; limit?: string };
  }>("/api/recommendations/dashboard", async (request, reply) => {
    const userId = request.query.userId;

    if (!userId) {
      return reply.status(401).send({ ok: false, error: "authentication_required" });
    }

    const limit = Math.min(parseInt(request.query.limit || "10", 10), 20);

    const result = await getDashboardRecommendations(db, userId, { limit });

    return reply.send({ ok: true, ...result });
  });

  // PATCH /api/recommendations/log/:logId/click
  app.patch<{
    Params: { logId: string };
  }>("/api/recommendations/log/:logId/click", async (request, reply) => {
    const { logId } = request.params;

    await db
      .update(recommendationLogs)
      .set({ clicked: true, clickedAt: new Date() })
      .where(eq(recommendationLogs.id, logId));

    return reply.status(204).send();
  });
}
