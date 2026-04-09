/**
 * Unit tests for structured tag proposal pipeline (Step 64).
 *
 * Tests cover:
 *   - resolveLlmOutput proposed_tags parsing (5 tests)
 *   - queueProposedTags DB interaction (3 tests)
 *   - JSON schema structure validation (1 test)
 *   - Few-shot proposed_tags parseability (1 test)
 *   - Orchestrator integration trace (1 test)
 *   - Telemetry logging (1 test)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock the openai SDK ────────────────────────────────────────────
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockRejectedValue(
          new Error("module-level fake client must not be used"),
        ),
      },
    };
    constructor(_opts?: unknown) {}
  }
  return { default: FakeOpenAI };
});

// ─── Mock @haggle/db ────────────────────────────────────────────────
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

// ─── Mock collaborators for orchestrator test ───────────────────────
vi.mock("../services/tag-candidate.service.js", () => ({
  gatherTagCandidates: vi.fn(),
}));

vi.mock("../services/tag-graph.service.js", () => ({
  pruneAncestorsFromSet: vi.fn(),
}));

vi.mock("../services/tag-placement-llm.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/tag-placement-llm.service.js")>(
    "../services/tag-placement-llm.service.js",
  );
  return {
    ...actual,
    placeTagsWithLlm: vi.fn(),
  };
});

import {
  resolveLlmOutput,
  PROPOSED_TAG_CATEGORIES,
  type ProposedTag,
} from "../services/tag-placement-llm.service.js";
import {
  queueProposedTags,
  placeListingTags,
  type PlacementInput,
} from "../services/tag-placement.service.js";
import { gatherTagCandidates } from "../services/tag-candidate.service.js";
import { pruneAncestorsFromSet } from "../services/tag-graph.service.js";
import { placeTagsWithLlm } from "../services/tag-placement-llm.service.js";
import { FEW_SHOT_POOL } from "../prompts/tag-placement/index.js";
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

function createFakeDb(): { calls: FakeDbCall[]; execute: (d: unknown) => Promise<unknown> } {
  const calls: FakeDbCall[] = [];
  return {
    calls,
    execute: async (descriptor: unknown) => {
      const d = descriptor as { raw?: string; values?: unknown[] };
      const raw = (d?.raw ?? "").replace(/\s+/g, " ").trim();
      const values = (d?.values as unknown[] | undefined) ?? [];
      calls.push({ raw, values });
      if (
        raw.includes("SELECT selected_tag_ids") &&
        raw.includes("FROM tag_placement_cache")
      ) {
        return [];
      }
      return [];
    },
  };
}

const asDb = (db: ReturnType<typeof createFakeDb>) => db as unknown as never;

const refToId = new Map<string, string>([
  ["t01", "uuid-a"],
  ["t02", "uuid-b"],
  ["t03", "uuid-c"],
]);

// ─── resolveLlmOutput: proposed_tags ────────────────────────────────

describe("resolveLlmOutput — proposed_tags", () => {
  it("1. parses 3 well-formed proposed_tags correctly", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: "r",
        proposed_tags: [
          { label: "esim-only", category: "feature", reason: "supports eSIM" },
          { label: "battery-90-plus", category: "condition", reason: "battery above 90%" },
          { label: "titanium-frame", category: "material", reason: "titanium build" },
        ],
      },
      refToId,
    );
    expect(out.proposedTags).toHaveLength(3);
    expect(out.proposedTags[0]).toEqual({
      label: "esim-only",
      category: "feature",
      reason: "supports eSIM",
    });
  });

  it("2. returns empty array when proposed_tags is []", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: "r",
        proposed_tags: [],
      },
      refToId,
    );
    expect(out.proposedTags).toEqual([]);
  });

  it("3. drops items with missing/non-string label", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: "r",
        proposed_tags: [
          { label: "valid-tag", category: "feature", reason: "ok" },
          { category: "feature", reason: "no label" },
          { label: 42, category: "feature", reason: "numeric label" },
          { label: "", category: "feature", reason: "empty label" },
        ],
      },
      refToId,
    );
    expect(out.proposedTags).toHaveLength(1);
    expect(out.proposedTags[0]!.label).toBe("valid-tag");
  });

  it("4. falls back unknown category to 'other'", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: "r",
        proposed_tags: [
          { label: "foo", category: "UNKNOWN_CAT", reason: "test" },
          { label: "bar", category: "feature", reason: "test" },
        ],
      },
      refToId,
    );
    expect(out.proposedTags[0]!.category).toBe("other");
    expect(out.proposedTags[1]!.category).toBe("feature");
  });

  it("5. normalizes label: uppercase→lowercase, spaces→hyphens", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: "r",
        proposed_tags: [
          { label: "  eSIM Only  ", category: "feature", reason: "x" },
          { label: "Battery  90  Plus", category: "condition", reason: "y" },
        ],
      },
      refToId,
    );
    expect(out.proposedTags[0]!.label).toBe("esim-only");
    expect(out.proposedTags[1]!.label).toBe("battery-90-plus");
  });
});

// ─── queueProposedTags ──────────────────────────────────────────────

describe("queueProposedTags", () => {
  it("6. inserts one row per proposed tag via db.execute", async () => {
    const db = createFakeDb();
    const tags: ProposedTag[] = [
      { label: "esim-only", category: "feature", reason: "supports eSIM" },
      { label: "titanium-frame", category: "material", reason: "titanium build" },
    ];
    const count = await queueProposedTags(asDb(db), tags, "listing-1");
    expect(count).toBe(2);
    const inserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_suggestions"),
    );
    expect(inserts).toHaveLength(2);
  });

  it("7. returns 0 for empty array and does not hit db", async () => {
    const db = createFakeDb();
    const count = await queueProposedTags(asDb(db), [], null);
    expect(count).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("8. deduplicates by normalized label, inserts only once", async () => {
    const db = createFakeDb();
    const tags: ProposedTag[] = [
      { label: "eSIM Only", category: "feature", reason: "a" },
      { label: "esim-only", category: "feature", reason: "b" },
    ];
    const count = await queueProposedTags(asDb(db), tags, "listing-1");
    expect(count).toBe(1);
    const inserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_suggestions"),
    );
    expect(inserts).toHaveLength(1);
  });
});

// ─── JSON schema structure validation ───────────────────────────────

describe("JSON schema", () => {
  it("9. PROPOSED_TAG_CATEGORIES contains all 7 expected values", () => {
    expect(PROPOSED_TAG_CATEGORIES).toEqual([
      "condition", "style", "size", "material", "feature", "compatibility", "other",
    ]);
  });
});

// ─── Few-shot proposed_tags parseability ─────────────────────────────

describe("few-shot proposed_tags", () => {
  it("10. all 8 few-shot examples have parseable proposed_tags arrays", () => {
    for (const example of FEW_SHOT_POOL) {
      const parsed = JSON.parse(example.messages[1].content) as {
        selected_tag_ids: unknown;
        reasoning: unknown;
        proposed_tags: unknown;
      };
      expect(Array.isArray(parsed.proposed_tags)).toBe(true);
      for (const tag of parsed.proposed_tags as Array<Record<string, unknown>>) {
        expect(typeof tag.label).toBe("string");
        expect(typeof tag.category).toBe("string");
        expect(typeof tag.reason).toBe("string");
      }
    }
  });
});

// ─── Orchestrator integration ───────────────────────────────────────

describe("orchestrator proposed → queueProposedTags chain", () => {
  const candidates = [
    cand({ id: "tag-1", label: "iphone-17-pro", idf: 4.0 }),
    cand({ id: "tag-2", label: "256gb", idf: 2.5 }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrune.mockImplementation(async (_db: unknown, ids: string[]) => ids);
    mockedGather.mockResolvedValue([]);
  });

  it("11. proposedTags from LLM result flow through to trace.suggestionsQueued", async () => {
    const db = createFakeDb();
    mockedGather.mockResolvedValueOnce(candidates);
    mockedLlm.mockResolvedValueOnce({
      ok: true,
      selectedTagIds: ["tag-1"],
      reasoning: "r",
      proposedTags: [
        { label: "esim-only", category: "feature", reason: "supports eSIM" },
        { label: "titanium", category: "material", reason: "titanium build" },
      ],
      modelVersion: "gpt-4o-mini-2024-07-18",
      tokensIn: 100,
      tokensOut: 20,
      latencyMs: 42,
    });

    const input: PlacementInput = {
      title: "iPhone 17 Pro",
      description: "Sealed",
      category: "Electronics",
      listingId: "listing-123",
    };
    const result = await placeListingTags(asDb(db), input);

    expect(result.trace.suggestionsQueued).toBe(2);
    const inserts = db.calls.filter((c) =>
      c.raw.includes("INSERT INTO tag_suggestions"),
    );
    expect(inserts).toHaveLength(2);
  });
});

// ─── Telemetry logging ──────────────────────────────────────────────

describe("telemetry", () => {
  it("12. logs proposed tag category and reason via console.info", async () => {
    const db = createFakeDb();
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const tags: ProposedTag[] = [
      { label: "esim-only", category: "feature", reason: "supports eSIM" },
    ];
    await queueProposedTags(asDb(db), tags, "listing-1");

    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0]![0] as string;
    expect(msg).toContain("[tag-proposal]");
    expect(msg).toContain("category=feature");
    expect(msg).toContain("esim-only");

    spy.mockRestore();
  });
});
