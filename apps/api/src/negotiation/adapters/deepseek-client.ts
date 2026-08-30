/**
 * deepseek-client.ts
 *
 * DeepSeek API HTTP client (OpenAI-compatible).
 * Structured Output (JSON mode) for reliable parsing.
 * Retry with backoff, timeout, telemetry integration.
 */

import { recordLlmSpend } from "../../lib/llm-cost.js";
import { withLLMTelemetry } from "../../lib/llm-telemetry.js";
import { getDecideTemperature, getDecideTimeoutMs } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepSeekCallOptions {
  /** Sampler temperature. Default 0.5 or DEEPSEEK_TEMPERATURE. Not a reasoning switch. */
  temperature?: number;
  /** Override max_tokens */
  maxTokens?: number;
  /** Correlation ID for telemetry */
  correlationId?: string;
  /** Total deadline for fetch, response body parsing, and retries. */
  timeoutMs?: number;
  /**
   * Override the model for THIS call only (defaults to DEEPSEEK_MODEL). Lets a
   * latency-sensitive path (e.g. the agent builder) A/B a faster model without
   * changing the global negotiation model.
   */
  model?: string;
}

export interface DeepSeekResponse {
  content: string;
  finish_reason?: string | null;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_cache_hit_tokens: number;
    prompt_cache_miss_tokens: number;
  };
  reasoning_used: boolean;
}

interface DeepSeekChatCompletion {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEEPSEEK_API_BASE = "https://api.deepseek.com/v1";
const RETRY_DELAYS = [1000, 3000]; // 2 retries: 1s, 3s

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY not configured");
  return key;
}

function getModel(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
}

// ---------------------------------------------------------------------------
// Core fetch with timeout
// ---------------------------------------------------------------------------

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      const error = new Error(`DeepSeek API timeout after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        const text = await response.text();
        return { response, text };
      })(),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call DeepSeek API with structured JSON output.
 * Temperature is a sampler knob (default 0.5). Timeout default 180s. Retries twice.
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: DeepSeekCallOptions = {},
): Promise<DeepSeekResponse> {
  const { maxTokens, correlationId } = options;
  const model = options.model ?? getModel();
  const apiKey = getApiKey();
  const timeoutMs = getDecideTimeoutMs(options.timeoutMs);
  const temperature = getDecideTemperature(options.temperature);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature,
    ...(maxTokens && { max_tokens: maxTokens }),
  };

  const doCall = async (): Promise<DeepSeekResponse> => {
    let lastError: Error | null = null;
    const deadline = Date.now() + timeoutMs;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          const error = new Error(`DeepSeek API timeout after ${timeoutMs}ms`);
          error.name = "TimeoutError";
          throw error;
        }

        const { response, text } = await fetchTextWithTimeout(
          `${DEEPSEEK_API_BASE}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          },
          remainingMs,
        );

        if (!response.ok) {
          const err = new Error(`DeepSeek API error ${response.status}`) as Error & {
            status: number;
            retryable: boolean;
          };
          err.status = response.status;

          // Don't retry on 4xx (except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            err.retryable = false;
            throw err;
          }
          err.retryable = true;
          throw err;
        }

        const data = JSON.parse(text) as DeepSeekChatCompletion;
        const content = data.choices?.[0]?.message?.content ?? "";
        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;
        const cacheHit =
          data.usage?.prompt_cache_hit_tokens ??
          data.usage?.prompt_tokens_details?.cached_tokens ??
          0;
        const cacheMiss =
          data.usage?.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
        const usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          prompt_cache_hit_tokens: cacheHit,
          prompt_cache_miss_tokens: cacheMiss,
        };
        recordLlmSpend(model, {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cacheHitTokens: cacheHit,
          cacheMissTokens: cacheMiss,
        });

        return {
          content,
          finish_reason: data.choices?.[0]?.finish_reason ?? null,
          usage,
          reasoning_used: false,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Non-retryable errors: throw immediately
        const retryable = (err as { retryable?: boolean }).retryable;
        if (retryable === false) {
          throw lastError;
        }

        // Abort and explicit deadline errors both stop the retry loop.
        if (lastError.name === "AbortError" || lastError.name === "TimeoutError") {
          lastError = new Error(`DeepSeek API timeout after ${timeoutMs}ms`);
          (lastError as Error & { name: string }).name = "TimeoutError";
          break;
        }

        // Wait before retry (if retries remaining)
        if (attempt < RETRY_DELAYS.length) {
          const delayMs = RETRY_DELAYS[attempt]!;
          if (Date.now() + delayMs >= deadline) break;
          await sleep(delayMs);
        }
      }
    }

    throw lastError ?? new Error("DeepSeek API call failed");
  };

  // Wrap with telemetry
  return withLLMTelemetry(
    {
      service: "deepseek.chat",
      model,
      operation: "negotiation-round",
      correlationId,
    },
    doCall,
    {
      extractUsage: (result) => ({
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.prompt_tokens + result.usage.completion_tokens,
        cacheHitTokens: result.usage.prompt_cache_hit_tokens,
        cacheMissTokens: result.usage.prompt_cache_miss_tokens,
      }),
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
