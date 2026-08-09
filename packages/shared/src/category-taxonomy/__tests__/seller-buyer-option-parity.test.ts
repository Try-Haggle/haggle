/**
 * Seller/buyer quick-setup parity.
 *
 * The two sides read different option arrays — buyers state a REQUIREMENT
 * (`answerOptions`), sellers state a FACT (`sellerOptions`) — which is deliberate. What
 * was NOT deliberate: 12 soft checks had buyer options and no seller counterpart, so a
 * buyer could tap "Full service history" on a check the seller was never asked about.
 * The negotiation then carried a buyer requirement with no seller fact to match it, and
 * because these are soft checks the mid-negotiation PAUSE (seller-required → buyer
 * unanswered) never covers the reverse direction.
 */

import { describe, expect, it } from "vitest";
import { buildBuyerChoiceQuestions, buildSellerChoiceQuestions } from "../criteria.js";
import { CATEGORY_TAXONOMY } from "../taxonomy.js";

/** The single documented exception — see the comment on the check itself. */
const BUYER_ONLY_BY_DESIGN = new Set(["mileage"]);

function allChecks() {
  const seen = new Map<string, (typeof CATEGORY_TAXONOMY)[number]["checks"][number]>();
  for (const node of CATEGORY_TAXONOMY) {
    for (const check of node.checks ?? []) {
      if (!seen.has(check.id)) seen.set(check.id, check);
    }
  }
  return [...seen.values()];
}

describe("every buyer-tappable check is also seller-tappable", () => {
  it("has no undocumented buyer-only checks", () => {
    const buyerOnly = allChecks()
      .filter((c) => (c.answerOptions?.length ?? 0) > 0 && (c.sellerOptions?.length ?? 0) === 0)
      .map((c) => c.id)
      .filter((id) => !BUYER_ONLY_BY_DESIGN.has(id));
    expect(buyerOnly).toEqual([]);
  });

  it("keeps mileage buyer-only on purpose", () => {
    const mileage = allChecks().find((c) => c.id === "mileage");
    expect(mileage?.answerOptions?.length).toBeGreaterThan(0);
    expect(mileage?.sellerOptions ?? []).toHaveLength(0);
  });

  it("gives every seller-tappable check a short English seller ask", () => {
    // Without `sellerAsk` the picker falls back to `questionKo`, printing Korean into
    // the English seller UI.
    const missing = allChecks()
      .filter((c) => (c.sellerOptions?.length ?? 0) > 0 && !c.sellerAsk)
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

describe("soft seller answers must not arm the PAUSE gate", () => {
  it("marks every SOFT seller option optional", () => {
    // A seller stating a soft fact ("full service records") is information, not a
    // non-negotiable. If it were `required`, `requiredCriteria` would pick it up and
    // pause the negotiation to ask the buyer about service history — an intervention
    // reserved for real deal-breakers.
    const offenders = allChecks()
      .filter((c) => c.enforcement === "soft")
      .flatMap((c) =>
        (c.sellerOptions ?? [])
          .filter((o) => o.requirement === "required")
          .map((o) => `${c.id}:${o.label}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe("vehicles now covers the gap the e2e surfaced", () => {
  const tags = ["vehicles"];

  it("adds service and accident history to the seller picker", () => {
    const sellerIds = buildSellerChoiceQuestions(tags).map((q) => q.checkId);
    expect(sellerIds).toContain("service_history");
    expect(sellerIds).toContain("accident_history");
    expect(sellerIds).not.toContain("mileage");
  });

  it("still shows every hard gate first on both sides", () => {
    for (const questions of [buildSellerChoiceQuestions(tags), buildBuyerChoiceQuestions(tags)]) {
      const firstSoft = questions.findIndex((q) => q.enforcement === "soft");
      const lastHard = questions.map((q) => q.enforcement).lastIndexOf("hard");
      if (firstSoft >= 0) expect(lastHard).toBeLessThan(firstSoft);
    }
  });

  it("leaves the buyer picker unchanged", () => {
    expect(buildBuyerChoiceQuestions(tags)).toHaveLength(9);
  });
});
