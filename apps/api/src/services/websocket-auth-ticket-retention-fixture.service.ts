import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import {
  getWebSocketAuthTicketRetentionHealth,
  runWebSocketAuthTicketRetention,
} from "../jobs/websocket-auth-ticket-retention.js";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows as T[] : [];
}

export async function runWebSocketAuthTicketRetentionFixture(db: Database) {
  const userId = randomUUID();
  const hashes = Array.from({ length: 4 }, () =>
    createHash("sha256").update(randomBytes(32)).digest("hex"));
  try {
    await db.execute(sql`
      INSERT INTO websocket_auth_tickets
        (token_hash, user_id, channel, resource_id, created_at, expires_at)
      VALUES
        (${hashes[0]}, ${userId}::uuid, 'notification', NULL,
          now() - interval '33 seconds', now() - interval '3 seconds'),
        (${hashes[1]}, ${userId}::uuid, 'notification', NULL,
          now() - interval '32 seconds', now() - interval '2 seconds'),
        (${hashes[2]}, ${userId}::uuid, 'notification', NULL,
          now() - interval '31 seconds', now() - interval '1 second'),
        (${hashes[3]}, ${userId}::uuid, 'notification', NULL,
          now(), now() + interval '30 seconds')
    `);
    const before = await getWebSocketAuthTicketRetentionHealth(db);
    const workers = await Promise.all(Array.from({ length: 20 }, () =>
      runWebSocketAuthTicketRetention(db, {
        batchSize: 1_000,
        fixtureUserId: userId,
      })));
    const remaining = rowsOf<{ token_hash: string; expired: boolean }>(await db.execute(sql`
      SELECT token_hash, expires_at <= clock_timestamp() AS expired
      FROM websocket_auth_tickets WHERE user_id = ${userId}::uuid
    `));
    const cleanup = rowsOf(await db.execute(sql`
      DELETE FROM websocket_auth_tickets WHERE user_id = ${userId}::uuid
      RETURNING id
    `));
    const cleanupRows = rowsOf(await db.execute(sql`
      SELECT id FROM websocket_auth_tickets WHERE user_id = ${userId}::uuid
    `)).length;
    return {
      schemaVersion: "websocket-auth-ticket-retention-fixture-v1",
      retentionWorkers: 20,
      lockWinners: workers.filter((worker) => worker.acquired).length,
      deletingWorkers: workers.filter((worker) => worker.deleted > 0).length,
      expiredInserted: 3,
      expiredDeleted: workers.reduce((sum, worker) => sum + worker.deleted, 0),
      expiredRemaining: remaining.filter((row) => row.expired).length,
      activeInserted: 1,
      activePreserved: remaining.some((row) => row.token_hash === hashes[3] && !row.expired),
      observedGlobalExpiredBefore: before.expiredCount,
      cleanupDeleted: cleanup.length,
      cleanupRows,
      containsTicket: false,
      containsHash: false,
      containsUserId: false,
      externalCalls: 0,
    };
  } finally {
    await db.execute(sql`DELETE FROM websocket_auth_tickets WHERE user_id = ${userId}::uuid`);
  }
}
