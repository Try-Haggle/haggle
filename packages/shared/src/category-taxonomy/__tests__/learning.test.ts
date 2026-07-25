import { describe, expect, it } from "vitest";
import {
  createInMemoryLearnedCheckStore,
  type LearnedCheck,
  type LearnedCheckObservation,
  promoteLearnedChecks,
  recordCheckObservation,
  resolveChecksWithLearned,
} from "../learning.js";
import { resolveChecks } from "../taxonomy.js";

function obs(
  categoryPath: string,
  questionKo: string,
  sourceId: string,
  extra: Partial<LearnedCheckObservation> = {},
): LearnedCheckObservation {
  return { categoryPath, questionKo, sourceId, ...extra };
}

describe("promoteLearnedChecks", () => {
  it("does NOT promote below the occurrence threshold", () => {
    const observations = [
      obs("vehicles", "사고 이력이 있나요?", "s1"),
      obs("vehicles", "사고 이력이 있나요?", "s2"),
    ];
    expect(promoteLearnedChecks(observations)).toEqual([]);
  });

  it("does NOT promote when all occurrences come from ONE source (loud session guard)", () => {
    const observations = [
      obs("vehicles", "사고 이력이 있나요?", "s1"),
      obs("vehicles", "사고 이력이 있나요?", "s1"),
      obs("vehicles", "사고 이력이 있나요?", "s1"),
      obs("vehicles", "사고 이력이 있나요?", "s1"),
    ];
    expect(promoteLearnedChecks(observations)).toEqual([]);
  });

  it("promotes once BOTH thresholds (occurrences + distinct sources) are cleared", () => {
    const observations = [
      obs("vehicles", "사고 이력이 있나요?", "s1"),
      obs("vehicles", "사고 이력이 있나요?", "s2"),
      obs("vehicles", "사고 이력이 있나요?", "s3"),
    ];
    const promoted = promoteLearnedChecks(observations);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toMatchObject({
      categoryPath: "vehicles",
      questionKo: "사고 이력이 있나요?",
      enforcement: "soft",
      support: { occurrences: 3, distinctSources: 3 },
    });
  });

  it("learned checks are ALWAYS soft, even if hard would seem natural", () => {
    const observations = [
      obs("clothing", "실측 사이즈를 알려주실 수 있나요?", "s1"),
      obs("clothing", "실측 사이즈를 알려주실 수 있나요?", "s2"),
      obs("clothing", "실측 사이즈를 알려주실 수 있나요?", "s3"),
    ];
    const promoted = promoteLearnedChecks(observations);
    expect(promoted[0]?.enforcement).toBe("soft");
  });

  it("does NOT re-promote a check already provided by the static taxonomy (same featureKey)", () => {
    // battery_health is already a static default at electronics/phones.
    const observations = [
      obs("electronics/phones", "배터리 성능은요?", "s1", { featureKey: "battery_health" }),
      obs("electronics/phones", "배터리 성능은요?", "s2", { featureKey: "battery_health" }),
      obs("electronics/phones", "배터리 성능은요?", "s3", { featureKey: "battery_health" }),
    ];
    expect(promoteLearnedChecks(observations)).toEqual([]);
  });

  it("does NOT re-promote a static default inherited from an ANCESTOR node", () => {
    // imei_verification is static at electronics/phones/iphone; observing it under
    // the same leaf must not re-learn it.
    const observations = [
      obs("electronics/phones/iphone", "IMEI 확인 되나요?", "s1", { checkId: "imei_verification" }),
      obs("electronics/phones/iphone", "IMEI 확인 되나요?", "s2", { checkId: "imei_verification" }),
      obs("electronics/phones/iphone", "IMEI 확인 되나요?", "s3", { checkId: "imei_verification" }),
    ];
    expect(promoteLearnedChecks(observations)).toEqual([]);
  });

  it("groups by check across categories and sorts deterministically", () => {
    const observations = [
      obs("vehicles", "사고 이력이 있나요?", "s1", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력이 있나요?", "s2", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력이 있나요?", "s3", { checkId: "accident_history" }),
      obs("clothing", "실측 사이즈?", "s4", { checkId: "measured_size" }),
      obs("clothing", "실측 사이즈?", "s5", { checkId: "measured_size" }),
      obs("clothing", "실측 사이즈?", "s6", { checkId: "measured_size" }),
    ];
    const promoted = promoteLearnedChecks(observations);
    // clothing sorts before vehicles.
    expect(promoted.map((c) => c.categoryPath)).toEqual(["clothing", "vehicles"]);
  });

  it("honors custom thresholds", () => {
    const observations = [
      obs("vehicles", "사고 이력?", "s1", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력?", "s2", { checkId: "accident_history" }),
    ];
    expect(
      promoteLearnedChecks(observations, { minOccurrences: 2, minDistinctSources: 2 }),
    ).toHaveLength(1);
  });
});

describe("resolveChecksWithLearned overlay", () => {
  it("appends an applicable learned check to the static checks (real hyphenated tags)", () => {
    const tags = ["electronics", "iphone-15-pro"];
    const base = resolveChecks(tags);
    const learned = promoteLearnedChecks([
      obs("electronics/phones/iphone", "정품 박스/구성품이 있나요?", "s1", {
        checkId: "box_contents",
      }),
      obs("electronics/phones/iphone", "정품 박스/구성품이 있나요?", "s2", {
        checkId: "box_contents",
      }),
      obs("electronics/phones/iphone", "정품 박스/구성품이 있나요?", "s3", {
        checkId: "box_contents",
      }),
    ]);
    const merged = resolveChecksWithLearned(tags, learned, base);
    // static checks preserved …
    expect(merged.slice(0, base.length)).toEqual(base);
    // … and the learned check appended.
    expect(merged.some((c) => c.id === "box_contents")).toBe(true);
  });

  it("does NOT surface a learned check whose category the tags do not resolve to", () => {
    const tags = ["electronics", "iphone-15-pro"];
    const base = resolveChecks(tags);
    const learned = promoteLearnedChecks([
      obs("vehicles", "사고 이력?", "s1", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력?", "s2", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력?", "s3", { checkId: "accident_history" }),
    ]);
    const merged = resolveChecksWithLearned(tags, learned, base);
    expect(merged).toEqual(base);
  });

  it("surfaces a learned check attached to an ANCESTOR node to descendant tags", () => {
    // learned at electronics → should apply to an iphone tag (descendant).
    const tags = ["iphone-15-pro"];
    const base = resolveChecks(tags);
    const learned = promoteLearnedChecks([
      obs("electronics", "충전 사이클/발열 이슈 있나요?", "s1", { checkId: "thermal_health" }),
      obs("electronics", "충전 사이클/발열 이슈 있나요?", "s2", { checkId: "thermal_health" }),
      obs("electronics", "충전 사이클/발열 이슈 있나요?", "s3", { checkId: "thermal_health" }),
    ]);
    const merged = resolveChecksWithLearned(tags, learned, base);
    expect(merged.some((c) => c.id === "thermal_health")).toBe(true);
  });

  it("static check wins on id collision (learned never overrides)", () => {
    const tags = ["iphone-15-pro"];
    const base = resolveChecks(tags);
    const learned = promoteLearnedChecks([
      obs("electronics/phones/iphone", "다른 질문", "s1", { checkId: "imei_verification" }),
      obs("electronics/phones/iphone", "다른 질문", "s2", { checkId: "imei_verification" }),
      obs("electronics/phones/iphone", "다른 질문", "s3", { checkId: "imei_verification" }),
    ]);
    // imei_verification is statically known → never promoted in the first place …
    expect(learned).toEqual([]);
    const merged = resolveChecksWithLearned(tags, learned, base);
    // … and the static imei_verification (hard) is intact, exactly once.
    const imei = merged.filter((c) => c.id === "imei_verification");
    expect(imei).toHaveLength(1);
    expect(imei[0]?.enforcement).toBe("hard");
  });

  it("resolveChecks itself is unchanged by the overlay (no regression)", () => {
    const tags = ["iphone-15-pro"];
    const before = resolveChecks(tags);
    resolveChecksWithLearned(tags, [], before);
    expect(resolveChecks(tags)).toEqual(before);
  });
});

describe("input hygiene (verifier findings)", () => {
  it("does NOT merge two different questions that share a 48-char prefix", () => {
    const prefix = "가".repeat(48);
    const observations = [
      obs("home", `${prefix}AAA`, "s1"),
      obs("home", `${prefix}AAA`, "s2"),
      obs("home", `${prefix}AAA`, "s3"),
      obs("home", `${prefix}BBB`, "s4"),
      obs("home", `${prefix}BBB`, "s5"),
    ];
    const promoted = promoteLearnedChecks(observations);
    // AAA seen by 3 distinct sources → promotes; BBB only 2 → does not.
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.questionKo).toBe(`${prefix}AAA`);
    expect(promoted[0]?.support).toEqual({ occurrences: 3, distinctSources: 3 });
  });

  it("does NOT merge distinct emoji/punctuation-only questions into one garbage id", () => {
    const observations = [
      obs("home", "🚗", "s1"),
      obs("home", "🚗", "s2"),
      obs("home", "🚗", "s3"),
      obs("home", "🏠", "s4"),
      obs("home", "🏠", "s5"),
      obs("home", "🏠", "s6"),
    ];
    const promoted = promoteLearnedChecks(observations);
    // two SEPARATE promotions, not one merged bucket.
    expect(promoted).toHaveLength(2);
    expect(new Set(promoted.map((c) => c.id)).size).toBe(2);
  });

  it("normalizes category path casing so a static default is still deduped", () => {
    // battery_health is static at electronics/phones; observing it under mixed case
    // must still be recognized as statically known and NOT re-promoted.
    const observations = [
      obs("Electronics/Phones", "배터리 성능?", "s1", { featureKey: "battery_health" }),
      obs("Electronics/Phones", "배터리 성능?", "s2", { featureKey: "battery_health" }),
      obs("Electronics/Phones", "배터리 성능?", "s3", { featureKey: "battery_health" }),
    ];
    expect(promoteLearnedChecks(observations)).toEqual([]);
  });

  it("normalizes a trailing slash so the learned check still surfaces via the overlay", () => {
    const observations = [
      obs("vehicles/", "사고 이력?", "s1", { checkId: "accident_history" }),
      obs("vehicles/", "사고 이력?", "s2", { checkId: "accident_history" }),
      obs("vehicles/", "사고 이력?", "s3", { checkId: "accident_history" }),
    ];
    const promoted = promoteLearnedChecks(observations);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.categoryPath).toBe("vehicles");
    // and it is reachable by the overlay for a vehicles tag.
    const base = resolveChecks(["vehicles"]);
    const merged = resolveChecksWithLearned(["vehicles"], promoted, base);
    expect(merged.some((c) => c.id === "accident_history")).toBe(true);
  });

  it("drops unidentifiable observations (blank question, no checkId/featureKey)", () => {
    const observations = [
      obs("vehicles", "   ", "s1"),
      obs("vehicles", "   ", "s2"),
      obs("vehicles", "   ", "s3"),
    ];
    expect(promoteLearnedChecks(observations)).toEqual([]);
  });

  it("is order-independent (deterministic under shuffled input)", () => {
    const base = [
      obs("vehicles", "사고 이력?", "s1", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력?", "s2", { checkId: "accident_history" }),
      obs("vehicles", "사고 이력?", "s3", { checkId: "accident_history" }),
      obs("clothing", "실측?", "s4", { checkId: "measured_size" }),
      obs("clothing", "실측?", "s5", { checkId: "measured_size" }),
      obs("clothing", "실측?", "s6", { checkId: "measured_size" }),
    ];
    const shuffled = [base[3]!, base[0]!, base[5]!, base[2]!, base[1]!, base[4]!];
    expect(promoteLearnedChecks(shuffled)).toEqual(promoteLearnedChecks(base));
  });
});

describe("overlay — genuine base-collision path", () => {
  it("drops a hand-built learned check whose id collides with a static base check", () => {
    const tags = ["iphone-15-pro"];
    const base = resolveChecks(tags);
    // A learned check that (wrongly) reuses a base id — exercises the !seen.has(l.id)
    // dedup branch that the promotion path can never trigger.
    const learned: LearnedCheck[] = [
      {
        id: "imei_verification",
        questionKo: "learned imei question",
        enforcement: "soft",
        categoryPath: "electronics/phones/iphone",
        support: { occurrences: 9, distinctSources: 9 },
      },
    ];
    const merged = resolveChecksWithLearned(tags, learned, base);
    const imei = merged.filter((c) => c.id === "imei_verification");
    expect(imei).toHaveLength(1);
    // the STATIC (hard) one survives, not the learned soft one.
    expect(imei[0]?.enforcement).toBe("hard");
    expect(imei[0]?.questionKo).not.toBe("learned imei question");
  });

  it("forces soft even if a caller hands the overlay a hard learned check", () => {
    const tags = ["vehicles"];
    const base = resolveChecks(tags);
    const learned: LearnedCheck[] = [
      {
        id: "accident_history",
        questionKo: "사고 이력?",
        enforcement: "hard",
        categoryPath: "vehicles",
        support: { occurrences: 9, distinctSources: 9 },
      },
    ];
    const merged = resolveChecksWithLearned(tags, learned, base);
    expect(merged.find((c) => c.id === "accident_history")?.enforcement).toBe("soft");
  });
});

describe("store", () => {
  it("in-memory store records and replays observations in order", () => {
    const store = createInMemoryLearnedCheckStore();
    recordCheckObservation(store, obs("vehicles", "사고 이력?", "s1"));
    recordCheckObservation(store, obs("vehicles", "사고 이력?", "s2"));
    expect(store.observations()).toHaveLength(2);
    expect(store.observations()[0]?.sourceId).toBe("s1");
  });

  it("observations() returns a copy (caller cannot mutate internal state)", () => {
    const store = createInMemoryLearnedCheckStore();
    recordCheckObservation(store, obs("vehicles", "사고 이력?", "s1"));
    store.observations().push(obs("hacked", "x", "s9"));
    expect(store.observations()).toHaveLength(1);
  });
});
