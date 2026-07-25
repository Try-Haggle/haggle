import { describe, expect, it } from "vitest";
import {
  detectFeatureMismatchPause,
  type FeatureMismatchInput,
} from "../feature-mismatch-pause.js";

function input(overrides: Partial<FeatureMismatchInput> = {}): FeatureMismatchInput {
  return { tags: ["iphone-15-pro"], round: 3, ...overrides };
}

describe("detectFeatureMismatchPause", () => {
  it("pauses on an unresolved hard requirement and surfaces the FIRST check's literal question", () => {
    // iPhone has hard checks imei_verification + find_my_status (inherited leaf), in
    // that taxonomy order — imei must be questioned first.
    const pause = detectFeatureMismatchPause(input({ resolvedFeatureKeys: [], round: 3 }));
    expect(pause).not.toBeNull();
    expect(pause?.shouldPause).toBe(true);
    expect(pause?.unresolvedHardChecks.map((c) => c.id)).toEqual([
      "imei_verification",
      "find_my_status",
    ]);
    // literal string, not a tautology against the computed field.
    expect(pause?.question).toBe("IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요?");
  });

  it("does NOT pause once every hard check is resolved (by featureKey)", () => {
    const pause = detectFeatureMismatchPause(
      input({
        resolvedFeatureKeys: ["imei_verification", "find_my_status"],
        round: 5,
      }),
    );
    expect(pause).toBeNull();
  });

  it("resolves a hard check that has NO featureKey via resolvedCheckIds (vehicle title)", () => {
    // vehicles → hard check title_status (no featureKey).
    const stillPending = detectFeatureMismatchPause(input({ tags: ["vehicles"], round: 3 }));
    expect(stillPending?.unresolvedHardChecks.map((c) => c.id)).toEqual(["title_status"]);

    const resolved = detectFeatureMismatchPause(
      input({ tags: ["vehicles"], round: 3, resolvedCheckIds: ["title_status"] }),
    );
    expect(resolved).toBeNull();
  });

  it("does NOT pause when only SOFT checks are outstanding", () => {
    // laptops has only soft checks (battery_cycles, spec_summary) — never pauses.
    const pause = detectFeatureMismatchPause(input({ tags: ["macbook-pro"], round: 9 }));
    expect(pause).toBeNull();
  });

  it("does NOT pause during early discovery rounds (before minRound)", () => {
    expect(detectFeatureMismatchPause(input({ round: 1 }))).toBeNull();
    // …but the same unresolved state pauses once the round threshold is reached.
    expect(detectFeatureMismatchPause(input({ round: 2 }))).not.toBeNull();
  });

  it("honors a custom minRound", () => {
    expect(detectFeatureMismatchPause(input({ round: 3, minRound: 5 }))).toBeNull();
    expect(detectFeatureMismatchPause(input({ round: 5, minRound: 5 }))).not.toBeNull();
  });

  it("returns null for tags with no taxonomy node, empty tags, or bare all-soft category", () => {
    expect(detectFeatureMismatchPause(input({ tags: ["furniture"], round: 9 }))).toBeNull();
    expect(detectFeatureMismatchPause(input({ tags: [], round: 9 }))).toBeNull();
    // bare "electronics" has only soft checks → no hard requirement → null.
    expect(detectFeatureMismatchPause(input({ tags: ["electronics"], round: 9 }))).toBeNull();
  });

  it("normalizes casing/whitespace in BOTH resolved channels", () => {
    // resolvedCheckIds channel (no-featureKey hard check).
    expect(
      detectFeatureMismatchPause(
        input({ tags: ["vehicles"], round: 3, resolvedCheckIds: ["  TITLE_STATUS  "] }),
      ),
    ).toBeNull();
    // resolvedFeatureKeys channel (hard check WITH featureKey).
    expect(
      detectFeatureMismatchPause(
        input({
          tags: ["iphone-15-pro"],
          round: 3,
          resolvedFeatureKeys: ["  IMEI_VERIFICATION  ", "Find_My_Status"],
        }),
      ),
    ).toBeNull();
  });

  it("resolves a no-featureKey hard check ONLY via its id channel, not the featureKey channel", () => {
    // clothing → hard check "authenticity" (no featureKey).
    const wrongChannel = detectFeatureMismatchPause(
      input({ tags: ["clothing"], round: 3, resolvedFeatureKeys: ["authenticity"] }),
    );
    expect(wrongChannel?.unresolvedHardChecks.map((c) => c.id)).toEqual(["authenticity"]);

    const rightChannel = detectFeatureMismatchPause(
      input({ tags: ["clothing"], round: 3, resolvedCheckIds: ["authenticity"] }),
    );
    expect(rightChannel).toBeNull();
  });

  it("no-ops on malformed non-finite / negative rounds, but a large finite round pauses", () => {
    expect(detectFeatureMismatchPause(input({ round: Number.NaN }))).toBeNull();
    expect(detectFeatureMismatchPause(input({ round: -5 }))).toBeNull();
    // Infinity is non-finite → fails safe to no-op, not a pause.
    expect(detectFeatureMismatchPause(input({ round: Number.POSITIVE_INFINITY }))).toBeNull();
    // …a genuinely large finite round still pauses.
    expect(detectFeatureMismatchPause(input({ round: 9999 }))).not.toBeNull();
  });

  it("lists ALL unresolved hard checks but questions the first (taxonomy order)", () => {
    const pause = detectFeatureMismatchPause(
      input({ tags: ["iphone-15-pro"], round: 4, resolvedFeatureKeys: ["imei_verification"] }),
    );
    // imei resolved → find_my_status remains.
    expect(pause?.unresolvedHardChecks.map((c) => c.id)).toEqual(["find_my_status"]);
    expect(pause?.question).toBe(pause?.unresolvedHardChecks[0]?.questionKo);
  });
});
