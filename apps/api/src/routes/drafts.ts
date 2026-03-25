import type { FastifyInstance } from "fastify";
import { type Database, listingDrafts, eq } from "@haggle/db";
import {
  createDraft,
  getDraftById,
  patchDraft,
  validateDraft,
  publishDraft,
  type DraftPatch,
} from "../services/draft.service.js";

export function registerDraftRoutes(app: FastifyInstance, db: Database) {
  // POST /api/drafts — create a new empty draft
  app.post<{
    Body: { userId: string };
  }>("/api/drafts", async (request, reply) => {
    const { userId } = request.body ?? {};

    if (!userId) {
      return reply.status(401).send({ ok: false, error: "unauthorized", message: "userId is required" });
    }

    const draft = await createDraft(db);

    // Link userId immediately (web app flow)
    if (draft) {
      await db
        .update(listingDrafts)
        .set({ userId, updatedAt: new Date() })
        .where(eq(listingDrafts.id, draft.id));
    }

    return reply.send({ ok: true, draft });
  });

  // PATCH /api/drafts/:id — update draft fields
  app.patch<{
    Params: { id: string };
    Body: DraftPatch & { userId?: string };
  }>("/api/drafts/:id", async (request, reply) => {
    const { id } = request.params;
    const { userId, ...patch } = request.body ?? {};

    // Verify ownership
    const existing = await getDraftById(db, id);
    if (!existing) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (!userId || existing.userId !== userId) {
      return reply.status(403).send({ ok: false, error: "forbidden", message: "Not the owner of this draft" });
    }

    const draft = await patchDraft(db, id, patch);

    return reply.send({ ok: true, draft });
  });

  // POST /api/drafts/:id/validate — pre-publish validation
  app.post<{
    Params: { id: string };
    Body: { userId?: string };
  }>("/api/drafts/:id/validate", async (request, reply) => {
    const { id } = request.params;
    const { userId } = request.body ?? {};

    const draft = await getDraftById(db, id);
    if (!draft) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (!userId || draft.userId !== userId) {
      return reply.status(403).send({ ok: false, error: "forbidden" });
    }

    const errors = validateDraft(draft);

    if (errors.length > 0) {
      return reply.send({ ok: false, errors });
    }

    return reply.send({ ok: true });
  });

  // POST /api/drafts/:id/publish — validate + publish
  app.post<{
    Params: { id: string };
    Body: { userId?: string };
  }>("/api/drafts/:id/publish", async (request, reply) => {
    const { id } = request.params;
    const { userId } = request.body ?? {};

    const draft = await getDraftById(db, id);
    if (!draft) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (!userId || draft.userId !== userId) {
      return reply.status(403).send({ ok: false, error: "forbidden" });
    }

    const errors = validateDraft(draft);
    if (errors.length > 0) {
      return reply.send({ ok: false, errors });
    }

    try {
      const result = await publishDraft(db, id);
      return reply.send({ ok: true, ...result });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to publish";
      return reply.status(400).send({ ok: false, error: message });
    }
  });
}
