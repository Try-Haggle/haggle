import type { Database } from "@haggle/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSettlementAutoRelease } from "../jobs/settlement-auto-release.js";

function makeSelectDb(overdue: Array<{ id: string; orderId: string }>) {
  const limit = vi.fn().mockResolvedValue(overdue);
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  const commerceOrderFindFirst = vi.fn();
  const disputeFindFirst = vi.fn();

  const db = {
    select,
    update,
    query: {
      commerceOrders: { findFirst: commerceOrderFindFirst },
      disputeCases: { findFirst: disputeFindFirst },
    },
  } as unknown as Database;

  return { db, select, update, set, updateWhere, commerceOrderFindFirst, disputeFindFirst };
}

describe("settlement auto-release dispute guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("skips product release when the commerce order is IN_DISPUTE", async () => {
    const { db, update, commerceOrderFindFirst, disputeFindFirst } = makeSelectDb([
      { id: "release_1", orderId: "order_1" },
    ]);
    commerceOrderFindFirst.mockResolvedValue({ id: "order_1", status: "IN_DISPUTE" });

    await runSettlementAutoRelease(db);

    expect(commerceOrderFindFirst).toHaveBeenCalledOnce();
    expect(disputeFindFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("skips product release when an active dispute exists before order status catches up", async () => {
    const { db, update, commerceOrderFindFirst, disputeFindFirst } = makeSelectDb([
      { id: "release_1", orderId: "order_1" },
    ]);
    commerceOrderFindFirst.mockResolvedValue({ id: "order_1", status: "DELIVERED" });
    disputeFindFirst.mockResolvedValue({ id: "dispute_1" });

    await runSettlementAutoRelease(db);

    expect(disputeFindFirst).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("releases overdue BUYER_REVIEW settlements when the order is not disputed", async () => {
    const { db, update, set, commerceOrderFindFirst, disputeFindFirst } = makeSelectDb([
      { id: "release_1", orderId: "order_1" },
    ]);
    commerceOrderFindFirst.mockResolvedValue({ id: "order_1", status: "DELIVERED" });
    disputeFindFirst.mockResolvedValue(null);

    await runSettlementAutoRelease(db);

    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        productReleaseStatus: "RELEASED",
      }),
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CLOSED",
      }),
    );
  });

  it("skips when the commerce order row is missing", async () => {
    const { db, update, commerceOrderFindFirst } = makeSelectDb([
      { id: "release_1", orderId: "order_missing" },
    ]);
    commerceOrderFindFirst.mockResolvedValue(undefined);

    await runSettlementAutoRelease(db);

    expect(update).not.toHaveBeenCalled();
  });
});
