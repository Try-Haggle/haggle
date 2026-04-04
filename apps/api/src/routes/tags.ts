import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import {
  normalizeTagName,
  validateTag,
  autoPromote,
  deprecate,
  suggestMerges,
  isExpertQualified,
} from "@haggle/tag-core";
import type { Tag } from "@haggle/tag-core";
import {
  getTagById,
  getTagByNormalizedName,
  listTags,
  createTag,
  updateTag,
  getExpertTags,
  upsertExpertTag,
  createMergeLog,
} from "../services/tag.service.js";

const createTagSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
});

const updateTagSchema = z.object({
  use_count: z.number().int().min(0).optional(),
  status: z.enum(["CANDIDATE", "EMERGING", "OFFICIAL", "DEPRECATED"]).optional(),
});

const mergeTagSchema = z.object({
  source_tag_id: z.string().min(1),
  target_tag_id: z.string().min(1),
  reason: z.enum(["levenshtein", "synonym", "manual"]),
  merged_by: z.string().min(1).optional(),
});

const qualifyExpertSchema = z.object({
  user_id: z.string().min(1),
  case_count: z.number().int().min(0),
  accuracy: z.number().min(0).max(1),
});

export function registerTagRoutes(app: FastifyInstance, db: Database) {
  // GET /tags/clusters — MUST be before /tags/:id
  app.get<{ Querystring: { category?: string } }>(
    "/tags/clusters",
    async (request, reply) => {
      const query = request.query as { category?: string };
      const rows = await listTags(db, { status: "OFFICIAL", category: query.category });

      // Convert DB rows to Tag objects for tag-core
      const tagObjects: Tag[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        normalizedName: r.normalizedName,
        status: r.status as Tag["status"],
        category: r.category,
        useCount: r.useCount,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt.toISOString(),
        parentId: r.parentId ?? undefined,
      }));

      const clusters = suggestMerges(tagObjects);
      return reply.send({ clusters });
    },
  );

  // POST /tags/merge
  app.post("/tags/merge", async (request, reply) => {
    const parsed = mergeTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_MERGE_REQUEST", issues: parsed.error.issues });
    }

    const { source_tag_id, target_tag_id, reason, merged_by } = parsed.data;

    const sourceTag = await getTagById(db, source_tag_id);
    if (!sourceTag) {
      return reply.code(404).send({ error: "SOURCE_TAG_NOT_FOUND" });
    }

    const targetTag = await getTagById(db, target_tag_id);
    if (!targetTag) {
      return reply.code(404).send({ error: "TARGET_TAG_NOT_FOUND" });
    }

    // Deprecate source and point to target
    await updateTag(db, source_tag_id, { status: "DEPRECATED", parentId: target_tag_id });

    // Add source useCount to target
    const updatedTarget = await updateTag(db, target_tag_id, {
      useCount: targetTag.useCount + sourceTag.useCount,
    });

    await createMergeLog(db, {
      sourceTagId: source_tag_id,
      targetTagId: target_tag_id,
      reason,
      mergedBy: merged_by ?? "system",
    });

    return reply.send({ merged: true, target: updatedTarget });
  });

  // GET /tags
  app.get<{ Querystring: { status?: string; category?: string } }>(
    "/tags",
    async (request, reply) => {
      const query = request.query as { status?: string; category?: string };
      const rows = await listTags(db, { status: query.status, category: query.category });
      return reply.send({ tags: rows });
    },
  );

  // POST /tags
  app.post("/tags", async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_TAG_REQUEST", issues: parsed.error.issues });
    }

    const { name, category } = parsed.data;
    const validation = validateTag(name);
    if (!validation.valid) {
      return reply.code(400).send({ error: "INVALID_TAG_NAME", issues: validation.errors });
    }

    const normalized = normalizeTagName(name);

    // Check for existing tag
    const existing = await getTagByNormalizedName(db, normalized, category);
    if (existing) {
      return reply.send({ tag: existing });
    }

    const newTag = await createTag(db, {
      name,
      normalizedName: normalized,
      category,
    });

    return reply.code(201).send({ tag: newTag });
  });

  // GET /tags/:id
  app.get<{ Params: { id: string } }>(
    "/tags/:id",
    async (request, reply) => {
      const { id } = request.params;
      const row = await getTagById(db, id);
      if (!row) {
        return reply.code(404).send({ error: "TAG_NOT_FOUND" });
      }
      return reply.send({ tag: row });
    },
  );

  // PATCH /tags/:id
  app.patch<{ Params: { id: string } }>(
    "/tags/:id",
    async (request, reply) => {
      const { id } = request.params;
      const parsed = updateTagSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_UPDATE_REQUEST", issues: parsed.error.issues });
      }

      const updateData: Record<string, unknown> = {};
      if (parsed.data.use_count !== undefined) {
        updateData.useCount = parsed.data.use_count;
      }
      if (parsed.data.status !== undefined) {
        updateData.status = parsed.data.status;
      }

      const updated = await updateTag(db, id, updateData as Parameters<typeof updateTag>[2]);
      return reply.send({ tag: updated });
    },
  );

  // POST /tags/:id/promote
  app.post<{ Params: { id: string } }>(
    "/tags/:id/promote",
    async (request, reply) => {
      const { id } = request.params;
      const row = await getTagById(db, id);
      if (!row) {
        return reply.code(404).send({ error: "TAG_NOT_FOUND" });
      }

      // Convert DB row to Tag object for tag-core
      const tag: Tag = {
        id: row.id,
        name: row.name,
        normalizedName: row.normalizedName,
        status: row.status as Tag["status"],
        category: row.category,
        useCount: row.useCount,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        parentId: row.parentId ?? undefined,
      };

      const lifecycleResult = autoPromote(tag);

      if (lifecycleResult.transitioned) {
        await updateTag(db, id, { status: lifecycleResult.newStatus });
      }

      return reply.send({ result: lifecycleResult });
    },
  );

  // POST /tags/:id/deprecate
  app.post<{ Params: { id: string } }>(
    "/tags/:id/deprecate",
    async (request, reply) => {
      const { id } = request.params;
      const row = await getTagById(db, id);
      if (!row) {
        return reply.code(404).send({ error: "TAG_NOT_FOUND" });
      }

      const tag: Tag = {
        id: row.id,
        name: row.name,
        normalizedName: row.normalizedName,
        status: row.status as Tag["status"],
        category: row.category,
        useCount: row.useCount,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        parentId: row.parentId ?? undefined,
      };

      const result = deprecate(tag, new Date().toISOString());

      if (result.transitioned) {
        await updateTag(db, id, { status: "DEPRECATED" });
      }

      return reply.send({ result });
    },
  );

  // GET /tags/:tagId/experts
  app.get<{ Params: { tagId: string } }>(
    "/tags/:tagId/experts",
    async (request, reply) => {
      const { tagId } = request.params;
      const rows = await getExpertTags(db, tagId);
      return reply.send({ experts: rows });
    },
  );

  // POST /tags/:tagId/experts/qualify
  app.post<{ Params: { tagId: string } }>(
    "/tags/:tagId/experts/qualify",
    async (request, reply) => {
      const { tagId } = request.params;
      const parsed = qualifyExpertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_QUALIFY_REQUEST", issues: parsed.error.issues });
      }

      const { user_id, case_count, accuracy } = parsed.data;

      // Get tag to determine category
      const tag = await getTagById(db, tagId);
      if (!tag) {
        return reply.code(404).send({ error: "TAG_NOT_FOUND" });
      }

      const qualified = isExpertQualified({
        userId: user_id,
        tagId,
        category: tag.category,
        caseCount: case_count,
        accuracy,
      });

      const expertTag = await upsertExpertTag(db, {
        userId: user_id,
        tagId,
        category: tag.category,
        caseCount: case_count,
        accuracy: String(accuracy),
        qualifiedAt: qualified ? new Date() : undefined,
      });

      return reply.send({ qualified, expert_tag: expertTag });
    },
  );
}
