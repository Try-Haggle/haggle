import { afterEach, describe, expect, it, vi } from "vitest";
import { runApiRateLimitRetention } from "../jobs/api-rate-limit-retention.js";
import { buildJobRegistry } from "../jobs/runner.js";

const original = {
  NODE_ENV: process.env.NODE_ENV,
  HAGGLE_ENV: process.env.HAGGLE_ENV,
  HAGGLE_API_RATE_LIMIT_MODE: process.env.HAGGLE_API_RATE_LIMIT_MODE,
  HAGGLE_API_RATE_LIMIT_HMAC_SECRET:
    process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("API rate-limit retention", () => {
  it("deletes only a bounded batch and returns aggregate counts", async () => {
    const db = { execute: vi.fn().mockResolvedValue([
      { deleted: 1 }, { deleted: 1 }, { deleted: 1 },
    ]) };
    await expect(runApiRateLimitRetention(db as never, {
      retentionHours: 48,
      batchSize: 25,
    })).resolves.toEqual({
      deleted: 3,
      retentionHours: 48,
      batchSize: 25,
    });
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("validates retention bounds before storage access", async () => {
    const db = { execute: vi.fn() };
    await expect(runApiRateLimitRetention(db as never, {
      retentionHours: 0,
    })).rejects.toThrow("INVALID_API_RATE_LIMIT_RETENTION_HOURS");
    await expect(runApiRateLimitRetention(db as never, {
      batchSize: 10_001,
    })).rejects.toThrow("INVALID_API_RATE_LIMIT_RETENTION_BATCH_SIZE");
    await expect(runApiRateLimitRetention(db as never, {
      scope: "invalid scope",
    })).rejects.toThrow("INVALID_API_RATE_LIMIT_RETENTION_SCOPE");
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("registers hourly run-on-start retention only in distributed mode", () => {
    process.env.NODE_ENV = "test";
    process.env.HAGGLE_ENV = "local";
    process.env.HAGGLE_API_RATE_LIMIT_MODE = "local";
    delete process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET;
    expect(buildJobRegistry().find((job) =>
      job.name === "api-rate-limit-retention")).toMatchObject({
      enabled: false,
      runOnStart: true,
      intervalMs: 3_600_000,
    });

    process.env.HAGGLE_API_RATE_LIMIT_MODE = "postgres";
    process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET = "h".repeat(32);
    expect(buildJobRegistry().find((job) =>
      job.name === "api-rate-limit-retention")).toMatchObject({
      enabled: true,
      runOnStart: true,
      intervalMs: 3_600_000,
    });
  });
});
