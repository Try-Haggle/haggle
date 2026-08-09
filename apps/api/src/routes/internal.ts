import { type Database, sql } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { getNotificationUserInfo } from "../notification/get-user-info.js";
import type { NotificationBus } from "../notification/index.js";
import {
  buildEmbeddingInput,
  computeTextHash,
  generateTextEmbedding,
  getSnapshotByPublishedId,
} from "../services/embedding.service.js";

export function registerInternalRoutes(
  app: FastifyInstance,
  db: Database,
  notificationBus: NotificationBus,
) {
  // POST /api/internal/retry-embeddings
  // Called by pg_cron via pg_net — protected by API key
  app.post("/api/internal/retry-embeddings", async (request, reply) => {
    // Verify API key (read at request time, not module load time)
    const internalApiKey = process.env.INTERNAL_API_KEY;
    const authHeader = request.headers.authorization;
    if (!internalApiKey || authHeader !== `Bearer ${internalApiKey}`) {
      return reply.status(401).send({ ok: false, error: "unauthorized" });
    }

    // Find failed embeddings with retry_count < 5
    const failed = await db.execute<{
      id: string;
      published_listing_id: string;
      retry_count: number;
    }>(sql`
      SELECT id, published_listing_id, retry_count
      FROM listing_embeddings
      WHERE status = 'failed' AND retry_count < 5
    `);

    const rows = failed as unknown as Array<{
      id: string;
      published_listing_id: string;
      retry_count: number;
    }>;

    if (rows.length === 0) {
      return reply.send({ ok: true, processed: 0, message: "No failed embeddings to retry" });
    }

    let success = 0;
    let stillFailed = 0;

    for (const row of rows) {
      const snapshot = await getSnapshotByPublishedId(db, row.published_listing_id);
      if (!snapshot) continue; // Listing was deleted

      try {
        const input = buildEmbeddingInput(snapshot);
        const embedding = await generateTextEmbedding(input);
        const hash = computeTextHash(input);

        await db.execute(sql`
          UPDATE listing_embeddings SET
            text_embedding = ${`[${embedding.join(",")}]`}::vector,
            text_hash = ${hash},
            status = 'completed',
            updated_at = NOW()
          WHERE id = ${row.id}
        `);
        success++;
      } catch {
        const newCount = row.retry_count + 1;
        await db.execute(sql`
          UPDATE listing_embeddings SET
            status = ${newCount >= 5 ? "dead" : "failed"},
            retry_count = ${newCount},
            failed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${row.id}
        `);
        stillFailed++;
      }
    }

    return reply.send({
      ok: true,
      processed: rows.length,
      success,
      stillFailed,
    });
  });

  // POST /api/internal/notifications/user-signed-up
  // Called from Next.js auth/callback after first login. Protected by INTERNAL_API_KEY.
  app.post<{ Body: { userId: string; isNewUser: boolean } }>(
    "/api/internal/notifications/user-signed-up",
    async (request, reply) => {
      const internalApiKey = process.env.INTERNAL_API_KEY;
      const providedKey = request.headers["x-haggle-internal-key"];
      if (!internalApiKey || providedKey !== internalApiKey) {
        return reply.status(401).send({ ok: false, error: "unauthorized" });
      }

      const { userId, isNewUser } = request.body ?? {};
      if (!userId || !isNewUser) {
        return reply.send({ ok: true, skipped: true, reason: "not_new_user" });
      }

      const userInfo = await getNotificationUserInfo(db, userId);
      if (!userInfo) {
        return reply.send({ ok: true, skipped: true, reason: "user_not_found" });
      }

      await notificationBus.publish({
        type: "user.signed_up",
        recipientUserId: userId,
        payload: { userId, userName: userInfo.displayName },
      });

      return reply.send({ ok: true });
    },
  );
}
