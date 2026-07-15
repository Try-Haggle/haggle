import { describe, expect, it } from "vitest";
import {
  computeModuleDisputeCost,
  decideModuleDisputeOpen,
  type ModuleTransactionSnapshot,
  normalizeDisputeModuleConfig,
} from "../module-contract.js";

const transaction: ModuleTransactionSnapshot = {
  platform_id: "marketplace",
  external_order_id: "ext-order-1",
  buyer_actor_id: "buyer-1",
  seller_actor_id: "seller-1",
  amount_minor: 50_000,
  currency: "USD",
  status: "DELIVERED",
};

describe("normalizeDisputeModuleConfig", () => {
  it("keeps Haggle native defaults", () => {
    const config = normalizeDisputeModuleConfig();
    expect(config.tier2_rate).toBe(0.02);
    expect(config.platform_share).toBe(0.3);
    expect(config.use_shared_pool).toBe(true);
  });

  it("allows platform-specific economics", () => {
    const config = normalizeDisputeModuleConfig({
      tier2_rate: 0.008,
      tier2_min_cents: 5_000,
      reviewer_share: 0.6,
      platform_share: 0.4,
      use_shared_pool: false,
    });
    expect(config.tier2_rate).toBe(0.008);
    expect(config.tier2_min_cents).toBe(5_000);
    expect(config.use_shared_pool).toBe(false);
  });

  it("rejects invalid revenue splits", () => {
    expect(() =>
      normalizeDisputeModuleConfig({
        reviewer_share: 0.7,
        platform_share: 0.2,
      }),
    ).toThrow("reviewer_share + platform_share must equal 1");
  });

  it("rejects invalid allowed statuses at runtime", () => {
    expect(() =>
      normalizeDisputeModuleConfig({
        allowed_open_statuses: ["NOT_A_STATUS" as never],
      }),
    ).toThrow("invalid allowed_open_status");
  });
});

describe("computeModuleDisputeCost", () => {
  it("uses default Haggle economics", () => {
    const cost = computeModuleDisputeCost(50_000, 2);
    expect(cost.cost_cents).toBe(1_200);
    expect(cost.reviewer_count).toBe(5);
  });

  it("uses platform overrides without changing reviewer topology", () => {
    const cost = computeModuleDisputeCost(500_000, 2, {
      tier2_rate: 0.008,
      tier2_min_cents: 5_000,
    });
    expect(cost.cost_cents).toBe(5_000);
    expect(cost.reviewer_count).toBe(9);
  });
});

describe("decideModuleDisputeOpen", () => {
  it("derives buyer role from trusted transaction snapshot", () => {
    const decision = decideModuleDisputeOpen(transaction, {
      requester_actor_id: "buyer-1",
      reason_code: "ITEM_NOT_AS_DESCRIBED",
      summary: "Battery health was overstated.",
    });
    expect(decision).toMatchObject({ ok: true, opened_by: "buyer" });
  });

  it("derives seller role from trusted transaction snapshot", () => {
    const decision = decideModuleDisputeOpen(transaction, {
      requester_actor_id: "seller-1",
      reason_code: "REFUND_DISPUTE",
      summary: "Buyer requested an unsupported refund.",
    });
    expect(decision).toMatchObject({ ok: true, opened_by: "seller" });
  });

  it("rejects callers outside the transaction", () => {
    const decision = decideModuleDisputeOpen(transaction, {
      requester_actor_id: "stranger",
      reason_code: "OTHER",
      summary: "Trying to open someone else's dispute.",
    });
    expect(decision).toMatchObject({ ok: false, error: "FORBIDDEN" });
  });

  it("rejects non-disputable statuses", () => {
    const decision = decideModuleDisputeOpen(
      { ...transaction, status: "PAYMENT_PENDING" },
      {
        requester_actor_id: "buyer-1",
        reason_code: "ITEM_NOT_RECEIVED",
        summary: "Too early.",
      },
    );
    expect(decision).toMatchObject({ ok: false, error: "ORDER_NOT_DISPUTABLE" });
  });

  it("rejects malformed transaction snapshots at runtime", () => {
    const decision = decideModuleDisputeOpen(
      { ...transaction, status: "NOT_A_STATUS" as never },
      {
        requester_actor_id: "buyer-1",
        reason_code: "ITEM_NOT_RECEIVED",
        summary: "Runtime bad status.",
      },
    );
    expect(decision).toMatchObject({ ok: false, error: "INVALID_TRANSACTION" });
  });

  it("rejects malformed reason codes at runtime", () => {
    const decision = decideModuleDisputeOpen(transaction, {
      requester_actor_id: "buyer-1",
      reason_code: "NOT_A_REASON" as never,
      summary: "Runtime bad reason.",
    });
    expect(decision).toMatchObject({ ok: false, error: "INVALID_TRANSACTION" });
  });

  it("supports platform-specific open statuses", () => {
    const decision = decideModuleDisputeOpen(
      { ...transaction, status: "CLOSED" },
      {
        requester_actor_id: "buyer-1",
        reason_code: "OTHER",
        summary: "Closed-order dispute window.",
      },
      { allowed_open_statuses: ["CLOSED"] },
    );
    expect(decision).toMatchObject({ ok: true, opened_by: "buyer" });
  });
});
