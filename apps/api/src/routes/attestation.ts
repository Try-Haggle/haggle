/**
 * Seller pre-ship attestation routes (Step 55).
 *
 *   POST /api/attestation/presigned-upload  — signed Supabase upload URL
 *   POST /api/attestation/commit            — finalize + hash + insert
 *   GET  /api/attestation/:listingId        — authorized read (+ view URLs)
 *
 * All three endpoints require authentication via `requireAuth`. The
 * presigned-upload and commit endpoints additionally require that the
 * caller is the seller who owns the listing. The read endpoint has its
 * own 3-tier access matrix (see attestation.service.ts).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import {
  buildAttestationObjectPath,
  sanitizeAttestationFilename,
  sanitizeListingIdSegment,
} from "../lib/supabase-storage-paths.js";
import {
  createAttestationUploadUrl,
} from "../services/supabase-storage.service.js";
import {
  createAttestationCommit,
  getAttestationForViewer,
  getListingSellerId,
  AttestationConflictError,
  AttestationStorageError,
  AttestationValidationError,
} from "../services/attestation.service.js";

const presignSchema = z.object({
  listingId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
});

const commitSchema = z.object({
  listingId: z.string().min(1),
  imei: z.string().min(1),
  batteryHealthPct: z.number().int().min(0).max(100),
  findMyOff: z.boolean(),
  photoStoragePaths: z.array(z.string().min(1)).min(1).max(20),
});

export function registerAttestationRoutes(app: FastifyInstance, db: Database) {
  // ─── POST /api/attestation/presigned-upload ──────────────
  app.post(
    "/api/attestation/presigned-upload",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = presignSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PRESIGN_REQUEST", issues: parsed.error.issues });
      }
      const { listingId, filename } = parsed.data;

      // Input sanitization — any throw here is a 400.
      let objectPath: string;
      try {
        sanitizeListingIdSegment(listingId);
        sanitizeAttestationFilename(filename);
        objectPath = buildAttestationObjectPath(listingId, filename);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "INVALID_PATH", message: (err as Error).message });
      }

      // Seller authorization.
      const sellerId = await getListingSellerId(db, listingId);
      if (!sellerId) {
        return reply.code(404).send({ error: "LISTING_NOT_FOUND" });
      }
      if (sellerId !== request.user!.id) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      try {
        const result = await createAttestationUploadUrl(objectPath);
        return reply.send({
          uploadUrl: result.uploadUrl,
          storagePath: result.storagePath,
          token: result.token,
          expiresIn: result.expiresIn,
        });
      } catch (err) {
        request.log.error({ err }, "attestation presign failed");
        return reply.code(500).send({ error: "PRESIGN_FAILED" });
      }
    },
  );

  // ─── POST /api/attestation/commit ────────────────────────
  app.post(
    "/api/attestation/commit",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = commitSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_COMMIT_REQUEST", issues: parsed.error.issues });
      }
      const { listingId, imei, batteryHealthPct, findMyOff, photoStoragePaths } =
        parsed.data;

      const sellerId = await getListingSellerId(db, listingId);
      if (!sellerId) {
        return reply.code(404).send({ error: "LISTING_NOT_FOUND" });
      }
      if (sellerId !== request.user!.id) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      try {
        const result = await createAttestationCommit(db, {
          listingId,
          sellerId,
          imei,
          batteryHealthPct,
          findMyOff,
          photoStoragePaths,
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof AttestationConflictError) {
          return reply.code(409).send({ error: "ATTESTATION_ALREADY_COMMITTED" });
        }
        // Validation-shaped errors (bad path, missing photo) → 400 with
        // a stable error code. Do NOT forward raw messages — they may
        // leak internal paths or storage layout.
        if (
          err instanceof AttestationValidationError ||
          err instanceof AttestationStorageError
        ) {
          request.log.warn({ err }, "attestation commit rejected");
          return reply.code(400).send({ error: "INVALID_COMMIT_REQUEST" });
        }
        // Everything else is an infra failure.
        request.log.error({ err }, "attestation commit failed");
        return reply.code(500).send({ error: "COMMIT_FAILED" });
      }
    },
  );

  // ─── GET /api/attestation/:listingId ─────────────────────
  app.get<{ Params: { listingId: string } }>(
    "/api/attestation/:listingId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { listingId } = request.params;
      try {
        sanitizeListingIdSegment(listingId);
      } catch {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const caller = request.user!;
      const result = await getAttestationForViewer(db, listingId, {
        id: caller.id,
        role: caller.role,
      });
      if (!result) {
        // Hide existence — 404 for both "no row" and "not authorized".
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      return reply.send(result);
    },
  );
}
