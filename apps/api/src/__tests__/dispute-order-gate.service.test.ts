import { describe, expect, it } from "vitest";
import {
  DISPUTABLE_ORDER_STATUSES,
  describeDisputeOrderGate,
  isDisputableOrderStatus,
} from "../services/dispute-order-gate.service.js";

describe("dispute-order-gate", () => {
  it("allows known post-payment statuses", () => {
    for (const status of DISPUTABLE_ORDER_STATUSES) {
      expect(isDisputableOrderStatus(status)).toBe(true);
      expect(describeDisputeOrderGate(status).disputable).toBe(true);
    }
  });

  it("names payment_not_settled for PAYMENT_PENDING with staging fixture hint", () => {
    const gate = describeDisputeOrderGate("PAYMENT_PENDING");
    expect(gate).toMatchObject({
      disputable: false,
      order_status: "PAYMENT_PENDING",
      blocking_gate: "payment_not_settled",
    });
    expect(gate.message).toContain("has not settled");
    expect(gate.message).toContain("haggle_create_checkout");
    expect(gate.staging_fixture?.endpoint).toBe("POST /tools/payment-test/dispute-ready-order");
    expect(gate.staging_fixture?.env_flag).toBe("HAGGLE_ENABLE_PAYMENT_TEST_TOOLS");
    expect(gate.staging_fixture?.notes?.join(" ")).toContain("Authorization: Bearer");
    expect(gate.staging_fixture?.notes?.join(" ")).toContain("HAGGLE_ENV=staging");
    expect(gate.hint).toContain("dispute-ready-order");
  });

  it("names payment_not_settled for APPROVED", () => {
    expect(describeDisputeOrderGate("APPROVED").blocking_gate).toBe("payment_not_settled");
  });

  it("names terminal gates without pointing at the paid fixture", () => {
    const closed = describeDisputeOrderGate("CLOSED");
    expect(closed.blocking_gate).toBe("order_terminal");
    expect(closed.staging_fixture).toBeUndefined();
  });
});
