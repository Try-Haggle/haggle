import { describe, expect, it, vi } from "vitest";
import {
  formatEvermemoBriefSignals,
  loadEvermemoBrief,
  syncUserMemoryBriefToEverOS,
} from "../services/evermemo-bridge.service.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

describe("Evermemo Bridge Service", () => {
  it("loads EverOS memories only when the user is currently eligible", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ eligible: true }]),
    } as unknown as import("@haggle/db").Database;
    const client = {
      searchMemories: vi.fn().mockResolvedValue({
        data: {
          profiles: [{ description: "Prefers unlocked iPhones", score: 0.9 }],
          episodes: [{ summary: "Previously rejected off-platform payment", score: 0.75 }],
        },
      }),
    } as never;

    const brief = await loadEvermemoBrief(db, {
      userId: "44444444-4444-4444-8444-444444444444",
      query: "iphone negotiation",
      topK: 5,
    }, { client });

    expect(brief?.items).toHaveLength(2);
    expect(brief?.items[0]).toMatchObject({
      source: "everos_profile",
      summary: "Prefers unlocked iPhones",
      score: 0.9,
    });
    expect((client as { searchMemories: ReturnType<typeof vi.fn> }).searchMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "44444444-4444-4444-8444-444444444444",
        method: "hybrid",
        memoryTypes: ["profile", "episodic_memory"],
      }),
    );
  });

  it("does not query EverOS when latest eligibility is missing or false", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ eligible: false }]),
    } as unknown as import("@haggle/db").Database;
    const client = { searchMemories: vi.fn() } as never;

    await expect(
      loadEvermemoBrief(db, {
        userId: "44444444-4444-4444-8444-444444444444",
        query: "iphone",
      }, { client }),
    ).resolves.toBeNull();
    expect((client as { searchMemories: ReturnType<typeof vi.fn> }).searchMemories).not.toHaveBeenCalled();
  });

  it("formats EverOS search output as non-authoritative L5 hints", () => {
    const lines = formatEvermemoBriefSignals({
      userId: "user-1",
      provider: "everos",
      items: [
        { source: "everos_profile", summary: "Prefers safe checkout", score: 0.8 },
      ],
    });

    expect(lines).toEqual([
      "EVEROS_MEMORY_HINTS:non_authoritative",
      "EVEROS:everos_profile:Prefers safe checkout|score:0.80",
    ]);
  });

  it("syncs HIL memory cards to EverOS without raw conversation text", async () => {
    const client = {
      addPersonalMemories: vi.fn().mockResolvedValue({ data: { status: "accumulated" } }),
    } as never;

    await expect(
      syncUserMemoryBriefToEverOS({
        brief: {
          userId: "44444444-4444-4444-8444-444444444444",
          items: [
            {
              cardType: "pricing",
              memoryKey: "price_resistance:ceiling:ceiling_90000",
              summary: "buyer pricing boundary: ceiling_90000",
              strength: 0.66,
              memory: { normalizedValue: "ceiling_90000" },
              evidenceRefs: ["round-1:incoming#3-14"],
            },
          ],
        },
        sessionId: "session-1",
      }, { client }),
    ).resolves.toEqual({ synced: true, messageCount: 1 });

    const message = (client as { addPersonalMemories: ReturnType<typeof vi.fn> }).addPersonalMemories
      .mock.calls[0]?.[0].messages[0].content;
    expect(message).toContain("Haggle Intelligence Layer memory card");
    expect(message).toContain("evidence_refs: round-1:incoming#3-14");
    expect(message).toContain("raw_text: unavailable");
  });
});
