import { describe, expect, it, vi } from "vitest";
import { EverOSClient } from "../services/everos-client.service.js";

describe("EverOS Client", () => {
  it("posts personal memories to the v1 EverOS endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: "accumulated" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = new EverOSClient({
      baseUrl: "http://localhost:1995",
      apiKey: "test-key",
      fetchImpl,
    });

    await client.addPersonalMemories({
      userId: "user-1",
      sessionId: "session-1",
      messages: [{ role: "system", timestamp: 1, content: "memory" }],
      asyncMode: false,
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://localhost:1995/api/v1/memories");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      user_id: "user-1",
      session_id: "session-1",
      async_mode: false,
    });
  });

  it("searches memories with user filters and hybrid retrieval by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { episodes: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = new EverOSClient({ baseUrl: "https://api.evermind.ai", fetchImpl });

    await client.searchMemories({ userId: "user-1", query: "iphone preference", topK: 5 });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api.evermind.ai/api/v1/memories/search");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      query: "iphone preference",
      filters: { user_id: "user-1" },
      method: "hybrid",
      memory_types: ["profile", "episodic_memory"],
      top_k: 5,
      include_original_data: false,
    });
  });
});
