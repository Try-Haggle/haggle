/**
 * Unit tests for tag-promotion.service (Step 56).
 *
 * Uses a fake chainable db + a mocked tag-suggestion.service so the
 * tag-promotion orchestration is exercised in isolation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @haggle/db ────────────────────────────────────────────────
vi.mock("@haggle/db", () => {
  const col = (name: string) => ({ name });
  return {
    eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    gte: (c: unknown, v: unknown) => ({ __op: "gte", c, v }),
    inArray: (c: unknown, vs: unknown[]) => ({ __op: "inArray", c, vs }),
    tagPromotionRules: {
      category: col("category"),
      candidateMinUse: col("candidate_min_use"),
    },
    tagSuggestions: {
      id: col("id"),
      status: col("status"),
      occurrenceCount: col("occurrence_count"),
    },
    tags: {
      id: col("id"),
      status: col("status"),
    },
    adminActionLog: { id: col("id") },
  };
});

// ─── Mock approveSuggestion from sibling service ────────────────────
const approveMock = vi.fn();
vi.mock("../services/tag-suggestion.service.js", () => ({
  approveSuggestion: (...args: unknown[]) => approveMock(...args),
}));

import {
  getRuleForCategory,
  promoteExistingTags,
  promotePendingSuggestions,
  runPromotionJob,
} from "../services/tag-promotion.service.js";

// ─── Fake DB ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakeDb {
  calls: Array<{ op: string; payload?: unknown }>;
  selectResults: Row[][];
  updateResults: Row[][];
  insertResults: Row[][];
  select: (...a: unknown[]) => unknown;
  update: (...a: unknown[]) => unknown;
  insert: (...a: unknown[]) => unknown;
  insertShouldThrow?: boolean;
}

function createFakeDb(): FakeDb {
  const db: FakeDb = {
    calls: [],
    selectResults: [],
    updateResults: [],
    insertResults: [],
    select: () => {},
    update: () => {},
    insert: () => {},
  };

  db.select = () => {
    const result = db.selectResults.shift() ?? [];
    db.calls.push({ op: "select" });
    const chain: {
      from: (...a: unknown[]) => typeof chain;
      where: (...a: unknown[]) => typeof chain;
      then: (r: (v: Row[]) => unknown) => Promise<unknown>;
    } = {
      from: () => chain,
      where: () => chain,
      then: (r) => Promise.resolve(r(result)),
    };
    return chain;
  };

  db.update = () => {
    db.calls.push({ op: "update" });
    const chain: {
      set: (v: unknown) => typeof chain;
      where: (...a: unknown[]) => Promise<Row[]>;
    } = {
      set: (v) => {
        db.calls.push({ op: "update.set", payload: v });
        return chain;
      },
      where: () => Promise.resolve(db.updateResults.shift() ?? []),
    };
    return chain;
  };

  db.insert = () => {
    db.calls.push({ op: "insert" });
    if (db.insertShouldThrow) {
      return {
        values: () => {
          throw new Error("insert failed");
        },
      };
    }
    const chain: {
      values: (v: unknown) => Promise<Row[]>;
    } = {
      values: (v) => {
        db.calls.push({ op: "insert.values", payload: v });
        return Promise.resolve(db.insertResults.shift() ?? []);
      },
    };
    return chain;
  };

  return db;
}

const asDb = (db: FakeDb) => db as unknown as never;

function defaultRuleRow(overrides: Partial<Row> = {}): Row {
  return {
    category: "default",
    candidateMinUse: 5,
    emergingMinUse: 20,
    candidateMinAgeDays: 0,
    emergingMinAgeDays: 7,
    suggestionAutoPromoteCount: 20,
    enabled: true,
    ...overrides,
  };
}

function conditionRuleRow(overrides: Partial<Row> = {}): Row {
  return {
    category: "condition",
    candidateMinUse: 3,
    emergingMinUse: 15,
    candidateMinAgeDays: 0,
    emergingMinAgeDays: 7,
    suggestionAutoPromoteCount: 20,
    enabled: true,
    ...overrides,
  };
}

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb();
  approveMock.mockReset();
});

// ─── getRuleForCategory ─────────────────────────────────────────────

describe("getRuleForCategory", () => {
  it("1. returns the exact category rule when present", async () => {
    db.selectResults.push([conditionRuleRow(), defaultRuleRow()]);
    const rule = await getRuleForCategory(asDb(db), "condition");
    expect(rule.category).toBe("condition");
    expect(rule.candidateMinUse).toBe(3);
  });

  it('2. falls back to "default" when category not found', async () => {
    db.selectResults.push([defaultRuleRow()]);
    const rule = await getRuleForCategory(asDb(db), "style");
    expect(rule.category).toBe("default");
    expect(rule.candidateMinUse).toBe(5);
  });

  it("3. throws when no rows returned at all", async () => {
    db.selectResults.push([]);
    await expect(getRuleForCategory(asDb(db), "foo")).rejects.toThrow(
      /No tag_promotion_rules/,
    );
  });
});

// ─── promotePendingSuggestions ──────────────────────────────────────

describe("promotePendingSuggestions", () => {
  it("4. returns zeros when no pending suggestions meet threshold", async () => {
    db.selectResults.push([defaultRuleRow()]); // rule lookup
    db.selectResults.push([]); // pending suggestions
    const report = await promotePendingSuggestions(asDb(db), "admin-1");
    expect(report.suggestionsPromoted).toBe(0);
    expect(report.suggestionsMerged).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("5. calls approveSuggestion for each pending row above threshold", async () => {
    db.selectResults.push([defaultRuleRow()]);
    db.selectResults.push([
      { id: "sug-1", occurrenceCount: 25 },
      { id: "sug-2", occurrenceCount: 30 },
    ]);
    approveMock
      .mockResolvedValueOnce({ ok: true, tagId: "t1", merged: false })
      .mockResolvedValueOnce({ ok: true, tagId: "t2", merged: true });

    const report = await promotePendingSuggestions(asDb(db), "admin-1");
    expect(approveMock).toHaveBeenCalledTimes(2);
    expect(report.suggestionsPromoted).toBe(1);
    expect(report.suggestionsMerged).toBe(1);
    expect(report.perCategory.uncategorized).toEqual({
      promoted: 1,
      merged: 1,
      raised: 0,
    });
  });

  it("6. collects errors from approveSuggestion failures", async () => {
    db.selectResults.push([defaultRuleRow()]);
    db.selectResults.push([{ id: "sug-1", occurrenceCount: 25 }]);
    approveMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    const report = await promotePendingSuggestions(asDb(db), "admin-1");
    expect(report.suggestionsPromoted).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.error).toBe("boom");
  });

  it("7. skips phase entirely when default rule is disabled", async () => {
    db.selectResults.push([defaultRuleRow({ enabled: false })]);
    const report = await promotePendingSuggestions(asDb(db), "admin-1");
    expect(report.suggestionsPromoted).toBe(0);
    expect(approveMock).not.toHaveBeenCalled();
  });
});

// ─── promoteExistingTags ────────────────────────────────────────────

describe("promoteExistingTags", () => {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30d ago
  const young = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago

  it("8. CANDIDATE with enough use & age → EMERGING", async () => {
    db.selectResults.push([
      {
        id: "t1",
        status: "CANDIDATE",
        category: "condition",
        useCount: 5,
        createdAt: old,
      },
    ]);
    db.selectResults.push([conditionRuleRow(), defaultRuleRow()]);
    const report = await promoteExistingTags(asDb(db));
    expect(report.tagsCandidateToEmerging).toBe(1);
    const setCall = db.calls.find((c) => c.op === "update.set");
    expect((setCall?.payload as Row)?.status).toBe("EMERGING");
  });

  it("9. CANDIDATE too young → skipped", async () => {
    db.selectResults.push([
      {
        id: "t1",
        status: "CANDIDATE",
        category: "condition",
        useCount: 100,
        createdAt: young,
      },
    ]);
    // rule: condition requires 0 age (no skip here — should promote).
    // Override to force age gate:
    db.selectResults.push([
      conditionRuleRow({ candidateMinAgeDays: 10 }),
      defaultRuleRow(),
    ]);
    const report = await promoteExistingTags(asDb(db));
    expect(report.tagsCandidateToEmerging).toBe(0);
  });

  it("10. EMERGING with enough use & age → OFFICIAL", async () => {
    db.selectResults.push([
      {
        id: "t1",
        status: "EMERGING",
        category: "condition",
        useCount: 50,
        createdAt: old,
      },
    ]);
    db.selectResults.push([conditionRuleRow(), defaultRuleRow()]);
    const report = await promoteExistingTags(asDb(db));
    expect(report.tagsEmergingToOfficial).toBe(1);
    const setCall = db.calls.find((c) => c.op === "update.set");
    expect((setCall?.payload as Row)?.status).toBe("OFFICIAL");
  });

  it("11. missing category rule → falls back to default", async () => {
    db.selectResults.push([
      {
        id: "t1",
        status: "CANDIDATE",
        category: "unknown",
        useCount: 5, // exactly at default threshold, below a hypothetical condition=3
        createdAt: old,
      },
    ]);
    db.selectResults.push([defaultRuleRow()]); // only default
    const report = await promoteExistingTags(asDb(db));
    expect(report.tagsCandidateToEmerging).toBe(1);
    // Pin that the fallback bucket shows up in perCategory
    expect(report.perCategory.unknown).toEqual({
      promoted: 0,
      merged: 0,
      raised: 1,
    });
  });

  it("12. rule.enabled=false → skip", async () => {
    db.selectResults.push([
      {
        id: "t1",
        status: "CANDIDATE",
        category: "condition",
        useCount: 100,
        createdAt: old,
      },
    ]);
    db.selectResults.push([
      conditionRuleRow({ enabled: false }),
      defaultRuleRow(),
    ]);
    const report = await promoteExistingTags(asDb(db));
    expect(report.tagsCandidateToEmerging).toBe(0);
  });
});

// ─── runPromotionJob ────────────────────────────────────────────────

describe("runPromotionJob", () => {
  it("13. writes a promotion.run row to admin_action_log with the report", async () => {
    // Phase A: rule lookup + pending empty
    db.selectResults.push([defaultRuleRow()]);
    db.selectResults.push([]);
    // Phase B: tags empty
    db.selectResults.push([]);

    const report = await runPromotionJob(asDb(db), "admin-1");

    expect(report.suggestionsPromoted).toBe(0);
    expect(report.tagsCandidateToEmerging).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    const insertCall = db.calls.find((c) => c.op === "insert.values");
    const payload = insertCall?.payload as Row | undefined;
    expect(payload?.actionType).toBe("promotion.run");
    expect(payload?.actorId).toBe("admin-1");
    expect(payload?.payload).toBeDefined();
  });

  it("14. surfaces admin_action_log insert failure as error entry", async () => {
    db.selectResults.push([defaultRuleRow()]);
    db.selectResults.push([]);
    db.selectResults.push([]);
    db.insertShouldThrow = true;

    const report = await runPromotionJob(asDb(db), "admin-1");
    expect(report.errors.some((e) => e.target === "admin_action_log")).toBe(true);
  });

  it("15. phase A throw (no default rule) is caught and logged, job still completes", async () => {
    // Phase A: getRuleForCategory returns empty → throws
    db.selectResults.push([]);
    // Phase B: tags empty
    db.selectResults.push([]);
    // admin_action_log insert succeeds
    db.insertResults.push([]);

    const report = await runPromotionJob(asDb(db), "admin-1");

    expect(report.errors.some((e) => e.target === "phase:suggestions")).toBe(
      true,
    );
    expect(report.suggestionsPromoted).toBe(0);
    // Log row was still written
    const insertCall = db.calls.find((c) => c.op === "insert.values");
    expect(insertCall).toBeDefined();
  });

  it("16. phase B throw on missing rule is caught per-tag, other rows continue", async () => {
    // Phase B: two tags, rule lookup returns empty for first category
    // → getRuleForCategory throws → caught at the per-tag try/catch.
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    db.selectResults.push([
      {
        id: "t1",
        status: "CANDIDATE",
        category: "unknown",
        useCount: 100,
        createdAt: oldDate,
      },
      {
        id: "t2",
        status: "CANDIDATE",
        category: "unknown",
        useCount: 100,
        createdAt: oldDate,
      },
    ]);
    db.selectResults.push([]); // first loadRule → no rows → throws
    // second iteration also calls loadRule (cache was NOT set on throw),
    // so supply another empty result:
    db.selectResults.push([]);

    const report = await promoteExistingTags(asDb(db));
    expect(report.tagsCandidateToEmerging).toBe(0);
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]!.target).toBe("tag:t1");
    expect(report.errors[1]!.target).toBe("tag:t2");
  });
});
