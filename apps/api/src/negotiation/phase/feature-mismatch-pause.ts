import { type NegotiationCheck, resolveChecks } from "@haggle/shared";

/**
 * Feature-mismatch PAUSE detector (PAUSE slice, pillar A × pillar B).
 *
 * "협상 중 멈춤" — when the item's category carries a HARD taxonomy requirement
 * (iPhone → IMEI, vehicle → title, clothing → authenticity) that the counterpart
 * has NOT resolved, the negotiation should pause and ask that question instead of
 * auto-proceeding. This module is the *detector*: given the item's tags and the set
 * of features/checks the counterpart has already resolved (sensor extracted_features
 * + listing-declared attributes), it decides whether a pause is warranted and which
 * question to surface.
 *
 * Scope (Group 2 loop discipline, §8 (다) mutual):
 *  - PURE + deterministic + additive. It consumes resolveChecks (taxonomy) only.
 *  - It does NOT flip any production gate. The existing hold machinery
 *    (checkIntervention → persistHoldRound in the executor) is where a pause would
 *    actually take effect, but wiring this detector into that gate is a mutual
 *    co-design step with Group 1 (it touches the round loop / intervention_mode).
 *    That wiring is a deliberate follow-up — see // TODO(group1/mutual) below.
 *  - Unconsumed in production for now (shadow); its contract is proven by tests.
 */

export interface FeatureMismatchInput {
  /** Item tags (listing.category + tags) — drives which checks apply via the taxonomy. */
  tags: readonly string[];
  /**
   * Feature keys the counterpart has already resolved/declared — from the sensor's
   * extracted_features (featureKey) and the listing's declared attributes.
   */
  resolvedFeatureKeys?: readonly string[];
  /**
   * Check ids already resolved/answered — for hard checks that have no engine
   * featureKey (e.g. vehicle "title_status", clothing "authenticity").
   */
  resolvedCheckIds?: readonly string[];
  /** Current negotiation round (1-based). */
  round: number;
  /**
   * Round from which an unresolved hard check triggers a pause. Earlier rounds are
   * discovery — pausing before any info is exchanged would be noise. Default 2.
   */
  minRound?: number;
}

export interface FeatureMismatchPause {
  shouldPause: true;
  /** The hard checks the counterpart has not resolved (taxonomy order). */
  unresolvedHardChecks: NegotiationCheck[];
  /** The question to surface first (the first unresolved hard check's questionKo). */
  question: string;
  /** Auditable reason string for logs / hold review. */
  reason: string;
}

const DEFAULT_MIN_ROUND = 2;

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const v = raw.trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

/**
 * Decide whether a feature mismatch warrants pausing. Returns the pause (with the
 * question to ask) or null when there is nothing to pause on: no taxonomy node, all
 * hard requirements resolved, only soft checks outstanding, or still in early
 * discovery rounds.
 */
export function detectFeatureMismatchPause(
  input: FeatureMismatchInput,
): FeatureMismatchPause | null {
  const checks = resolveChecks(input.tags);
  if (checks.length === 0) return null; // no taxonomy node → nothing to gate

  const resolvedKeys = normalizedSet(input.resolvedFeatureKeys);
  const resolvedIds = normalizedSet(input.resolvedCheckIds);

  const unresolvedHardChecks = checks.filter((check) => {
    if (check.enforcement !== "hard") return false; // only HARD requirements pause
    const idResolved = resolvedIds.has(check.id.toLowerCase());
    const keyResolved = check.featureKey ? resolvedKeys.has(check.featureKey.toLowerCase()) : false;
    return !idResolved && !keyResolved;
  });

  if (unresolvedHardChecks.length === 0) return null; // every hard check resolved

  const minRound = input.minRound ?? DEFAULT_MIN_ROUND;
  // Guard non-finite rounds: `NaN < minRound` is false, which would fail OPEN into a
  // pause. Malformed input must no-op, not pause.
  if (!Number.isFinite(input.round) || input.round < minRound) return null; // discovery

  // TODO(group1/mutual): wire this into the executor hold gate (checkIntervention →
  // persistHoldRound) once the pause↔decision interaction is co-designed with Group 1.
  return {
    shouldPause: true,
    unresolvedHardChecks,
    question: unresolvedHardChecks[0]!.questionKo,
    reason: `Unresolved hard requirement(s) for this category: ${unresolvedHardChecks
      .map((c) => c.id)
      .join(", ")}. Pausing to confirm before proceeding.`,
  };
}
