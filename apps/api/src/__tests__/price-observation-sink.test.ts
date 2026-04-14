import { describe, it, expect, vi } from "vitest";
import { recordAgreedPrice, type AgreedPriceEvent } from "../services/price-observation-sink.js";

// Mock @haggle/db
vi.mock("@haggle/db", () => ({
  hfmiPriceObservations: { _: "hfmi_price_observations" },
}));

function makeMockDb() {
  const insertedValues: Record<string, unknown>[] = [];
  const onConflictDoNothing = vi.fn();
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { insert } as unknown as import("@haggle/db").Database,
    insertedValues,
    getInsertedValue: () => values.mock.calls[0]?.[0],
    insert,
    values,
    onConflictDoNothing,
  };
}

describe("Price Observation Sink", () => {
  it("records agreed price with haggle_internal source", async () => {
    const mock = makeMockDb();
    const event: AgreedPriceEvent = {
      sessionId: "sess-001",
      finalPriceMinor: 58500,
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-1",
      tagGarden: [
        { name: "iphone_15_pro", category: "model" },
        { name: "256gb", category: "storage" },
        { name: "B", category: "condition" },
      ],
      category: "electronics",
    };

    await recordAgreedPrice(mock.db, event);

    expect(mock.insert).toHaveBeenCalled();
    const inserted = mock.getInsertedValue();
    expect(inserted.source).toBe("haggle_internal");
    expect(inserted.model).toBe("iphone_15_pro");
    expect(inserted.storageGb).toBe(256);
    expect(inserted.observedPriceUsd).toBe("585");
    expect(inserted.externalId).toBe("haggle_sess-001");
    expect(mock.onConflictDoNothing).toHaveBeenCalled();
  });

  it("falls back to category when no tag garden", async () => {
    const mock = makeMockDb();
    const event: AgreedPriceEvent = {
      sessionId: "sess-002",
      finalPriceMinor: 45000,
      buyerId: "buyer-1",
      sellerId: "seller-1",
      listingId: "listing-2",
      category: "electronics",
    };

    await recordAgreedPrice(mock.db, event);

    const inserted = mock.getInsertedValue();
    expect(inserted.source).toBe("haggle_internal");
    expect(inserted.model).toBe("electronics");
    expect(inserted.observedPriceUsd).toBe("450");
  });

  it("is idempotent via external_id", async () => {
    const mock = makeMockDb();
    const event: AgreedPriceEvent = {
      sessionId: "sess-003",
      finalPriceMinor: 60000,
      buyerId: "b",
      sellerId: "s",
      listingId: "l",
    };

    await recordAgreedPrice(mock.db, event);
    expect(mock.getInsertedValue().externalId).toBe("haggle_sess-003");
    expect(mock.onConflictDoNothing).toHaveBeenCalled();
  });

  it("is non-fatal on DB error", async () => {
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockRejectedValue(new Error("DB down")),
        }),
      }),
    } as unknown as import("@haggle/db").Database;

    // Should not throw
    await expect(
      recordAgreedPrice(db, {
        sessionId: "sess-err",
        finalPriceMinor: 50000,
        buyerId: "b",
        sellerId: "s",
        listingId: "l",
      }),
    ).resolves.toBeUndefined();
  });

  it("stores raw payload with metadata", async () => {
    const mock = makeMockDb();
    await recordAgreedPrice(mock.db, {
      sessionId: "sess-004",
      finalPriceMinor: 72000,
      buyerId: "buyer-x",
      sellerId: "seller-y",
      listingId: "listing-z",
      category: "smartphones",
    });

    const inserted = mock.getInsertedValue();
    expect(inserted.rawPayload.session_id).toBe("sess-004");
    expect(inserted.rawPayload.buyer_id).toBe("buyer-x");
    expect(inserted.rawPayload.final_price_minor).toBe(72000);
  });
});
