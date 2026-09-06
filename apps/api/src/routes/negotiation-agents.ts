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

import { and, type Database, desc, eq, inArray, negotiationAgents, or } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
  sanitizePersistedBuilderMemory,
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
  negotiationAgentPresetId: z.string().optional(),
  weights: weightsSchema.optional(),
  engineParams: z.record(z.unknown()).optional(),
  categoryAnswers: z.record(z.record(z.unknown())).optional(),
  voiceId: z.string().optional(),
  /** Latest memory snapshot captured from the builder chat. Sanitized to the
   *  durable fields only — the session-only scratchpad is dropped on persist. */
  builderChatMemory: z
    .record(z.unknown())
    .optional()
    .transform((m) => sanitizePersistedBuilderMemory(m)),
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

export function registerNegotiationAgentRoutes(app: FastifyInstance, db: Database) {
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
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }

    const userId = request.user?.id ?? parsed.data.user_id ?? null;

    try {
      // Feature ②: serve checks already LEARNED for this category deterministically, so a
      // warmed category no longer depends on the LLM thinking of the question. Degrades
      // to the static taxonomy if the lookup fails.
      const learningTags = parsed.data.listings.flatMap((l) =>
        [l.category, ...l.tags].filter((t): t is string => typeof t === "string" && t.length > 0),
      );
      let learnedChecks: Array<{ id: string; questionKo: string; buyerAskKo?: string }> = [];
      if (learningTags.length > 0) {
        try {
          const { loadPromotedLearnedChecks } = await import(
            "../services/category-check-learning.service.js"
          );
          learnedChecks = await loadPromotedLearnedChecks(db, learningTags);
        } catch (err) {
          request.log.warn({ err }, "learned-check load failed; using static taxonomy");
        }
      }

      const result = await processNegotiationAgentBuilderTurn({
        ...parsed.data,
        user_id: userId ?? undefined,
        learned_checks: learnedChecks,
      });

      // Feature ②: a question the static taxonomy does not cover is evidence the taxonomy
      // is missing a check for this category. Record it (best-effort, never awaited into
      // the response path) so recurring gaps can be promoted to a deterministic check.
      const observations = result.learning_observations ?? [];
      if (observations.length > 0) {
        void (async () => {
          try {
            const { recordCategoryCheckObservation, promoteEligibleCategoryChecks } = await import(
              "../services/category-check-learning.service.js"
            );
            for (const observation of observations) {
              await recordCategoryCheckObservation(db, { ...observation, origin: "BUILDER" });
            }
            // Scoped to the paths just touched — a builder turn must not sweep the table.
            await promoteEligibleCategoryChecks(
              db,
              observations.map((o) => o.categoryPath),
            );
          } catch (err) {
            request.log.warn({ err }, "category-check learning capture failed");
          }
        })();
      }

      return reply.send({
        user_id: userId,
        agent_id: parsed.data.agent_id,
        ...result,
      });
    } catch (err) {
      request.log.error({ err }, "negotiation agent builder chat turn failed");
      return reply.code(502).send({
        error: "CHAT_TURN_FAILED",
        message: "The negotiation advisor could not complete its response. Please try again.",
      });
    }
  });

  // ─── Agent CRUD ─────────────────────────────────────────────────────────
  //
  // All CRUD endpoints require auth. System presets (isSystem=true) are
  // included in list responses but cannot be edited or deleted by users.

  /** POST /negotiations/agents — create a user-owned agent. */
  app.post("/negotiations/agents", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = createNegotiationAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_AGENT", issues: parsed.error.issues });
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
  });

  /** GET /negotiations/agents?role=buyer|seller|both|any
   *  Returns system presets + the caller's custom agents, optionally filtered
   *  by `role`. `any` returns all roles. */
  app.get("/negotiations/agents", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const query = listQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: query.error.issues });
    }

    const ownership = or(
      eq(negotiationAgents.isSystem, true),
      eq(negotiationAgents.userId, userId),
    );
    const where =
      query.data.role === "any"
        ? ownership
        : and(ownership, inArray(negotiationAgents.role, [query.data.role, "both"] as const));

    // Most recently touched first: the roster is a working list, and the
    // agent you just edited is the one you are most likely to want next.
    // Without an ORDER BY the rows came back in whatever order Postgres found
    // them, which tracks physical layout — so editing an agent could silently
    // move it. `createdAt` breaks ties so two rows written in the same
    // millisecond (seeded presets) cannot swap between requests.
    const rows = await db
      .select()
      .from(negotiationAgents)
      .where(where)
      .orderBy(desc(negotiationAgents.updatedAt), desc(negotiationAgents.createdAt));
    return reply.send({ agents: rows });
  });

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
        return reply.code(400).send({ error: "INVALID_AGENT", issues: parsed.error.issues });
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
          and(eq(negotiationAgents.id, request.params.id), eq(negotiationAgents.userId, userId)),
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
          and(eq(negotiationAgents.id, request.params.id), eq(negotiationAgents.userId, userId)),
        );

      return reply.code(204).send();
    },
  );
}
