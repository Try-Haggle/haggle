const TRANSIENT_DB_ERROR_CODES = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return (
    (typeof candidate.code === "string" && TRANSIENT_DB_ERROR_CODES.has(candidate.code)) ||
    (typeof candidate.errno === "string" && TRANSIENT_DB_ERROR_CODES.has(candidate.errno))
  );
}

export async function withNegotiationTransientDbRetry<T>(
  operation: () => Promise<T>,
  retryDelayMs = 100,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDbError(error)) throw error;
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    return operation();
  }
}
