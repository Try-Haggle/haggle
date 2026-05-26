/**
 * Text-mode LLM caller for the AI Advisor.
 *
 * The main callLLM in xai-client.ts forces JSON response_format,
 * which is unsuitable for natural language advisor responses.
 * This module provides a text-mode variant with the same retry
 * and telemetry patterns.
 */

import { withLLMTelemetry } from "../lib/llm-telemetry.js";

export interface AdvisorLLMResponse {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface XAIChatCompletion {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

const XAI_API_BASE = "https://api.x.ai/v1";
const DEFAULT_RETRY_DELAYS = [1000, 3000];
const DEFAULT_TIMEOUT_MS = 60_000;

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getRetryDelays(): number[] {
  const raw = process.env.XAI_RETRY_DELAYS_MS;
  if (!raw) return DEFAULT_RETRY_DELAYS;
  if (raw.trim() === "0" || raw.trim().toLowerCase() === "none") return [];

  const delays = raw
    .split(",")
    .map((part) => parsePositiveInt(part.trim()))
    .filter((value): value is number => value !== null);

  return delays.length > 0 ? delays : DEFAULT_RETRY_DELAYS;
}

function getTimeoutMs(): number {
  return (
    parsePositiveInt(process.env.XAI_ADVISOR_TIMEOUT_MS) ??
    parsePositiveInt(process.env.XAI_GENERAL_TIMEOUT_MS) ??
    DEFAULT_TIMEOUT_MS
  );
}

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY not configured");
  return key;
}

function getModel(): string {
  return process.env.XAI_MODEL ?? "grok-4-fast";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call xAI API in text mode (no response_format constraint).
 * Supports multi-turn conversation history.
 */
export async function callAdvisorLLM(
  messages: ChatMessage[],
  options: { maxTokens?: number; correlationId?: string } = {},
): Promise<AdvisorLLMResponse> {
  const { maxTokens = 600, correlationId } = options;
  const model = getModel();
  const timeoutMs = getTimeoutMs();
  const retryDelays = getRetryDelays();

  const body = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: maxTokens,
  };

  const doCall = async (): Promise<AdvisorLLMResponse> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const response = await fetchWithTimeout(
          `${XAI_API_BASE}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${getApiKey()}`,
            },
            body: JSON.stringify(body),
          },
          timeoutMs,
        );

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const err = new Error(
            `xAI API error ${response.status}: ${text}`,
          ) as Error & { status: number; retryable: boolean };
          err.status = response.status;
          if (
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429
          ) {
            err.retryable = false;
            throw err;
          }
          err.retryable = true;
          throw err;
        }

        const data = (await response.json()) as XAIChatCompletion;
        const content = data.choices?.[0]?.message?.content ?? "";

        return {
          content,
          usage: {
            prompt_tokens: data.usage?.prompt_tokens ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const retryable = (err as { retryable?: boolean }).retryable;
        if (retryable === false) throw lastError;
        if (lastError.name === "AbortError") {
          lastError = new Error(`xAI API timeout after ${timeoutMs}ms`);
          (lastError as Error & { name: string }).name = "TimeoutError";
        }
        if (attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]!);
        }
      }
    }

    throw lastError ?? new Error("xAI API call failed");
  };

  return withLLMTelemetry(
    {
      service: "xai.chat",
      model,
      operation: "advisor-chat",
      correlationId,
    },
    doCall,
    {
      extractUsage: (result) => ({
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens:
          result.usage.prompt_tokens + result.usage.completion_tokens,
      }),
    },
  );
}
