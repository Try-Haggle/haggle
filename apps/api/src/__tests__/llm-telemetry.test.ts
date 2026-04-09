/**
 * Unit tests for llm-telemetry shim (Step 60).
 *
 * Zero network. Mocks only `console.info` and `process.env.LLM_TELEMETRY`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyLLMError,
  usageExtractors,
  withLLMTelemetry,
} from "../lib/llm-telemetry.js";

const META = {
  service: "openai.chat" as const,
  model: "gpt-4o-mini-2024-07-18",
  operation: "test-op",
  correlationId: "test-corr",
};

function parseLogLine(line: string): Record<string, unknown> {
  const prefix = "[llm-telemetry] ";
  expect(line.startsWith(prefix)).toBe(true);
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>;
}

describe("withLLMTelemetry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the inner result unchanged on success", async () => {
    vi.stubEnv("LLM_TELEMETRY", "1");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const payload = { answer: 42, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };

    const result = await withLLMTelemetry(META, async () => payload);

    expect(result).toBe(payload);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("emits exactly one log line with success=true, latencyMs>=0 and extracted usage", async () => {
    vi.stubEnv("LLM_TELEMETRY", "1");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const payload = {
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    };

    await withLLMTelemetry(META, async () => payload, {
      extractUsage: usageExtractors.openaiChat,
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const record = parseLogLine(infoSpy.mock.calls[0][0] as string);
    expect(record.success).toBe(true);
    expect(record.errorType).toBeNull();
    expect(record.errorMessage).toBeNull();
    expect(typeof record.latencyMs).toBe("number");
    expect(record.latencyMs as number).toBeGreaterThanOrEqual(0);
    expect(record.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    expect(record.service).toBe("openai.chat");
    expect(record.model).toBe("gpt-4o-mini-2024-07-18");
    expect(record.operation).toBe("test-op");
    expect(record.correlationId).toBe("test-corr");
    expect(typeof record.timestamp).toBe("string");
  });

  it("rethrows inner error and emits one log line with success=false and classified errorType", async () => {
    vi.stubEnv("LLM_TELEMETRY", "1");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const inner = new Error("request timed out");

    await expect(
      withLLMTelemetry(META, async () => {
        throw inner;
      }),
    ).rejects.toBe(inner);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const record = parseLogLine(infoSpy.mock.calls[0][0] as string);
    expect(record.success).toBe(false);
    expect(record.errorType).toBe("timeout");
    expect(record.errorMessage).toBe("request timed out");
    expect(record.usage).toBeNull();
  });

  it("does not emit when LLM_TELEMETRY !== '1' but preserves result/throw behavior", async () => {
    vi.stubEnv("LLM_TELEMETRY", "0");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const ok = await withLLMTelemetry(META, async () => "ok");
    expect(ok).toBe("ok");

    const err = new Error("boom");
    await expect(
      withLLMTelemetry(META, async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("swallows telemetry side-effect failures — returns inner result even when console.info throws", async () => {
    vi.stubEnv("LLM_TELEMETRY", "1");
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("boom");
    });

    const result = await withLLMTelemetry(META, async () => "inner-value");
    expect(result).toBe("inner-value");
  });
});

describe("usageExtractors.openaiChat", () => {
  it("extracts prompt/completion/total when present; returns null when usage absent", () => {
    expect(
      usageExtractors.openaiChat({
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    ).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });

    expect(usageExtractors.openaiChat({})).toBeNull();
  });
});

describe("usageExtractors.openaiEmbedding", () => {
  it("returns completionTokens=0 and maps total_tokens; null when usage absent", () => {
    expect(
      usageExtractors.openaiEmbedding({
        usage: { prompt_tokens: 42, total_tokens: 42 },
      }),
    ).toEqual({ promptTokens: 42, completionTokens: 0, totalTokens: 42 });

    expect(usageExtractors.openaiEmbedding({})).toBeNull();
  });
});

describe("classifyLLMError", () => {
  it("maps error shapes into the coarse taxonomy", () => {
    expect(classifyLLMError(new Error("request timed out")).errorType).toBe(
      "timeout",
    );
    expect(
      classifyLLMError({ status: 429, message: "slow down" }).errorType,
    ).toBe("rate_limit");
    expect(
      classifyLLMError({ status: 401, message: "nope" }).errorType,
    ).toBe("auth");
    expect(
      classifyLLMError({ status: 500, message: "oops" }).errorType,
    ).toBe("server_error");
    expect(classifyLLMError(new Error("something weird")).errorType).toBe(
      "unknown",
    );
  });
});
