import { describe, expect, it, vi } from "vitest";
import { recordTermCandidates } from "../services/term-intelligence.service.js";
import type { ConversationSignal } from "../services/conversation-signal-extractor.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

function makeSignal(overrides: Partial<ConversationSignal> = {}): ConversationSignal {
  return {
    type: "term_candidate",
    entityType: "shipping",
    entityValue: "insured shipping",
    normalizedValue: "insured_shipping",
    confidence: 0.78,
    evidence: {
      source: "message",
      sourceKey: "round-1:incoming",
      messageId: "round-1:incoming",
      start: 10,
      end: 26,
      textHash: "a".repeat(64),
      rawTextAvailable: true,
    },
    method: "deterministic",
    privacyClass: "user_preference",
    marketUsefulness: "medium",
    rolePerspective: "BUYER",
    sourceRoundNo: 1,
    sourceMessageId: "round-1:incoming",
    ...overrides,
  };
}

describe("Term Intelligence Service", () => {
  it("records term candidates and evidence pointers", async () => {
    const execute = vi.fn().mockResolvedValue([{ normalized_term: "insured_shipping" }]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordTermCandidates(db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      roundNo: 1,
      listingId: "22222222-2222-2222-2222-222222222222",
      sourceKey: "round-1:incoming",
      signals: [makeSignal()],
      metadata: { engine: "staged-pipeline" },
    });

    expect(result).toEqual({ observed: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].raw).toContain("INSERT INTO term_intelligence_terms");
    expect(execute.mock.calls[0]?.[0].raw).toContain("INSERT INTO term_intelligence_evidence");
    expect(execute.mock.calls[0]?.[0].raw).toContain("FROM inserted_evidence");
  });

  it("deduplicates term candidates in the same source", async () => {
    const execute = vi.fn().mockResolvedValue([{ normalized_term: "insured_shipping" }]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordTermCandidates(db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      sourceKey: "round-1:incoming",
      signals: [makeSignal(), makeSignal({ confidence: 0.72 })],
    });

    expect(result).toEqual({ observed: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not count duplicate evidence sources as observations", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordTermCandidates(db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      sourceKey: "round-1:incoming",
      signals: [makeSignal()],
    });

    expect(result).toEqual({ observed: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("ignores non-term and private-context signals", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordTermCandidates(db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      sourceKey: "round-1:incoming",
      signals: [
        makeSignal({ type: "tag_candidate" }),
        makeSignal({ normalizedValue: "private_note", privacyClass: "private_context" }),
      ],
    });

    expect(result).toEqual({ observed: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});
