import type { Database } from "@haggle/db";
import { describe, expect, it } from "vitest";
import {
  computeShipmentApvPayoutOffset,
  listExpiredShipmentApvPayoutReservations,
} from "../services/shipment-apv-payout-offset.service.js";

describe("shipment APV payout offset cap", () => {
  it("preserves liability that cannot fit under the onchain fee headroom", () => {
    expect(computeShipmentApvPayoutOffset(1000, 850)).toEqual({
      sellerLiabilityMinor: 1000,
      appliedOffsetMinor: 850,
      unappliedLiabilityMinor: 150,
    });
  });

  it("applies the full liability when payout headroom is sufficient", () => {
    expect(computeShipmentApvPayoutOffset(100, 850)).toEqual({
      sellerLiabilityMinor: 100,
      appliedOffsetMinor: 100,
      unappliedLiabilityMinor: 0,
    });
  });

  it("rejects unsafe or negative accounting inputs", () => {
    expect(() => computeShipmentApvPayoutOffset(-1, 10)).toThrow("safe integers");
    expect(() => computeShipmentApvPayoutOffset(10.5, 10)).toThrow("safe integers");
  });

  it("returns an opaque cursor and accepts it for the next bounded page", async () => {
    const row = (id: string, expiredAt: string) => ({
      id,
      settlement_release_id: "22222222-2222-4222-8222-222222222222",
      order_id: "33333333-3333-4333-8333-333333333333",
      seller_id: "44444444-4444-4444-8444-444444444444",
      currency: "USDC",
      applied_offset_minor: "40",
      signed: true,
      expired_at: expiredAt,
      expired_age_seconds: 60,
      created_at: "2026-07-11T23:00:00.000Z",
    });
    const execute = async () => [
      row("11111111-1111-4111-8111-111111111111", "2026-07-12T00:00:00.000Z"),
      row("55555555-5555-4555-8555-555555555555", "2026-07-12T00:01:00.000Z"),
    ];
    const first = await listExpiredShipmentApvPayoutReservations(
      { execute } as unknown as Database,
      {
        limit: 1,
        now: new Date("2026-07-12T00:02:00.000Z"),
      },
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(
      listExpiredShipmentApvPayoutReservations({ execute } as unknown as Database, {
        limit: 1,
        cursor: first.nextCursor!,
        now: new Date("2026-07-12T00:02:00.000Z"),
      }),
    ).resolves.toMatchObject({ items: [{ offsetId: "11111111-1111-4111-8111-111111111111" }] });
  });

  it("rejects malformed recovery queue cursors before querying the database", async () => {
    const execute = () => {
      throw new Error("must not query");
    };
    await expect(
      listExpiredShipmentApvPayoutReservations({ execute } as unknown as Database, {
        cursor: Buffer.from(
          JSON.stringify({ expiredAt: "2026-07-12T00:00:00.000Z", id: "not-a-uuid" }),
        ).toString("base64url"),
      }),
    ).rejects.toThrow("INVALID_APV_PAYOUT_RESERVATION_CURSOR");
  });
});
