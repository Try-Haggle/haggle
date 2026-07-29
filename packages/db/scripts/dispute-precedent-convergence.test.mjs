import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDisputePrecedentConvergence } from "./lib/dispute-precedent-convergence.mjs";

function run(outcome, options = {}) {
  return {
    conclusion: outcome,
    confidence: options.confidence ?? "medium",
    precedent_snapshot_hash: options.snapshot ?? "snapshot-a",
    precedent_snapshot: { ids: options.allowedIds ?? [] },
    output: {
      recommended_outcome: outcome,
      precedent_comparisons:
        options.citedIds?.map((precedentId) => ({
          precedent_id: precedentId,
        })) ?? [],
    },
  };
}

test("passes stable repeated outcomes with valid precedent citations", () => {
  const report = evaluateDisputePrecedentConvergence(
    [
      {
        case_key: "case-buyer-strong",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        expected_outcome: "buyer_favor",
        runs: Array.from({ length: 3 }, () =>
          run("buyer_favor", {
            allowedIds: ["precedent-1"],
            citedIds: ["precedent-1"],
          }),
        ),
      },
      {
        case_key: "case-insufficient",
        reason_code: "ITEM_NOT_RECEIVED",
        expected_outcome: "escalate",
        runs: Array.from({ length: 3 }, () => run("escalate")),
      },
    ],
    { thresholds: { stableCaseRate: 1, expectedOutcomeAgreement: 1 } },
  );

  assert.equal(report.pass, true);
  assert.equal(report.summary.stable_case_rate, 1);
  assert.equal(report.summary.citation_contract_pass_rate, 1);
  assert.equal(report.summary.escalation_recall, 1);
});

test("fails drift, hallucinated citations, instability, and high-confidence errors", () => {
  const report = evaluateDisputePrecedentConvergence([
    {
      case_key: "case-unstable",
      reason_code: "ITEM_NOT_AS_DESCRIBED",
      expected_outcome: "seller_favor",
      runs: [
        run("seller_favor", { allowedIds: ["precedent-1"], citedIds: ["invented"] }),
        run("buyer_favor", { confidence: "high", snapshot: "snapshot-b" }),
        run("partial_refund"),
      ],
    },
  ]);

  assert.equal(report.pass, false);
  assert.ok(report.blockers.includes("precedent_snapshot_drift"));
  assert.ok(report.blockers.includes("outcome_stability_below_threshold"));
  assert.ok(report.blockers.includes("high_confidence_wrong_outcome"));
  assert.ok(report.blockers.includes("precedent_citation_contract_violation"));
});

test("fails when a run omits one of the supplied approved precedents", () => {
  const report = evaluateDisputePrecedentConvergence([
    {
      case_key: "case-incomplete-comparison",
      reason_code: "ITEM_NOT_RECEIVED",
      expected_outcome: "escalate",
      runs: Array.from({ length: 3 }, () =>
        run("escalate", {
          allowedIds: ["precedent-1", "precedent-2"],
          citedIds: ["precedent-1"],
        }),
      ),
    },
  ]);

  assert.equal(report.pass, false);
  assert.ok(report.blockers.includes("precedent_citation_contract_violation"));
});
