import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { runPaymentIntentExpiry } from "../jobs/payment-intent-expiry.js";

describe("payment intent expiry job", () => {
  it("keeps the legacy and canonical statuses compatible", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const db = { select, update } as unknown as Database;

    await runPaymentIntentExpiry(db);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CANCELED",
        canonicalStatus: "expired",
      }),
    );
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});
