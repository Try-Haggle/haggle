/** Buyer chat must not 500 when the session is gone, forbidden, or not a uuid. */

const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNegotiationSessionId(value: string): boolean {
  return SESSION_UUID.test(value.trim());
}

/** serverApi throws `API ${status}: ${path}` for non-OK responses. */
export function isMissingNegotiationSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^API (401|403|404):/.test(error.message);
}

export function shouldRenderNegotiationNotFound(
  sessionId: string,
  error: unknown | null,
  payload: { session?: { id?: string } | null } | null | undefined,
): boolean {
  if (!isNegotiationSessionId(sessionId)) return true;
  if (error && isMissingNegotiationSessionError(error)) return true;
  if (error) return false;
  return !payload?.session?.id;
}
