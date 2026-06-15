/**
 * deepseek-client.ts
 *
 * DeepSeek API HTTP client (OpenAI-compatible).
 * Structured Output (JSON mode) for reliable parsing.
 * Retry with backoff, timeout, telemetry integration.
 */

import { withLLMTelemetry } from '../../lib/llm-telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepSeekCallOptions {
  /** Enable reasoning mode (longer timeout, lower temperature) */
  reasoning?: boolean;
  /** Override max_tokens */
  maxTokens?: number;
  /** Correlation ID for telemetry */
  correlationId?: string;
}

export interface DeepSeekResponse {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
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
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';
const RETRY_DELAYS = [1000, 3000]; // 2 retries: 1s, 3s
const GENERAL_TIMEOUT_MS = 60_000;
const REASONING_TIMEOUT_MS = 90_000;

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not configured');
  return key;
}

function getModel(): string {
  return process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';
}

// ---------------------------------------------------------------------------
// Core fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Call DeepSeek API with structured JSON output.
 * Supports dual mode: general (fast, temp=0.5) and reasoning (deeper, temp=0.3,
 * longer timeout). Retries up to 2 times on transient failures.
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: DeepSeekCallOptions = {},
): Promise<DeepSeekResponse> {
  const { reasoning = false, maxTokens, correlationId } = options;
  const model = getModel();
  const timeoutMs = reasoning ? REASONING_TIMEOUT_MS : GENERAL_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: reasoning ? 0.3 : 0.5,
    ...(maxTokens && { max_tokens: maxTokens }),
  };

  const doCall = async (): Promise<DeepSeekResponse> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const response = await fetchWithTimeout(
          `${DEEPSEEK_API_BASE}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getApiKey()}`,
            },
            body: JSON.stringify(body),
          },
          timeoutMs,
        );

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const err = new Error(`DeepSeek API error ${response.status}: ${text}`) as Error & { status: number; retryable: boolean };
          err.status = response.status;

          // Don't retry on 4xx (except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            err.retryable = false;
            throw err;
          }
          err.retryable = true;
          throw err;
        }

        const data = (await response.json()) as DeepSeekChatCompletion;
        const content = data.choices?.[0]?.message?.content ?? '';

        return {
          content,
          usage: {
            prompt_tokens: data.usage?.prompt_tokens ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
          },
          reasoning_used: reasoning,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Non-retryable errors: throw immediately
        const retryable = (err as { retryable?: boolean }).retryable;
        if (retryable === false) {
          throw lastError;
        }

        // Check if abort (timeout)
        if (lastError.name === 'AbortError') {
          lastError = new Error(`DeepSeek API timeout after ${timeoutMs}ms`);
          (lastError as Error & { name: string }).name = 'TimeoutError';
        }

        // Wait before retry (if retries remaining)
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]!);
        }
      }
    }

    throw lastError ?? new Error('DeepSeek API call failed');
  };

  // Wrap with telemetry
  return withLLMTelemetry(
    {
      service: 'deepseek.chat',
      model,
      operation: 'negotiation-round',
      correlationId,
    },
    doCall,
    {
      extractUsage: (result) => ({
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.prompt_tokens + result.usage.completion_tokens,
      }),
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
