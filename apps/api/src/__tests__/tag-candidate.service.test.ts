/**
 * Unit tests for tag-candidate.service (Step 51).
 *
 * Pattern matches Step 50's tag-graph.service.test.ts: override the
 * global @haggle/db mock with a tagged-template `sql` that captures
 * raw SQL + interpolated values, and route execute() calls through a
 * fake in-memory store keyed off the raw SQL fragment.
 *
 * Covers the 15 cases in handoff/ARCHITECT-BRIEF.md Step 51.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Override the global @haggle/db mock ─────────────────────────────
vi.mock("@haggle/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join(" ");
    return { __sql: true, raw, values };
  };
  return {
    sql,
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
  };
});

// Also stub similar-listings.service so getTagIdf returns 1.0 (default)
// without trying to load anything.
vi.mock("../services/similar-listings.service.js", () => ({
  getTagIdf: vi.fn(() => 1.0),
}));

// Import AFTER the mock is registered.
import {
  gatherFromIdfTop,
  gatherFromSimilarListings,
  gatherFromTitleNgram,
  gatherTagCandidates,
  resolveLabelsToCandidates,
  type TagCandidate,
} from "../services/tag-candidate.service.js";

// ─── Fake in-memory database ─────────────────────────────────────────

interface TagRow {
  id: string;
  name: string;
  normalized_name: string;
  idf: number | null;
  aliases: string[];
}

interface IdfRow {
  tag: string;
  idf_score: number;
}

interface EdgeRow {
  parent_tag_id: string;
  child_tag_id: string;
}

interface SimilarTagsRow {
  tags: string[];
}

interface FakeDbState {
  tags: TagRow[];
  idfCache: IdfRow[];
  edges: EdgeRow[];
  /** Pre-canned ordered result for the similar-listings route. */
  similarTagRows: SimilarTagsRow[];
  /** Whether listing_embeddings has a row for the test listingId. */
  hasEmbeddingForListingId: Set<string>;
}

function createFakeDb(initial: Partial<FakeDbState> = {}) {
  const state: FakeDbState = {
    tags: initial.tags ?? [],
    idfCache: initial.idfCache ?? [],
    edges: initial.edges ?? [],
    similarTagRows: initial.similarTagRows ?? [],
    hasEmbeddingForListingId: initial.hasEmbeddingForListingId ?? new Set(),
  };

  const db = {
    _state: state,
    execute: async (descriptor: unknown) => {
      const d = descriptor as { raw?: string; values?: unknown[] };
      const raw = (d?.raw ?? "").replace(/\s+/g, " ").trim();
      const values = (d?.values as unknown[] | undefined) ?? [];

      // ── 1. tag_idf_cache top-N (route b) ─────────────────────────
      if (raw.includes("FROM tag_idf_cache") && raw.includes("ORDER BY idf_score DESC")) {
        const n = Number(values[0] ?? 0);
        return [...state.idfCache]
          .sort((a, b) => b.idf_score - a.idf_score)
          .slice(0, n)
          .map((r) => ({ tag: r.tag }));
      }

      // ── 2. tag_idf_cache lookup by names (resolveLabelsToCandidates) ─
      if (raw.includes("FROM tag_idf_cache") && raw.includes("WHERE tag = ANY")) {
        const names = (values[0] as string[]) ?? [];
        return state.idfCache
          .filter((r) => names.includes(r.tag))
          .map((r) => ({ tag: r.tag, idf_score: r.idf_score }));
      }

      // ── 3. listing_embeddings lookup by published_listing_id (route a) ─
      if (raw.includes("FROM listing_embeddings") && raw.includes("WHERE published_listing_id")) {
        const lid = String(values[0] ?? "");
        if (state.hasEmbeddingForListingId.has(lid)) {
          // Return a fake 3-d embedding string (matches pgvector raw shape).
          return [{ text_embedding: "[0.1,0.2,0.3]" }];
        }
        return [];
      }

      // ── 4. similar listings query (route a) ──────────────────────
      if (
        raw.includes("FROM listings_published lp") &&
        raw.includes("ORDER BY le.text_embedding")
      ) {
        return state.similarTagRows.map((r) => ({ tags: r.tags }));
      }

      // ── 5. tags lookup by normalized_name OR aliases (route c) ───
      if (
        raw.includes("FROM tags") &&
        raw.includes("normalized_name = ANY") &&
        raw.includes("aliases &&")
      ) {
        const ngrams = (values[0] as string[]) ?? [];
        const set = new Set(ngrams);
        const matches = state.tags.filter(
          (t) =>
            set.has(t.normalized_name) ||
            t.aliases.some((a) => set.has(a)),
        );
        // DISTINCT name
        const seen = new Set<string>();
        const out: Array<{ name: string }> = [];
        for (const t of matches) {
          if (!seen.has(t.name)) {
            seen.add(t.name);
            out.push({ name: t.name });
          }
        }
        return out;
      }

      // ── 6. tags lookup by name OR normalized_name (resolve) ──────
      if (
        raw.includes("FROM tags") &&
        raw.includes("name = ANY") &&
        raw.includes("normalized_name = ANY")
      ) {
        const rawNames = (values[0] as string[]) ?? [];
        const normNames = (values[1] as string[]) ?? [];
        const rawSet = new Set(rawNames);
        const normSet = new Set(normNames);
        return state.tags
          .filter((t) => rawSet.has(t.name) || normSet.has(t.normalized_name))
          .map((t) => ({
            id: t.id,
            name: t.name,
            normalized_name: t.normalized_name,
            idf: t.idf,
          }));
      }

      // ── 7. tag_edges lookup by child_tag_id (resolve) ────────────
      if (
        raw.includes("FROM tag_edges") &&
        raw.includes("WHERE child_tag_id = ANY")
      ) {
        const ids = (values[0] as string[]) ?? [];
        const set = new Set(ids);
        return state.edges
          .filter((e) => set.has(e.child_tag_id))
          .map((e) => ({
            child_tag_id: e.child_tag_id,
            parent_tag_id: e.parent_tag_id,
          }));
      }

      return [];
    },
  };

  return db;
}

type FakeDb = ReturnType<typeof createFakeDb>;
const asDb = (db: FakeDb) => db as unknown as never;

// ─── Tests ───────────────────────────────────────────────────────────

describe("tag-candidate.service", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
  });

  // ── Case 1 — gatherFromIdfTop top-3 desc ─────────────────────────
  it("gatherFromIdfTop returns top-N tags by idf_score desc", async () => {
    db._state.idfCache.push(
      { tag: "common1", idf_score: 0.1 },
      { tag: "rare1", idf_score: 5.0 },
      { tag: "mid1", idf_score: 2.0 },
      { tag: "rare2", idf_score: 4.5 },
      { tag: "common2", idf_score: 0.3 },
    );
    const result = await gatherFromIdfTop(asDb(db), 3);
    expect(result).toEqual(["rare1", "rare2", "mid1"]);
  });

  // ── Case 2 — gatherFromIdfTop empty ──────────────────────────────
  it("gatherFromIdfTop returns [] when cache is empty", async () => {
    const result = await gatherFromIdfTop(asDb(db), 10);
    expect(result).toEqual([]);
  });

  // ── Case 3 — n-gram English title match ──────────────────────────
  it("gatherFromTitleNgram matches lowercase n-grams from title", async () => {
    db._state.tags.push(
      {
        id: "t1",
        name: "iPhone",
        normalized_name: "iphone",
        idf: 2.0,
        aliases: [],
      },
      {
        id: "t2",
        name: "iPhone 17",
        normalized_name: "iphone 17",
        idf: 3.0,
        aliases: [],
      },
      {
        id: "t3",
        name: "Pro Model",
        normalized_name: "17 pro",
        idf: 2.5,
        aliases: [],
      },
      {
        id: "t4",
        name: "Unrelated",
        normalized_name: "samsung galaxy",
        idf: 1.0,
        aliases: [],
      },
    );
    const result = await gatherFromTitleNgram(
      asDb(db),
      "iPhone 17 Pro",
      2,
      4,
    );
    expect(result.sort()).toEqual(["Pro Model", "iPhone", "iPhone 17"]);
  });

  // ── Case 4 — alias-based match ───────────────────────────────────
  it("gatherFromTitleNgram matches via the aliases array", async () => {
    db._state.tags.push({
      id: "k1",
      name: "iPhone",
      normalized_name: "iphone",
      idf: 2.0,
      aliases: ["아이폰"],
    });
    const result = await gatherFromTitleNgram(asDb(db), "아이폰 17", 2, 4);
    expect(result).toEqual(["iPhone"]);
  });

  // ── Case 5 — n-gram no match ─────────────────────────────────────
  it("gatherFromTitleNgram returns [] when nothing matches", async () => {
    db._state.tags.push({
      id: "u1",
      name: "Toaster",
      normalized_name: "toaster",
      idf: 1.0,
      aliases: [],
    });
    const result = await gatherFromTitleNgram(
      asDb(db),
      "iPhone 17 Pro",
      2,
      4,
    );
    expect(result).toEqual([]);
  });

  // ── Case 6 — gatherFromSimilarListings graceful empty ────────────
  it("gatherFromSimilarListings returns [] without embedding or listing", async () => {
    const result = await gatherFromSimilarListings(
      asDb(db),
      {
        title: "irrelevant",
        description: "",
        category: null,
        listingId: null,
        sourceEmbedding: null,
      },
      20,
    );
    expect(result).toEqual([]);
  });

  // ── Case 7 — gatherFromSimilarListings returns union of tags ─────
  it("gatherFromSimilarListings returns union of tags from similar listings", async () => {
    db._state.similarTagRows.push(
      { tags: ["iphone", "smartphone"] },
      { tags: ["iphone", "apple"] },
      { tags: ["pro", "apple"] },
    );
    const result = await gatherFromSimilarListings(
      asDb(db),
      {
        title: "any",
        description: "",
        category: null,
        sourceEmbedding: [0.1, 0.2, 0.3],
      },
      20,
    );
    expect(result.sort()).toEqual(["apple", "iphone", "pro", "smartphone"]);
  });

  // ── Case 8 — resolveLabelsToCandidates drops unknown labels ──────
  it("resolveLabelsToCandidates silently drops unknown labels", async () => {
    db._state.tags.push(
      {
        id: "id-known1",
        name: "known1",
        normalized_name: "known1",
        idf: 1.0,
        aliases: [],
      },
      {
        id: "id-known2",
        name: "known2",
        normalized_name: "known2",
        idf: 1.0,
        aliases: [],
      },
    );
    const result = await resolveLabelsToCandidates(
      asDb(db),
      ["known1", "ghost", "known2"],
      "similar",
    );
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.label).sort()).toEqual(["known1", "known2"]);
    for (const c of result) {
      expect(c.source).toEqual(["similar"]);
    }
  });

  // ── Case 9 — parentIds attached from tag_edges ───────────────────
  it("resolveLabelsToCandidates attaches parentIds from tag_edges", async () => {
    db._state.tags.push({
      id: "child-id",
      name: "child",
      normalized_name: "child",
      idf: 1.0,
      aliases: [],
    });
    db._state.edges.push(
      { parent_tag_id: "parent-a", child_tag_id: "child-id" },
      { parent_tag_id: "parent-b", child_tag_id: "child-id" },
    );
    const result = await resolveLabelsToCandidates(
      asDb(db),
      ["child"],
      "ngram",
    );
    expect(result).toHaveLength(1);
    expect(result[0].parentIds.sort()).toEqual(["parent-a", "parent-b"]);
  });

  // ── Case 10 — tag_idf_cache overrides tags.idf ───────────────────
  it("resolveLabelsToCandidates prefers tag_idf_cache idf over tags.idf", async () => {
    db._state.tags.push({
      id: "u-id",
      name: "uniq",
      normalized_name: "uniq",
      idf: 1.5, // tags.idf — should NOT win
      aliases: [],
    });
    db._state.idfCache.push({ tag: "uniq", idf_score: 7.7 }); // should win
    const result = await resolveLabelsToCandidates(
      asDb(db),
      ["uniq"],
      "idf",
    );
    expect(result).toHaveLength(1);
    expect(result[0].idf).toBe(7.7);
  });

  // ── Case 11 — gatherTagCandidates dedupes across routes ──────────
  it("gatherTagCandidates merges duplicates across routes into a single candidate with union of sources", async () => {
    db._state.tags.push({
      id: "shared-id",
      name: "shared",
      normalized_name: "shared",
      idf: 1.0,
      aliases: [],
    });
    db._state.idfCache.push({ tag: "shared", idf_score: 3.0 });
    db._state.similarTagRows.push({ tags: ["shared"] });

    const result = await gatherTagCandidates(
      asDb(db),
      {
        title: "shared",
        description: "",
        category: null,
        sourceEmbedding: [0.1, 0.2],
      },
      { idfTopN: 5, similarListingsK: 5, ngramMinLen: 1, ngramMaxLen: 1 },
    );

    expect(result).toHaveLength(1);
    const c = result[0];
    expect(c.id).toBe("shared-id");
    expect(c.source.sort()).toEqual(["idf", "ngram", "similar"]);
  });

  // ── Case 12 — multi-source ranks above single-source ─────────────
  it("gatherTagCandidates sorts multi-source candidates ahead of single-source", async () => {
    db._state.tags.push(
      {
        id: "multi-id",
        name: "multi",
        normalized_name: "multi",
        idf: 0.5,
        aliases: [],
      },
      {
        id: "solo-id",
        name: "solo",
        normalized_name: "solo",
        idf: 9.9, // very high but only one source
        aliases: [],
      },
    );
    db._state.idfCache.push(
      { tag: "multi", idf_score: 0.5 },
      { tag: "solo", idf_score: 9.9 },
    );
    db._state.similarTagRows.push({ tags: ["multi"] });

    const result = await gatherTagCandidates(
      asDb(db),
      {
        title: "nothing matches here",
        description: "",
        category: null,
        sourceEmbedding: [0.1, 0.2],
      },
      { idfTopN: 5, similarListingsK: 5, ngramMinLen: 5, ngramMaxLen: 5 },
    );

    expect(result.map((c) => c.id)).toEqual(["multi-id", "solo-id"]);
  });

  // ── Case 13 — same source count → idf desc tiebreak ──────────────
  it("gatherTagCandidates sorts by idf desc when source counts are equal", async () => {
    db._state.tags.push(
      {
        id: "low-id",
        name: "lowidf",
        normalized_name: "lowidf",
        idf: 0.1,
        aliases: [],
      },
      {
        id: "high-id",
        name: "highidf",
        normalized_name: "highidf",
        idf: 5.5,
        aliases: [],
      },
    );
    db._state.idfCache.push(
      { tag: "lowidf", idf_score: 0.1 },
      { tag: "highidf", idf_score: 5.5 },
    );

    const result = await gatherTagCandidates(
      asDb(db),
      {
        title: "no ngram match",
        description: "",
        category: null,
      },
      { idfTopN: 5, similarListingsK: 5, ngramMinLen: 9, ngramMaxLen: 9 },
    );

    expect(result.map((c) => c.id)).toEqual(["high-id", "low-id"]);
  });

  // ── Case 14 — limit cap ──────────────────────────────────────────
  it("gatherTagCandidates caps the result at the configured limit", async () => {
    // Seed 50 tags into idf cache + tags table.
    for (let i = 0; i < 50; i++) {
      db._state.tags.push({
        id: `id-${i}`,
        name: `tag${i}`,
        normalized_name: `tag${i}`,
        idf: i,
        aliases: [],
      });
      db._state.idfCache.push({ tag: `tag${i}`, idf_score: i });
    }
    const result = await gatherTagCandidates(
      asDb(db),
      { title: "x", description: "", category: null },
      { limit: 40, idfTopN: 50, similarListingsK: 5, ngramMinLen: 9, ngramMaxLen: 9 },
    );
    expect(result.length).toBe(40);
    // Highest idf first
    expect(result[0].label).toBe("tag49");
  });

  // ── Case 15 — all routes empty → [] ──────────────────────────────
  it("gatherTagCandidates returns [] when every route is empty", async () => {
    const result = await gatherTagCandidates(
      asDb(db),
      { title: "", description: "", category: null },
      {},
    );
    expect(result).toEqual([]);
  });
});

// Sanity export to keep TS happy in some configs.
export type _TestSurfaceTagCandidate = TagCandidate;
