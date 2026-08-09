/**
 * Category-check learning service (feature ②).
 *
 * The value of the flywheel rests on ONE property: a check only promotes when DISTINCT
 * sources needed it. These tests pin that (a repeat from the same source must not move
 * the distinct counter), plus the safety posture — soft-only, suppressible, and a
 * learning outage degrading to the static taxonomy rather than breaking resolution.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@haggle/db", () => ({
  and: (...c: unknown[]) => ({ __op: "and", c }),
  eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
  inArray: (c: unknown, vs: unknown[]) => ({ __op: "inArray", c, vs }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      __sql: strings.join("?"),
      values,
    }),
    {},
  ),
  learnedCategoryChecks: {
    categoryPath: { name: "category_path" },
    checkKey: { name: "check_key" },
    status: { name: "status" },
    occurrenceCount: { name: "occurrence_count" },
    distinctSourceCount: { name: "distinct_source_count" },
  },
  learnedCategoryCheckEvidence: {
    id: { name: "id" },
    categoryPath: { name: "category_path" },
    checkKey: { name: "check_key" },
    sourceKey: { name: "source_key" },
  },
}));

import {
  learningReadScopes,
  loadPromotedLearnedChecks,
  observationCheckKey,
  promoteEligibleCategoryChecks,
  recordCategoryCheckObservation,
} from "../services/category-check-learning.service.js";

/**
 * Minimal in-memory stand-in for the two tables, honouring the unique indexes that make
 * distinct-source counting correct.
 */
function makeDb() {
  const evidence: Array<{ id: string; categoryPath: string; checkKey: string; sourceKey: string }> =
    [];
  const aggregates: Array<{
    id: string;
    categoryPath: string;
    checkKey: string;
    questionKo: string;
    featureKey: string | null;
    occurrenceCount: number;
    distinctSourceCount: number;
    status: string;
  }> = [];
  let seq = 0;

  const db: Record<string, unknown> = {
    // The service wraps evidence + aggregate in ONE transaction; the callback receives a
    // tx with the same builder surface.
    transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(db);
    },
    insert() {
      return {
        values(v: Record<string, unknown>) {
          const chain = {
            onConflictDoNothing() {
              return {
                returning() {
                  const dup = evidence.some(
                    (e) =>
                      e.categoryPath === v.categoryPath &&
                      e.checkKey === v.checkKey &&
                      e.sourceKey === v.sourceKey,
                  );
                  if (dup) return Promise.resolve([]);
                  const row = {
                    id: `ev-${++seq}`,
                    categoryPath: v.categoryPath as string,
                    checkKey: v.checkKey as string,
                    sourceKey: v.sourceKey as string,
                  };
                  evidence.push(row);
                  return Promise.resolve([{ id: row.id }]);
                },
              };
            },
            onConflictDoUpdate(args: { set: Record<string, unknown> }) {
              const existing = aggregates.find(
                (a) => a.categoryPath === v.categoryPath && a.checkKey === v.checkKey,
              );
              if (!existing) {
                aggregates.push({
                  id: `ag-${++seq}`,
                  categoryPath: v.categoryPath as string,
                  checkKey: v.checkKey as string,
                  questionKo: v.questionKo as string,
                  featureKey: (v.featureKey as string) ?? null,
                  occurrenceCount: 1,
                  distinctSourceCount: 1,
                  status: "OBSERVED",
                });
              } else {
                existing.occurrenceCount += 1;
                // The service passes a *different* sql fragment when the source is new.
                const distinctFrag = JSON.stringify(args.set.distinctSourceCount);
                if (distinctFrag.includes("+ 1")) existing.distinctSourceCount += 1;
              }
              return Promise.resolve(undefined);
            },
          };
          // Aggregate insert without onConflict* still needs to be awaitable.
          return Object.assign(Promise.resolve(undefined), chain);
        },
      };
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where() {
              return {
                returning() {
                  const eligible = aggregates.filter(
                    (a) =>
                      a.status === "OBSERVED" &&
                      a.occurrenceCount >= 3 &&
                      a.distinctSourceCount >= 2,
                  );
                  for (const row of eligible) row.status = patch.status as string;
                  return Promise.resolve(eligible.map((r) => ({ id: r.id })));
                },
              };
            },
          };
        },
      };
    },
    // Two different reads share this builder. `loadPromotedLearnedChecks` selects whole
    // rows and wants only PROMOTED ones; the clustering lookup selects a projection and
    // wants every row in the scope. The projection argument is what tells them apart.
    select(projection?: unknown) {
      const isClusterLookup = projection !== undefined;
      return {
        from() {
          return {
            where() {
              return Promise.resolve(
                isClusterLookup ? aggregates : aggregates.filter((a) => a.status === "PROMOTED"),
              );
            },
          };
        },
      };
    },
  };
  return { db: db as never, evidence, aggregates };
}

const OBS = {
  categoryPath: "electronics/phones",
  questionKo: "정품 충전기가 포함되나요?",
  sourceId: "draft-1",
} as const;

beforeEach(() => vi.clearAllMocks());

describe("observationCheckKey — stable identity", () => {
  it("prefers an explicit checkId, then featureKey, then a question slug", () => {
    expect(observationCheckKey({ ...OBS, checkId: "Battery_Health" })).toBe("battery_health");
    expect(observationCheckKey({ ...OBS, featureKey: "Cosmetic_Grade" })).toBe("cosmetic_grade");
    expect(observationCheckKey(OBS).startsWith("q-")).toBe(true);
  });

  it("gives the same key for the same question (so evidence aggregates)", () => {
    expect(observationCheckKey(OBS)).toBe(observationCheckKey({ ...OBS, sourceId: "draft-2" }));
  });

  it("returns empty for an unidentifiable observation", () => {
    expect(observationCheckKey({ ...OBS, questionKo: "  ???  " })).toBe("");
  });
});

describe("recordCategoryCheckObservation — distinct-source honesty", () => {
  it("records a first observation", async () => {
    const { db, aggregates, evidence } = makeDb();
    const res = await recordCategoryCheckObservation(db, { ...OBS, origin: "BUILDER" });
    expect(res.recorded).toBe(true);
    expect(evidence).toHaveLength(1);
    expect(aggregates[0]).toMatchObject({ occurrenceCount: 1, distinctSourceCount: 1 });
  });

  it("a REPEAT from the same source bumps occurrences but NOT distinct sources", async () => {
    const { db, aggregates, evidence } = makeDb();
    await recordCategoryCheckObservation(db, OBS);
    await recordCategoryCheckObservation(db, OBS);
    await recordCategoryCheckObservation(db, OBS);

    expect(evidence).toHaveLength(1); // unique index held
    expect(aggregates[0]?.occurrenceCount).toBe(3);
    expect(aggregates[0]?.distinctSourceCount).toBe(1); // ← the anti-spam property
  });

  it("a new source moves the distinct counter", async () => {
    const { db, aggregates } = makeDb();
    await recordCategoryCheckObservation(db, OBS);
    await recordCategoryCheckObservation(db, { ...OBS, sourceId: "draft-2" });
    expect(aggregates[0]?.distinctSourceCount).toBe(2);
  });

  it("normalizes the category path so casing/slashes cannot fork a row", async () => {
    const { db, aggregates } = makeDb();
    await recordCategoryCheckObservation(db, OBS);
    await recordCategoryCheckObservation(db, {
      ...OBS,
      categoryPath: "/Electronics/Phones/",
      sourceId: "draft-2",
    });
    expect(aggregates).toHaveLength(1);
  });

  it("rejects unidentifiable / sourceless observations without throwing", async () => {
    const { db, aggregates } = makeDb();
    expect((await recordCategoryCheckObservation(db, { ...OBS, questionKo: " " })).recorded).toBe(
      false,
    );
    expect((await recordCategoryCheckObservation(db, { ...OBS, sourceId: "" })).recorded).toBe(
      false,
    );
    expect((await recordCategoryCheckObservation(db, { ...OBS, categoryPath: "" })).recorded).toBe(
      false,
    );
    expect(aggregates).toHaveLength(0);
  });

  it("never throws when the DB errors — a builder turn must not break", async () => {
    const brokenDb = {
      insert() {
        throw new Error("db down");
      },
    } as never;
    const res = await recordCategoryCheckObservation(brokenDb, OBS);
    expect(res).toEqual({ recorded: false, reason: "error" });
  });
});

describe("promoteEligibleCategoryChecks — thresholds", () => {
  it("does NOT promote below 3 occurrences / 2 distinct sources", async () => {
    const { db, aggregates } = makeDb();
    // 3 occurrences but a single source — the loud-seller case.
    await recordCategoryCheckObservation(db, OBS);
    await recordCategoryCheckObservation(db, OBS);
    await recordCategoryCheckObservation(db, OBS);

    const { promoted } = await promoteEligibleCategoryChecks(db);
    expect(promoted).toBe(0);
    expect(aggregates[0]?.status).toBe("OBSERVED");
  });

  it("promotes once BOTH thresholds clear", async () => {
    const { db, aggregates } = makeDb();
    await recordCategoryCheckObservation(db, { ...OBS, sourceId: "draft-1" });
    await recordCategoryCheckObservation(db, { ...OBS, sourceId: "draft-2" });
    await recordCategoryCheckObservation(db, { ...OBS, sourceId: "draft-3" });

    const { promoted } = await promoteEligibleCategoryChecks(db);
    expect(promoted).toBe(1);
    expect(aggregates[0]?.status).toBe("PROMOTED");
  });

  it("is idempotent — a second run promotes nothing new", async () => {
    const { db } = makeDb();
    for (const s of ["a", "b", "c"]) {
      await recordCategoryCheckObservation(db, { ...OBS, sourceId: s });
    }
    await promoteEligibleCategoryChecks(db);
    expect((await promoteEligibleCategoryChecks(db)).promoted).toBe(0);
  });
});

describe("loadPromotedLearnedChecks — serving + safety", () => {
  async function promotedDb() {
    const ctx = makeDb();
    for (const s of ["a", "b", "c"]) {
      await recordCategoryCheckObservation(ctx.db, { ...OBS, sourceId: s });
    }
    await promoteEligibleCategoryChecks(ctx.db);
    return ctx;
  }

  it("serves a promoted check for tags that resolve its category", async () => {
    const { db } = await promotedDb();
    const checks = await loadPromotedLearnedChecks(db, ["electronics", "iphone-15-pro"]);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[0]?.questionKo).toBe(OBS.questionKo);
  });

  it("learned checks are ALWAYS soft — never a blocking deal-breaker", async () => {
    const { db } = await promotedDb();
    const checks = await loadPromotedLearnedChecks(db, ["electronics", "iphone-15-pro"]);
    expect(checks.every((c) => c.enforcement === "soft")).toBe(true);
  });

  it("returns [] when there is no scope to look up (no full-table scan)", async () => {
    // An unmodelled tag is no longer "no scope" — it is a tag scope, which is how the
    // uncategorised long tail learns at all. What still yields nothing is a listing with
    // nothing to key on: no tags, or only generic buckets.
    const { db } = await promotedDb();
    expect(await loadPromotedLearnedChecks(db, [])).toEqual([]);
    expect(await loadPromotedLearnedChecks(db, ["other", "misc"])).toEqual([]);
  });

  it("always scopes the lookup rather than scanning the table", () => {
    // Asserted on the pure scope function: the in-memory db double ignores `where`, so
    // it cannot prove filtering — only that a scope list is always produced.
    expect(learningReadScopes(["totally-unknown-thing"])).toEqual(["tag:totally-unknown-thing"]);
    expect(learningReadScopes(["electronics", "iphone-15-pro"])).toContain("electronics");
    expect(learningReadScopes([])).toEqual([]);
  });

  it("degrades to [] when the DB fails — static taxonomy still works", async () => {
    const brokenDb = {
      select() {
        throw new Error("db down");
      },
    } as never;
    expect(await loadPromotedLearnedChecks(brokenDb, ["electronics"])).toEqual([]);
  });
});

/**
 * Reworded questions must pool into one check.
 *
 * From the user's brass-telescope e2e: seven rows for the same scope, every one stuck at
 * a single occurrence, because `observationCheckKey` only merges IDENTICAL token sets and
 * the model never phrases a question the same way twice. Nothing could ever promote.
 */
describe("clustering — a rewording joins the check it belongs to", () => {
  const scope = "tag:brass-telescope";
  const record = (db: never, questionKo: string, sourceId: string) =>
    recordCategoryCheckObservation(db, { categoryPath: scope, questionKo, sourceId });

  it("folds a near-duplicate into the existing row instead of starting a new one", async () => {
    const { db, aggregates } = makeDb();
    await record(db, "And any internal haze on the lenses?", "listing-a");
    await record(db, "And any fungus or haze on the lenses?", "listing-b");

    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]).toMatchObject({ occurrenceCount: 2, distinctSourceCount: 2 });
  });

  it("keeps the wording its key was derived from", async () => {
    // Otherwise the row's key and its text describe different questions.
    const { db, aggregates } = makeDb();
    await record(db, "And any internal haze on the lenses?", "listing-a");
    await record(db, "And any fungus or haze on the lenses?", "listing-b");
    expect(aggregates[0]?.questionKo).toBe("And any internal haze on the lenses?");
  });

  it("reaches promotion once the pooled phrasings clear the bar", async () => {
    const { db, aggregates } = makeDb();
    await record(db, "And any internal haze on the lenses?", "listing-a");
    await record(db, "And any fungus or haze on the lenses?", "listing-b");
    await record(db, "Any haze or fungus inside the lenses?", "listing-c");
    await promoteEligibleCategoryChecks(db, [scope]);
    expect(aggregates[0]).toMatchObject({ occurrenceCount: 3, status: "PROMOTED" });
  });

  it("leaves genuinely different questions in their own rows", async () => {
    const { db, aggregates } = makeDb();
    await record(db, "And any internal haze on the lenses?", "listing-a");
    await record(db, "Does the telescope come with any accessories?", "listing-a");
    await record(db, "Are there any scratches, dents, or wear on the brass?", "listing-b");
    expect(aggregates).toHaveLength(3);
  });

  it("does not cluster into a SUPPRESSED check", async () => {
    // An operator silencing one question must not create a sink that swallows every
    // similar-but-distinct question after it.
    const { db, aggregates } = makeDb();
    await record(db, "And any internal haze on the lenses?", "listing-a");
    aggregates[0]!.status = "SUPPRESSED";
    await record(db, "And any fungus or haze on the lenses?", "listing-b");
    expect(aggregates).toHaveLength(2);
  });

  it("never re-points a key that came from an explicit checkId", async () => {
    const { db, aggregates } = makeDb();
    await record(db, "And any internal haze on the lenses?", "listing-a");
    await recordCategoryCheckObservation(db, {
      categoryPath: scope,
      checkId: "lens_clarity",
      questionKo: "And any fungus or haze on the lenses?",
      sourceId: "listing-b",
    });
    expect(aggregates.map((a) => a.checkKey)).toContain("lens_clarity");
  });
});
