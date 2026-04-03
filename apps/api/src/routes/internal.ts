import type { FastifyInstance } from "fastify";
import { type Database, listingEmbeddings, sql } from "@haggle/db";
import {
  getSnapshotByPublishedId,
  buildEmbeddingInput,
  generateTextEmbedding,
  computeTextHash,
} from "../services/embedding.service.js";

export function registerInternalRoutes(app: FastifyInstance, db: Database) {
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
}
