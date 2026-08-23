import { type Database, eq, listingDrafts } from "@haggle/db";
import { enrichTagsWithTaxonomy } from "@haggle/shared";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import { getNotificationUserInfo } from "../notification/get-user-info.js";
import type { NotificationBus } from "../notification/index.js";
import {
  createDraft,
  type DraftPatch,
  getDraftById,
  getDraftsByUserId,
  patchDraft,
  publishDraft,
  validateDraft,
} from "../services/draft.service.js";

export function registerDraftRoutes(
  app: FastifyInstance,
  db: Database,
  notificationBus: NotificationBus,
) {
  // GET /api/drafts — list user's in-progress drafts
  app.get("/api/drafts", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const drafts = await getDraftsByUserId(db, userId);
    return reply.send({ ok: true, drafts });
  });

  // GET /api/drafts/:id — get a single draft
  app.get<{ Params: { id: string } }>(
    "/api/drafts/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;
      const draft = await getDraftById(db, id);
      if (!draft) return reply.status(404).send({ ok: false, error: "not_found" });
      if (draft.userId !== userId) return reply.status(403).send({ ok: false, error: "forbidden" });
      return reply.send({ ok: true, draft });
    },
  );

  // POST /api/drafts — create a new empty draft
  app.post("/api/drafts", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

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
    Body: DraftPatch;
  }>("/api/drafts/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;
    const patch = request.body ?? {};

    // Verify ownership
    const existing = await getDraftById(db, id);
    if (!existing) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (existing.userId !== userId) {
      return reply
        .status(403)
        .send({ ok: false, error: "forbidden", message: "Not the owner of this draft" });
    }

    const draft = await patchDraft(db, id, patch);

    return reply.send({ ok: true, draft });
  });

  // POST /api/drafts/:id/auto-detect — vision classify + tag suggestion
  app.post<{
    Params: { id: string };
  }>("/api/drafts/:id/auto-detect", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const draft = await getDraftById(db, id);
    if (!draft) return reply.status(404).send({ ok: false, error: "not_found" });
    if (draft.userId !== userId) return reply.status(403).send({ ok: false, error: "forbidden" });
    if (!draft.photoUrl || !draft.title) {
      return reply.status(400).send({ ok: false, error: "photo and title are required" });
    }

    const { autoDetectListing } = await import("../services/listing-auto-detect.service.js");
    // Belt-and-braces: autoDetectListing is contractually non-throwing, but tag enrichment
    // below is the part that actually matters, so an unexpected throw must not 500 either.
    const result = await autoDetectListing({
      photoUrl: draft.photoUrl,
      title: draft.title,
      description: draft.description ?? null,
    }).catch((err) => {
      request.log.warn({ err }, "auto-detect vision failed; continuing with tag enrichment");
      return { ok: false as const, error: { code: "OPENAI_ERROR" as const, message: String(err) } };
    });

    // Vision output is ADVISORY. The taxonomy enrichment below is what the criteria /
    // PAUSE system actually needs (an item-type tag), and it is derived deterministically
    // from the listing's own text — so a vision outage (unreachable image, missing key,
    // provider error) must NOT block tagging. Degrade instead of failing.
    const existingTags: string[] = Array.isArray(draft.tags) ? (draft.tags as string[]) : [];
    const mergedTags = [...existingTags];
    if (result.ok) {
      for (const t of result.tags) if (!mergedTags.includes(t)) mergedTags.push(t);
    }

    // Deterministic item-type inference from the TITLE ONLY. Vision emits descriptive
    // attributes ("256gb", "space-black"); the taxonomy is keyed by what the item IS.
    // Descriptions are deliberately excluded: prose like "I saw no dead pixel, kept on my
    // desk, pet-free home" contains taxonomy vocabulary that would attach unrelated HARD
    // safety gates (a monitor demanding an IMEI). The title names the item; the body doesn't.
    const { tags: enrichedTags, inferred } = enrichTagsWithTaxonomy(mergedTags, draft.title);

    await patchDraft(db, id, { tags: enrichedTags });

    return reply.send({
      ok: true,
      tags: enrichedTags,
      /** Tags the taxonomy inference added — lets the wizard show what was auto-derived. */
      inferred,
      /** False when the vision pass failed; tags are still enriched deterministically. */
      visionOk: result.ok,
    });
  });

  // POST /api/drafts/:id/validate — pre-publish validation
  app.post<{
    Params: { id: string };
  }>("/api/drafts/:id/validate", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const draft = await getDraftById(db, id);
    if (!draft) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (draft.userId !== userId) {
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
  }>("/api/drafts/:id/publish", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const draft = await getDraftById(db, id);
    if (!draft) {
      return reply.status(404).send({ ok: false, error: "not_found" });
    }
    if (draft.userId !== userId) {
      return reply.status(403).send({ ok: false, error: "forbidden" });
    }

    const errors = validateDraft(draft);
    if (errors.length > 0) {
      return reply.send({ ok: false, errors });
    }

    try {
      const result = await publishDraft(db, id);

      // ── Notification: listing.published (→ seller)
      void (async () => {
        try {
          const sellerInfo = await getNotificationUserInfo(db, userId);
          await notificationBus.publish({
            type: "listing.published",
            recipientUserId: userId,
            payload: {
              listingId: result?.published?.id ?? id,
              listingTitle: draft.title ?? "your listing",
              listingPriceMinor: Math.round(parseFloat(String(draft.targetPrice ?? "0")) * 100),
              currency: "USD",
              sellerName: sellerInfo?.displayName ?? "Seller",
            },
          });
        } catch (err) {
          console.error("[notifications] listing.published error:", err);
        }
      })();

      return reply.send({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to publish";
      return reply.status(400).send({ ok: false, error: message });
    }
  });
}
