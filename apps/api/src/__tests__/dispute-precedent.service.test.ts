import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAdvisorSystemPrompt } from "../advisor/advisor-prompts.js";
import { buildJobRegistry } from "../jobs/runner.js";
import {
  buildApprovedPrecedentFilter,
  formatApprovedDisputePrecedents,
  rankApprovedDisputePrecedents,
} from "../services/dispute-precedent.service.js";

vi.mock("@haggle/db", async (importOriginal) => importOriginal());

const originalCollectionEnabled = process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB;

afterEach(() => {
  if (originalCollectionEnabled === undefined) {
    delete process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB;
  } else {
    process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB = originalCollectionEnabled;
  }
});

describe("approved dispute precedent retrieval", () => {
  it("filters runtime context to approved, effective precedents for the same reason", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const filter = buildApprovedPrecedentFilter("ITEM_NOT_AS_DESCRIBED", now);
    if (!filter) throw new Error("precedent filter was not created");
    const query = new PgDialect().sqlToQuery(filter.getSQL());

    expect(query.sql).toContain('"dispute_precedents"."status" = $1');
    expect(query.sql).toContain('"dispute_precedents"."reason_code" = $2');
    expect(query.sql).toContain('"dispute_precedents"."effective_from" <= $3');
    expect(query.sql).toContain('"dispute_precedents"."effective_until" is null');
    expect(query.params).toEqual([
      "APPROVED",
      "ITEM_NOT_AS_DESCRIBED",
      now.toISOString(),
      now.toISOString(),
    ]);
  });

  it("formats only stored analysis and preserves the auditable precedent id", () => {
    const text = formatApprovedDisputePrecedents([
      {
        id: "d7f35225-2f34-4d67-a29c-b1733d884168",
        reason_code: "ITEM_NOT_AS_DESCRIBED",
        outcome: "buyer_favor",
        facts_summary: "Verified condition evidence materially differed from the listing baseline.",
        issue_summary: "Whether the delivered condition matched the accepted terms.",
        decision_principle: "Verified condition evidence outweighs an unsupported denial.",
        evidence_profile: {
          evidence_types: ["camera_capture", "listing_snapshot"],
          high_weight_evidence: ["verified_camera_capture"],
          material_gaps: [],
        },
        distinguishing_factors: ["A listing baseline must exist."],
        analysis_version: "precedent-analysis-v1",
        policy_version: "dispute-policy-v2",
        approved_at: "2026-07-18T12:00:00.000Z",
      },
    ]);

    expect(text).toContain("Haggle ID: d7f35225-2f34-4d67-a29c-b1733d884168");
    expect(text).toContain("Verified condition evidence outweighs an unsupported denial.");
    expect(text).toContain('"analysis_version":"precedent-analysis-v1"');
  });

  it("ranks stored analyses by evidence profile without an LLM call", () => {
    const base = {
      reason_code: "ITEM_NOT_AS_DESCRIBED",
      outcome: "buyer_favor" as const,
      facts_summary: "facts",
      issue_summary: "issue",
      decision_principle: "principle",
      distinguishing_factors: [],
      analysis_version: "v1",
      policy_version: "v2",
      approved_at: "2026-07-18T12:00:00.000Z",
    };
    const ranked = rankApprovedDisputePrecedents(
      [
        {
          ...base,
          id: "text-only",
          evidence_profile: {
            evidence_types: ["text"],
            high_weight_evidence: [],
            material_gaps: [],
          },
        },
        {
          ...base,
          id: "camera-match",
          evidence_profile: {
            evidence_types: ["image", "text"],
            high_weight_evidence: ["image"],
            material_gaps: [],
          },
        },
      ],
      ["image"],
      2,
    );

    expect(ranked.map((precedent) => precedent.id)).toEqual(["camera-match", "text-only"]);
  });
});

describe("Advisor precedent policy", () => {
  it("requires professional analysis and explicit precedent comparisons", () => {
    const prompt = buildAdvisorSystemPrompt("buyer", "CASE CONTEXT", "CANARY");

    expect(prompt).toContain("professional marketplace dispute-resolution terminology");
    expect(prompt).toContain("approved, pre-analyzed platform precedent summaries");
    expect(prompt).toContain("material similarity and any distinguishing fact");
    expect(prompt).toContain("Facts, Key Issue, Applicable Standard, Precedent Comparison");
    expect(prompt).not.toContain("NEVER use legal terminology");
  });

  it("registers candidate collection daily only when explicitly enabled", () => {
    delete process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB;
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-precedent-collection"),
    ).toMatchObject({ intervalMs: 86_400_000, enabled: false, runOnStart: true });

    process.env.ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB = "true";
    expect(
      buildJobRegistry().find((job) => job.name === "dispute-precedent-collection"),
    ).toMatchObject({ intervalMs: 86_400_000, enabled: true, runOnStart: true });
  });
});
