import { describe, expect, it } from "vitest";
import {
  type ConversationSignal,
  extractConversationSignals,
} from "../../../services/conversation-signal-extractor.js";
import { mapSignalsToFeatures } from "../signals-to-features.js";

/** End-to-end: real regex extractor → sensor mapper. */
function featuresFor(text: string, source: "buyer_msg" | "seller_msg" = "seller_msg") {
  return mapSignalsToFeatures(extractConversationSignals({ text }), source);
}
function byKey(text: string, key: string) {
  return featuresFor(text).find((f) => f.key === key);
}

describe("mapSignalsToFeatures (L3 / H5-a)", () => {
  it("maps battery health to a numeric value_adjust feature", () => {
    const f = byKey("Battery health 89%, clean unit.", "battery_health");
    expect(f).toBeDefined();
    expect(f!.type).toBe("value_adjust");
    expect(f!.value).toBe(89);
    expect(f!.unit).toBe("%");
    expect(f!.raw_span).toBeTruthy();
  });

  it("normalizes storage GB into the schema enum label", () => {
    expect(byKey("256GB model", "storage_capacity")?.value).toBe("256GB");
    expect(byKey("512GB version", "storage_capacity")?.value).toBe("512GB");
  });

  it("maps 1024GB (1TB) storage to the '1TB' label", () => {
    // The regex extractor needs 2+ digits before the unit, so it misses bare "1TB"
    // (tracked as a follow-up). Drive the mapper directly to cover the TB→label path.
    const signal: ConversationSignal = {
      type: "product_attribute",
      entityType: "storage",
      entityValue: "1TB",
      normalizedValue: "1024gb",
      confidence: 0.9,
      evidence: { source: "message" },
      method: "deterministic",
      privacyClass: "public_market",
      marketUsefulness: "high",
      rolePerspective: "SELLER",
      metadata: { storage_gb: 1024 },
    };
    expect(mapSignalsToFeatures([signal], "seller_msg")[0]?.value).toBe("1TB");
  });

  it("maps carrier status to unlocked/locked", () => {
    expect(byKey("Factory unlocked device", "carrier_lock")?.value).toBe("unlocked");
    expect(byKey("It is carrier locked", "carrier_lock")?.value).toBe("locked");
  });

  it("emits mentioned-but-unknown gates/terms with value null (→ Tag Garden H7)", () => {
    const imei = byKey("IMEI clean and verified", "imei_verification");
    expect(imei?.type).toBe("term");
    expect(imei?.value).toBeNull();

    expect(byKey("Warranty included", "warranty_period")?.value).toBeNull();
    expect(byKey("Free shipping on this one", "shipping_method")?.value).toBeNull();
  });

  it("captures local pickup as a concrete shipping_method value", () => {
    expect(byKey("Local pickup only", "shipping_method")?.value).toBe("local_pickup");
  });

  it("a concrete value wins over a null on the same key (shipping vs local pickup)", () => {
    // "shipping" (→ null) is emitted before "local pickup" (→ "local_pickup"); the
    // concrete value must not be shadowed by the earlier null.
    const f = byKey("I can ship it, or you can do local pickup", "shipping_method");
    expect(f?.value).toBe("local_pickup");
  });

  it("drops signals that are not in the feature schema (price, product identity)", () => {
    const feats = featuresFor("I'd offer $450 for this iPhone 14 Pro");
    expect(feats.map((f) => f.key)).not.toContain("battery_health");
    // price_anchor / product_identity carry no feature key → nothing emitted
    expect(feats.every((f) => f.key !== "price" && f.key !== "product")).toBe(true);
  });

  it("dedupes by key (first wins)", () => {
    const feats = featuresFor("128GB or 256GB available");
    const storage = feats.filter((f) => f.key === "storage_capacity");
    expect(storage).toHaveLength(1);
  });

  it("propagates the source side", () => {
    const [f] = mapSignalsToFeatures(
      extractConversationSignals({ text: "Battery health 90%" }),
      "buyer_msg",
    );
    expect(f?.source).toBe("buyer_msg");
  });
});
