/**
 * Simulated checkout (staging/local demo only). Pure client-side helpers: payload
 * handoff from a real negotiation, deterministic fake chain identifiers, and the
 * presenter-panel state transitions. No network, no DB, no funds movement.
 */
import { isDogfoodAuthWebSurfaceEnabled } from "./dogfood-auth-gate";

export const DEMO_CHECKOUT_STORAGE_KEY = "haggle_checkout";
export const DEMO_CHECKOUT_PATH = "/demo/checkout";

export const DEFAULT_DEMO_CHECKOUT = {
  price: 45000,
  market: 52000,
  item: "iPhone 14 Pro 128GB · Space Black",
  rounds: 3,
} as const;

/** Prices are minor units (cents). */
export interface DemoCheckoutPayload {
  price: number;
  market: number;
  item: string;
  rounds: number;
  /** Listing photo (http/https only). Omitted when the listing has none. */
  imageUrl?: string;
}

/** Same gate as dogfood auth: closed on production, open on staging/local. */
export function isDemoCheckoutEnabled(env?: Record<string, string | undefined>): boolean {
  return env ? isDogfoodAuthWebSurfaceEnabled(env) : isDogfoodAuthWebSurfaceEnabled();
}

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

function safeImageUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const url = new URL(v.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function withImage(payload: DemoCheckoutPayload, image: unknown): DemoCheckoutPayload {
  const imageUrl = safeImageUrl(image);
  return imageUrl ? { ...payload, imageUrl } : payload;
}

export function buildDemoCheckoutPayload(input: {
  agreedPriceUsd: number;
  listingPriceUsd: number;
  item: string;
  rounds: number;
  imageUrl?: string | null;
}): DemoCheckoutPayload {
  const price = positiveInt(Math.round(input.agreedPriceUsd * 100)) ?? DEFAULT_DEMO_CHECKOUT.price;
  const listing = positiveInt(Math.round(input.listingPriceUsd * 100)) ?? price;
  return withImage(
    {
      price,
      market: Math.max(listing, price),
      item: input.item.trim() || DEFAULT_DEMO_CHECKOUT.item,
      rounds: positiveInt(input.rounds) ?? 1,
    },
    input.imageUrl,
  );
}

/** Tolerant parse of sessionStorage content; anything malformed falls back to the preset. */
export function parseDemoCheckoutPayload(raw: string | null): DemoCheckoutPayload {
  if (!raw) return { ...DEFAULT_DEMO_CHECKOUT };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const price = positiveInt(p.price) ?? DEFAULT_DEMO_CHECKOUT.price;
    const market = positiveInt(p.market) ?? Math.max(price, DEFAULT_DEMO_CHECKOUT.market);
    return withImage(
      {
        price,
        market: Math.max(market, price),
        item:
          typeof p.item === "string" && p.item.trim() ? p.item.trim() : DEFAULT_DEMO_CHECKOUT.item,
        rounds: positiveInt(p.rounds) ?? DEFAULT_DEMO_CHECKOUT.rounds,
      },
      p.imageUrl,
    );
  } catch {
    return { ...DEFAULT_DEMO_CHECKOUT };
  }
}

/* ===== deterministic fake chain identifiers ===== */

function fnv(seed: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function hex(seed: string, chars: number, salt: number): string {
  let out = "";
  for (let i = 0; out.length < chars; i++)
    out += fnv(seed, salt + i * 7919)
      .toString(16)
      .padStart(8, "0");
  return out.slice(0, chars);
}

export const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export interface DemoChainIds {
  buyer: string;
  seller: string;
  escrow: string;
  feeWallet: string;
  tx: string;
  block: number;
  /** Buyer USDC balance before paying (minor-unit precision, dollars). */
  walletBefore: number;
}

export function deriveDemoChainIds(item: string, priceMinor: number): DemoChainIds {
  const seed = `${item}|${priceMinor}`;
  return {
    buyer: `0x${hex(seed, 40, 1)}`,
    seller: `0x${hex(seed, 40, 101)}`,
    escrow: `0x${hex(seed, 40, 201)}`,
    feeWallet: `0x${hex(seed, 40, 301)}`,
    tx: `0x${hex(seed, 64, 401)}`,
    block: 12_000_000 + (fnv(seed, 9) % 900_000),
    walletBefore: Math.ceil((priceMinor / 100) * 2.4 + 120),
  };
}

/* ===== presenter panel transitions ===== */

export type ShipPhase =
  | "labelPending"
  | "labelCreated"
  | "inTransit"
  | "outForDelivery"
  | "delivered";
export const SHIP_PHASES: readonly ShipPhase[] = [
  "labelPending",
  "labelCreated",
  "inTransit",
  "outForDelivery",
  "delivered",
];

export interface PresenterView {
  /** Index into the checkout STEPS (0 rail … 4 settle, 5 ship, 6 delivered). */
  idx: number;
  shipSub: ShipPhase;
  /** Step indexes that must be marked done. */
  done: number[];
  delayed: boolean;
}

/**
 * Jump to a payment step (0-4) with all earlier steps completed. The settle step (4)
 * renders the settled receipt on arrival, so it is marked done too (wallet debited).
 */
export function presenterJumpStep(idx: number): PresenterView {
  const i = Math.max(0, Math.min(6, Math.floor(idx)));
  return {
    idx: i,
    shipSub: "labelPending",
    done: Array.from({ length: i === 4 ? 5 : i }, (_, k) => k),
    delayed: false,
  };
}

/** Jump to a shipping phase; `delayed` is only meaningful while in transit. */
export function presenterJumpShip(phase: ShipPhase, delayed = false): PresenterView {
  const delivered = phase === "delivered";
  return {
    idx: delivered ? 6 : 5,
    shipSub: phase,
    done: delivered ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4],
    delayed: phase === "inTransit" ? delayed : false,
  };
}
