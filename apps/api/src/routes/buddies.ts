import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { buddies, buddyTrades } from "@haggle/db";
import { eq, desc, sql } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

import {
  getAbilityForBuddy,
  type Species,
  type Rarity,
} from "../services/gamification.service.js";

const renameSchema = z.object({
  name: z.string().min(1).max(20),
});

export function registerBuddyRoutes(app: FastifyInstance, db: Database) {
  // GET /buddies — list user's buddies
  app.get(
    "/buddies",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;

      const rows = await db
        .select()
        .from(buddies)
        .where(eq(buddies.userId, userId))
        .orderBy(desc(buddies.createdAt));

      return reply.send({ buddies: rows });
    },
  );

  // GET /buddies/:id — buddy detail with DNA + trade stats
  app.get<{ Params: { id: string } }>(
    "/buddies/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;

      const [buddy] = await db
        .select()
        .from(buddies)
        .where(eq(buddies.id, id))
        .limit(1);

      if (!buddy) {
        return reply.code(404).send({ error: "BUDDY_NOT_FOUND" });
      }
      if (buddy.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      // Aggregate trade outcomes
      const outcomeRows = await db
        .select({
          outcome: buddyTrades.outcome,
          count: sql<number>`count(*)::int`,
        })
        .from(buddyTrades)
        .where(eq(buddyTrades.buddyId, id))
        .groupBy(buddyTrades.outcome);

      const tradeSummary: Record<string, number> = {
        deals: 0,
        rejects: 0,
        timeouts: 0,
        walkaways: 0,
        total: 0,
      };

      for (const row of outcomeRows) {
        const key = row.outcome.toLowerCase() + "s";
        if (key in tradeSummary) {
          tradeSummary[key] = row.count;
        }
        tradeSummary.total += row.count;
      }

      return reply.send({ buddy, trade_summary: tradeSummary });
    },
  );

  // POST /buddies/:id/reveal — reveal buddy details (auto-hatched, this is the "open" moment)
  app.post<{ Params: { id: string } }>(
    "/buddies/:id/reveal",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;

      const [buddy] = await db
        .select()
        .from(buddies)
        .where(eq(buddies.id, id))
        .limit(1);

      if (!buddy) {
        return reply.code(404).send({ error: "BUDDY_NOT_FOUND" });
      }
      if (buddy.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      // Buddies are auto-hatched now — this endpoint is for the reveal animation
      return reply.send({
        buddy,
        surprise: {
          species: buddy.species,
          rarity: buddy.rarity,
          ability: buddy.ability,
        },
      });
    },
  );

  // PATCH /buddies/:id/name — rename buddy
  app.patch<{ Params: { id: string } }>(
    "/buddies/:id/name",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;

      const parsed = renameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_NAME", issues: parsed.error.issues });
      }

      const [buddy] = await db
        .select()
        .from(buddies)
        .where(eq(buddies.id, id))
        .limit(1);

      if (!buddy) {
        return reply.code(404).send({ error: "BUDDY_NOT_FOUND" });
      }
      if (buddy.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const [updated] = await db
        .update(buddies)
        .set({ name: parsed.data.name, updatedAt: new Date() })
        .where(eq(buddies.id, id))
        .returning();

      return reply.send({ buddy: updated });
    },
  );

  // GET /buddies/:id/trades — buddy trade history
  app.get<{ Params: { id: string } }>(
    "/buddies/:id/trades",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;

      // Verify buddy ownership
      const [buddy] = await db
        .select({ userId: buddies.userId })
        .from(buddies)
        .where(eq(buddies.id, id))
        .limit(1);

      if (!buddy) {
        return reply.code(404).send({ error: "BUDDY_NOT_FOUND" });
      }
      if (buddy.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const trades = await db
        .select()
        .from(buddyTrades)
        .where(eq(buddyTrades.buddyId, id))
        .orderBy(desc(buddyTrades.createdAt))
        .limit(50);

      return reply.send({ trades });
    },
  );
}
