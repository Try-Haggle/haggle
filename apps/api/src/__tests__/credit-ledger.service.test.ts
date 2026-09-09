/**
 * Eng1 C1 — Soft-AI credit ledger unit tests.
 * SoT: docs/wip/credit-ledger-sot.md
 */

import {
  CREDIT_SIGNUP,
  creditsAreUnlimited,
  quoteSoftAiCreditDifferential,
} from "@haggle/commerce-core";
import { describe, expect, it } from "vitest";
import {
  creditsAreUnlimitedAtRuntime,
  grantIdempotencyKey,
  INSUFFICIENT_CREDITS,
  InsufficientCreditsError,
  signupGrantIdempotencyKey,
  softAiDebitIdempotencyKey,
} from "../services/credit-ledger.service.js";

describe("credit ledger idempotency key shapes (per-account scoped)", () => {
  it("signup grant key is stable per account", () => {
    expect(signupGrantIdempotencyKey("acc-1")).toBe("grant:signup:acc-1");
    expect(grantIdempotencyKey("signup", "acc-1")).toBe("grant:signup:acc-1");
  });

  it("Soft AI debit key includes session + charged-base watermark target", () => {
    expect(softAiDebitIdempotencyKey("sess-9", 10)).toBe("debit:soft_ai:sess-9:10");
    expect(softAiDebitIdempotencyKey("sess-9", 5)).toBe("debit:soft_ai:sess-9:5");
  });
});

describe("InsufficientCreditsError", () => {
  it("exposes clear 402 + INSUFFICIENT_CREDITS", () => {
    const err = new InsufficientCreditsError({
      accountId: "a",
      required: 10,
      balance: 3,
    });
    expect(err.status).toBe(402);
    expect(err.code).toBe(INSUFFICIENT_CREDITS);
    expect(err.required).toBe(10);
    expect(err.balance).toBe(3);
  });
});

describe("signup grant constant (no client-supplied amounts)", () => {
  it("CREDIT_SIGNUP is 200 from policy", () => {
    expect(CREDIT_SIGNUP).toBe(200);
  });
});

describe("staging unlimited regression (policy → wallet skip)", () => {
  it("staging/local quote charge_total is 0 while charge_base preserved", () => {
    const staging = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
      haggleEnv: "staging",
    });
    expect(staging.unlimited).toBe(true);
    expect(staging.charge_base).toBe(10);
    expect(staging.charge_total).toBe(0);
    expect(staging.new_charged_base).toBe(10);

    const local = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
      haggleEnv: "local",
    });
    expect(local.unlimited).toBe(true);
    expect(local.charge_total).toBe(0);
  });

  it("production must debit (charge_total === charge_base)", () => {
    const prod = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "auto",
      sellerMode: "auto",
      publishedAskMinor: 80_000,
      haggleEnv: "production",
    });
    expect(prod.unlimited).toBe(false);
    expect(prod.charge_total).toBe(10);
    expect(prod.charge_base).toBe(10);
  });

  it("both Manual → 0 charge (manual side does not consume Soft AI credits)", () => {
    const zero = quoteSoftAiCreditDifferential({
      alreadyChargedBase: 0,
      buyerMode: "manual",
      sellerMode: "manual",
      publishedAskMinor: 80_000,
      haggleEnv: "production",
    });
    expect(zero.charge_base).toBe(0);
    expect(zero.charge_total).toBe(0);
  });
});

describe("creditsAreUnlimited fail-closed (security residual)", () => {
  it("policy: prod/production never unlimited; unknown env fails closed", () => {
    expect(creditsAreUnlimited("prod")).toBe(false);
    expect(creditsAreUnlimited("production")).toBe(false);
    expect(creditsAreUnlimited("")).toBe(false);
    expect(creditsAreUnlimited("staging")).toBe(true);
  });

  it("runtime: NODE_ENV=production never unlimited even if HAGGLE_ENV=staging", () => {
    const prevNode = process.env.NODE_ENV;
    const prevHaggle = process.env.HAGGLE_ENV;
    try {
      process.env.NODE_ENV = "production";
      process.env.HAGGLE_ENV = "staging";
      expect(creditsAreUnlimitedAtRuntime("staging")).toBe(false);
      expect(creditsAreUnlimitedAtRuntime()).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevHaggle === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = prevHaggle;
    }
  });
});
