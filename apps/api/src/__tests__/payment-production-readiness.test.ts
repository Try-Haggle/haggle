import { afterEach, describe, expect, it } from "vitest";
import { initiateDepositCollection } from "../payments/deposit-collector.js";
import { executeRefund } from "../payments/refund-executor.js";
import { refundDeposit } from "../payments/deposit-refunder.js";

const originalEnv = {
  DEPOSIT_COLLECTION_MODE: process.env.DEPOSIT_COLLECTION_MODE,
  NODE_ENV: process.env.NODE_ENV,
  REFUND_MODE: process.env.REFUND_MODE,
};

afterEach(() => {
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("payment production readiness", () => {
  it("does not allow mock dispute deposits in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.DEPOSIT_COLLECTION_MODE;

    await expect(initiateDepositCollection({
      deposit_id: "dep_1",
      dispute_id: "disp_1",
      amount_cents: 500,
      seller_user_id: "seller_1",
    })).rejects.toThrow("DEPOSIT_COLLECTION_MODE must be usdc or stripe in production");
  });

  it("does not allow mock buyer refunds in production", async () => {
    process.env.NODE_ENV = "production";

    await expect(executeRefund({
      order_id: "ord_1",
      amount_cents: 500,
      rail: "mock",
      reason: "test",
    })).rejects.toThrow("Mock refunds are disabled in production");
  });

  it("does not allow mock deposit refunds in production", async () => {
    process.env.NODE_ENV = "production";

    await expect(refundDeposit({
      deposit_id: "dep_1",
      amount_cents: 500,
      rail: "mock",
    })).rejects.toThrow("Mock deposit refunds are disabled in production");
  });
});
