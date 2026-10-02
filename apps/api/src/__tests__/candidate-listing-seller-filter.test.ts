import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerIntelligenceDemoRoutes } from "../routes/intelligence-demo.js";

const generateTextEmbeddingMock = vi.hoisted(() => vi.fn());

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

vi.mock("../negotiation/adapters/deepseek-client.js", () => ({ callLLM: vi.fn() }));
vi.mock("../services/embedding.service.js", () => ({
  generateTextEmbedding: generateTextEmbeddingMock,
}));
vi.mock("../services/conversation-signal-sink.js", () => ({
  recordConversationSignalsForRound: vi.fn(),
}));

const row = (publicId: string, userId: string | null, extra: Record<string, unknown> = {}) => ({
  public_id: publicId,
  user_id: userId,
  title: `iPhone ${publicId}`,
  category: "electronics",
  condition: "good",
  ask_price: "300.00",
  floor_price: "260.00",
  tags: ["iphone"],
  ...extra,
});

// Emulates the SQL predicate: rows without a seller are dropped only when the query asks for it.
function makeDb(
  keywordRows: Array<Record<string, unknown>>,
  semanticRows: Array<Record<string, unknown>>,
) {
  const execute = vi.fn().mockImplementation((query: { raw: string }) => {
    const rows = query.raw.includes("JOIN listing_embeddings")
      ? semanticRows
      : query.raw.includes("FROM listings_published lp")
        ? keywordRows
        : [];
    return Promise.resolve(
      query.raw.includes("ld.user_id IS NOT NULL") ? rows.filter((r) => r.user_id !== null) : rows,
    );
  });
  return { db: { execute } as unknown as import("@haggle/db").Database, execute };
}

describe("candidate listing seller filter", () => {
  it("demo route excludes sellerless listings from keyword and semantic paths", async () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    generateTextEmbeddingMock.mockResolvedValue([0.1, 0.2]);
    const { db, execute } = makeDb(
      [row("kw-ok", "u1"), row("kw-orphan", null)],
      [
        row("sem-ok", "u1", { semantic_score: "0.9" }),
        row("sem-orphan", null, { semantic_score: "0.95" }),
      ],
    );
    const app = Fastify();
    registerIntelligenceDemoRoutes(app, db);

    const res = await app.inject({
      method: "GET",
      url: "/intelligence/demo/advisor-listings?q=iphone&limit=8",
    });
    const titles = JSON.parse(res.body).listings.map((l: { title: string }) => l.title);

    expect(titles).toEqual(expect.arrayContaining(["iPhone sem-ok", "iPhone kw-ok"]));
    expect(titles).not.toContain("iPhone kw-orphan");
    expect(titles).not.toContain("iPhone sem-orphan");
    expect(execute).toHaveBeenCalledTimes(2);

    await app.close();
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it.each([
    "../services/negotiation-agent-builder-chat.service.ts",
    "../routes/intelligence-demo.ts",
  ])("%s applies the seller filter to both candidate queries", (path) => {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const queries = src.split("JOIN listing_drafts ld ON ld.id = lp.draft_id").slice(1);
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(q.split("LIMIT")[0]).toContain("AND ld.user_id IS NOT NULL");
    }
  });
});
