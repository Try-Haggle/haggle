import { createClient } from "./supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.tryhaggle.ai";

interface ApiOptions extends RequestInit {
  skipAuth?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message || code);
    this.name = "ApiError";
  }
}

export async function apiClient<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    ...(fetchOptions.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Attach Supabase JWT if available
  if (!skipAuth) {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch {
      // Auth not available — continue without token
    }
  }

  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const res = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || "UNKNOWN_ERROR", body.message);
  }

  // Empty body (e.g. 204 No Content from DELETE) — nothing to parse. Reading
  // text first avoids `res.json()` throwing "Unexpected end of JSON input".
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Convenience methods
export const api = {
  get: <T = unknown>(path: string, opts?: ApiOptions) =>
    apiClient<T>(path, { ...opts, method: "GET" }),

  post: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiClient<T>(path, {
      ...opts,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiClient<T>(path, {
      ...opts,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiClient<T>(path, {
      ...opts,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = unknown>(path: string, opts?: ApiOptions) =>
    apiClient<T>(path, { ...opts, method: "DELETE" }),
};

// ─── Notification API ─────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  eventType: string;
  category: string;
  payload: {
    displayTitle?: string;
    displayLink?: string;
    [key: string]: unknown;
  };
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  [category: string]: { [channel: string]: boolean };
}

export const notificationApi = {
  list: (cursor?: string) =>
    api.get<{ notifications: Notification[]; nextCursor: string | null }>(
      `/api/notifications${cursor ? `?cursor=${cursor}` : ""}`,
    ),

  count: () => api.get<{ count: number }>("/api/notifications/count"),

  markRead: (id: string) => api.patch(`/api/notifications/${id}/read`),

  markAllRead: () => api.patch("/api/notifications/read-all"),

  getPreferences: () =>
    api.get<{ preferences: NotificationPreferences }>("/api/notifications/preferences"),

  updatePreference: (category: string, channel: string, enabled: boolean) =>
    api.put("/api/notifications/preferences", { category, channel, enabled }),
};
