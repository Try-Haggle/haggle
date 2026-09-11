import { getRuntimeConfig } from "../config/runtime.js";

export function publicApiBaseUrl(request: { protocol: string; hostname: string }): string {
  const configured = process.env.HNP_PUBLIC_BASE_URL?.trim() || process.env.PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${request.protocol}://${request.hostname}`;
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
