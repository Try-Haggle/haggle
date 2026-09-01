import { getRuntimeConfig } from "../config/runtime.js";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizePublicOrigin(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (!isLoopbackHost(url.hostname) && url.protocol === "http:") {
      url.protocol = "https:";
    }
    return url.origin;
  } catch {
    return trimmed;
  }
}

export function publicApiBaseUrl(request: { protocol: string; hostname: string }): string {
  const configured = process.env.HNP_PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_API_URL?.trim();
  if (configured) return normalizePublicOrigin(configured);

  const haggleEnv = process.env.HAGGLE_ENV?.trim().toLowerCase();
  if (haggleEnv === "staging") return "https://api.staging.tryhaggle.ai";
  if (haggleEnv === "production") return "https://api.tryhaggle.ai";

  const protocol = isLoopbackHost(request.hostname) ? request.protocol : "https";
  return `${protocol}://${request.hostname}`;
}

export function publicAppBaseUrl(): string {
  return getRuntimeConfig().publicAppUrl.replace(/\/+$/, "");
}

export function negotiationChatUrl(sessionId: string): string {
  return `${publicAppBaseUrl()}/buy/negotiations/${sessionId}`;
}

export function checkoutUrl(sessionId: string): string {
  return `${publicAppBaseUrl()}/buy/negotiations/${sessionId}/checkout`;
}

export function connectUrl(query?: string): string {
  const base = `${publicAppBaseUrl()}/connect`;
  return query ? `${base}?${query}` : base;
}

export function signUpUrl(nextPath: string): string {
  return `${publicAppBaseUrl()}/sign-up?next=${encodeURIComponent(nextPath)}`;
}
