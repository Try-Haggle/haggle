import type { FastifyRequest, FastifyReply } from "fastify";

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
}

// Tier 1 — Global: 100 req/min per IP
const globalLimiter = new SlidingWindowRateLimiter(100, 60_000);

// Tier 2 — Offers: 10 req/min per user (POST /negotiations/sessions/:id/offers)
const offersLimiter = new SlidingWindowRateLimiter(10, 60_000);

// Tier 3 — Payments: 20 req/min per user (POST /payments/*)
const paymentsLimiter = new SlidingWindowRateLimiter(20, 60_000);

function getIp(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    request.ip ??
    "unknown"
  );
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
