import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWebSocketAuthTicketRetentionHealth,
  getWebSocketAuthTicketRetentionPolicyStatus,
  runWebSocketAuthTicketRetention,
} from "../jobs/websocket-auth-ticket-retention.js";
import { buildJobRegistry } from "../jobs/runner.js";

const originalCron = process.env.ENABLE_CRON;

afterEach(() => {
  if (originalCron === undefined) delete process.env.ENABLE_CRON;
  else process.env.ENABLE_CRON = originalCron;
});

function transactionDb(results: unknown[][]) {
  const execute = vi.fn().mockImplementation(async () => results.shift() ?? []);
  return {
    transaction: vi.fn(async (fn: (tx: { execute: typeof execute }) => unknown) => fn({ execute })),
    execute,
  };
}

describe("WebSocket ticket retention", () => {
  it("deletes one bounded batch while holding the distributed lock", async () => {
    const db = transactionDb([[{ acquired: true }], [{ deleted: 1 }, { deleted: 1 }, { deleted: 1 }]]);
    await expect(runWebSocketAuthTicketRetention(db as never, { batchSize: 25 }))
      .resolves.toEqual({ acquired: true, deleted: 3, batchSize: 25 });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("returns a non-mutating skip when another instance owns the lock", async () => {
    const db = transactionDb([[{ acquired: false }]]);
    await expect(runWebSocketAuthTicketRetention(db as never))
      .resolves.toEqual({ acquired: false, deleted: 0, batchSize: 1000 });
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("validates fixture scope and batch bounds before storage access", async () => {
    const db = transactionDb([]);
    await expect(runWebSocketAuthTicketRetention(db as never, { batchSize: 0 }))
      .rejects.toThrow("INVALID_WEBSOCKET_TICKET_RETENTION_BATCH_SIZE");
    await expect(runWebSocketAuthTicketRetention(db as never, { fixtureUserId: "not-uuid" }))
      .rejects.toThrow("INVALID_WEBSOCKET_TICKET_RETENTION_FIXTURE_USER");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns aggregate backlog health without ticket material", async () => {
    const db = { execute: vi.fn().mockResolvedValue([{
      active_count: "4", expired_count: "2", oldest_expired_age_seconds: "17",
    }]) };
    await expect(getWebSocketAuthTicketRetentionHealth(db as never)).resolves.toEqual({
      status: "backlog",
      activeCount: 4,
      expiredCount: 2,
      oldestExpiredAgeSeconds: 17,
      recordedAt: expect.any(String),
    });
  });

  it("registers a five-minute run-on-start job and reports scheduler state", () => {
    delete process.env.ENABLE_CRON;
    expect(buildJobRegistry().find((job) =>
      job.name === "websocket-auth-ticket-retention")).toMatchObject({
      enabled: true, runOnStart: true, intervalMs: 300_000,
    });
    expect(getWebSocketAuthTicketRetentionPolicyStatus()).toMatchObject({
      scheduled: false, intervalSeconds: 300, batchSize: 1000,
      containsTicket: false, containsHash: false, containsUserId: false,
    });
    process.env.ENABLE_CRON = "true";
    expect(getWebSocketAuthTicketRetentionPolicyStatus().scheduled).toBe(true);
  });
});
