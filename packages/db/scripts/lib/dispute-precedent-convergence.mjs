const OUTCOMES = new Set([
  "buyer_favor",
  "seller_favor",
  "partial_refund",
  "no_action",
  "escalate",
]);

function fraction(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function outcomeFrom(run) {
  return run.conclusion ?? run.output?.recommended_outcome;
}

export function evaluateDisputePrecedentConvergence(cases, options = {}) {
  const requiredRepeats = options.requiredRepeats ?? 3;
  const thresholds = {
    stableCaseRate: 0.9,
    expectedOutcomeAgreement: 0.8,
    escalationRecall: 1,
    ...options.thresholds,
  };
  const caseResults = [];
  let totalRuns = 0;
  let expectedMatches = 0;
  let expectedRuns = 0;
  let highConfidenceWrong = 0;
  let citationContractPasses = 0;
  let escalationMatches = 0;
  let escalationRuns = 0;
  const outcomeCounts = new Map();

  for (const testCase of cases) {
    const outcomes = [];
    const snapshotHashes = new Set();
    let caseExpectedMatches = 0;
    let caseCitationPasses = 0;

    for (const run of testCase.runs) {
      const outcome = outcomeFrom(run);
      const expected = testCase.expected_outcome;
      const allowedIds = new Set(run.precedent_snapshot?.ids ?? []);
      const comparisons = run.output?.precedent_comparisons ?? [];
      const citedIds = comparisons.map((comparison) => comparison.precedent_id);
      const uniqueCitedIds = new Set(citedIds);
      const citationsValid =
        citedIds.every((precedentId) => allowedIds.has(precedentId)) &&
        uniqueCitedIds.size === citedIds.length &&
        allowedIds.size === uniqueCitedIds.size;

      totalRuns += 1;
      if (OUTCOMES.has(outcome)) {
        outcomes.push(outcome);
        outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
      }
      if (typeof run.precedent_snapshot_hash === "string") {
        snapshotHashes.add(run.precedent_snapshot_hash);
      }
      if (expected) {
        expectedRuns += 1;
        if (outcome === expected) {
          expectedMatches += 1;
          caseExpectedMatches += 1;
        } else if (run.confidence === "high") {
          highConfidenceWrong += 1;
        }
        if (expected === "escalate") {
          escalationRuns += 1;
          if (outcome === "escalate") escalationMatches += 1;
        }
      }
      if (citationsValid) {
        citationContractPasses += 1;
        caseCitationPasses += 1;
      }
    }

    const validRunCount = outcomes.length;
    caseResults.push({
      case_key: testCase.case_key,
      reason_code: testCase.reason_code,
      expected_outcome: testCase.expected_outcome ?? null,
      runs: testCase.runs.length,
      required_repeats_met: testCase.runs.length >= requiredRepeats,
      exact_outcome_stable: validRunCount >= requiredRepeats && new Set(outcomes).size === 1,
      observed_outcomes: Object.fromEntries(
        [...new Set(outcomes)]
          .sort()
          .map((outcome) => [outcome, outcomes.filter((value) => value === outcome).length]),
      ),
      expected_agreement: fraction(caseExpectedMatches, testCase.runs.length),
      snapshot_stable: testCase.runs.length >= requiredRepeats && snapshotHashes.size === 1,
      citation_contract_pass_rate: fraction(caseCitationPasses, testCase.runs.length),
    });
  }

  const completedCases = caseResults.filter((result) => result.required_repeats_met).length;
  const stableCases = caseResults.filter((result) => result.exact_outcome_stable).length;
  const snapshotStableCases = caseResults.filter((result) => result.snapshot_stable).length;
  const stableCaseRate = fraction(stableCases, caseResults.length);
  const expectedAgreement = fraction(expectedMatches, expectedRuns);
  const citationContractPassRate = fraction(citationContractPasses, totalRuns);
  const escalationRecall = fraction(escalationMatches, escalationRuns);
  const blockers = [];

  if (completedCases !== caseResults.length) blockers.push("insufficient_repeat_runs");
  if (snapshotStableCases !== caseResults.length) blockers.push("precedent_snapshot_drift");
  if (stableCaseRate < thresholds.stableCaseRate)
    blockers.push("outcome_stability_below_threshold");
  if (expectedAgreement < thresholds.expectedOutcomeAgreement) {
    blockers.push("human_expected_agreement_below_threshold");
  }
  if (highConfidenceWrong > 0) blockers.push("high_confidence_wrong_outcome");
  if (citationContractPassRate < 1) blockers.push("precedent_citation_contract_violation");
  if (escalationRecall < thresholds.escalationRecall) {
    blockers.push("insufficient_evidence_escalation_below_threshold");
  }

  return {
    schema_version: "dispute-precedent-convergence-report-v1",
    pass: blockers.length === 0,
    thresholds: {
      required_repeats: requiredRepeats,
      stable_case_rate: thresholds.stableCaseRate,
      expected_outcome_agreement: thresholds.expectedOutcomeAgreement,
      escalation_recall: thresholds.escalationRecall,
      citation_contract_pass_rate: 1,
      high_confidence_wrong: 0,
    },
    summary: {
      cases: caseResults.length,
      completed_cases: completedCases,
      runs: totalRuns,
      stable_case_rate: stableCaseRate,
      expected_outcome_agreement: expectedAgreement,
      snapshot_stable_case_rate: fraction(snapshotStableCases, caseResults.length),
      citation_contract_pass_rate: citationContractPassRate,
      escalation_recall: escalationRecall,
      high_confidence_wrong: highConfidenceWrong,
      observed_outcomes: Object.fromEntries([...outcomeCounts.entries()].sort()),
    },
    blockers,
    cases: caseResults,
  };
}
