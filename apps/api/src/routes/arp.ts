import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAdmin } from "../middleware/require-auth.js";
import {
  classifyAmountTier,
  getColdStartHours,
  computeSignals,
  computeAdjustment,
} from "@haggle/arp-core";
import type { Category, AmountTier } from "@haggle/arp-core";
import {
  getSegment,
  listSegments,
  updateSegmentReviewHours,
} from "../services/arp-segment.service.js";

const adjustSignalsSchema = z.object({
  signals: z.object({
    total_actions: z.number().int().min(0),
    late_disputes: z.number().int().min(0),
    late_valid_disputes: z.number().int().min(0),
    discovery_p90_hours: z.number().min(0),
    auto_confirms: z.number().int().min(0),
    buyer_valid_disputes: z.number().int().min(0),
  }),
});

export function registerARPRoutes(app: FastifyInstance, db: Database) {
  // GET /arp/review-hours
  app.get<{ Querystring: { category?: string; amount_minor?: string; tags?: string } }>(
    "/arp/review-hours",
    async (request, reply) => {
      const query = request.query as { category?: string; amount_minor?: string; tags?: string };
      const category = query.category as Category | undefined;
      const amountMinor = query.amount_minor ? Number(query.amount_minor) : undefined;
      const tagList = query.tags ? query.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

      const amountTier = amountMinor != null ? classifyAmountTier(amountMinor) : undefined;

      // Try DB segment lookup
      const segment = await getSegment(db, category, amountTier, tagList[0]);
      if (segment) {
        return reply.send({
          review_hours: Number(segment.reviewHours),
          source: "segment",
          segment_key: {
            category: segment.category,
            amount_tier: segment.amountTier,
            tag: segment.tag,
          },
        });
      }

      // Fall back to cold-start defaults
      const coldCategory = category ?? "GENERAL_GOODS";
      const coldAmountTier = amountTier ?? "MID";
      const hours = getColdStartHours(coldCategory as Category, coldAmountTier);

      return reply.send({
        review_hours: hours,
        source: "cold_start",
      });
    },
  );

  // GET /arp/segments
  app.get("/arp/segments", async (_request, reply) => {
    const rows = await listSegments(db);
    return reply.send({ segments: rows });
  });

  // POST /arp/segments/:id/adjust
  app.post<{ Params: { id: string } }>(
    "/arp/segments/:id/adjust",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = adjustSignalsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_ADJUST_REQUEST", issues: parsed.error.issues });
      }

      // Get current segment from DB
      const segments = await listSegments(db);
      const current = segments.find((s) => s.id === id);
      if (!current) {
        return reply.code(404).send({ error: "SEGMENT_NOT_FOUND" });
      }

      // Compute signals
      const signalResult = computeSignals(
        parsed.data.signals,
        Number(current.reviewHours),
      );

      // Compute adjustment
      const adjustmentResult = computeAdjustment(
        {
          key: {
            category: current.category as Category | undefined,
            amount_tier: current.amountTier as AmountTier | undefined,
            tag: current.tag as string | undefined,
          },
          review_hours: Number(current.reviewHours),
          sample_count: current.sampleCount,
        },
        signalResult,
      );

      // Persist new hours if changed
      if (adjustmentResult.direction !== "HOLD" && !adjustmentResult.skipped) {
        await updateSegmentReviewHours(
          db,
          id,
          String(adjustmentResult.new_hours),
          current.sampleCount + parsed.data.signals.total_actions,
        );
      }

      return reply.send({ adjustment: adjustmentResult });
    },
  );
}
