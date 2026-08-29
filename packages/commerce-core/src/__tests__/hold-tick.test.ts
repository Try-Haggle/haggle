import { describe, expect, it } from "vitest";
import {
  canPayAgainstHold,
  HOLD_FLOOR_MS,
  holdFloorExpiresAt,
  holdTickMinor,
  isHoldFloorActive,
} from "../hold-tick.js";

const NOW = "2026-08-28T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

describe("holdTickMinor", () => {
  it("uses the meeting band table, not one cent", () => {
    expect(holdTickMinor(4_000)).toBe(200);
    expect(holdTickMinor(8_000)).toBe(500);
    expect(holdTickMinor(30_000)).toBe(1_000);
    expect(holdTickMinor(72_500)).toBe(2_000);
    expect(holdTickMinor(121_000)).toBe(2_500);
    expect(holdTickMinor(500_000)).toBe(5_000);
  });
});

describe("isHoldFloorActive", () => {
  it("is live before expiry and dead after unless funding", () => {
    const hold = {
      hold_price_minor: 72_500,
      hold_buyer_id: "a",
      hold_expires_at: holdFloorExpiresAt(NOW),
      status: "OPEN",
    };
    expect(isHoldFloorActive(hold, NOW_MS)).toBe(true);
    expect(isHoldFloorActive(hold, NOW_MS + HOLD_FLOOR_MS + 1)).toBe(false);
    expect(
      isHoldFloorActive(
        {
          ...hold,
          hold_expires_at: new Date(NOW_MS - 1).toISOString(),
          status: "FUNDING",
          funding_lease_expires_at: new Date(NOW_MS + 60_000).toISOString(),
        },
        NOW_MS,
      ),
    ).toBe(true);
  });
});

describe("canPayAgainstHold", () => {
  const live = {
    hold_price_minor: 72_500,
    hold_buyer_id: "a",
    hold_expires_at: holdFloorExpiresAt(NOW),
    status: "OPEN" as const,
  };

  it("lets the holder pay P and blocks a later buyer below P+tick", () => {
    expect(canPayAgainstHold(live, "a", 72_500, NOW)).toEqual({ ok: true });
    expect(canPayAgainstHold(live, "b", 73_000, NOW)).toMatchObject({
      ok: false,
      minimum_minor: 74_500,
    });
    expect(canPayAgainstHold(live, "b", 74_500, NOW)).toEqual({ ok: true });
  });

  it("drops the floor after two hours so a later $730 can pay", () => {
    const later = new Date(NOW_MS + HOLD_FLOOR_MS + 1).toISOString();
    expect(canPayAgainstHold(live, "b", 73_000, later)).toEqual({ ok: true });
  });
});
