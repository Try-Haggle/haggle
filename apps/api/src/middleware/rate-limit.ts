import type { FastifyRequest, FastifyReply } from "fastify";
import type { Database } from "@haggle/db";
import type { ApiRateLimitConfig } from "../lib/api-rate-limit.js";
import { API_GLOBAL_RATE_LIMIT } from "../lib/api-rate-limit.js";
import { consumeApiRateLimit } from "../services/api-rate-limit.service.js";

interface WindowEntry {
  timestamps: number[];
}

class SlidingWindowRateLimiter {
  private store = new Map<string, WindowEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(key: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Evict timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      // Retry after the oldest request expires
      const oldest = entry.timestamps[0];
      const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    entry.timestamps.push(now);
    return { allowed: true, retryAfter: 0 };
  }

  clear(): void {
    this.store.clear();
  }
}

// Tier 1 — Global: 100 req/min per IP
const globalLimiter = new SlidingWindowRateLimiter(API_GLOBAL_RATE_LIMIT, 60_000);

// Tier 2 — Offers: 10 req/min per user (POST /negotiations/sessions/:id/offers)
const offersLimiter = new SlidingWindowRateLimiter(10, 60_000);

// Tier 3 — Payments: 20 req/min per user (POST /payments/*)
const paymentsLimiter = new SlidingWindowRateLimiter(20, 60_000);

export function resetRateLimitsForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("rate limit reset is test-only");
  }
  globalLimiter.clear();
  offersLimiter.clear();
  paymentsLimiter.clear();
}

function getIp(request: FastifyRequest): string {
  // Fastify resolves request.ip through its trustProxy policy. Reading the
  // forwarding header directly lets an untrusted client rotate limiter keys.
  return request.ip || "unknown";
}

function getUserKey(request: FastifyRequest): string {
  return request.user?.id ?? getIp(request);
}

export async function globalRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = getIp(request);
  const result = globalLimiter.isAllowed(key);
  if (!result.allowed) {
    reply
      .code(429)
      .header("Retry-After", String(result.retryAfter))
      .send({ error: "TOO_MANY_REQUESTS", retryAfter: result.retryAfter });
  }
}

export function createGlobalRateLimit(input: {
  db: Database;
  config: ApiRateLimitConfig;
}) {
  if (input.config.mode === "local") return globalRateLimit;
  const hmacSecret = input.config.hmacSecret;
  return async function distributedGlobalRateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (request.url === "/health" || request.url.startsWith("/health?")) {
      return;
    }
    try {
      const result = await consumeApiRateLimit(input.db, {
        scope: "global_ip",
        identity: getIp(request),
        hmacSecret,
      });
      if (!result.allowed) {
        reply
          .code(429)
          .header("Cache-Control", "no-store")
          .header("Retry-After", String(result.retryAfterSeconds))
          .send({
            error: "TOO_MANY_REQUESTS",
            retryAfter: result.retryAfterSeconds,
          });
      }
    } catch {
      request.log.error(
        { event: "api_rate_limit_store_unavailable" },
        "distributed API rate limit unavailable",
      );
      reply
        .code(503)
        .header("Cache-Control", "no-store")
        .send({ error: "RATE_LIMIT_SERVICE_UNAVAILABLE" });
    }
  };
}

export async function offersRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = getUserKey(request);
  const result = offersLimiter.isAllowed(key);
  if (!result.allowed) {
    reply
      .code(429)
      .header("Retry-After", String(result.retryAfter))
      .send({ error: "TOO_MANY_REQUESTS", retryAfter: result.retryAfter });
  }
}

export async function paymentsRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = getUserKey(request);
  const result = paymentsLimiter.isAllowed(key);
  if (!result.allowed) {
    reply
      .code(429)
      .header("Retry-After", String(result.retryAfter))
      .send({ error: "TOO_MANY_REQUESTS", retryAfter: result.retryAfter });
  }
}
