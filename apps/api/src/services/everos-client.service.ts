type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type EverOSRetrieveMethod = "keyword" | "vector" | "hybrid" | "agentic";
export type EverOSMemoryType = "episodic_memory" | "profile" | "raw_message" | "agent_memory";

export interface EverOSMessage {
  role: string;
  timestamp: number;
  content: string;
}

export interface EverOSAddPersonalMemoriesInput {
  userId: string;
  sessionId?: string;
  messages: EverOSMessage[];
  asyncMode?: boolean;
}

export interface EverOSSearchMemoriesInput {
  userId: string;
  query: string;
  method?: EverOSRetrieveMethod;
  memoryTypes?: EverOSMemoryType[];
  topK?: number;
  radius?: number;
}

export interface EverOSClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class EverOSClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: EverOSClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.evermind.ai");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error("EVEROS_FETCH_UNAVAILABLE");
    }
  }

  async addPersonalMemories(input: EverOSAddPersonalMemoriesInput): Promise<Record<string, unknown>> {
    return this.request("/api/v1/memories", {
      method: "POST",
      body: {
        user_id: input.userId,
        session_id: input.sessionId,
        async_mode: input.asyncMode ?? true,
        messages: input.messages.slice(0, 500),
      },
    });
  }

  async searchMemories(input: EverOSSearchMemoriesInput): Promise<Record<string, unknown>> {
    return this.request("/api/v1/memories/search", {
      method: "POST",
      body: {
        query: input.query,
        filters: { user_id: input.userId },
        method: input.method ?? "hybrid",
        memory_types: input.memoryTypes ?? ["profile", "episodic_memory"],
        top_k: input.topK ?? 5,
        radius: input.radius,
        include_original_data: false,
      },
    });
  }

  async flushPersonalMemories(input: { userId: string; sessionId?: string }): Promise<Record<string, unknown>> {
    return this.request("/api/v1/memories/flush", {
      method: "POST",
      body: {
        user_id: input.userId,
        session_id: input.sessionId,
      },
    });
  }

  private async request(path: string, input: { method: "POST"; body: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(new URL(path, `${this.baseUrl}/`), {
        method: input.method,
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(stripUndefined(input.body)),
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed = text ? parseJsonObject(text) : {};
      if (!response.ok) {
        throw new Error(`EVEROS_HTTP_${response.status}: ${response.statusText || text.slice(0, 120)}`);
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEverOSClientFromEnv(): EverOSClient | null {
  if (process.env.EVEROS_ENABLED !== "true") return null;

  return new EverOSClient({
    baseUrl: process.env.EVEROS_BASE_URL,
    apiKey: process.env.EVEROS_API_KEY,
    timeoutMs: parsePositiveInt(process.env.EVEROS_TIMEOUT_MS) ?? 3000,
  });
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
