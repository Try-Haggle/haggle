const TOKEN_KEY_PREFIX = "haggle:negotiation-run-token:";

export function storeNegotiationRunToken(sessionId: string, token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(`${TOKEN_KEY_PREFIX}${sessionId}`, token);
}

export function getNegotiationRunToken(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(`${TOKEN_KEY_PREFIX}${sessionId}`);
}

export function clearNegotiationRunToken(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(`${TOKEN_KEY_PREFIX}${sessionId}`);
}
