import { describe, expect, it, vi } from "vitest";
import { runListingWithdrawRetention } from "../jobs/listing-withdraw-retention.js";

function transactionDb(results: unknown[][]) {
  const execute = vi.fn().mockImplementation(async () => results.shift() ?? []);
  return {
    transaction: vi.fn(async (fn: (tx: { execute: typeof execute }) => unknown) => fn({ execute })),
    execute,
  };
}

describe("listing withdraw retention", () => {
  it("purges one bounded batch while holding the lock", async () => {
    const db = transactionDb([[{ acquired: true }], [{ deleted: 2 }]]);
    await expect(runListingWithdrawRetention(db as never, { batchSize: 25 })).resolves.toEqual({
      acquired: true,
      deleted: 2,
      retentionDays: 90,
      batchSize: 25,
    });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("skips when another instance owns the lock", async () => {
    const db = transactionDb([[{ acquired: false }]]);
    await expect(runListingWithdrawRetention(db as never)).resolves.toEqual({
      acquired: false,
      deleted: 0,
      retentionDays: 90,
      batchSize: 50,
    });
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("rejects a retention window other than 1-365 days", async () => {
    const db = transactionDb([]);
    await expect(runListingWithdrawRetention(db as never, { retentionDays: 0 })).rejects.toThrow(
      "INVALID_LISTING_WITHDRAW_RETENTION_DAYS",
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
