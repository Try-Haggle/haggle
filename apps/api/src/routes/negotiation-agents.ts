/**
 * Production negotiation-agents routes.
 *
 * URL namespace `/negotiations/agents/*` (rebuild plan 2026-05-28, option B).
 *
 * Independent of `intelligence-demo.ts` — the demo file is reference-only.
 * Logic lives in `services/negotiation-agent-builder-chat.service.ts`, which
 * is a verbatim copy of the demo logic minus the demo-only route function
 * and the DEMO_USER_ID schema default.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Database, negotiationAgents, and, eq, inArray, or } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
} from "../services/negotiation-agent-builder-chat.service.js";

/** Default skill id stored in the legacy `advisor_skill_id` column. The column
 *  is NOT NULL, but user-created agents do not select an LLM skill — they all
 *  use the standard NegotiationAgentBuilder pipeline. */
const DEFAULT_BUILDER_SKILL_ID = "negotiation-agent-builder-v1";

/** Roles surfaced on /buy/agents vs /sell/agents. `both` shows on either. */
const agentRoleSchema = z.enum(["buyer", "seller", "both"]);

const weightsSchema = z.object({
  w_p: z.number(),
  w_t: z.number(),
  w_r: z.number(),
  w_s: z.number(),
});

/** Fields stored inside `negotiation_agent_config` jsonb. Mirrors the
 *  `NegotiationAgent` type in @haggle/shared modulo top-level columns. */
const negotiationAgentConfigSchema = z.object({
  emoji: z.string().optional(),
  basePresetId: z.string().optional(),
  stats: z.record(z.number()).optional(),
  negotiationAgentPresetId: z.string().optional(),
  weights: weightsSchema.optional(),
  engineParams: z.record(z.unknown()).optional(),
  categoryAnswers: z.record(z.record(z.unknown())).optional(),
  voiceId: z.string().optional(),
  /** Latest memory snapshot captured from the builder chat. */
  builderChatMemory: z.record(z.unknown()).optional(),
});

const createNegotiationAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  role: agentRoleSchema.default("both"),
  config: negotiationAgentConfigSchema.default({}),
});

const updateNegotiationAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  role: agentRoleSchema.optional(),
  config: negotiationAgentConfigSchema.optional(),
});

const listQuerySchema = z.object({
  role: z.enum(["buyer", "seller", "both", "any"]).default("any"),
});

export function registerNegotiationAgentRoutes(
  app: FastifyInstance,
  db: Database,
) {
  /**
   * POST /negotiations/agents/builder/chat-turn
   *
   * Optional auth — buyers on /l/:publicId hit this anonymously while building
   * their negotiation agent, and authenticated sellers hit it from the
   * agent-builder pages. When authenticated, request.user.id overrides any
   * body.user_id; for guests the field stays undefined and the service treats
   * the turn as session-scoped.
   */
  app.post("/negotiations/agents/builder/chat-turn", async (request, reply) => {
    const parsed = negotiationAgentBuilderTurnBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const userId = request.user?.id ?? parsed.data.user_id ?? null;

    try {
      const result = await processNegotiationAgentBuilderTurn({
        ...parsed.data,
        user_id: userId ?? undefined,
      });
      return reply.send({
        user_id: userId,
        agent_id: parsed.data.agent_id,
        ...result,
      });
    } catch (err) {
      request.log.error(
        { err },
        "negotiation agent builder chat turn failed",
      );
      return reply.code(502).send({
        error: "CHAT_TURN_FAILED",
        message: err instanceof Error ? err.message : "Chat turn failed",
      });
    }
  });

  // ─── Agent CRUD ─────────────────────────────────────────────────────────
  //
  // All CRUD endpoints require auth. System presets (isSystem=true) are
  // included in list responses but cannot be edited or deleted by users.

  /** POST /negotiations/agents — create a user-owned agent. */
  app.post(
    "/negotiations/agents",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = createNegotiationAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_AGENT", issues: parsed.error.issues });
      }

      const { name, description, role, config } = parsed.data;

      const [inserted] = await db
        .insert(negotiationAgents)
        .values({
          name,
          displayName: name,
          description: description ?? null,
          advisorSkillId: DEFAULT_BUILDER_SKILL_ID,
          negotiationAgentConfig: config,
          role,
          isSystem: false,
          userId,
        })
        .returning();

      return reply.code(201).send({ agent: inserted });
    },
  );

  /** GET /negotiations/agents?role=buyer|seller|both|any
   *  Returns system presets + the caller's custom agents, optionally filtered
   *  by `role`. `any` returns all roles. */
  app.get(
    "/negotiations/agents",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const query = listQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_QUERY", issues: query.error.issues });
      }

      const ownership = or(
        eq(negotiationAgents.isSystem, true),
        eq(negotiationAgents.userId, userId),
      );
      const where =
        query.data.role === "any"
          ? ownership
          : and(
              ownership,
              inArray(
                negotiationAgents.role,
                [query.data.role, "both"] as const,
              ),
            );

      const rows = await db.select().from(negotiationAgents).where(where);
      return reply.send({ agents: rows });
    },
  );

  /** GET /negotiations/agents/:id — fetch one. Ownership-checked. */
  app.get<{ Params: { id: string } }>(
    "/negotiations/agents/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const [row] = await db
        .select()
        .from(negotiationAgents)
        .where(eq(negotiationAgents.id, request.params.id))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }
      if (!row.isSystem && row.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
      return reply.send({ agent: row });
    },
  );

  /** PATCH /negotiations/agents/:id — partial update. System presets are
   *  read-only; users can only edit their own custom agents. */
  app.patch<{ Params: { id: string } }>(
    "/negotiations/agents/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = updateNegotiationAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_AGENT", issues: parsed.error.issues });
      }

      const [existing] = await db
        .select()
        .from(negotiationAgents)
        .where(eq(negotiationAgents.id, request.params.id))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }
      if (existing.isSystem || existing.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) {
        patch.name = parsed.data.name;
        patch.displayName = parsed.data.name;
      }
      if (parsed.data.description !== undefined) {
        patch.description = parsed.data.description;
      }
      if (parsed.data.role !== undefined) patch.role = parsed.data.role;
      if (parsed.data.config !== undefined) {
        patch.negotiationAgentConfig = parsed.data.config;
      }

      const [updated] = await db
        .update(negotiationAgents)
        .set(patch)
        .where(
          and(
            eq(negotiationAgents.id, request.params.id),
            eq(negotiationAgents.userId, userId),
          ),
        )
        .returning();

      return reply.send({ agent: updated });
    },
  );

  /** DELETE /negotiations/agents/:id — hard delete (no soft-delete column).
   *  System presets are protected; users can only delete their own agents. */
  app.delete<{ Params: { id: string } }>(
    "/negotiations/agents/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const [existing] = await db
        .select()
        .from(negotiationAgents)
        .where(eq(negotiationAgents.id, request.params.id))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }
      if (existing.isSystem || existing.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      await db
        .delete(negotiationAgents)
        .where(
          and(
            eq(negotiationAgents.id, request.params.id),
            eq(negotiationAgents.userId, userId),
          ),
        );

      return reply.code(204).send();
    },
  );
}
