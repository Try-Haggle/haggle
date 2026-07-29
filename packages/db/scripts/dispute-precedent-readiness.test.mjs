import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDisputePrecedentReadiness } from "./lib/dispute-precedent-readiness.mjs";

const totals = { collection_eligible: 6 };
const eligibleByReason = [
  { reason_code: "ITEM_NOT_AS_DESCRIBED", eligible: 3 },
  { reason_code: "ITEM_NOT_RECEIVED", eligible: 3 },
];
const options = {
  priorityReasonCodes: ["ITEM_NOT_AS_DESCRIBED", "ITEM_NOT_RECEIVED"],
  thresholds: { minimumApprovedPerReason: 2, minimumDistinctOutcomesPerReason: 2 },
};

test("reports a missing migration before collection readiness", () => {
  const result = evaluateDisputePrecedentReadiness(
    {
      totals,
      eligibleByReason,
      precedent: { tablePresent: false },
    },
    options,
  );

  assert.equal(result.phase, "MIGRATION_REQUIRED");
  assert.equal(result.baseline_test_ready, true);
  assert.equal(result.precedent_assisted_test_ready, false);
  assert.deepEqual(result.blockers, ["dispute_precedents_table_missing"]);
});

test("does not call one-outcome approval coverage ready", () => {
  const result = evaluateDisputePrecedentReadiness(
    {
      totals,
      eligibleByReason,
      precedent: {
        tablePresent: true,
        currentSourceCount: 6,
        byStatus: [{ status: "APPROVED", count: 4 }],
        activeApproved: [
          {
            reason_code: "ITEM_NOT_AS_DESCRIBED",
            outcome: "partial_refund",
            count: 2,
          },
          { reason_code: "ITEM_NOT_RECEIVED", outcome: "buyer_favor", count: 2 },
        ],
      },
    },
    options,
  );

  assert.equal(result.phase, "COVERAGE_BUILDING");
  assert.equal(result.precedent_assisted_test_ready, false);
  assert.ok(
    result.priority_reason_coverage.every((reason) =>
      reason.blockers.includes("outcome_diversity_below_minimum"),
    ),
  );
});

test("requires sufficient count and outcome diversity for every priority reason", () => {
  const result = evaluateDisputePrecedentReadiness(
    {
      totals,
      eligibleByReason,
      precedent: {
        tablePresent: true,
        currentSourceCount: 6,
        byStatus: [{ status: "APPROVED", count: 4 }],
        activeApproved: [
          { reason_code: "ITEM_NOT_AS_DESCRIBED", outcome: "buyer_favor", count: 1 },
          { reason_code: "ITEM_NOT_AS_DESCRIBED", outcome: "seller_favor", count: 1 },
          { reason_code: "ITEM_NOT_RECEIVED", outcome: "buyer_favor", count: 1 },
          { reason_code: "ITEM_NOT_RECEIVED", outcome: "no_action", count: 1 },
        ],
      },
    },
    options,
  );

  assert.equal(result.phase, "KNOWLEDGE_BASE_READY_FOR_HOLDOUT");
  assert.equal(result.precedent_assisted_test_ready, true);
  assert.deepEqual(result.blockers, []);
});

test("reports collection backlog without hiding otherwise complete coverage", () => {
  const result = evaluateDisputePrecedentReadiness(
    {
      totals,
      eligibleByReason,
      precedent: {
        tablePresent: true,
        currentSourceCount: 5,
        byStatus: [{ status: "APPROVED", count: 4 }],
        activeApproved: [
          { reason_code: "ITEM_NOT_AS_DESCRIBED", outcome: "buyer_favor", count: 1 },
          { reason_code: "ITEM_NOT_AS_DESCRIBED", outcome: "seller_favor", count: 1 },
          { reason_code: "ITEM_NOT_RECEIVED", outcome: "buyer_favor", count: 1 },
          { reason_code: "ITEM_NOT_RECEIVED", outcome: "no_action", count: 1 },
        ],
      },
    },
    options,
  );

  assert.equal(result.counts.collection_backlog, 1);
  assert.ok(result.blockers.includes("collection_backlog_present"));
});
