import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import type { NegotiationContext } from "@haggle/engine-core";
import { requireAuth } from "../middleware/require-auth.js";
import type { WaitingIntent } from "@haggle/engine-session";
import { transitionIntent, evaluateIntents } from "@haggle/engine-session";
import {
  getIntentById,
  getActiveIntentsByCategory,
  getIntentsByUserId,
  createIntent,
  updateIntentStatus,
  getActiveIntentCount,
  createMatch,
  expireStaleIntents,
} from "../services/intent.service.js";

const createIntentSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(["BUYER", "SELLER"]),
  category: z.string().min(1),
  keywords: z.array(z.string().min(1)),
  strategy: z.record(z.unknown()),
  min_u_total: z.number().min(0).max(1).optional(),
  max_active_sessions: z.number().int().min(1).optional(),
  expires_in_days: z.number().int().min(1).optional(),
});

const matchIntentSchema = z.object({
  listing_id: z.string().min(1).optional(),
  counter_intent_id: z.string().min(1).optional(),
  session_id: z.string().min(1),
  buyer_u_total: z.number().min(0).max(1),
  seller_u_total: z.number().min(0).max(1).optional(),
});

const triggerMatchSchema = z.object({
  category: z.string().min(1),
  listing_id: z.string().min(1).optional(),
  trigger_intent_id: z.string().min(1).optional(),
  context_template: z.record(z.unknown()),
});

export function registerIntentRoutes(app: FastifyInstance, db: Database) {
  // POST /intents
  app.post("/intents", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INTENT_REQUEST", issues: parsed.error.issues });
    }

    const {
      user_id,
      role,
      category,
      keywords,
      strategy,
      min_u_total,
      max_active_sessions,
      expires_in_days,
    } = parsed.data;

    // Capacity check
    const activeCount = await getActiveIntentCount(db, user_id);
    const maxSessions = max_active_sessions ?? 5;
    if (activeCount >= maxSessions) {
      return reply.code(409).send({
        error: "INTENT_CAPACITY_EXCEEDED",
        active_count: activeCount,
        max_allowed: maxSessions,
      });
    }

    const days = expires_in_days ?? 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const intent = await createIntent(db, {
      userId: user_id,
      role,
      category,
      keywords,
      strategySnapshot: strategy,
      minUtotal: min_u_total != null ? String(min_u_total) : undefined,
      maxActiveSessions: max_active_sessions,
      expiresAt,
    });

    return reply.code(201).send({ intent });
  });

  // GET /intents
  app.get<{ Querystring: { user_id?: string; category?: string; status?: string; role?: string } }>(
    "/intents",
    async (request, reply) => {
      const query = request.query as { user_id?: string; category?: string; status?: string; role?: string };

      if (query.user_id) {
        const rows = await getIntentsByUserId(db, query.user_id, query.status);
        return reply.send({ intents: rows });
      }

      if (query.category) {
        const rows = await getActiveIntentsByCategory(db, query.category, query.role);
        return reply.send({ intents: rows });
      }

      // No filters — return empty to avoid full table scan
      return reply.send({ intents: [] });
    },
  );

  // GET /intents/:id
  app.get<{ Params: { id: string } }>(
    "/intents/:id",
    async (request, reply) => {
      const { id } = request.params;
      const intent = await getIntentById(db, id);
      if (!intent) {
        return reply.code(404).send({ error: "INTENT_NOT_FOUND" });
      }
      return reply.send({ intent });
    },
  );

  // PATCH /intents/:id/cancel
  app.patch<{ Params: { id: string } }>(
    "/intents/:id/cancel",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const intent = await getIntentById(db, id);
      if (!intent) {
        return reply.code(404).send({ error: "INTENT_NOT_FOUND" });
      }

      const nextStatus = transitionIntent(intent.status, "CANCEL");
      if (nextStatus === null) {
        return reply.code(400).send({ error: "INVALID_TRANSITION", current_status: intent.status });
      }

      const updated = await updateIntentStatus(db, id, nextStatus);
      return reply.send({ intent: updated });
    },
  );

  // POST /intents/:id/match
  app.post<{ Params: { id: string } }>(
    "/intents/:id/match",
    async (request, reply) => {
      const { id } = request.params;
      const parsed = matchIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_MATCH_REQUEST", issues: parsed.error.issues });
      }

      const intent = await getIntentById(db, id);
      if (!intent) {
        return reply.code(404).send({ error: "INTENT_NOT_FOUND" });
      }

      if (intent.status !== "ACTIVE") {
        return reply.code(400).send({ error: "INTENT_NOT_ACTIVE", current_status: intent.status });
      }

      const nextStatus = transitionIntent(intent.status, "MATCH");
      if (nextStatus === null) {
        return reply.code(400).send({ error: "INVALID_TRANSITION", current_status: intent.status });
      }

      const updated = await updateIntentStatus(db, id, nextStatus, { matchedAt: new Date() });

      const match = await createMatch(db, {
        intentId: id,
        counterpartyIntentId: parsed.data.counter_intent_id,
        listingId: parsed.data.listing_id,
        sessionId: parsed.data.session_id,
        buyerUtotal: String(parsed.data.buyer_u_total),
        sellerUtotal: parsed.data.seller_u_total != null ? String(parsed.data.seller_u_total) : undefined,
      });

      return reply.send({ intent: updated, match });
    },
  );

  // POST /intents/trigger-match — MUST be before /:id routes but Fastify handles this via method+path
  app.post("/intents/trigger-match", async (request, reply) => {
    const parsed = triggerMatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_TRIGGER_REQUEST", issues: parsed.error.issues });
    }

    const { category, context_template } = parsed.data;

    const dbIntents = await getActiveIntentsByCategory(db, category);
    if (dbIntents.length === 0) {
      return reply.send({ match_result: { matched: [], rejected: [], total_evaluated: 0 } });
    }

    // Convert DB rows to WaitingIntent objects for engine-session
    const intents: WaitingIntent[] = dbIntents.map((row) => ({
      intentId: row.id,
      userId: row.userId,
      role: row.role as "BUYER" | "SELLER",
      category: row.category,
      keywords: row.keywords as string[],
      strategy: row.strategySnapshot as unknown as WaitingIntent["strategy"],
      minUtotal: Number(row.minUtotal),
      maxActiveSessions: row.maxActiveSessions,
      currentActiveSessions: 0, // Caller would provide real count; MVP simplification
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      status: row.status as WaitingIntent["status"],
    }));

    // contextBuilder: merge the template with per-intent data
    const contextBuilder = (_intent: WaitingIntent): NegotiationContext => {
      return context_template as unknown as NegotiationContext;
    };

    const result = evaluateIntents(intents, contextBuilder);

    return reply.send({
      match_result: {
        matched: result.matched,
        rejected: result.rejected,
        total_evaluated: result.totalEvaluated,
      },
    });
  });

  // POST /intents/expire — admin/cron
  app.post("/intents/expire", async (_request, reply) => {
    const expiredCount = await expireStaleIntents(db);
    return reply.send({ expired_count: expiredCount });
  });
}
