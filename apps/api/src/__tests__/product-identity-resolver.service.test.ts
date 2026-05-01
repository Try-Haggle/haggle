import { describe, expect, it } from "vitest";
import {
  compareProductIdentity,
  resolveProductIdentity,
} from "../services/product-identity-resolver.service.js";

describe("product identity resolver", () => {
  it("extracts canonical iPhone model and variant attributes", () => {
    const identity = resolveProductIdentity("Apple iPhone 15 Pro 128GB unlocked battery 92%");

    expect(identity).toMatchObject({
      canonicalFamily: "iphone",
      generation: "15",
      variant: "pro",
      model: "iphone_15_pro",
      storageGb: 128,
      batteryHealthPct: 92,
      carrierLocked: false,
    });
    expect(identity.confidence).toBeGreaterThan(0.8);
  });

  it("treats same model with different storage as a variant that needs confirmation", () => {
    const comparison = compareProductIdentity("iphone 15 128GB", "iphone 15 256GB");

    expect(comparison.alignment).toBe("variant");
    expect(comparison.shouldAskConfirmation).toBe(true);
    expect(comparison.shouldBlockAutoNegotiation).toBe(false);
    expect(comparison.reasonCodes).toContain("different_storage");
  });

  it("treats iPhone 15 memory and iPhone 14 selection as related, not a hard block", () => {
    const comparison = compareProductIdentity("iphone 15", "iphone 14");

    expect(comparison.alignment).toBe("related");
    expect(comparison.shouldAskConfirmation).toBe(true);
    expect(comparison.shouldBlockAutoNegotiation).toBe(false);
    expect(comparison.reasonCodes).toContain("different_generation");
  });

  it("does not ask confirmation when the selected product is a different family", () => {
    const comparison = compareProductIdentity("laptop for school", "iphone 15");

    expect(comparison.alignment).toBe("different");
    expect(comparison.shouldAskConfirmation).toBe(false);
    expect(comparison.shouldBlockAutoNegotiation).toBe(false);
    expect(comparison.reasonCodes).toContain("different_family");
  });

  it("blocks auto negotiation when identity is uncertain", () => {
    const comparison = compareProductIdentity("something lightweight", "iphone 15");

    expect(comparison.alignment).toBe("unknown");
    expect(comparison.shouldBlockAutoNegotiation).toBe(true);
    expect(comparison.shouldAskConfirmation).toBe(true);
  });
});
