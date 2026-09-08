import { describe, expect, it } from "vitest";
import {
  attendanceGrantAmount,
  CREDIT_ATTENDANCE_BASE,
  CREDIT_ATTENDANCE_MAX,
  CREDIT_FLASH_GAME,
  CREDIT_FLASH_HALF,
  CREDIT_OWN_BETTER_MODEL,
  CREDIT_PRO_GAME,
  CREDIT_PRO_HALF,
  CREDIT_SIGNUP,
  CREDIT_UNLIMITED_IS_TEMPORARY,
  creditGrantAmount,
  creditsAreUnlimited,
  quoteNegotiationCredits,
  quoteSoftAiCreditDifferential,
  softAiCreditBand,
  softAiCreditBase,
} from "../negotiation-credit-policy.js";

describe("quoteNegotiationCredits", () => {
  it("charges the buyer 4 on a cheap ask and 10 on a Pro ask", () => {
    expect(quoteNegotiationCredits({ role: "buyer", publishedAskMinor: 8_000 })).toMatchObject({
      base: CREDIT_FLASH_GAME,
      own_better_model: 0,
      total: 4,
      default_is_pro: false,
      unlimited: false,
      soft_ai_band: "full",
    });
    expect(quoteNegotiationCredits({ role: "buyer", publishedAskMinor: 80_000 })).toMatchObject({
      base: CREDIT_PRO_GAME,
      total: 10,
      default_is_pro: true,
      soft_ai_band: "full",
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

  it("applies Soft Auto/Manual matrix for buyer Soft AI credits (SoT §5)", () => {
    // both Auto → Pro10 / Flash4
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        buyerControlMode: "auto",
        sellerControlMode: "auto",
      }),
    ).toMatchObject({ base: 10, soft_ai_band: "full", total: 10 });
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 8_000,
        buyerControlMode: "auto",
        sellerControlMode: "auto",
      }),
    ).toMatchObject({ base: 4, soft_ai_band: "full", total: 4 });

    // buyer Manual + seller AI → 5/2
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        buyerControlMode: "manual",
        sellerControlMode: "auto",
      }),
    ).toMatchObject({ base: CREDIT_PRO_HALF, soft_ai_band: "half", total: 5 });
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 8_000,
        buyerControlMode: "manual",
        sellerControlMode: "auto",
      }),
    ).toMatchObject({ base: CREDIT_FLASH_HALF, soft_ai_band: "half", total: 2 });

    // seller Manual + buyer Auto → half (derived, our AI Soft only)
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        buyerControlMode: "auto",
        sellerControlMode: "manual",
      }),
    ).toMatchObject({ base: 5, soft_ai_band: "half" });

    // both Manual → 0
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        buyerControlMode: "manual",
        sellerControlMode: "manual",
      }),
    ).toMatchObject({ base: 0, soft_ai_band: "zero", total: 0 });
  });
});

describe("softAiCreditBand / differential", () => {
  it("maps four Soft combinations", () => {
    expect(softAiCreditBand("auto", "auto")).toBe("full");
    expect(softAiCreditBand("manual", "auto")).toBe("half");
    expect(softAiCreditBand("auto", "manual")).toBe("half");
    expect(softAiCreditBand("manual", "manual")).toBe("zero");
  });

  it("charges differential when Auto expands Soft AI work; never refunds", () => {
    // start both Manual (0) → turn seller Auto → half Pro 5
    const toHalf = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "manual",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(toHalf).toMatchObject({
      band: "half",
      charge_base: CREDIT_PRO_HALF,
      new_charged_base: 5,
    });

    // half → both Auto → differential +5
    const toFull = quoteSoftAiCreditDifferential({
      alreadyChargedBase: toHalf.new_charged_base,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(toFull).toMatchObject({
      band: "full",
      charge_base: CREDIT_PRO_HALF,
      new_charged_base: 10,
    });

    // Auto OFF again → no refund
    const afterOff = quoteSoftAiCreditDifferential({
      alreadyChargedBase: toFull.new_charged_base,
      buyerMode: "manual",
      sellerMode: "manual",
      publishedAskMinor: 80_000,
    });
    expect(afterOff).toMatchObject({
      band: "zero",
      charge_base: 0,
      new_charged_base: 10,
      target_base: 0,
    });

    // Flash differential 2
    expect(
      softAiCreditBase({
        buyerMode: "manual",
        sellerMode: "auto",
        publishedAskMinor: 8_000,
      }).base,
    ).toBe(CREDIT_FLASH_HALF);
    expect(
      quoteSoftAiCreditDifferential({
        alreadyChargedBase: 0,
        buyerMode: "auto",
        sellerMode: "auto",
        publishedAskMinor: 8_000,
        haggleEnv: "staging",
      }),
    ).toMatchObject({ charge_base: 4, charge_total: 0, unlimited: true });
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
