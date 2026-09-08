/**
 * Eng1 M1 goldens — Soft control_mode + Soft AI credit matrix / differential.
 * SoT: docs/wip/auto-manual-control-mode-sot.md
 */
import { describe, expect, it } from "vitest";
import {
  CREDIT_FLASH_HALF,
  CREDIT_PRO_HALF,
  quoteNegotiationCredits,
  quoteSoftAiCreditDifferential,
  softAiCreditBand,
} from "@haggle/commerce-core";
import {
  buildControlModeView,
  controlModeFromSessionRecord,
  initialBuyerSoftAiCharge,
  isSellerManualTimedOut,
  partyForActor,
  SELLER_MANUAL_FIRST_TIMEOUT_MS,
  SELLER_MANUAL_LATER_TIMEOUT_MS,
  sellerManualTimeoutMs,
} from "../services/control-mode.service.js";

describe("Soft control_mode credit matrix (SoT §5)", () => {
  it("both Auto → Pro10 / Flash4; half → 5/2; both Manual → 0", () => {
    expect(softAiCreditBand("auto", "auto")).toBe("full");
    expect(softAiCreditBand("manual", "auto")).toBe("half");
    expect(softAiCreditBand("auto", "manual")).toBe("half");
    expect(softAiCreditBand("manual", "manual")).toBe("zero");

    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        buyerControlMode: "auto",
        sellerControlMode: "auto",
      }).base,
    ).toBe(10);
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 8_000,
        buyerControlMode: "manual",
        sellerControlMode: "auto",
      }).base,
    ).toBe(CREDIT_FLASH_HALF);
    expect(
      quoteNegotiationCredits({
        role: "buyer",
        publishedAskMinor: 80_000,
        buyerControlMode: "manual",
        sellerControlMode: "manual",
      }).base,
    ).toBe(0);
  });

  it("Auto ever ON charges differential; OFF = no refund", () => {
    const start = initialBuyerSoftAiCharge({
      publishedAskMinor: 80_000,
      buyerControlMode: "manual",
      sellerControlMode: "manual",
    });
    expect(start.charge_base).toBe(0);

    const half = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "manual",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(half.charge_base).toBe(CREDIT_PRO_HALF);

    const full = quoteSoftAiCreditDifferential({
      alreadyChargedBase: half.new_charged_base,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(full.charge_base).toBe(CREDIT_PRO_HALF);
    expect(full.new_charged_base).toBe(10);

    const afterOff = quoteSoftAiCreditDifferential({
      alreadyChargedBase: full.new_charged_base,
      buyerMode: "manual",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(afterOff.charge_base).toBe(0);
    expect(afterOff.new_charged_base).toBe(10);
  });

  it("default session start charges full Soft AI band (both Auto)", () => {
    const charge = initialBuyerSoftAiCharge({ publishedAskMinor: 80_000 });
    expect(charge).toMatchObject({ band: "full", charge_base: 10, new_charged_base: 10 });
  });
});

describe("party-only toggle + counterpart visibility helpers", () => {
  it("maps actor to own party only", () => {
    const session = { buyerId: "b1", sellerId: "s1" };
    expect(partyForActor("b1", session)).toBe("buyer");
    expect(partyForActor("s1", session)).toBe("seller");
    expect(partyForActor("other", session)).toBeNull();
  });

  it("exposes both Soft modes on the view (counterpart-visible)", () => {
    const row = controlModeFromSessionRecord({
      id: "sess",
      buyerId: "b1",
      sellerId: "s1",
      status: "ACTIVE",
      version: 1,
      buyerControlMode: "manual",
      sellerControlMode: "auto",
      buyerSoftAiCreditsCharged: 5,
      negotiationAgentSnapshot: { listing_context: { published_ask_minor: 80_000 } },
    });
    const view = buildControlModeView(row, { haggleEnv: "production" });
    expect(view.buyer_control_mode).toBe("manual");
    expect(view.seller_control_mode).toBe("auto");
    expect(view.credit_quote.base).toBe(CREDIT_PRO_HALF);
    expect(view.buyer_soft_ai_credits_charged).toBe(5);
  });
});

describe("seller Manual timeout (SoT §7)", () => {
  it("uses 30m first / 2h later", () => {
    expect(sellerManualTimeoutMs("first")).toBe(SELLER_MANUAL_FIRST_TIMEOUT_MS);
    expect(sellerManualTimeoutMs("later")).toBe(SELLER_MANUAL_LATER_TIMEOUT_MS);
    expect(SELLER_MANUAL_FIRST_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(SELLER_MANUAL_LATER_TIMEOUT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("fires only after phase window while seller is Manual", () => {
    const since = new Date("2026-09-09T00:00:00.000Z");
    const firstDue = since.getTime() + SELLER_MANUAL_FIRST_TIMEOUT_MS;
    expect(
      isSellerManualTimedOut(
        {
          sellerControlMode: "manual",
          sellerManualSince: since,
          sellerManualTimeoutPhase: "first",
        },
        firstDue - 1,
      ),
    ).toBe(false);
    expect(
      isSellerManualTimedOut(
        {
          sellerControlMode: "manual",
          sellerManualSince: since,
          sellerManualTimeoutPhase: "first",
        },
        firstDue,
      ),
    ).toBe(true);
    expect(
      isSellerManualTimedOut(
        {
          sellerControlMode: "auto",
          sellerManualSince: since,
          sellerManualTimeoutPhase: "first",
        },
        firstDue + 1,
      ),
    ).toBe(false);
  });
});

describe("credit differential race invariant (TOCTOU)", () => {
  it("monotonic charged base — concurrent expands cannot refund or double below target", () => {
    // Two concurrent "expand to full" reads with same alreadyCharged=5 must each
    // propose charge_base=5; session lock applies once → new_charged=10, second
    // re-read sees 10 and charges 0. Policy itself never decreases charged.
    const a = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 5,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    const b = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 5,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(a.charge_base).toBe(5);
    expect(b.charge_base).toBe(5);
    const afterLock = quoteSoftAiCreditDifferential({
      alreadyChargedBase: a.new_charged_base,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
    });
    expect(afterLock.charge_base).toBe(0);
    expect(afterLock.new_charged_base).toBe(10);
  });
});
