export const DEFAULT_PRIORITY_REASON_CODES = [
  "ITEM_NOT_AS_DESCRIBED",
  "ITEM_NOT_RECEIVED",
  "DELIVERY_EXCEPTION",
];

export const DEFAULT_PRECEDENT_READINESS_THRESHOLDS = Object.freeze({
  minimumApprovedPerReason: 3,
  minimumDistinctOutcomesPerReason: 2,
});

function countByKey(rows, key) {
  return new Map(rows.map((row) => [row[key], Number(row.count ?? 0)]));
}

function asNumber(value) {
  return Number(value ?? 0);
}

export function evaluateDisputePrecedentReadiness(input, options = {}) {
  const priorityReasonCodes = options.priorityReasonCodes ?? DEFAULT_PRIORITY_REASON_CODES;
  const thresholds = {
    ...DEFAULT_PRECEDENT_READINESS_THRESHOLDS,
    ...options.thresholds,
  };
  const eligibleByReason = new Map(
    input.eligibleByReason.map((row) => [row.reason_code, asNumber(row.eligible)]),
  );
  const statuses = countByKey(input.precedent?.byStatus ?? [], "status");
  const approvedRows = input.precedent?.activeApproved ?? [];
  const approvedByReason = new Map();
  const outcomesByReason = new Map();

  for (const row of approvedRows) {
    const reasonCode = row.reason_code;
    approvedByReason.set(reasonCode, (approvedByReason.get(reasonCode) ?? 0) + asNumber(row.count));
    if (asNumber(row.count) > 0) {
      const outcomes = outcomesByReason.get(reasonCode) ?? new Set();
      outcomes.add(row.outcome);
      outcomesByReason.set(reasonCode, outcomes);
    }
  }

  const reasonCoverage = priorityReasonCodes.map((reasonCode) => {
    const eligible = eligibleByReason.get(reasonCode) ?? 0;
    const approved = approvedByReason.get(reasonCode) ?? 0;
    const distinctOutcomes = outcomesByReason.get(reasonCode)?.size ?? 0;
    const blockers = [];
    if (approved < thresholds.minimumApprovedPerReason) {
      blockers.push("approved_count_below_minimum");
    }
    if (distinctOutcomes < thresholds.minimumDistinctOutcomesPerReason) {
      blockers.push("outcome_diversity_below_minimum");
    }
    return {
      reason_code: reasonCode,
      collection_eligible: eligible,
      active_approved: approved,
      distinct_approved_outcomes: distinctOutcomes,
      ready: blockers.length === 0,
      blockers,
    };
  });

  const collectionEligible = asNumber(input.totals.collection_eligible);
  const currentSourceCount = asNumber(input.precedent?.currentSourceCount);
  const activeApprovedCount = approvedRows.reduce((sum, row) => sum + asNumber(row.count), 0);
  const blockers = [];
  let phase;

  if (!input.precedent?.tablePresent) {
    phase = "MIGRATION_REQUIRED";
    blockers.push("dispute_precedents_table_missing");
  } else if (collectionEligible === 0) {
    phase = "SOURCE_CASES_REQUIRED";
    blockers.push("no_resolved_cases_with_resolution");
  } else if (currentSourceCount === 0) {
    phase = "COLLECTION_REQUIRED";
    blockers.push("resolved_cases_not_collected");
  } else if (statuses.get("DRAFT") === 0 && activeApprovedCount === 0) {
    phase = "ANALYSIS_REQUIRED";
    blockers.push("no_precomputed_analysis");
  } else if (activeApprovedCount === 0) {
    phase = "APPROVAL_REQUIRED";
    blockers.push("no_active_approved_precedents");
  } else if (reasonCoverage.some((reason) => !reason.ready)) {
    phase = "COVERAGE_BUILDING";
    blockers.push("priority_reason_coverage_incomplete");
  } else {
    phase = "KNOWLEDGE_BASE_READY_FOR_HOLDOUT";
  }

  if (collectionEligible > currentSourceCount && input.precedent?.tablePresent) {
    blockers.push("collection_backlog_present");
  }

  return {
    schema_version: "dispute-precedent-readiness-v1",
    phase,
    baseline_test_ready: true,
    precedent_assisted_test_ready: phase === "KNOWLEDGE_BASE_READY_FOR_HOLDOUT",
    thresholds: {
      priority_reason_codes: priorityReasonCodes,
      minimum_approved_per_reason: thresholds.minimumApprovedPerReason,
      minimum_distinct_outcomes_per_reason: thresholds.minimumDistinctOutcomesPerReason,
    },
    counts: {
      collection_eligible: collectionEligible,
      collected_current_sources: currentSourceCount,
      collection_backlog: Math.max(collectionEligible - currentSourceCount, 0),
      candidate: statuses.get("CANDIDATE") ?? 0,
      draft: statuses.get("DRAFT") ?? 0,
      active_approved: activeApprovedCount,
      retired: statuses.get("RETIRED") ?? 0,
      excluded: statuses.get("EXCLUDED") ?? 0,
    },
    priority_reason_coverage: reasonCoverage,
    blockers,
    notes: [
      "Baseline testing is possible without approved precedents.",
      "Readiness counts never approve a precedent or establish decision correctness.",
      "Holdout cases must be created after the approved precedent snapshot is frozen.",
    ],
  };
}
