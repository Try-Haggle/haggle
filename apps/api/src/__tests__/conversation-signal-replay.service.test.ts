import { describe, expect, it, vi } from "vitest";
import { replayConversationSignalSources } from "../services/conversation-signal-replay.service.js";
import { recordConversationSignalsForRound } from "../services/conversation-signal-sink.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

vi.mock("../services/conversation-signal-sink.js", () => ({
  recordConversationSignalsForRound: vi.fn().mockResolvedValue({ extracted: 2, inserted: 2 }),
}));

describe("Conversation Signal Replay Service", () => {
  it("replays source rows that have no downstream market signals", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        sourceKey: "round-1:incoming",
        sessionId: "11111111-1111-4111-8111-111111111111",
        roundId: "22222222-2222-4222-8222-222222222222",
        roundNo: 1,
        listingId: "33333333-3333-4333-8333-333333333333",
        userId: "44444444-4444-4444-8444-444444444444",
        rolePerspective: "BUYER",
        sourceLabel: "incoming",
        rawText: "My max is $700 if shipping is insured.",
      },
    ]);
    const db = { execute } as unknown as import("@haggle/db").Database;

    await expect(replayConversationSignalSources(db, { limit: 10 })).resolves.toEqual({
      scanned: 1,
      replayed: 1,
      inserted: 2,
      errors: [],
    });

    expect(execute.mock.calls[0]?.[0].raw).toContain("NOT EXISTS");
    expect(execute.mock.calls[0]?.[0].raw).toContain("conversation_market_signals");
    expect(recordConversationSignalsForRound).toHaveBeenCalledWith(db, expect.objectContaining({
      sourceMessageId: "round-1:incoming",
      text: "My max is $700 if shipping is insured.",
      metadata: { replayed_from_source: true },
    }));
  });
});
