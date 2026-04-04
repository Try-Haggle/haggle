import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth.js";
import { validateManifest, isCompatibleCategory } from "@haggle/skill-core";
import type { SkillManifest } from "@haggle/skill-core";
import {
  getSkillBySkillId,
  listSkills,
  createSkill,
  updateSkillStatus,
  updateSkillMetrics,
  recordExecution,
  getExecutionsBySkillId,
} from "../services/skill.service.js";

const createSkillSchema = z.object({
  skillId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  category: z.enum(["STRATEGY", "DATA", "INTERPRETATION", "AUTHENTICATION", "DISPUTE_RESOLUTION"]),
  provider: z.enum(["FIRST_PARTY", "THIRD_PARTY", "COMMUNITY"]),
  supportedCategories: z.array(z.string().min(1)).min(1),
  hookPoints: z.array(z.string().min(1)).min(1),
  pricing: z.object({
    model: z.enum(["FREE", "PER_USE", "SUBSCRIPTION", "REVENUE_SHARE"]),
    perUseCents: z.number().positive().optional(),
    monthlySubscriptionCents: z.number().positive().optional(),
    revenueSharePercent: z.number().min(0).max(100).optional(),
  }),
  configSchema: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const executeSkillSchema = z.object({
  hook_point: z.string().min(1),
  success: z.boolean(),
  latency_ms: z.number().int().min(0),
  input_summary: z.record(z.unknown()).optional(),
  output_summary: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export function registerSkillRoutes(app: FastifyInstance, db: Database) {
  // GET /skills/resolve — MUST be before /skills/:skillId
  app.get<{ Querystring: { hook_point?: string; product_category?: string } }>(
    "/skills/resolve",
    async (request, reply) => {
      const query = request.query as { hook_point?: string; product_category?: string };

      if (!query.hook_point) {
        return reply.code(400).send({ error: "MISSING_HOOK_POINT", message: "hook_point query param is required" });
      }

      const rows = await listSkills(db, { status: "ACTIVE", hookPoint: query.hook_point });

      // Post-filter by product_category if provided — delegates to skill-core's isCompatibleCategory
      if (query.product_category) {
        const filtered = rows.filter((r) => {
          const supported = r.supportedCategories as string[] | null;
          if (!supported) return false;
          // Construct a minimal manifest-shaped object for isCompatibleCategory
          const asManifest = { supportedCategories: supported } as SkillManifest;
          return isCompatibleCategory(asManifest, query.product_category!);
        });
        return reply.send({ skills: filtered });
      }

      return reply.send({ skills: rows });
    },
  );

  // POST /skills
  app.post("/skills", async (request, reply) => {
    const parsed = createSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_SKILL_REQUEST", issues: parsed.error.issues });
    }

    // Validate manifest via skill-core
    const manifest: SkillManifest = {
      skillId: parsed.data.skillId,
      name: parsed.data.name,
      description: parsed.data.description,
      version: parsed.data.version,
      category: parsed.data.category,
      provider: parsed.data.provider,
      supportedCategories: parsed.data.supportedCategories,
      hookPoints: parsed.data.hookPoints as SkillManifest["hookPoints"],
      pricing: parsed.data.pricing as SkillManifest["pricing"],
      configSchema: parsed.data.configSchema,
      metadata: parsed.data.metadata,
    };

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return reply.code(400).send({ error: "INVALID_MANIFEST", issues: validation.errors });
    }

    // Check for existing skill
    const existing = await getSkillBySkillId(db, parsed.data.skillId);
    if (existing) {
      return reply.code(409).send({ error: "SKILL_ALREADY_EXISTS", skillId: parsed.data.skillId });
    }

    const newSkill = await createSkill(db, {
      skillId: parsed.data.skillId,
      name: parsed.data.name,
      description: parsed.data.description,
      version: parsed.data.version,
      category: parsed.data.category,
      provider: parsed.data.provider,
      supportedCategories: parsed.data.supportedCategories,
      hookPoints: parsed.data.hookPoints,
      pricing: parsed.data.pricing as Record<string, unknown>,
      configSchema: parsed.data.configSchema,
      metadata: parsed.data.metadata,
    });

    return reply.code(201).send({ skill: newSkill });
  });

  // GET /skills
  app.get<{ Querystring: { category?: string; status?: string; hook_point?: string } }>(
    "/skills",
    async (request, reply) => {
      const query = request.query as { category?: string; status?: string; hook_point?: string };
      const rows = await listSkills(db, {
        category: query.category,
        status: query.status,
        hookPoint: query.hook_point,
      });
      return reply.send({ skills: rows });
    },
  );

  // GET /skills/:skillId
  app.get<{ Params: { skillId: string } }>(
    "/skills/:skillId",
    async (request, reply) => {
      const { skillId } = request.params;
      const row = await getSkillBySkillId(db, skillId);
      if (!row) {
        return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
      }
      return reply.send({ skill: row });
    },
  );

  // PATCH /skills/:skillId/activate — DRAFT -> ACTIVE
  app.patch<{ Params: { skillId: string } }>(
    "/skills/:skillId/activate",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { skillId } = request.params;
      const existing = await getSkillBySkillId(db, skillId);
      if (!existing) {
        return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
      }
      if (existing.status !== "DRAFT") {
        return reply.code(400).send({ error: "INVALID_TRANSITION", message: "Only DRAFT skills can be activated" });
      }
      const updated = await updateSkillStatus(db, skillId, "ACTIVE");
      return reply.send({ skill: updated });
    },
  );

  // PATCH /skills/:skillId/suspend — ACTIVE -> SUSPENDED
  app.patch<{ Params: { skillId: string } }>(
    "/skills/:skillId/suspend",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { skillId } = request.params;
      const existing = await getSkillBySkillId(db, skillId);
      if (!existing) {
        return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
      }
      if (existing.status !== "ACTIVE") {
        return reply.code(400).send({ error: "INVALID_TRANSITION", message: "Only ACTIVE skills can be suspended" });
      }
      const updated = await updateSkillStatus(db, skillId, "SUSPENDED");
      return reply.send({ skill: updated });
    },
  );

  // PATCH /skills/:skillId/deprecate — ACTIVE or SUSPENDED -> DEPRECATED
  app.patch<{ Params: { skillId: string } }>(
    "/skills/:skillId/deprecate",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { skillId } = request.params;
      const existing = await getSkillBySkillId(db, skillId);
      if (!existing) {
        return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
      }
      if (existing.status !== "ACTIVE" && existing.status !== "SUSPENDED") {
        return reply.code(400).send({ error: "INVALID_TRANSITION", message: "Only ACTIVE or SUSPENDED skills can be deprecated" });
      }
      const updated = await updateSkillStatus(db, skillId, "DEPRECATED");
      return reply.send({ skill: updated });
    },
  );

  // POST /skills/:skillId/execute — record execution log + update metrics
  app.post<{ Params: { skillId: string } }>(
    "/skills/:skillId/execute",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { skillId } = request.params;
      const parsed = executeSkillSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_EXECUTION_REQUEST", issues: parsed.error.issues });
      }

      const existing = await getSkillBySkillId(db, skillId);
      if (!existing) {
        return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
      }
      if (existing.status !== "ACTIVE") {
        return reply.code(400).send({ error: "SKILL_NOT_ACTIVE", message: "Only ACTIVE skills can be executed" });
      }

      const execution = await recordExecution(db, {
        skillId,
        hookPoint: parsed.data.hook_point,
        success: parsed.data.success,
        latencyMs: parsed.data.latency_ms,
        inputSummary: parsed.data.input_summary,
        outputSummary: parsed.data.output_summary,
        error: parsed.data.error,
      });

      await updateSkillMetrics(db, skillId, parsed.data.latency_ms, parsed.data.success);

      return reply.code(201).send({ execution });
    },
  );

  // GET /skills/:skillId/executions
  app.get<{ Params: { skillId: string }; Querystring: { limit?: string } }>(
    "/skills/:skillId/executions",
    async (request, reply) => {
      const { skillId } = request.params;
      const query = request.query as { limit?: string };
      let limit: number | undefined;
      if (query.limit) {
        const parsed = parseInt(query.limit, 10);
        limit = Number.isNaN(parsed) ? undefined : Math.min(Math.max(parsed, 1), 200);
      }

      const rows = await getExecutionsBySkillId(db, skillId, limit);
      return reply.send({ executions: rows });
    },
  );
}
