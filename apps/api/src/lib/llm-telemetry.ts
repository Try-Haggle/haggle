/**
 * LLM Telemetry shim (Step 60 / Step 74-B).
 *
 * Wraps any async LLM / embedding / Replicate call to capture usage,
 * latency, and error shape, emitting a single structured JSON log line
 * and optionally persisting to the llm_telemetry DB table.
 *
 * Design notes:
 *  - Console logging gated by `process.env.LLM_TELEMETRY === "1"`.
 *  - DB logging gated by `process.env.LLM_TELEMETRY === "db"`.
 *    Register a DB instance via `setTelemetryDb()` before use.
 *  - Every telemetry side-effect is wrapped in try/catch. Telemetry must
 *    never alter behavior: inner results are returned unchanged, inner
 *    errors are rethrown unchanged.
 *
 * See handoff/ARCHITECT-BRIEF-step60-62.md §Step 60.
 */

import { llmTelemetry, type Database } from "@haggle/db";

// ─── Module-level DB instance (set via setTelemetryDb) ───
let _telemetryDb: Database | null = null;

/**
 * Register a DB instance for DB-mode telemetry persistence.
 * Call once at app startup when LLM_TELEMETRY=db.
 */
export function setTelemetryDb(db: Database): void {
  _telemetryDb = db;
}

export type LLMService =
  | "openai.chat"
  | "openai.embedding"
  | "replicate.clip"
  | string; // forward-compatible

export interface LLMTelemetryMeta {
  service: LLMService;
  model: string;
  /** Free-form caller tag, e.g. "tag-placement", "listing-embedding". */
  operation: string;
  /** Optional correlation id (listing id, session id, etc). */
  correlationId?: string | null;
  /** Optional session ID for DB telemetry row */
  sessionId?: string | null;
  /** Optional round number for DB telemetry row */
  roundNo?: number | null;
}

export interface LLMTelemetryUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMTelemetryRecord extends LLMTelemetryMeta {
  latencyMs: number;
  success: boolean;
  errorType: string | null;
  errorMessage: string | null;
  usage: LLMTelemetryUsage | null;
  timestamp: string; // ISO8601
}

export type UsageExtractor<T> = (result: T) => LLMTelemetryUsage | null;

export interface WithLLMTelemetryOptions<T> {
  extractUsage?: UsageExtractor<T>;
}

function isEnabled(): boolean {
  return process.env.LLM_TELEMETRY === "1" || process.env.LLM_TELEMETRY === "db";
}

function isDbMode(): boolean {
  return process.env.LLM_TELEMETRY === "db";
}

function emit(record: LLMTelemetryRecord): void {
  try {
    // Single-line JSON prefixed for grep-ability.
    // eslint-disable-next-line no-console
    console.info("[llm-telemetry] " + JSON.stringify(record));
  } catch {
    // Swallow — telemetry must never break the caller.
  }
}

async function emitToDb(record: LLMTelemetryRecord, meta: LLMTelemetryMeta & { sessionId?: string; roundNo?: number }): Promise<void> {
  if (!_telemetryDb) return;
  try {
    // Map operation to a valid stage enum value, defaulting to UNDERSTAND
    const validStages = ["UNDERSTAND", "CONTEXT", "DECIDE", "VALIDATE", "RESPOND", "MEMO_UPDATE"] as const;
    type ValidStage = typeof validStages[number];
    const operationUpper = record.operation.toUpperCase() as ValidStage;
    const stage: ValidStage = validStages.includes(operationUpper) ? operationUpper : "UNDERSTAND";

    await _telemetryDb.insert(llmTelemetry).values({
      sessionId: meta.sessionId ?? null,
      roundNo: meta.roundNo ?? null,
      stage,
      model: record.model,
      inputTokens: record.usage?.promptTokens ?? 0,
      outputTokens: record.usage?.completionTokens ?? 0,
      latencyMs: record.latencyMs,
      costMinor: null,
      reasoningUsed: false,
      error: record.errorMessage ?? null,
    });
  } catch (err) {
    // Non-fatal: log warning and continue
    // eslint-disable-next-line no-console
    console.warn("[llm-telemetry] DB insert failed:", (err as Error).message ?? String(err));
  }
}

/**
 * Classify an error into a coarse bucket. Exported for testability.
 */
export function classifyLLMError(err: unknown): {
  errorType: string;
  errorMessage: string;
} {
  const anyErr = err as
    | { message?: unknown; name?: unknown; status?: unknown }
    | null
    | undefined;
  const message =
    typeof anyErr?.message === "string"
      ? anyErr.message
      : anyErr == null
        ? String(anyErr)
        : (() => {
            try {
              return String(anyErr);
            } catch {
              return "unknown error";
            }
          })();
  const name = typeof anyErr?.name === "string" ? anyErr.name : "";
  const status =
    typeof anyErr?.status === "number" ? anyErr.status : undefined;
  const haystack = `${name} ${message}`;

  let errorType = "unknown";

  if (/timeout|timed out|ETIMEDOUT/i.test(haystack)) {
    errorType = "timeout";
  } else if (status === 429 || /rate.?limit/i.test(haystack)) {
    errorType = "rate_limit";
  } else if (
    status === 401 ||
    /unauthori[sz]ed|invalid.?api.?key/i.test(haystack)
  ) {
    errorType = "auth";
  } else if (/ECONNREFUSED|ENOTFOUND|fetch failed|socket/i.test(haystack)) {
    errorType = "network";
  } else if (status === 400) {
    errorType = "invalid_request";
  } else if (typeof status === "number" && status >= 500) {
    errorType = "server_error";
  }

  return { errorType, errorMessage: message };
}

/**
 * Usage extractors for the three known response shapes.
 */
export const usageExtractors: {
  openaiChat: UsageExtractor<{
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  }>;
  openaiEmbedding: UsageExtractor<{
    usage?: { prompt_tokens?: number; total_tokens?: number };
  }>;
  replicate: UsageExtractor<unknown>;
} = {
  openaiChat: (result) => {
    const usage = result?.usage;
    if (!usage) return null;
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  },
  openaiEmbedding: (result) => {
    const usage = result?.usage;
    if (!usage) return null;
    const promptTokens = usage.prompt_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens;
    return { promptTokens, completionTokens: 0, totalTokens };
  },
  replicate: () => null,
};

/**
 * Wrap an async LLM call. Returns whatever `fn` returned, rethrows
 * whatever `fn` threw. Telemetry is always a side effect.
 */
export async function withLLMTelemetry<T>(
  meta: LLMTelemetryMeta,
  fn: () => Promise<T>,
  options?: WithLLMTelemetryOptions<T>,
): Promise<T> {
  const enabled = isEnabled();
  const dbMode = isDbMode();
  const start = Date.now();

  try {
    const result = await fn();
    if (enabled) {
      let usage: LLMTelemetryUsage | null = null;
      try {
        usage = options?.extractUsage ? options.extractUsage(result) : null;
      } catch {
        usage = null;
      }
      const record: LLMTelemetryRecord = {
        service: meta.service,
        model: meta.model,
        operation: meta.operation,
        correlationId: meta.correlationId ?? null,
        latencyMs: Math.max(0, Date.now() - start),
        success: true,
        errorType: null,
        errorMessage: null,
        usage,
        timestamp: new Date().toISOString(),
      };
      emit(record);
      if (dbMode) {
        void emitToDb(record, {
          ...meta,
          sessionId: meta.sessionId ?? undefined,
          roundNo: meta.roundNo ?? undefined,
        });
      }
    }
    return result;
  } catch (err) {
    if (enabled) {
      let errorType = "unknown";
      let errorMessage = "";
      try {
        const classified = classifyLLMError(err);
        errorType = classified.errorType;
        errorMessage = classified.errorMessage;
      } catch {
        // Swallow classification failures.
      }
      const record: LLMTelemetryRecord = {
        service: meta.service,
        model: meta.model,
        operation: meta.operation,
        correlationId: meta.correlationId ?? null,
        latencyMs: Math.max(0, Date.now() - start),
        success: false,
        errorType,
        errorMessage,
        usage: null,
        timestamp: new Date().toISOString(),
      };
      emit(record);
      if (dbMode) {
        void emitToDb(record, {
          ...meta,
          sessionId: meta.sessionId ?? undefined,
          roundNo: meta.roundNo ?? undefined,
        });
      }
    }
    throw err;
  }
}
