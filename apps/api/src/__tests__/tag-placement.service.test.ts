/**
 * Unit tests for tag-placement.service (Step 53).
 *
 * Covers 18 cases from handoff/ARCHITECT-BRIEF.md §Tests.
 *
 * Strategy: mock the three collaborator services (gatherTagCandidates,
 * placeTagsWithLlm, pruneAncestorsFromSet) and the @haggle/db sql
 * tagged template. No real DB or LLM calls are made.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Override the global @haggle/db mock ────────────────────────────
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

// ─── Mock collaborator services (top-level, before imports) ─────────
vi.mock("../services/tag-candidate.service.js", () => ({
  gatherTagCandidates: vi.fn(),
}));

vi.mock("../services/tag-graph.service.js", () => ({
  pruneAncestorsFromSet: vi.fn(),
}));

vi.mock("../services/tag-placement-llm.service.js", () => ({
  placeTagsWithLlm: vi.fn(),
  TAG_PLACEMENT_MODEL_DEFAULT: "gpt-4o-mini-2024-07-18",
}));

// Import AFTER mocks are registered.
import {
  computeCacheKey,
  placeListingTags,
  prefilterCandidates,
  queueMissingTags,
  type PlacementInput,
} from "../services/tag-placement.service.js";
import { gatherTagCandidates } from "../services/tag-candidate.service.js";
import { pruneAncestorsFromSet } from "../services/tag-graph.service.js";
import { placeTagsWithLlm } from "../services/tag-placement-llm.service.js";
import type { TagCandidate } from "../services/tag-candidate.service.js";

const mockedGather = vi.mocked(gatherTagCandidates);
const mockedPrune = vi.mocked(pruneAncestorsFromSet);
const mockedLlm = vi.mocked(placeTagsWithLlm);

// ─── Helpers ────────────────────────────────────────────────────────

function cand(
  partial: Partial<TagCandidate> & { id: string; label: string },
): TagCandidate {
  return {
    id: partial.id,
    label: partial.label,
    normalizedLabel: partial.normalizedLabel ?? partial.label.toLowerCase(),
    idf: partial.idf ?? 1.0,
    parentIds: partial.parentIds ?? [],
    source: partial.source ?? ["idf"],
  };
}

interface FakeDbCall {
  raw: string;
  values: unknown[];
}

interface FakeDb {
  calls: FakeDbCall[];
  cacheRows: Array<{
    selected_tag_ids: string[];
    reasoning: string | null;
  }>;
  execute: (descriptor: unknown) => Promise<unknown>;
}

function createFakeDb(opts: { cacheHit?: boolean } = {}): FakeDb {
  const calls: FakeDbCall[] = [];
  const cacheRows = opts.cacheHit
    ? [{ selected_tag_ids: ["cached-1", "cached-2"], reasoning: "from cache" }]
    : [];

  const db: FakeDb = {
    calls,
    cacheRows,
    execute: async (descriptor: unknown) => {
      const d = descriptor as { raw?: string; values?: unknown[] };
      const raw = (d?.raw ?? "").replace(/\s+/g, " ").trim();
      const values = (d?.values as unknown[] | undefined) ?? [];
      calls.push({ raw, values });

      if (
        raw.includes("SELECT selected_tag_ids") &&
        raw.includes("FROM tag_placement_cache")
      ) {
        return cacheRows;
      }
      return [];
    },
  };
  return db;
}

const asDb = (db: FakeDb) => db as unknown as never;

function baseInput(overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    title: "iPhone 17 Pro 256GB",
    description: "Sealed, unopened",
    category: "Electronics",
    priceBand: "high",
    listingId: "listing-123",
    sourceEmbedding: null,
    ...overrides,
  };
}

// ─── Global defaults for mocks ──────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default prune: pass-through (no ancestors removed).
  mockedPrune.mockImplementation(async (_db: unknown, ids: string[]) => ids);
  mockedGather.mockResolvedValue([]);
  mockedLlm.mockResolvedValue({
    ok: true,
    selectedTagIds: [],
    reasoning: "",
    proposedTags: [],
    modelVersion: "gpt-4o-mini-2024-07-18",
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 1,
  });
});

// ─── computeCacheKey ────────────────────────────────────────────────

describe("computeCacheKey", () => {
  it("1. is deterministic for the same input", () => {
    const input = baseInput();
    const a = computeCacheKey(input, ["id-1", "id-2", "id-3"], "model-x");
    const b = computeCacheKey(input, ["id-1", "id-2", "id-3"], "model-x");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it("2. ignores candidate order (sorts)", () => {
    const input = baseInput();
    const a = computeCacheKey(input, ["id-a", "id-b", "id-c"], "m");
    const b = computeCacheKey(input, ["id-c", "id-a", "id-b"], "m");
    expect(a).toBe(b);
  });

  it("3. differs when model version changes", () => {
    const input = baseInput();
    const a = computeCacheKey(input, ["id-1"], "model-v1");
    const b = computeCacheKey(input, ["id-1"], "model-v2");
    expect(a).not.toBe(b);
  });
});

// ─── prefilterCandidates ────────────────────────────────────────────

describe("prefilterCandidates", () => {
  it("4. removes candidates with IDF < 0.5", async () => {
    const db = createFakeDb();
    const input = [
      cand({ id: "a", label: "a", idf: 1.5 }),
      cand({ id: "b", label: "b", idf: 0.3 }),
      cand({ id: "c", label: "c", idf: 0.9 }),
      cand({ id: "d", label: "d", idf: 0.1 }),
    ];
    const out = await prefilterCandidates(asDb(db), input, 20);
    const outIds = out.map((c) => c.id);
    expect(outIds).toContain("a");
    expect(outIds).toContain("c");
    expect(outIds).not.toContain("b");
    expect(outIds).not.toContain("d");
  });

  it("5. passes all candidates through when all are low-IDF (safety)", async () => {
    const db = createFakeDb();
    const input = [
      cand({ id: "a", label: "a", idf: 0.1 }),
      cand({ id: "b", label: "b", idf: 0.2 }),
    ];
    const out = await prefilterCandidates(asDb(db), input, 20);
    expect(out).toHaveLength(2);
  });

  it("6. removes ancestors via pruneAncestorsFromSet", async () => {
    const db = createFakeDb();
    // prune keeps only descendants (drop "parent-id").
    mockedPrune.mockResolvedValueOnce(["child-id"]);
    const input = [
      cand({ id: "parent-id", label: "parent", idf: 2.0 }),
      cand({ id: "child-id", label: "child", idf: 2.0 }),
    ];
    const out = await prefilterCandidates(asDb(db), input, 20);
    expect(out.map((c) => c.id)).toEqual(["child-id"]);
    expect(mockedPrune).toHaveBeenCalledTimes(1);
  });

  it("7. caps to maxOutput (25 → 20)", async () => {
    const db = createFakeDb();
    const input = Array.from({ length: 25 }, (_, i) =>
      cand({ id: `t${i}`, label: `t${i}`, idf: 2.0 }),
    );
    const out = await prefilterCandidates(asDb(db), input, 20);
    expect(out).toHaveLength(20);
    expect(out[0]!.id).toBe("t0");
    expect(out[19]!.id).toBe("t19");
  });
});

// ─── queueMissingTags ───────────────────────────────────────────────

describe("queueMissingTags (backward compat wrapper)", () => {
  it("8. inserts one row per unique label via db.execute", async () => {
    const db = createFakeDb();
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const count = await queueMissingTags(
      asDb(db),
      ["iPhone-17 Pro Max", "OLED Panel"],
      "listing-1",
    );
    expect(count).toBe(2);
    const inserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_suggestions"),
    );
    expect(inserts).toHaveLength(2);
    // normalized_label should be lowercased/trimmed with spaces→hyphens
    expect(inserts[0]!.values).toContain("iphone-17-pro-max");
    spy.mockRestore();
  });

  it("9. returns 0 and does not hit the db for an empty array", async () => {
    const db = createFakeDb();
    const count = await queueMissingTags(asDb(db), [], null);
    expect(count).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("10. excludes whitespace-only labels", async () => {
    const db = createFakeDb();
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const count = await queueMissingTags(
      asDb(db),
      ["   ", "", "real-label"],
      null,
    );
    expect(count).toBe(1);
    const inserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_suggestions"),
    );
    expect(inserts).toHaveLength(1);
    spy.mockRestore();
  });
});

// ─── placeListingTags orchestrator ──────────────────────────────────

describe("placeListingTags", () => {
  const candidates = [
    cand({ id: "tag-1", label: "iphone-17-pro", idf: 4.0 }),
    cand({ id: "tag-2", label: "256gb", idf: 2.5 }),
    cand({ id: "tag-3", label: "sealed", idf: 3.2 }),
  ];

  it("11. cache HIT: skips LLM, source='cache', updates hit_count", async () => {
    const db = createFakeDb({ cacheHit: true });
    mockedGather.mockResolvedValueOnce(candidates);

    const result = await placeListingTags(asDb(db), baseInput());

    expect(result.source).toBe("cache");
    expect(result.selectedTagIds).toEqual(["cached-1", "cached-2"]);
    expect(result.trace.cacheHit).toBe(true);
    expect(mockedLlm).not.toHaveBeenCalled();
    // An UPDATE call for hit_count must be present.
    const updates = db.calls.filter(
      (c) =>
        c.raw.includes("UPDATE tag_placement_cache") &&
        c.raw.includes("hit_count = hit_count + 1"),
    );
    expect(updates).toHaveLength(1);
  });

  it("12. cache MISS + LLM success: source='llm', cache write called, trace populated", async () => {
    const db = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1", "tag-2"],
      reasoning: "picked best",
      proposedTags: [],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 100,
      tokensOut: 20,
      latencyMs: 42,
    });

    const result = await placeListingTags(asDb(db), baseInput());

    expect(result.source).toBe("llm");
    expect(result.selectedTagIds).toEqual(["tag-1", "tag-2"]);
    expect(result.trace.usedLlm).toBe(true);
    expect(result.trace.llmOk).toBe(true);
    expect(result.trace.fallbackUsed).toBe(false);
    expect(mockedLlm).toHaveBeenCalledTimes(1);
    const cacheInserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_placement_cache"),
    );
    expect(cacheInserts).toHaveLength(1);
  });

  it("13. LLM failure: source='fallback', top-N filtered, trace.llmError set", async () => {
    const db = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: false,
      error: { code: "OPENAI_ERROR", message: "boom" },
      modelVersion: "gpt-4o-mini-2024-07-18",
    });

    const result = await placeListingTags(asDb(db), baseInput());

    expect(result.source).toBe("fallback");
    expect(result.selectedTagIds.length).toBeGreaterThan(0);
    expect(result.selectedTagIds.length).toBeLessThanOrEqual(5);
    expect(result.selectedTagIds).toEqual(["tag-1", "tag-2", "tag-3"]);
    expect(result.trace.fallbackUsed).toBe(true);
    expect(result.trace.llmOk).toBe(false);
    expect(result.trace.llmError).toBe("OPENAI_ERROR");
    expect(result.reasoning).toContain("OPENAI_ERROR");
  });

  it("14. zero candidates: source='fallback', empty selection, no LLM call", async () => {
    const db = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce([]);

    const result = await placeListingTags(asDb(db), baseInput());

    expect(result.source).toBe("fallback");
    expect(result.selectedTagIds).toEqual([]);
    expect(result.modelVersion).toBeNull();
    expect(mockedLlm).not.toHaveBeenCalled();
  });

  it("15. proposedTags present: queueProposedTags invoked and trace.suggestionsQueued > 0", async () => {
    const db = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1"],
      reasoning: "r",
      proposedTags: [
        { label: "iphone-17-pro-max", category: "feature", reason: "pro max variant" },
        { label: "titanium-blue", category: "material", reason: "titanium blue color" },
      ],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 1,
    });

    const result = await placeListingTags(asDb(db), baseInput());

    expect(result.trace.suggestionsQueued).toBe(2);
    const inserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_suggestions"),
    );
    expect(inserts).toHaveLength(2);
  });

  it("16. bypassCache=true: HIT still triggers LLM", async () => {
    const db = createFakeDb({ cacheHit: true });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1"],
      reasoning: "fresh",
      proposedTags: [],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 1,
    });

    const result = await placeListingTags(asDb(db), baseInput(), {
      bypassCache: true,
    });

    expect(result.source).toBe("llm");
    expect(mockedLlm).toHaveBeenCalledTimes(1);
    expect(result.trace.cacheHit).toBe(false);
  });

  it("17. L7 pruneAncestors runs only when selectedIds.length > 1", async () => {
    // Case A: single selection → NOT called for L7.
    const dbA = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1"],
      reasoning: "one",
      proposedTags: [],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 1,
    });
    await placeListingTags(asDb(dbA), baseInput());
    // prune is called once (in prefilter L3), not a 2nd time for L7.
    expect(mockedPrune).toHaveBeenCalledTimes(1);

    // Case B: multi selection → L7 pruneAncestors invoked.
    vi.clearAllMocks();
    mockedPrune.mockImplementation(async (_db: unknown, ids: string[]) => ids);
    const dbB = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1", "tag-2", "tag-3"],
      reasoning: "multi",
      proposedTags: [],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 1,
    });
    await placeListingTags(asDb(dbB), baseInput());
    // prune called twice: once in prefilter L3, once in L7 cleanup.
    expect(mockedPrune).toHaveBeenCalledTimes(2);
  });

  it("18. trace latency fields are all populated and total > 0", async () => {
    const db = createFakeDb({ cacheHit: false });
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1", "tag-2"],
      reasoning: "r",
      proposedTags: [],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 1,
    });

    const result = await placeListingTags(asDb(db), baseInput());

    expect(typeof result.trace.latencyMs.candidates).toBe("number");
    expect(typeof result.trace.latencyMs.prefilter).toBe("number");
    expect(typeof result.trace.latencyMs.llm).toBe("number");
    expect(typeof result.trace.latencyMs.dagCleanup).toBe("number");
    expect(typeof result.trace.latencyMs.persist).toBe("number");
    expect(result.trace.latencyMs.total).toBeGreaterThan(0);
    expect(result.trace.candidatesGathered).toBe(candidates.length);
    expect(result.trace.candidatesAfterPrefilter).toBeGreaterThan(0);
  });
});
