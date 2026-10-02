/**
 * Retry a read that failed for a reason that usually clears on its own: rate
 * limiting (429), a 5xx, or the network. Anything else (401, 404, a bad
 * request) is thrown straight away.
 *
 * Exists because callers used to turn any failure into an empty result, so a
 * momentary 429 showed "you have no agents" and the next refresh showed them
 * again. Retry first; if it still fails, let the caller show an error, not an
 * empty list.
 */
export async function retryTransient<T>(
  load: () => Promise<T>,
  { attempts = 3, baseDelayMs = 800 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

function isTransient(error: unknown): boolean {
  // Both the browser client (ApiError) and the server client carry `status`.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  // fetch() rejects with a TypeError when the request never got a response.
  return error instanceof TypeError;
}
