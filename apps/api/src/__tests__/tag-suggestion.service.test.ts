/**
 * Unit tests for tag-suggestion.service (Step 54).
 *
 * Strategy: mock `@haggle/db` with a chainable fluent builder so that
 * service code paths can be exercised without a real database. The fake
 * db records all calls for assertion.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Override the global @haggle/db mock ────────────────────────────
vi.mock("@haggle/db", () => {
  return {
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    asc: (col: unknown) => ({ __op: "asc", col }),
    desc: (col: unknown) => ({ __op: "desc", col }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      __sql: true,
      raw: strings.join(" "),
      values,
    }),
    tagSuggestions: {
      id: { name: "id" },
      label: { name: "label" },
      normalizedLabel: { name: "normalized_label" },
      status: { name: "status" },
      occurrenceCount: { name: "occurrence_count" },
      createdAt: { name: "created_at" },
    },
    tags: {
      id: { name: "id" },
      name: { name: "name" },
      normalizedName: { name: "normalized_name" },
    },
  };
});

import {
  approveSuggestion,
  getSuggestionById,
  listSuggestions,
  mergeSuggestion,
  rejectSuggestion,
} from "../services/tag-suggestion.service.js";

// ─── Fake DB ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface ChainOptions {
  selectResult: Row[];
  insertResult: Row[];
  updateResult: Row[];
}

interface FakeDb {
  calls: Array<{ op: string; table?: string; payload?: unknown }>;
  queue: {
    selectResults: Row[][];
    insertResults: Row[][];
    updateResults: Row[][];
  };
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
}

function createFakeDb(): FakeDb {
  const db: FakeDb = {
    calls: [],
    queue: { selectResults: [], insertResults: [], updateResults: [] },
    select: () => {},
    insert: () => {},
    update: () => {},
  };

  db.select = (_cols?: unknown) => {
    db.calls.push({ op: "select" });
    const result: Row[] = db.queue.selectResults.shift() ?? [];
    // Chainable: from().where().orderBy().limit().offset() → resolves to result
    const chain: {
      from: (...a: unknown[]) => typeof chain;
      where: (...a: unknown[]) => typeof chain;
      orderBy: (...a: unknown[]) => typeof chain;
      limit: (...a: unknown[]) => typeof chain;
      offset: (...a: unknown[]) => typeof chain;
      then: (resolve: (v: Row[]) => unknown) => Promise<unknown>;
    } = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve) => Promise.resolve(resolve(result)),
    };
    return chain;
  };

  db.insert = (table: unknown) => {
    db.calls.push({ op: "insert", table: String((table as Row)?.id ?? "") });
    const result: Row[] = db.queue.insertResults.shift() ?? [];
    const chain: {
      values: (v: unknown) => typeof chain;
      returning: (...a: unknown[]) => Promise<Row[]>;
    } = {
      values: (v: unknown) => {
        db.calls.push({ op: "insert.values", payload: v });
        return chain;
      },
      returning: () => Promise.resolve(result),
    };
    return chain;
  };

  db.update = (table: unknown) => {
    db.calls.push({ op: "update", table: String((table as Row)?.id ?? "") });
    const result: Row[] = db.queue.updateResults.shift() ?? [];
    const chain: {
      set: (v: unknown) => typeof chain;
      where: (...a: unknown[]) => Promise<Row[]>;
    } = {
      set: (v: unknown) => {
        db.calls.push({ op: "update.set", payload: v });
        return chain;
      },
      where: () => Promise.resolve(result),
    };
    return chain;
  };

  return db;
}

const asDb = (db: FakeDb) => db as unknown as never;

// Build a baseline suggestion row
function suggestionRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "sug-1",
    label: "Titanium Blue",
    normalizedLabel: "titanium blue",
    suggestedBy: "LLM",
    firstSeenListingId: "listing-1",
    occurrenceCount: 1,
    status: "PENDING",
    mergedIntoTagId: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb();
});

// ─── listSuggestions ────────────────────────────────────────────────

describe("listSuggestions", () => {
  it("1. filters by status and returns rows", async () => {
    const rows = [suggestionRow(), suggestionRow({ id: "sug-2" })];
    db.queue.selectResults.push(rows);
    const out = await listSuggestions(asDb(db), { status: "PENDING" });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("sug-1");
  });

  it("2. applies limit/offset pagination defaults", async () => {
    db.queue.selectResults.push([suggestionRow()]);
    const out = await listSuggestions(asDb(db), { limit: 10, offset: 5 });
    expect(out).toHaveLength(1);
    // Select was called once
    expect(db.calls.filter((c) => c.op === "select")).toHaveLength(1);
  });
});

// ─── getSuggestionById ──────────────────────────────────────────────

describe("getSuggestionById", () => {
  it("3. returns null when not found", async () => {
    db.queue.selectResults.push([]);
    const out = await getSuggestionById(asDb(db), "missing");
    expect(out).toBeNull();
  });
});

// ─── approveSuggestion ──────────────────────────────────────────────

describe("approveSuggestion", () => {
  it("4. creates new tag when normalized name does not exist", async () => {
    // Lookup suggestion → exists
    db.queue.selectResults.push([suggestionRow()]);
    // Lookup existing tag by normalized name → empty
    db.queue.selectResults.push([]);
    // Insert new tag → returns id
    db.queue.insertResults.push([{ id: "tag-new" }]);
    // Update suggestion → ok
    db.queue.updateResults.push([]);

    const result = await approveSuggestion(asDb(db), "sug-1", {
      reviewedBy: "admin-1",
      category: "product",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tagId).toBe("tag-new");
      expect(result.merged).toBe(false);
    }
    // Verify tag insert payload
    const insertValues = db.calls.find((c) => c.op === "insert.values")
      ?.payload as Row | undefined;
    expect(insertValues?.name).toBe("Titanium Blue");
    expect(insertValues?.normalizedName).toBe("titanium blue");
    expect(insertValues?.category).toBe("product");
    expect(insertValues?.createdBy).toBe("ADMIN");
  });

  it("5. auto-merges into existing tag when normalized name already exists", async () => {
    db.queue.selectResults.push([suggestionRow()]);
    db.queue.selectResults.push([{ id: "tag-existing" }]);
    db.queue.updateResults.push([]);

    const result = await approveSuggestion(asDb(db), "sug-1", {
      reviewedBy: "admin-1",
      category: "product",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tagId).toBe("tag-existing");
      expect(result.merged).toBe(true);
    }
    // No insert into tags should have happened
    expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(0);
    // Update set should target MERGED
    const updateSet = db.calls.find((c) => c.op === "update.set")
      ?.payload as Row | undefined;
    expect(updateSet?.status).toBe("MERGED");
    expect(updateSet?.mergedIntoTagId).toBe("tag-existing");
  });

  it("6. returns ok:false when suggestion does not exist", async () => {
    db.queue.selectResults.push([]);
    const result = await approveSuggestion(asDb(db), "missing", {
      reviewedBy: "admin-1",
      category: "product",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });

  it("7. returns ok:false when suggestion is already approved/rejected", async () => {
    db.queue.selectResults.push([suggestionRow({ status: "APPROVED" })]);
    const result = await approveSuggestion(asDb(db), "sug-1", {
      reviewedBy: "admin-1",
      category: "product",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Already APPROVED");
  });
});

// ─── rejectSuggestion ───────────────────────────────────────────────

describe("rejectSuggestion", () => {
  it("8. rejects a pending suggestion", async () => {
    db.queue.selectResults.push([suggestionRow()]);
    db.queue.updateResults.push([]);

    const result = await rejectSuggestion(asDb(db), "sug-1", "admin-1");
    expect(result.ok).toBe(true);
    const updateSet = db.calls.find((c) => c.op === "update.set")
      ?.payload as Row | undefined;
    expect(updateSet?.status).toBe("REJECTED");
    expect(updateSet?.reviewedBy).toBe("admin-1");
  });

  it("9. returns ok:false when suggestion does not exist", async () => {
    db.queue.selectResults.push([]);
    const result = await rejectSuggestion(asDb(db), "missing", "admin-1");
    expect(result.ok).toBe(false);
  });
});

// ─── mergeSuggestion ────────────────────────────────────────────────

describe("mergeSuggestion", () => {
  it("10. merges a pending suggestion into a valid target tag", async () => {
    db.queue.selectResults.push([suggestionRow()]);
    db.queue.selectResults.push([{ id: "tag-target" }]);
    db.queue.updateResults.push([]);

    const result = await mergeSuggestion(
      asDb(db),
      "sug-1",
      "tag-target",
      "admin-1",
    );
    expect(result.ok).toBe(true);
    const updateSet = db.calls.find((c) => c.op === "update.set")
      ?.payload as Row | undefined;
    expect(updateSet?.status).toBe("MERGED");
    expect(updateSet?.mergedIntoTagId).toBe("tag-target");
  });

  it("11. returns ok:false when suggestion does not exist", async () => {
    db.queue.selectResults.push([]);
    const result = await mergeSuggestion(
      asDb(db),
      "missing",
      "tag-target",
      "admin-1",
    );
    expect(result.ok).toBe(false);
  });
});
