// QA HAGA-150 supplementary: exercise each consumer path end-to-end with mixed rows.
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: true,
    strings: [...strings],
    values,
  }),
  recommendationLogs: { id: "id" },
  tagIdfCache: {},
}));

import {
  getDashboardRecommendations,
  getSimilarListingsForPublicId,
} from "../services/similar-listings.service.js";

const vec = [1, 0, 0];
const snap = { category: "phone", tags: [], condition: "good", targetPrice: "100", title: "t" };
const row = (id: string, seller: string | null) => ({
  id,
  public_id: `pub-${id}`,
  draft_id: `d-${id}`,
  snapshot_json: snap,
  text_embedding: vec,
  image_embedding: null,
  cosine_similarity: 0.99,
  __seller: seller,
});

function makeDb(main: ReturnType<typeof row>[], fallback: ReturnType<typeof row>[]) {
  const seen: string[] = [];
  const execute = vi.fn(async (q: unknown) => {
    const t = render(q).replace(/\s+/g, " ");
    if (t.includes("FROM listings_published lp") && t.includes("JOIN listing_drafts")) {
      seen.push(t);
      const src =
        t.includes("NOT IN (SELECT published_listing_id") || !t.includes("buyer_listings")
          ? main
          : fallback;
      const pool = t.includes("NOT IN (SELECT published_listing_id")
        ? main
        : src === main && seen.length === 1
          ? main
          : fallback;
      return t.includes("ld.user_id IS NOT NULL") ? pool.filter((r) => r.__seller !== null) : pool;
    }
    if (t.includes("WHERE public_id =")) return [{ id: "source", snapshot_json: snap }];
    if (t.includes("FROM listing_embeddings") && t.includes("published_listing_id ="))
      return [{ text_embedding: "[1,0,0]", image_embedding: null }];
    if (t.includes("buyer_interest_vectors"))
      return [{ interest_vector: "[1,0,0]", based_on_count: 3 }];
    return [];
  });
  let n = 0;
  const insert = vi.fn(() => ({
    values: () => ({ returning: async () => [{ id: `log-${++n}` }] }),
  }));
  return { db: { execute, insert } as never, seen };
}

describe("QA HAGA-150 per-path", () => {
  it("public similar listings: drops seller-less, keeps seller-owned", async () => {
    const { db, seen } = makeDb([row("s1", "seller-1"), row("x1", null)], []);
    const res = await getSimilarListingsForPublicId(db, "pub-source", { limit: 10, userId: null });
    const ids = res!.listings.map(
      (l) => (l as { publicId?: string }).publicId ?? JSON.stringify(l),
    );
    expect(seen).toHaveLength(1);
    expect(ids.join()).toContain("pub-s1");
    expect(ids.join()).not.toContain("pub-x1");
  });

  it("dashboard main + fallback: drops seller-less, keeps seller-owned in both", async () => {
    const { db, seen } = makeDb(
      [row("m1", "seller-1"), row("mx", null)],
      [row("f1", "seller-2"), row("fx", null)],
    );
    const res = await getDashboardRecommendations(db, "buyer-1", { limit: 10 });
    const s = JSON.stringify(res.listings);
    expect(seen).toHaveLength(2);
    expect(s).toContain("pub-m1");
    expect(s).toContain("pub-f1");
    expect(s).not.toContain("pub-mx");
    expect(s).not.toContain("pub-fx");
  });
});
