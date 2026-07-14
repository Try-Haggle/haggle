import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { runApiRateLimitRetention } from "../jobs/api-rate-limit-retention.js";
import { hashApiRateLimitIdentity } from "../lib/api-rate-limit.js";
import { consumeApiRateLimit } from "./api-rate-limit.service.js";

interface CountRow {
  count: number | string;
}

async function countScope(db: Database, scope: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::integer AS count
    FROM api_rate_limit_windows
    WHERE scope = ${scope}
  `) as unknown as CountRow[];
  return Number(rows[0]?.count ?? 0);
}

export async function runApiRateLimitFixture(db: Database) {
  const suffix = randomUUID().replaceAll("-", "");
  const rateScope = `fixture_global_ip:${suffix}`;
  const retentionScope = `fixture_retention:${suffix}`;
  const hmacSecret = randomBytes(32).toString("hex");
  const sharedIdentity = `fixture-client:${randomUUID()}`;
  const independentIdentity = `fixture-client:${randomUUID()}`;
  let result: Record<string, unknown> | null = null;

  try {
    const instanceA = Array.from({ length: 60 }, () =>
      consumeApiRateLimit(db, {
        scope: rateScope,
        identity: sharedIdentity,
        hmacSecret,
      }));
    const instanceB = Array.from({ length: 60 }, () =>
      consumeApiRateLimit(db, {
        scope: rateScope,
        identity: sharedIdentity,
        hmacSecret,
      }));
    const sharedResults = await Promise.all([...instanceA, ...instanceB]);
    const independent = await consumeApiRateLimit(db, {
      scope: rateScope,
      identity: independentIdentity,
      hmacSecret,
    });

    const storedRows = await db.execute(sql`
      SELECT count(*)::integer AS count,
        bool_and(length(key_hash) = 64
          AND key_hash ~ '^[0-9a-f]{64}$') AS "hashesValid"
      FROM api_rate_limit_windows
      WHERE scope = ${rateScope}
    `) as unknown as Array<{
      count: number | string;
      hashesValid: boolean;
    }>;

    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    for (let index = 0; index < 3; index += 1) {
      const keyHash = hashApiRateLimitIdentity({
        scope: retentionScope,
        identity: `old-fixture-client:${index}`,
        hmacSecret,
      });
      await db.execute(sql`
        INSERT INTO api_rate_limit_windows
          (scope, key_hash, window_started_at, request_count, updated_at)
        VALUES (${retentionScope}, ${keyHash}, ${oldTimestamp.toISOString()}::timestamptz,
          1, ${oldTimestamp.toISOString()}::timestamptz)
      `);
    }
    const retentionRuns = await Promise.all(Array.from({ length: 20 }, () =>
      runApiRateLimitRetention(db, {
        retentionHours: 24,
        batchSize: 2,
        scope: retentionScope,
      })));
    const retentionDeleted = retentionRuns.reduce(
      (sum, run) => sum + run.deleted,
      0,
    );
    const retentionRemaining = await countScope(db, retentionScope);
    const row = storedRows[0];
    const sharedAllowed = sharedResults.filter((entry) => entry.allowed).length;
    const sharedBlocked = sharedResults.length - sharedAllowed;

    result = {
      schemaVersion: "api-rate-limit-fixture-v1",
      instanceARequests: 60,
      instanceBRequests: 60,
      sharedAllowed,
      sharedBlocked,
      distributedExactLimit: sharedAllowed === 100 && sharedBlocked === 20,
      independentIdentityAllowed: independent.allowed,
      storedRows: Number(row?.count ?? 0),
      hashesValid: row?.hashesValid === true,
      rawIdentityStored: false,
      retentionWorkers: 20,
      retentionInserted: 3,
      retentionDeleted,
      retentionRemaining,
      boundedRetention: retentionDeleted === 3 && retentionRemaining === 0,
      containsIdentifiers: false,
      containsHashes: false,
      containsSecret: false,
      externalCalls: 0,
    };
  } finally {
    await db.execute(sql`
      DELETE FROM api_rate_limit_windows
      WHERE scope IN (${rateScope}, ${retentionScope})
    `);
  }

  return {
    ...result,
    cleanupRows: await countScope(db, rateScope)
      + await countScope(db, retentionScope),
  };
}
