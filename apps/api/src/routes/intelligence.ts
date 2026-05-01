import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import {
  listUserMemoryCards,
  resetUserMemoryCards,
  suppressUserMemoryCard,
} from "../services/user-memory-card.service.js";
import { replayConversationSignalSources } from "../services/conversation-signal-replay.service.js";
import {
  advisorMemorySaveBodySchema,
  saveAdvisorMemorySnapshot,
} from "../services/advisor-memory.service.js";

const listMemoryQuerySchema = z.object({
  include_suppressed: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const suppressParamsSchema = z.object({
  cardId: z.string().uuid(),
});

const memoryControlBodySchema = z.object({
  reason: z.string().max(300).optional(),
});

const replayBodySchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  session_id: z.string().uuid().optional(),
  source_key: z.string().min(1).optional(),
});

export function registerIntelligenceRoutes(app: FastifyInstance, db: Database) {
  app.post("/intelligence/advisor-memory", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = advisorMemorySaveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const body = parsed.data;
    const result = await saveAdvisorMemorySnapshot(db, {
      userId: request.user!.id,
      sessionId: body.session_id,
      agentId: body.agent_id,
      message: body.message,
      memory: body.memory,
      surface: "advisor_memory_api",
    });

    return reply.send(result);
  });

  app.get("/intelligence/memory/cards", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = listMemoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const cards = await listUserMemoryCards(db, {
      userId: request.user!.id,
      includeSuppressed: parsed.data.include_suppressed,
      limit: parsed.data.limit,
    });

    return reply.send({ user_id: request.user!.id, cards });
  });

  app.patch("/intelligence/memory/cards/:cardId/suppress", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = suppressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "INVALID_PARAMS", issues: params.error.issues });
    }
    const body = memoryControlBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: body.error.issues });
    }

    const result = await suppressUserMemoryCard(db, {
      userId: request.user!.id,
      cardId: params.data.cardId,
      reason: body.data.reason,
    });

    if (result.affected === 0) {
      return reply.code(404).send({ error: "MEMORY_CARD_NOT_FOUND" });
    }

    return reply.send({ user_id: request.user!.id, ...result });
  });

  app.delete("/intelligence/memory", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = memoryControlBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: body.error.issues });
    }

    const result = await resetUserMemoryCards(db, {
      userId: request.user!.id,
      reason: body.data.reason,
    });

    return reply.send({ user_id: request.user!.id, ...result });
  });

  app.post("/intelligence/ops/replay-source-only", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = replayBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const result = await replayConversationSignalSources(db, {
      limit: parsed.data.limit,
      sessionId: parsed.data.session_id,
      sourceKey: parsed.data.source_key,
    });

    return reply.send(result);
  });
}
