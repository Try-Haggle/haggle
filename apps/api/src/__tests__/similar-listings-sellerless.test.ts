/**
 * HAGA-149: seller-less (listing_drafts.user_id IS NULL) published listings
 * must never be returned by findSimilarListings, which backs both the public
 * similar-listings route and the dashboard recommendations (main + fallback).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { render } = vi.hoisted(() => {
  const render = (v: unknown): string => {
    const o = v as { __sql?: boolean; strings?: string[]; values?: unknown[] };
    if (!o?.__sql) return "?";
    return o
      .strings!.map((s, i) => s + (i < o.values!.length ? render(o.values![i]) : ""))
      .join("");
  };
  return { render };
});

vi.mock("@haggle/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: true,
    strings: [...strings],
    values,
  });
  return { sql, recommendationLogs: {}, tagIdfCache: {} };
});

import {
  findSimilarListings,
  getDashboardRecommendations,
} from "../services/similar-listings.service.js";

const vec = [1, 0, 0];

function candidate(id: string, sellerId: string | null) {
  return {
    id,
    public_id: `pub-${id}`,
    draft_id: `draft-${id}`,
    snapshot_json: { category: "phone", tags: [], condition: "good", targetPrice: "100" },
    text_embedding: vec,
    image_embedding: null,
    cosine_similarity: 0.99,
    __sellerId: sellerId,
  };
}

const norm = (s: string) => s.replace(/\s+/g, " ");

/** Fake db: applies the seller filter only if the SQL text contains it. */
function makeDb(rows: ReturnType<typeof candidate>[]) {
  const candidateSql: string[] = [];
  const execute = vi.fn(async (q: unknown) => {
    const text = norm(render(q));
    if (text.includes("FROM listings_published lp") && text.includes("JOIN listing_drafts")) {
      candidateSql.push(text);
      return text.includes("ld.user_id IS NOT NULL")
        ? rows.filter((r) => r.__sellerId !== null)
        : rows;
    }
    if (text.includes("buyer_interest_vectors")) {
      return [{ interest_vector: "[1,0,0]", based_on_count: 3 }];
    }
    return [];
  });
  return { db: { execute } as never, candidateSql };
}

const snapshot = { category: "phone", tags: [], condition: "good", targetPrice: "100" };

describe("findSimilarListings seller-less exclusion", () => {
  let rows: ReturnType<typeof candidate>[];
  beforeEach(() => {
    rows = [candidate("with-seller", "seller-1"), candidate("sellerless", null)];
  });

  it("drops seller-less candidates and keeps seller-owned ones", async () => {
    const { db } = makeDb(rows);
    const res = await findSimilarListings(db, "source", snapshot, vec, null, { threshold: 0 });
    expect(res.map((r) => r.candidate.id)).toEqual(["with-seller"]);
  });

  it("applies the filter for anonymous callers too", async () => {
    const { db, candidateSql } = makeDb(rows);
    await findSimilarListings(db, "source", snapshot, vec, null, { userId: null, threshold: 0 });
    expect(candidateSql[0]).toContain("ld.user_id IS NOT NULL");
  });

  it("keeps category, viewed, ordering and limit conditions", async () => {
    const { db, candidateSql } = makeDb(rows);
    await findSimilarListings(db, "source", snapshot, vec, null, {
      userId: "buyer-1",
      excludeViewed: true,
      threshold: 0,
    });
    const q = candidateSql[0];
    expect(q).toContain("ld.user_id IS NOT NULL");
    expect(q).toContain("ld.user_id IS DISTINCT FROM");
    expect(q).toContain("lp.snapshot_json->>'category' =");
    expect(q).toContain("NOT IN (SELECT published_listing_id FROM buyer_listings");
    expect(q).toContain("ld.status = 'published'");
    expect(q).toContain("ORDER BY le.text_embedding <=>");
    expect(q).toContain("LIMIT 100");
  });
});

describe("dashboard recommendations seller-less exclusion", () => {
  it("applies the filter to both the main and fallback candidate queries", async () => {
    const { db, candidateSql } = makeDb([candidate("sellerless", null)]);
    const res = await getDashboardRecommendations(db, "buyer-1", { limit: 10 });
    expect(res.listings).toEqual([]);
    // main query (excludeViewed) + fallback query (viewed allowed)
    expect(candidateSql).toHaveLength(2);
    expect(candidateSql[0]).toContain("NOT IN (SELECT published_listing_id");
    expect(candidateSql[1]).not.toContain("NOT IN (SELECT published_listing_id");
    for (const q of candidateSql) expect(q).toContain("ld.user_id IS NOT NULL");
  });
});
