import { describe, expect, it } from "vitest";
import {
  attendanceGrantAmount,
  CREDIT_ATTENDANCE_BASE,
  CREDIT_ATTENDANCE_MAX,
  CREDIT_FLASH_GAME,
  CREDIT_OWN_BETTER_MODEL,
  CREDIT_PRO_GAME,
  CREDIT_SIGNUP,
  CREDIT_UNLIMITED_IS_TEMPORARY,
  creditGrantAmount,
  creditsAreUnlimited,
  quoteNegotiationCredits,
} from "../negotiation-credit-policy.js";

describe("quoteNegotiationCredits", () => {
  it("charges the buyer 4 on a cheap ask and 10 on a Pro ask", () => {
    expect(quoteNegotiationCredits({ role: "buyer", publishedAskMinor: 8_000 })).toMatchObject({
      base: CREDIT_FLASH_GAME,
      own_better_model: 0,
      total: 4,
      default_is_pro: false,
      unlimited: false,
    });
    expect(quoteNegotiationCredits({ role: "buyer", publishedAskMinor: 80_000 })).toMatchObject({
      base: CREDIT_PRO_GAME,
      total: 10,
      default_is_pro: true,
    });
    expect(quoteNegotiationCredits({ role: "buyer" }).total).toBe(10);
  });

  it("adds 5 when this side asked for a better-than-default model", () => {
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 8_000,
        ownBetterModel: true,
      }).total,
    ).toBe(CREDIT_FLASH_GAME + CREDIT_OWN_BETTER_MODEL);
    expect(
      quoteNegotiationCredits({
        role: "seller",
        publishedAskMinor: 8_000,
        ownBetterModel: true,
      }),
    ).toMatchObject({ base: 0, own_better_model: 5, total: 5 });
    expect(quoteNegotiationCredits({ role: "seller", publishedAskMinor: 80_000 }).total).toBe(0);
  });

  it("does not charge on staging or local during the test period", () => {
    expect(CREDIT_UNLIMITED_IS_TEMPORARY).toBe(true);
    expect(creditsAreUnlimited("staging")).toBe(true);
    expect(creditsAreUnlimited("local")).toBe(true);
    expect(creditsAreUnlimited("production")).toBe(false);
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        haggleEnv: "staging",
      }),
    ).toMatchObject({ base: 10, total: 0, unlimited: true });
  });
});

describe("attendanceGrantAmount", () => {
  it("starts at 10 and adds 1 per consecutive day up to 20", () => {
    expect(attendanceGrantAmount(1)).toBe(CREDIT_ATTENDANCE_BASE);
    expect(attendanceGrantAmount(2)).toBe(11);
    expect(attendanceGrantAmount(11)).toBe(CREDIT_ATTENDANCE_MAX);
    expect(attendanceGrantAmount(30)).toBe(CREDIT_ATTENDANCE_MAX);
  });
});

describe("creditGrantAmount", () => {
  it("uses the meeting grant table", () => {
    expect(creditGrantAmount("signup")).toBe(CREDIT_SIGNUP);
    expect(creditGrantAmount("attendance_daily")).toBe(10);
    expect(creditGrantAmount("invite_first_funded")).toBe(40);
  });
});
