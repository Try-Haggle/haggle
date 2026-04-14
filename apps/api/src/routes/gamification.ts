import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { agentLevels, buddyTrades } from "@haggle/db";
import { eq, desc, sql } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

// ────────────────────────────────────────────────────────────────
// Agent level progression table
// ────────────────────────────────────────────────────────────────

const AGENT_LEVEL_TABLE = [
  { level: 1, xp: 0 },
  { level: 5, xp: 2_000 },
  { level: 10, xp: 8_000 },
  { level: 15, xp: 18_000 },
  { level: 20, xp: 35_000 },
  { level: 25, xp: 60_000 },
  { level: 30, xp: 100_000 },
  { level: 40, xp: 220_000 },
  { level: 50, xp: 500_000 },
] as const;

/**
 * Given a current level, return the XP required for the next milestone level.
 * Returns null if the user has reached or exceeded the max defined level.
 */
function getNextLevelXp(currentLevel: number): number | null {
  for (const entry of AGENT_LEVEL_TABLE) {
    if (entry.level > currentLevel) {
      return entry.xp;
    }
  }
  return null;
}

const VALID_SORT_FIELDS = ["level", "volume", "savings", "deals"] as const;
type SortField = (typeof VALID_SORT_FIELDS)[number];

function getSortColumn(sort: SortField) {
  switch (sort) {
    case "level": return agentLevels.level;
    case "volume": return agentLevels.totalVolume;
    case "savings": return agentLevels.totalSaved;
    case "deals": return agentLevels.totalDeals;
  }
}

const leaderboardQuerySchema = z.object({
  sort: z.enum(VALID_SORT_FIELDS).default("level"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function registerGamificationRoutes(app: FastifyInstance, db: Database) {
  // GET /me/level — user's agent level + XP + stats
  app.get(
    "/me/level",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;

      const [row] = await db
        .select()
        .from(agentLevels)
        .where(eq(agentLevels.userId, userId))
        .limit(1);

      if (!row) {
        // User has no level record yet — return defaults
        return reply.send({
          level_info: {
            userId,
            level: 1,
            xp: 0,
            totalTrades: 0,
            totalDeals: 0,
            totalVolume: "0",
            totalSaved: "0",
            avgSavingPct: "0",
            bestSavingPct: "0",
            consecutiveDeals: 0,
            nextLevelXp: AGENT_LEVEL_TABLE[1].xp, // 2000
          },
        });
      }

      return reply.send({
        level_info: {
          ...row,
          nextLevelXp: getNextLevelXp(row.level),
        },
      });
    },
  );

  // GET /leaderboard — global leaderboard
  app.get(
    "/leaderboard",
    async (request, reply) => {
      const parsed = leaderboardQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
      }

      const { sort, limit } = parsed.data;
      const sortColumn = getSortColumn(sort);

      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(agentLevels)
          .orderBy(desc(sortColumn))
          .limit(limit),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(agentLevels),
      ]);

      return reply.send({
        leaderboard: rows,
        total: totalResult[0]?.total ?? 0,
      });
    },
  );

  // GET /leaderboard/:category — category-specific leaderboard (Olympics)
  app.get<{ Params: { category: string } }>(
    "/leaderboard/:category",
    async (request, reply) => {
      const { category } = request.params;

      const limitParam = (request.query as Record<string, string>)?.limit;
      const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 100);

      // Aggregate buddyTrades by category, group by userId (via buddy ownership join)
      // Since buddyTrades doesn't have userId directly, we join through buddies
      const rows = await db.execute(sql`
        SELECT
          b.user_id AS "userId",
          COUNT(*)::int AS "tradeCount",
          COUNT(*) FILTER (WHERE bt.outcome = 'DEAL')::int AS "deals",
          COALESCE(SUM(bt.saving_pct::numeric), 0) AS "totalSavingPct",
          COALESCE(AVG(bt.saving_pct::numeric), 0) AS "avgSavingPct"
        FROM buddy_trades bt
        INNER JOIN buddies b ON b.id = bt.buddy_id
        WHERE bt.category = ${category}
        GROUP BY b.user_id
        ORDER BY "totalSavingPct" DESC
        LIMIT ${limit}
      `);

      return reply.send({
        category,
        leaderboard: rows,
      });
    },
  );
}
