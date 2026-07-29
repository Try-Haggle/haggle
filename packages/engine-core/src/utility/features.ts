import type { FeatureAdjustment } from "../features/types.js";
import { clamp } from "../utils.js";

/**
 * Adjust V_p for extracted features, mirroring `adjustVpForCompetition`.
 *
 * Each adjustment's `vp_delta_ratio` is already clamped by its category rule (H9);
 * here we compose them multiplicatively and clamp the total to [0, 1]. The composition
 * policy (multiply vs sum, ordering) is to be confirmed at kickoff (H6).
 *
 * If `adjustments` is empty, returns `vp` unchanged.
 */
export function adjustVpForFeatures(vp: number, adjustments: readonly FeatureAdjustment[]): number {
  let adjusted = vp;
  for (const a of adjustments) {
    if (typeof a.vp_delta_ratio === "number") {
      adjusted *= 1 + a.vp_delta_ratio;
    }
  }
  return clamp(adjusted, 0, 1);
}
