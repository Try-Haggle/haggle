/**
 * Tests for the tag placement hook inside draft.service.publishDraft (Step 54).
 *
 * Strategy:
 *   - Mock @haggle/db to provide table stubs and a chainable fluent builder
 *   - Mock tag-placement.service.placeListingTags
 *   - Verify publish NEVER fails on placement errors (best-effort semantics)
 *   - Verify snapshot update only fires when labels are non-empty
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock("@haggle/db", () => {
  const makeCol = (name: string) => ({ name, __col: true });
  return {
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    gt: (col: unknown, val: unknown) => ({ __op: "gt", col, val }),
    inArray: (col: unknown, vals: unknown) => ({ __op: "inArray", col, vals }),
    listingDrafts: {
      id: makeCol("id"),
      title: makeCol("title"),
      description: makeCol("description"),
      category: makeCol("category"),
      status: makeCol("status"),
      userId: makeCol("user_id"),
      tags: makeCol("tags"),
      claimToken: makeCol("claim_token"),
      claimExpiresAt: makeCol("claim_expires_at"),
      updatedAt: makeCol("updated_at"),
    },
    listingsPublished: {
      id: makeCol("id"),
      publicId: makeCol("public_id"),
      draftId: makeCol("draft_id"),
      snapshotJson: makeCol("snapshot_json"),
    },
    tags: {
      id: makeCol("id"),
      name: makeCol("name"),
    },
  };
});

vi.mock("../services/tag-placement.service.js", () => ({
  placeListingTags: vi.fn(),
}));

vi.mock("../services/embedding.service.js", () => ({
  triggerEmbeddingGeneration: vi.fn().mockResolvedValue(undefined),
}));

import { publishDraft } from "../services/draft.service.js";
import { placeListingTags } from "../services/tag-placement.service.js";

const mockedPlace = vi.mocked(placeListingTags);

// ─── Fake DB ───────────────────────────────────────────────────────

interface Call {
  op: string;
  payload?: unknown;
}

interface FakeDb {
  calls: Call[];
  draft: Record<string, unknown> | null;
  publishedRow: Record<string, unknown>;
  tagRows: Array<{ id: string; name: string }>;
  query: {
    listingDrafts: {
      findFirst: (...args: unknown[]) => Promise<Record<string, unknown> | null>;
    };
  };
  insert: (table: unknown) => unknown;
  update: (table: unknown) => unknown;
  select: (cols?: unknown) => unknown;
}

function createFakeDb(draft: Record<string, unknown>): FakeDb {
  const db: FakeDb = {
    calls: [],
    draft,
    publishedRow: {
      id: "published-1",
      publicId: "abc12345",
      draftId: draft.id,
      snapshotJson: { ...draft },
    },
    tagRows: [],
    query: {
      listingDrafts: {
        findFirst: async () => draft,
      },
    },
    insert: () => ({}),
    update: () => ({}),
    select: () => ({}),
  };

  db.insert = (_table: unknown) => {
    db.calls.push({ op: "insert" });
    const chain = {
      values: (_v: unknown) => chain,
      returning: async () => [db.publishedRow],
    };
    return chain;
  };

  db.update = (_table: unknown) => {
    db.calls.push({ op: "update" });
    const chain = {
      set: (payload: unknown) => {
        db.calls.push({ op: "update.set", payload });
        return chain;
      },
      where: (..._a: unknown[]) => {
        const p = Promise.resolve([{ ...(db.draft ?? {}), status: "published" }]);
        // Support both `.where()` (resolve) and `.where().returning()`
        (p as unknown as { returning: () => Promise<unknown> }).returning =
          async () => [{ ...(db.draft ?? {}), status: "published" }];
        return p as unknown as Promise<unknown[]> & {
          returning: () => Promise<unknown>;
        };
      },
    };
    return chain;
  };

  db.select = (_cols?: unknown) => {
    db.calls.push({ op: "select" });
    const chain = {
      from: (_t: unknown) => chain,
      where: async () => db.tagRows,
    };
    return chain;
  };

  return db;
}

const asDb = (db: FakeDb) => db as unknown as never;

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    title: "iPhone",
    description: "sealed",
    category: "electronics",
    status: "draft",
    userId: "user-1",
    targetPrice: 1000,
    sellingDeadline: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("publishDraft — tag placement hook", () => {
  it("1. placement success → select tag labels and update snapshot", async () => {
    const db = createFakeDb(baseDraft());
    db.tagRows = [
      { id: "tag-1", name: "iphone" },
      { id: "tag-2", name: "sealed" },
    ];
    mockedPlace.mockResolvedValueOnce({
      selectedTagIds: ["tag-1", "tag-2"],
      reasoning: "r",
      source: "llm",
      modelVersion: "gpt-4o-mini",
      cacheKey: "k",
      trace: {
        cacheHit: false,
        candidatesGathered: 5,
        candidatesAfterPrefilter: 5,
        usedLlm: true,
        llmOk: true,
        fallbackUsed: false,
        suggestionsQueued: 0,
        latencyMs: {
          candidates: 1,
          prefilter: 1,
          llm: 1,
          dagCleanup: 1,
          persist: 1,
          total: 5,
        },
      },
    });

    const result = await publishDraft(asDb(db), "draft-1");

    expect(result).not.toBeNull();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    // Snapshot update (update.set) payload should include tags: labels
    const snapshotUpdateCall = db.calls.find(
      (c) =>
        c.op === "update.set" &&
        !!(c.payload as Record<string, unknown>)?.snapshotJson,
    );
    expect(snapshotUpdateCall).toBeDefined();
    const snapshot = (snapshotUpdateCall!.payload as Record<string, unknown>)
      .snapshotJson as Record<string, unknown>;
    expect(snapshot.tags).toEqual(["iphone", "sealed"]);
  });

  it("2. placement throws → publish still succeeds, no snapshot update", async () => {
    const db = createFakeDb(baseDraft());
    mockedPlace.mockRejectedValueOnce(new Error("boom"));

    const result = await publishDraft(asDb(db), "draft-1");

    expect(result).not.toBeNull();
    expect(result!.published).toBeDefined();
    // No snapshot update call
    const snapshotUpdateCall = db.calls.find(
      (c) =>
        c.op === "update.set" &&
        !!(c.payload as Record<string, unknown>)?.snapshotJson,
    );
    expect(snapshotUpdateCall).toBeUndefined();
  });

  it("3. placement returns empty selectedTagIds → no snapshot update", async () => {
    const db = createFakeDb(baseDraft());
    mockedPlace.mockResolvedValueOnce({
      selectedTagIds: [],
      reasoning: "",
      source: "fallback",
      modelVersion: null,
      cacheKey: "k",
      trace: {
        cacheHit: false,
        candidatesGathered: 0,
        candidatesAfterPrefilter: 0,
        usedLlm: false,
        llmOk: null,
        fallbackUsed: false,
        suggestionsQueued: 0,
        latencyMs: {
          candidates: 0,
          prefilter: 0,
          llm: null,
          dagCleanup: 0,
          persist: 0,
          total: 1,
        },
      },
    });

    const result = await publishDraft(asDb(db), "draft-1");

    expect(result).not.toBeNull();
    const snapshotUpdateCall = db.calls.find(
      (c) =>
        c.op === "update.set" &&
        !!(c.payload as Record<string, unknown>)?.snapshotJson,
    );
    expect(snapshotUpdateCall).toBeUndefined();
  });

  it("4. placement selected ids but tags table lookup returns empty (stale) → no snapshot update", async () => {
    const db = createFakeDb(baseDraft());
    db.tagRows = []; // stale — ids not found
    mockedPlace.mockResolvedValueOnce({
      selectedTagIds: ["stale-1"],
      reasoning: "r",
      source: "llm",
      modelVersion: "gpt-4o-mini",
      cacheKey: "k",
      trace: {
        cacheHit: false,
        candidatesGathered: 1,
        candidatesAfterPrefilter: 1,
        usedLlm: true,
        llmOk: true,
        fallbackUsed: false,
        suggestionsQueued: 0,
        latencyMs: {
          candidates: 1,
          prefilter: 1,
          llm: 1,
          dagCleanup: 1,
          persist: 1,
          total: 5,
        },
      },
    });

    const result = await publishDraft(asDb(db), "draft-1");

    expect(result).not.toBeNull();
    const snapshotUpdateCall = db.calls.find(
      (c) =>
        c.op === "update.set" &&
        !!(c.payload as Record<string, unknown>)?.snapshotJson,
    );
    expect(snapshotUpdateCall).toBeUndefined();
  });
});
