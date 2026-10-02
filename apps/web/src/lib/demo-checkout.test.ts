import { describe, expect, it } from "vitest";
import {
  buildDemoCheckoutPayload,
  DEFAULT_DEMO_CHECKOUT,
  deriveDemoChainIds,
  isDemoCheckoutEnabled,
  parseDemoCheckoutPayload,
  presenterJumpShip,
  presenterJumpStep,
} from "./demo-checkout";

describe("demo checkout handoff payload", () => {
  it("builds minor-unit payload from a negotiation agreement", () => {
    const p = buildDemoCheckoutPayload({
      agreedPriceUsd: 11.48,
      listingPriceUsd: 13,
      item: " Vintage Lamp ",
      rounds: 4,
    });
    expect(p).toEqual({ price: 1148, market: 1300, item: "Vintage Lamp", rounds: 4 });
  });

  it("round-trips through JSON and clamps market to at least the price", () => {
    const raw = JSON.stringify({ price: 5000, market: 100, item: "X", rounds: 2 });
    expect(parseDemoCheckoutPayload(raw)).toEqual({
      price: 5000,
      market: 5000,
      item: "X",
      rounds: 2,
    });
  });

  it("carries a safe listing photo URL and drops unsafe ones", () => {
    const p = buildDemoCheckoutPayload({
      agreedPriceUsd: 408,
      listingPriceUsd: 450,
      item: "MacBook Air",
      rounds: 8,
      imageUrl: "https://cdn.example.com/a.webp",
    });
    expect(p.imageUrl).toBe("https://cdn.example.com/a.webp");
    expect(parseDemoCheckoutPayload(JSON.stringify(p)).imageUrl).toBe(
      "https://cdn.example.com/a.webp",
    );
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AA", "not a url", 7]) {
      const raw = JSON.stringify({ price: 100, item: "X", rounds: 1, imageUrl: bad });
      expect(parseDemoCheckoutPayload(raw)).not.toHaveProperty("imageUrl");
    }
    expect(
      buildDemoCheckoutPayload({
        agreedPriceUsd: 1,
        listingPriceUsd: 1,
        item: "X",
        rounds: 1,
        imageUrl: null,
      }),
    ).not.toHaveProperty("imageUrl");
  });

  it("falls back to preset for null / malformed / invalid input", () => {
    expect(parseDemoCheckoutPayload(null)).toEqual(DEFAULT_DEMO_CHECKOUT);
    expect(parseDemoCheckoutPayload("{nope")).toEqual(DEFAULT_DEMO_CHECKOUT);
    const bad = parseDemoCheckoutPayload(JSON.stringify({ price: -1, item: 5, rounds: "x" }));
    expect(bad.price).toBe(DEFAULT_DEMO_CHECKOUT.price);
    expect(bad.item).toBe(DEFAULT_DEMO_CHECKOUT.item);
  });

  it("is closed on production and open on staging/local", () => {
    expect(isDemoCheckoutEnabled({ HAGGLE_ENV: "production" })).toBe(false);
    expect(isDemoCheckoutEnabled({ HAGGLE_ENV: "staging", VERCEL_ENV: "production" })).toBe(false);
    expect(isDemoCheckoutEnabled({ HAGGLE_ENV: "staging" })).toBe(true);
    expect(isDemoCheckoutEnabled({})).toBe(true);
  });
});

describe("deterministic chain ids", () => {
  it("is stable per agreement and well-formed", () => {
    const a = deriveDemoChainIds("Lamp", 1148);
    expect(deriveDemoChainIds("Lamp", 1148)).toEqual(a);
    expect(a.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.buyer).toMatch(/^0x[0-9a-f]{40}$/);
    expect(a.buyer).not.toBe(a.seller);
    expect(deriveDemoChainIds("Lamp", 1149).tx).not.toBe(a.tx);
    expect(a.walletBefore).toBeGreaterThan(11.48);
  });
});

describe("presenter transitions", () => {
  it("step jump marks earlier steps done and resets shipping", () => {
    expect(presenterJumpStep(3)).toMatchObject({
      idx: 3,
      done: [0, 1, 2],
      shipSub: "labelPending",
    });
  });
  it("settle jump marks the settle step done so the wallet is debited", () => {
    expect(presenterJumpStep(4).done).toEqual([0, 1, 2, 3, 4]);
  });
  it("ship jump routes delivered to the delivered step", () => {
    expect(presenterJumpShip("inTransit")).toMatchObject({
      idx: 5,
      shipSub: "inTransit",
      delayed: false,
    });
    expect(presenterJumpShip("inTransit", true).delayed).toBe(true);
    expect(presenterJumpShip("outForDelivery", true).delayed).toBe(false);
    expect(presenterJumpShip("delivered")).toMatchObject({ idx: 6, done: [0, 1, 2, 3, 4, 5] });
  });
});
