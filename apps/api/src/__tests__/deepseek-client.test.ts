import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callLLM } from "../negotiation/adapters/deepseek-client.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key-123");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro");
  vi.stubEnv("LLM_TELEMETRY", "0");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("callLLM", () => {
  it("returns parsed response on success", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [
        {
          message: { content: '{"action":"COUNTER","price":45000,"reasoning":"test"}' },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await callLLM("system prompt", "user prompt");

    expect(result.content).toBe('{"action":"COUNTER","price":45000,"reasoning":"test"}');
    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(50);
    expect(result.reasoning_used).toBe(false);
    expect(result.finish_reason).toBe("stop");
  });

  it("uses reasoning mode (lower temperature) when flag is set", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [
        {
          message: { content: '{"action":"ACCEPT","reasoning":"reasoning mode"}' },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 100 },
    });

    const result = await callLLM("system", "user", { reasoning: true });

    expect(result.reasoning_used).toBe(true);

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.temperature).toBe(0.3);
  });

  it("uses general mode (default temperature) by default", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [
        {
          message: { content: '{"action":"COUNTER","reasoning":"general"}' },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    await callLLM("system", "user");

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.temperature).toBe(0.5);
  });

  it("sends correct headers", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: {},
    });

    await callLLM("system", "user");

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe("Bearer test-key-123");
    expect(callArgs[1].headers["Content-Type"]).toBe("application/json");
  });

  it("uses structured output (json_object)", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: {},
    });

    await callLLM("system", "user");

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("retries on 500 error then succeeds", async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as unknown as Response;

    const successResponse = {
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [
              {
                message: { content: '{"action":"COUNTER","reasoning":"retry success"}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        ),
    } as unknown as Response;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse);

    const result = await callLLM("system", "user");
    expect(result.content).toContain("retry success");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("throws on 400 error without retrying", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    } as unknown as Response);

    await expect(callLLM("system", "user")).rejects.toThrow("DeepSeek API error 400");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("throws when DEEPSEEK_API_KEY is missing", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    delete process.env.DEEPSEEK_API_KEY;

    globalThis.fetch = mockFetchResponse({});

    await expect(callLLM("system", "user")).rejects.toThrow("DEEPSEEK_API_KEY not configured");
  });

  it("returns empty content when choices array is empty", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });

    const result = await callLLM("system", "user");
    expect(result.content).toBe("");
  });

  it("times out while reading a stalled response body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    } as unknown as Response);

    await expect(callLLM("system", "user", { timeoutMs: 20 })).rejects.toThrow(
      "DeepSeek API timeout after 20ms",
    );
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
