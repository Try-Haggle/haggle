import { describe, expect, it, vi } from "vitest";
import { recordConversationSignalsForRound } from "../services/conversation-signal-sink.js";

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

function makeMockDb() {
  const execute = vi.fn().mockImplementation((query: { raw: string; values: unknown[] }) => {
    if (query.raw.includes("INSERT INTO conversation_signal_sources")) {
      return Promise.resolve([{ source_key: query.values[0] }]);
    }
    if (query.raw.includes("INSERT INTO conversation_market_signals")) {
      return Promise.resolve([{ signal_key: query.values[0] }]);
    }
    if (query.raw.includes("INSERT INTO term_intelligence_terms")) {
      return Promise.resolve([{ normalized_term: "insured_shipping" }]);
    }
    if (query.raw.includes("INSERT INTO user_memory_cards")) {
      return Promise.resolve([{ card_id: "memory-card-1" }]);
    }
    return Promise.resolve([]);
  });

  return {
    db: { execute } as unknown as import("@haggle/db").Database,
    execute,
    getSourceQuery: () =>
      execute.mock.calls.find((call) => String(call[0]?.raw).includes("INSERT INTO conversation_signal_sources"))?.[0] as
        | { raw: string; values: unknown[] }
        | undefined,
    getMarketQueries: () =>
      execute.mock.calls
        .map((call) => call[0] as { raw: string; values: unknown[] })
        .filter((query) => query.raw.includes("INSERT INTO conversation_market_signals")),
  };
}

describe("Conversation Signal Sink", () => {
  it("records extracted signals with round and source metadata", async () => {
    const mock = makeMockDb();

    const result = await recordConversationSignalsForRound(mock.db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      roundId: "22222222-2222-2222-2222-222222222222",
      roundNo: 4,
      listingId: "33333333-3333-3333-3333-333333333333",
      userId: "44444444-4444-4444-4444-444444444444",
      rolePerspective: "BUYER",
      text: "My max is $700 for the iPhone 15 Pro 256GB if shipping is insured.",
      sourceMessageId: "msg-123",
      sourceLabel: "incoming",
      metadata: { engine: "staged-pipeline" },
    });

    expect(result.extracted).toBeGreaterThan(0);
    expect(result.inserted).toBe(result.extracted);
    expect(mock.execute).toHaveBeenCalled();

    const source = mock.getSourceQuery();
    expect(source?.raw).toContain("ON CONFLICT (source_key) DO UPDATE");
    expect(source?.values).toEqual(
      expect.arrayContaining([
        "msg-123",
        "My max is $700 for the iPhone 15 Pro 256GB if shipping is insured.",
        "incoming",
      ]),
    );

    const marketQueries = mock.getMarketQueries();
    expect(marketQueries.some((query) => query.values.includes("price_resistance"))).toBe(true);
    expect(marketQueries.some((query) => query.values.includes("product_identity") && query.values.includes("iphone_15_pro"))).toBe(true);

    const priceQuery = marketQueries.find((query) => query.values.includes("price_resistance"));
    expect(priceQuery?.raw).toContain("ON CONFLICT (signal_key) DO NOTHING");
    expect(priceQuery?.values).toEqual(
      expect.arrayContaining([
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        4,
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444",
        "BUYER",
        "deterministic",
      ]),
    );
    const evidenceValue = priceQuery?.values.find(
      (value): value is string => typeof value === "string" && value.includes('"sourceKey":"msg-123"'),
    );
    expect(evidenceValue).toBeTruthy();
    expect(JSON.stringify(priceQuery?.values)).not.toContain('"text"');
  });

  it("can retry downstream writes when the source row already exists", async () => {
    const mock = makeMockDb();

    await recordConversationSignalsForRound(mock.db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      roundId: "22222222-2222-2222-2222-222222222222",
      roundNo: 4,
      listingId: "33333333-3333-3333-3333-333333333333",
      userId: "44444444-4444-4444-4444-444444444444",
      rolePerspective: "BUYER",
      text: "My max is $700 for the iPhone 15 Pro 256GB.",
      sourceMessageId: "msg-123",
      sourceLabel: "incoming",
    });

    expect(mock.getSourceQuery()?.raw).toContain("WHERE conversation_signal_sources.raw_text_hash = EXCLUDED.raw_text_hash");
    expect(mock.getMarketQueries().length).toBeGreaterThan(0);
  });

  it("does not requeue Tag Garden candidates when market signals already exist", async () => {
    const execute = vi.fn().mockImplementation((query: { raw: string; values: unknown[] }) => {
      if (query.raw.includes("INSERT INTO conversation_signal_sources")) {
        return Promise.resolve([{ source_key: query.values[0] }]);
      }
      if (query.raw.includes("INSERT INTO conversation_market_signals")) {
        return Promise.resolve([]);
      }
      if (query.raw.includes("INSERT INTO term_intelligence_terms")) {
        return Promise.resolve([]);
      }
      if (query.raw.includes("INSERT INTO user_memory_cards")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const db = { execute } as unknown as import("@haggle/db").Database;

    const result = await recordConversationSignalsForRound(db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      listingId: "33333333-3333-3333-3333-333333333333",
      rolePerspective: "BUYER",
      text: "Does the AirPods Max include insured shipping?",
      sourceLabel: "incoming",
    });

    expect(result.extracted).toBeGreaterThan(0);
    expect(result.inserted).toBe(0);
    expect(
      execute.mock.calls.some((call) => String(call[0]?.raw).includes("INSERT INTO tag_suggestions")),
    ).toBe(false);
  });

  it("queues tag candidates for Tag Garden review", async () => {
    const mock = makeMockDb();

    await recordConversationSignalsForRound(mock.db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      listingId: "33333333-3333-3333-3333-333333333333",
      rolePerspective: "BUYER",
      text: "Does the AirPods Max include insured shipping?",
      sourceLabel: "incoming",
    });

    expect(mock.execute).toHaveBeenCalled();
  });

  it("does not write when no signals are extracted", async () => {
    const mock = makeMockDb();

    const result = await recordConversationSignalsForRound(mock.db, {
      sessionId: "11111111-1111-1111-1111-111111111111",
      rolePerspective: "UNKNOWN",
      text: "hello there",
    });

    expect(result).toEqual({ extracted: 0, inserted: 0 });
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it("is non-fatal when persistence fails", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("db down"));
    const db = {
      execute,
    } as unknown as import("@haggle/db").Database;

    await expect(
      recordConversationSignalsForRound(db, {
        sessionId: "11111111-1111-1111-1111-111111111111",
        rolePerspective: "BUYER",
        text: "$700 for the PS5",
      }),
    ).resolves.toEqual({ extracted: 0, inserted: 0 });
  });
});
