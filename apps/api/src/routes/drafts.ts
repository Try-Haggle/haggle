import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { listingDrafts } from "@haggle/db";
import {
  LISTING_CATEGORIES,
  ITEM_CONDITIONS,
  createApiResponse,
  createApiError,
} from "@haggle/shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const draftPatchSchema = z
  .object({
    title: z.string().max(200).optional(),
    category: z.enum(LISTING_CATEGORIES).optional(),
    brand: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
    condition: z.enum(ITEM_CONDITIONS).optional(),
    description: z.string().max(2000).optional(),
    target_price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal (e.g. 99.99)")
      .optional(),
    floor_price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal (e.g. 49.99)")
      .optional(),
  })
  .strict();

function formatDraft(row: typeof listingDrafts.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    category: row.category,
    brand: row.brand,
    model: row.model,
    condition: row.condition,
    description: row.description,
    target_price: row.targetPrice,
    floor_price: row.floorPrice,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function registerDraftRoutes(app: FastifyInstance, db: Database) {
  // ─── GET /api/drafts/:id ─────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/api/drafts/:id",
    async (request, reply) => {
      const { id } = request.params;

      if (!UUID_RE.test(id)) {
        return reply
          .status(400)
          .send(createApiError("INVALID_ID", "Invalid draft ID format"));
      }

      const rows = await db
        .select()
        .from(listingDrafts)
        .where(eq(listingDrafts.id, id));

      if (rows.length === 0) {
        return reply
          .status(404)
          .send(createApiError("NOT_FOUND", "Draft not found"));
      }

      return reply.send(createApiResponse(formatDraft(rows[0])));
    },
  );

  // ─── PATCH /api/drafts/:id ───────────────────────────────
  app.patch<{ Params: { id: string } }>(
    "/api/drafts/:id",
    async (request, reply) => {
      const { id } = request.params;

      if (!UUID_RE.test(id)) {
        return reply
          .status(400)
          .send(createApiError("INVALID_ID", "Invalid draft ID format"));
      }

      const parsed = draftPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createApiError("VALIDATION_ERROR", "Invalid request body", {
            issues: parsed.error.issues,
          }),
        );
      }

      // Map snake_case input → camelCase columns
      const data = parsed.data;
      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (data.title !== undefined) updates.title = data.title;
      if (data.category !== undefined) updates.category = data.category;
      if (data.brand !== undefined) updates.brand = data.brand;
      if (data.model !== undefined) updates.model = data.model;
      if (data.condition !== undefined) updates.condition = data.condition;
      if (data.description !== undefined) updates.description = data.description;
      if (data.target_price !== undefined)
        updates.targetPrice = data.target_price;
      if (data.floor_price !== undefined) updates.floorPrice = data.floor_price;

      const rows = await db
        .update(listingDrafts)
        .set(updates)
        .where(eq(listingDrafts.id, id))
        .returning();

      if (rows.length === 0) {
        return reply
          .status(404)
          .send(createApiError("NOT_FOUND", "Draft not found"));
      }

      return reply.send(createApiResponse(formatDraft(rows[0])));
    },
  );
}
