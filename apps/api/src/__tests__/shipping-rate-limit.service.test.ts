import { describe, expect, it, vi } from "vitest";
import { consumeShippingRateMissBudget } from "../services/shipping-rate-limit.service.js";

vi.unmock("@haggle/db");

describe("shipping rate miss budget", () => {
  it("uses an ISO string in the SQL window comparison instead of a Date object", async () => {
    let conflictConfig: { set: { requestCount: { queryChunks: unknown[] } } } | undefined;
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn((config) => {
            conflictConfig = config;
            return {
              returning: vi.fn().mockResolvedValue([{
                requestCount: 1,
                windowStartedAt: new Date("2026-07-12T00:00:00.000Z"),
              }]),
            };
          }),
        })),
      })),
    };

    const result = await consumeShippingRateMissBudget(
      db as never,
      "shipping_rate_miss:test-user",
      30,
      new Date("2026-07-12T00:00:42.000Z"),
    );
    const chunks = conflictConfig?.set.requestCount.queryChunks ?? [];

    expect(result).toMatchObject({ allowed: true, requestCount: 1 });
    expect(chunks).toContain("2026-07-12T00:00:00.000Z");
    expect(chunks.some((chunk) => chunk instanceof Date)).toBe(false);
  });
});
