import { type Database, listingDrafts, listingsPublished } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { DEMO_LISTINGS, ensureDemoListings } from "../services/demo-listings.service.js";

const enabled = { HAGGLE_ENV: "staging", HAGGLE_DOGFOOD_AUTH_SECRET: "x".repeat(32) };

function fakeDb(sellerExists = true) {
  const published = new Set<string>();
  const drafts = new Map<string, Record<string, unknown>>();
  let lookupCount = 0;
  const db = {
    execute: vi.fn().mockResolvedValue(sellerExists ? [{ id: "seller" }] : []),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const publicId = DEMO_LISTINGS[lookupCount++ % DEMO_LISTINGS.length].publicId;
            return Promise.resolve(published.has(publicId) ? [{ id: publicId }] : []);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (table === listingDrafts) {
            drafts.set(value.id as string, value);
            return Promise.resolve([]);
          }
          if (table === listingsPublished) {
            return {
              returning: () => {
                const publicId = value.publicId as string;
                if (published.has(publicId)) return Promise.resolve([]);
                published.add(publicId);
                return Promise.resolve([{ id: publicId }]);
              },
            };
          }
          throw new Error("unexpected table");
        },
      }),
    }),
  };
  return { db: db as unknown as Database, published, drafts, execute: db.execute };
}

describe("ensureDemoListings", () => {
  const log = { info: vi.fn(), warn: vi.fn() };

  it("writes no rows with the gate off or in production", async () => {
    const store = fakeDb();
    expect(await ensureDemoListings(store.db, { HAGGLE_ENV: "staging" }, log)).toBe(0);
    expect(await ensureDemoListings(store.db, { ...enabled, HAGGLE_ENV: "production" }, log)).toBe(
      0,
    );
    expect(store.execute).not.toHaveBeenCalled();
    expect(store.published.size).toBe(0);
  });

  it("skips when the seller user is missing", async () => {
    const store = fakeDb(false);
    expect(await ensureDemoListings(store.db, enabled, log)).toBe(0);
    expect(store.published.size).toBe(0);
  });

  it("inserts ten negotiable listings once with fixed IDs and demo copy", async () => {
    const store = fakeDb();
    log.warn.mockClear();
    const count = await ensureDemoListings(store.db, enabled, log);
    expect(log.warn.mock.calls).toEqual([]);
    expect(count).toBe(10);
    expect(await ensureDemoListings(store.db, enabled, log)).toBe(0);
    expect(store.published.size).toBe(10);
    expect(store.drafts.size).toBe(10);
    for (const draft of store.drafts.values()) {
      expect(draft.title).toMatch(/^\[Demo\] /);
      expect(draft.description).toMatch(/^Demo listing for Haggle staging/);
      expect(draft.photoUrl).toMatch(/^https:\/\/images\.unsplash\.com\//);
      expect(draft.negotiationAgentSnapshot).toEqual({ preset: "balancer" });
      expect(draft.agentId).toBe("balancer");
      expect(Number(draft.floorPrice)).toBeLessThan(Number(draft.targetPrice));
    }
  });
});
