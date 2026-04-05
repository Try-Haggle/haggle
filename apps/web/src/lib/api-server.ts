import { createClient } from "./supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface ApiServerOptions {
  skipAuth?: boolean;
  method?: string;
  body?: string;
}

async function getAuthHeaders(
  skipAuth?: boolean,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!skipAuth) {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  }

  return headers;
}

export async function apiServer<T = unknown>(
  path: string,
  options: ApiServerOptions = {},
): Promise<T> {
  const headers = await getAuthHeaders(options.skipAuth);

  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

// Convenience methods for server components
export const serverApi = {
  get: <T = unknown>(path: string, opts?: { skipAuth?: boolean }) =>
    apiServer<T>(path, opts),

  post: <T = unknown>(
    path: string,
    body?: unknown,
    opts?: { skipAuth?: boolean },
  ) =>
    apiServer<T>(path, {
      ...opts,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
};

/**
 * Fire-and-forget server-side POST — does not throw on failure.
 * Used for non-critical operations like view tracking.
 */
export function apiServerFireAndForget(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): void {
  const url = `${API_URL}${path}`;
  fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch(() => {
    // Silent fail — non-critical
  });
}
