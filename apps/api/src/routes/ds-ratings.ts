import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { computeDSScore, checkPromotion } from "@haggle/dispute-core";
import type { DSTier } from "@haggle/dispute-core";
import {
  getDSRating,
  upsertDSRating,
  getSpecializations,
  getDSPool,
} from "../services/ds-rating.service.js";

const VALID_TIERS: DSTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"];

const computeDSSchema = z.object({
  zone_hit_rate: z.number().min(0).max(1),
  result_proximity: z.number().min(0).max(1),
  participation_rate: z.number().min(0).max(1),
  response_hours: z.number().min(0),
  cumulative_cases: z.number().int().min(0),
  unique_categories: z.number().int().min(0),
  total_categories: z.number().int().min(0),
  high_value_cases: z.number().int().min(0),
  recent_cases: z.number().int().min(0).optional(),
  current_tier: z.enum(["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"]).optional(),
});

export function registerDSRatingRoutes(app: FastifyInstance, db: Database) {
  // GET /ds-ratings/pool — MUST be before /:reviewerId
  app.get<{ Querystring: { min_tier?: string } }>(
    "/ds-ratings/pool",
    async (request, reply) => {
      const minTier = (request.query as { min_tier?: string }).min_tier ?? "BRONZE";
      if (!VALID_TIERS.includes(minTier as DSTier)) {
        return reply.code(400).send({ error: "INVALID_TIER", message: `min_tier must be one of: ${VALID_TIERS.join(", ")}` });
      }
      const rows = await getDSPool(db, minTier as DSTier);
      return reply.send({ reviewers: rows });
    },
  );

  // GET /ds-ratings/:reviewerId
  app.get<{ Params: { reviewerId: string } }>(
    "/ds-ratings/:reviewerId",
    async (request, reply) => {
      const { reviewerId } = request.params;
      const row = await getDSRating(db, reviewerId);
      if (!row) {
        return reply.code(404).send({ error: "DS_RATING_NOT_FOUND" });
      }
      return reply.send({ ds_rating: row });
    },
  );

  // POST /ds-ratings/:reviewerId/compute
  app.post<{ Params: { reviewerId: string } }>(
    "/ds-ratings/:reviewerId/compute",
    async (request, reply) => {
      const { reviewerId } = request.params;
      const parsed = computeDSSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_DS_COMPUTE_REQUEST", issues: parsed.error.issues });
      }

      const {
        zone_hit_rate,
        result_proximity,
        participation_rate,
        response_hours,
        cumulative_cases,
        unique_categories,
        total_categories,
        high_value_cases,
        recent_cases,
        current_tier,
      } = parsed.data;

      const dsResult = computeDSScore({
        zone_hit_rate,
        result_proximity,
        participation_rate,
        response_hours,
        cumulative_cases,
        unique_categories,
        total_categories,
        high_value_cases,
      });

      const promotionResult = checkPromotion(
        current_tier ?? dsResult.tier,
        dsResult.score,
        recent_cases ?? cumulative_cases,
      );

      const persisted = await upsertDSRating(db, {
        reviewerId,
        score: dsResult.score,
        tier: promotionResult.should_change ? promotionResult.new_tier : dsResult.tier,
        voteWeight: String(dsResult.vote_weight),
        cumulativeCases: cumulative_cases,
        recentCases: recent_cases ?? cumulative_cases,
        zoneHitRate: String(zone_hit_rate),
        participationRate: String(participation_rate),
        uniqueCategories: unique_categories,
      });

      return reply.send({ ds_rating: dsResult, promotion: promotionResult, record: persisted });
    },
  );

  // GET /ds-ratings/:reviewerId/specializations
  app.get<{ Params: { reviewerId: string } }>(
    "/ds-ratings/:reviewerId/specializations",
    async (request, reply) => {
      const { reviewerId } = request.params;
      const rows = await getSpecializations(db, reviewerId);
      return reply.send({ specializations: rows });
    },
  );
}
