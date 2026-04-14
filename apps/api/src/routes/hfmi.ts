/**
 * HFMI (Haggle Fair Market Index) routes.
 *
 * Public:
 *   GET /hfmi/:model/median — 30-day observation median (public, no auth)
 *
 * Admin:
 *   POST /hfmi/observations — bulk insert observations
 *   POST /hfmi/fit          — trigger model fitting for a SKU
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAdmin } from "../middleware/require-auth.js";
import { getMedianPrice } from "../services/hfmi.service.js";
import { fitModel } from "../services/hfmi-fitter.js";
import { hfmiPriceObservations } from "@haggle/db";

// ─── Validation schemas ────────────────────────────────────────────────

const medianQuerySchema = z.object({
  storage: z.coerce.number().int().positive().optional(),
  condition: z.enum(["A", "B", "C"]).optional(),
});

const observationSchema = z.object({
  source: z.enum([
    "ebay_browse",
    "ebay_sold",
    "terapeak_manual",
    "marketplace_insights",
    "gazelle",
    "backmarket",
    "haggle_internal",
  ]),
  model: z.string().min(1),
  storage_gb: z.number().int().positive().optional(),
  battery_health_pct: z.number().int().min(0).max(100).optional(),
  cosmetic_grade: z.enum(["A", "B", "C"]).optional(),
  carrier_locked: z.boolean().optional().default(false),
  observed_price_usd: z.number().positive(),
  observed_at: z.string().datetime(),
  external_id: z.string().optional(),
});

const bulkInsertSchema = z.object({
  observations: z.array(observationSchema).min(1).max(500),
});

const fitBodySchema = z.object({
  model: z.string().min(1),
});

// ─── Route registration ────────────────────────────────────────────────

export function registerHfmiRoutes(app: FastifyInstance, db: Database) {
  // ── GET /hfmi/:model/median (PUBLIC) ──────────────────────────────
  app.get<{
    Params: { model: string };
    Querystring: { storage?: string; condition?: string };
  }>("/hfmi/:model/median", async (request, reply) => {
    const parsed = medianQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const { model } = request.params;
    const { storage, condition } = parsed.data;

    const result = await getMedianPrice(db, model, storage, condition);
    if (!result) {
      return reply.code(404).send({ error: "NO_DATA", model });
    }

    return reply.send(result);
  });

  // ── POST /hfmi/observations (ADMIN) ───────────────────────────────
  app.post(
    "/hfmi/observations",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = bulkInsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }

      const rows = parsed.data.observations.map((obs) => ({
        source: obs.source,
        model: obs.model,
        storageGb: obs.storage_gb,
        batteryHealthPct: obs.battery_health_pct,
        cosmeticGrade: obs.cosmetic_grade,
        carrierLocked: obs.carrier_locked,
        observedPriceUsd: obs.observed_price_usd.toFixed(2),
        observedAt: new Date(obs.observed_at),
        externalId: obs.external_id,
      }));

      await db.insert(hfmiPriceObservations).values(rows).onConflictDoNothing();

      return reply.send({ inserted: rows.length });
    },
  );

  // ── POST /hfmi/fit (ADMIN) ─────────────────────────────────────────
  app.post(
    "/hfmi/fit",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = fitBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }

      const outcome = await fitModel(
        db,
        parsed.data.model as Parameters<typeof fitModel>[1],
      );
      if (!outcome.ok) {
        return reply
          .code(422)
          .send({ error: "FIT_REJECTED", ...outcome });
      }

      return reply.send(outcome);
    },
  );
}
