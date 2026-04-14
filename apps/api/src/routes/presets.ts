import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { skillPresets } from "@haggle/db";
import { eq, or } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

const createPresetSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  advisorSkillId: z.string().min(1),
  advisorConfig: z.record(z.unknown()).optional(),
  validatorSkills: z.array(z.string()).optional(),
});

export function registerPresetRoutes(app: FastifyInstance, db: Database) {
  // GET /presets — list system presets + user's custom presets
  app.get(
    "/presets",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;

      const rows = await db
        .select()
        .from(skillPresets)
        .where(
          or(
            eq(skillPresets.isSystem, true),
            eq(skillPresets.userId, userId),
          ),
        );

      return reply.send({ presets: rows });
    },
  );

  // POST /presets/custom — create custom preset
  app.post(
    "/presets/custom",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = createPresetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_PRESET", issues: parsed.error.issues });
      }

      const { name, displayName, description, advisorSkillId, advisorConfig, validatorSkills } =
        parsed.data;

      const [inserted] = await db
        .insert(skillPresets)
        .values({
          name,
          displayName,
          description: description ?? null,
          advisorSkillId,
          advisorConfig: advisorConfig ?? null,
          validatorSkills: validatorSkills ?? null,
          isSystem: false,
          userId,
        })
        .returning();

      return reply.code(201).send({ preset: inserted });
    },
  );

  // GET /presets/:id/stats — preset performance stats
  app.get<{ Params: { id: string } }>(
    "/presets/:id/stats",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;

      const [preset] = await db
        .select()
        .from(skillPresets)
        .where(eq(skillPresets.id, id))
        .limit(1);

      if (!preset) {
        return reply.code(404).send({ error: "PRESET_NOT_FOUND" });
      }

      // Non-system presets must belong to the requesting user
      if (!preset.isSystem && preset.userId !== userId) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      return reply.send({
        preset,
        stats: {
          avgSavingPct: preset.avgSavingPct ?? null,
          avgWinRate: preset.avgWinRate ?? null,
          usageCount: preset.usageCount,
        },
      });
    },
  );
}
