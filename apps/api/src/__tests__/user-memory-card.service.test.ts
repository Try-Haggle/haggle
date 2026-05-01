import { describe, expect, it, vi } from "vitest";
import {
  formatUserMemoryBriefSignals,
  listUserMemoryCards,
  loadUserMemoryBrief,
  recordUserMemoryCards,
  resetUserMemoryCards,
  suppressUserMemoryCard,
} from "../services/user-memory-card.service.js";
import type { ConversationSignal } from "../services/conversation-signal-extractor.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

function makeSignal(overrides: Partial<ConversationSignal> = {}): ConversationSignal {
  return {
    type: "price_resistance",
    entityType: "ceiling",
    entityValue: "max is $700",
    normalizedValue: "ceiling_70000",
    confidence: 0.88,
    evidence: {
      source: "message",
      sourceKey: "round-1:incoming",
      messageId: "round-1:incoming",
      start: 3,
      end: 14,
      textHash: "b".repeat(64),
      rawTextAvailable: true,
    },
    method: "deterministic",
    privacyClass: "user_preference",
    marketUsefulness: "high",
    rolePerspective: "BUYER",
    sourceRoundNo: 1,
    sourceMessageId: "round-1:incoming",
    ...overrides,
  };
}

describe("User Memory Card Service", () => {
  it("loads bounded active memory brief rows", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        cardType: "pricing",
        memoryKey: "price_resistance:ceiling:ceiling_70000",
        summary: "buyer pricing boundary: ceiling_70000",
        strength: "0.6520",
        memory: { normalizedValue: "ceiling_70000" },
        evidenceRefs: ["round-1:incoming#3-14"],
      },
    ]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const brief = await loadUserMemoryBrief(db, {
      userId: "44444444-4444-4444-4444-444444444444",
    });

    expect(brief?.items).toHaveLength(1);
    expect(brief?.items[0]).toMatchObject({
      cardType: "pricing",
      memoryKey: "price_resistance:ceiling:ceiling_70000",
      strength: 0.652,
    });
    expect(execute.mock.calls[0]?.[0].raw).toContain("FROM user_memory_cards");
    expect(execute.mock.calls[0]?.[0].raw).toContain("status = 'ACTIVE'");
  });

  it("formats memory brief as non-authoritative signals", () => {
    const signals = formatUserMemoryBriefSignals({
      userId: "44444444-4444-4444-4444-444444444444",
      items: [
        {
          cardType: "pricing",
          memoryKey: "price_resistance:ceiling:ceiling_70000",
          summary: "buyer pricing boundary: ceiling_70000",
          strength: 0.652,
          memory: { normalizedValue: "ceiling_70000" },
          evidenceRefs: ["round-1:incoming#3-14"],
        },
      ],
    });

    expect(signals).toEqual([
      "USER_MEMORY_HINTS:non_authoritative",
      "MEM:pricing:ceiling_70000|strength:0.65",
    ]);
    expect(JSON.stringify(signals)).not.toContain("max is $700");
  });

  it("lists user-controlled memory cards without suppressed cards by default", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        status: "ACTIVE",
        cardType: "pricing",
        memoryKey: "price_resistance:ceiling:ceiling_70000",
        summary: "buyer pricing boundary: ceiling_70000",
        strength: "0.6520",
        memory: { normalizedValue: "ceiling_70000" },
        evidenceRefs: ["round-1:incoming#3-14"],
      },
    ]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const cards = await listUserMemoryCards(db, {
      userId: "44444444-4444-4444-4444-444444444444",
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "55555555-5555-4555-8555-555555555555",
      status: "ACTIVE",
      cardType: "pricing",
    });
    expect(execute.mock.calls[0]?.[0].raw).toContain("status = ANY");
  });

  it("suppresses a single memory card and records an event", async () => {
    const execute = vi.fn().mockResolvedValue([{ id: "55555555-5555-4555-8555-555555555555" }]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    await expect(
      suppressUserMemoryCard(db, {
        userId: "44444444-4444-4444-4444-444444444444",
        cardId: "55555555-5555-4555-8555-555555555555",
        reason: "not relevant",
      }),
    ).resolves.toEqual({ affected: 1 });

    expect(execute.mock.calls[0]?.[0].raw).toContain("SET status = 'SUPPRESSED'");
    expect(execute.mock.calls[0]?.[0].raw).toContain("'SUPPRESSED'");
    expect(execute.mock.calls[0]?.[0].raw).toContain("INSERT INTO user_memory_events");
  });

  it("resets active memory cards via suppression and records reset events", async () => {
    const execute = vi.fn().mockResolvedValue([
      { id: "55555555-5555-4555-8555-555555555555" },
      { id: "66666666-6666-4666-8666-666666666666" },
    ]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    await expect(
      resetUserMemoryCards(db, {
        userId: "44444444-4444-4444-4444-444444444444",
      }),
    ).resolves.toEqual({ affected: 2 });

    expect(execute.mock.calls[0]?.[0].raw).toContain("status IN ('ACTIVE', 'STALE')");
    expect(execute.mock.calls[0]?.[0].raw).toContain("'USER_RESET'");
  });

  it("upserts structured memory cards without raw text", async () => {
    const execute = vi.fn().mockResolvedValue([{ card_id: "card-1" }]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordUserMemoryCards(db, {
      userId: "44444444-4444-4444-4444-444444444444",
      sourceKey: "round-1:incoming",
      signals: [makeSignal()],
      metadata: { engine: "staged-pipeline" },
    });

    expect(result).toEqual({ observed: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].raw).toContain("INSERT INTO user_memory_cards");
    expect(execute.mock.calls[0]?.[0].raw).toContain("INSERT INTO user_memory_events");
    expect(execute.mock.calls[0]?.[0].raw).toContain("WHERE should_record_event");
    expect(JSON.stringify(execute.mock.calls[0]?.[0].values)).not.toContain("max is $700");
  });

  it("does not reinforce duplicate evidence refs", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordUserMemoryCards(db, {
      userId: "44444444-4444-4444-4444-444444444444",
      sourceKey: "round-1:incoming",
      signals: [makeSignal()],
    });

    expect(result).toEqual({ observed: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].raw).toContain("evidence_refs ?");
    expect(execute.mock.calls[0]?.[0].raw).toContain("WHERE NOT (user_memory_cards.evidence_refs");
    expect(execute.mock.calls[0]?.[0].raw).toContain("THEN user_memory_cards.strength");
  });

  it("ignores private, system, and non-memory signals", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordUserMemoryCards(db, {
      userId: "44444444-4444-4444-4444-444444444444",
      sourceKey: "round-1:incoming",
      signals: [
        makeSignal({ privacyClass: "private_context" }),
        makeSignal({ rolePerspective: "SYSTEM" }),
        makeSignal({ type: "product_identity", privacyClass: "public_market" }),
      ],
    });

    expect(result).toEqual({ observed: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not write without a user id", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    await expect(
      recordUserMemoryCards(db, {
        sourceKey: "round-1:incoming",
        signals: [makeSignal()],
      }),
    ).resolves.toEqual({ observed: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});
