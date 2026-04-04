# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 12 — API Client Utility + Auth Token Injection

### Context
The web app has `API_URL` hardcoded in 6+ files and makes raw `fetch()` calls without auth tokens. We built Supabase JWT auth middleware (Step 11) on the API side, but the frontend never sends the token. This step creates a shared API client that:
1. Centralizes the API base URL
2. Automatically attaches the Supabase JWT to every request
3. Handles common error patterns

### Build Order

#### 1. `apps/web/src/lib/api-client.ts` — Shared API client

```ts
import { createClient } from "./supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface ApiOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiClient<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Attach Supabase JWT if available
  if (!skipAuth) {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
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

  return res.json() as Promise<T>;
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

// Convenience methods
export const api = {
  get: <T = unknown>(path: string, opts?: ApiOptions) =>
    apiClient<T>(path, { ...opts, method: "GET" }),

  post: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiClient<T>(path, { ...opts, method: "POST", body: body ? JSON.stringify(body) : undefined }),

  patch: <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) =>
    apiClient<T>(path, { ...opts, method: "PATCH", body: body ? JSON.stringify(body) : undefined }),

  delete: <T = unknown>(path: string, opts?: ApiOptions) =>
    apiClient<T>(path, { ...opts, method: "DELETE" }),
};
```

#### 2. Update existing pages to use `api` client

Replace raw `fetch` in these files:

**`app/(app)/sell/dashboard/page.tsx`:**
```ts
// Before:
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const res = await fetch(`${API_URL}/api/claim`, { ... });
const res = await fetch(`${API_URL}/api/listings?userId=${user.id}`, { ... });

// After:
import { api } from "@/lib/api-client";
const data = await api.post("/api/claim", { ... });
const data = await api.get(`/api/listings?userId=${user.id}`);
```

Do the same for:
- `app/(app)/buy/dashboard/page.tsx`
- `app/(app)/sell/listings/new/new-listing-wizard.tsx`
- `app/(app)/sell/listings/[id]/page.tsx`
- `app/(app)/settings/settings-content.tsx`
- `app/l/[publicId]/page.tsx` (use `skipAuth: true` for public pages)

**Do NOT change:**
- `app/(marketing)/landing.tsx` — uses relative `/api/waitlist` which is a Next.js API route, not our Fastify API

#### 3. Server-side API client for SSR pages

Some pages fetch data server-side (React Server Components). Those need the server-side Supabase client:

`apps/web/src/lib/api-server.ts`:
```ts
import { createServerClient } from "./supabase/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function apiServer<T = unknown>(path: string): Promise<T> {
  const supabase = await createServerClient();
  const { data: { session } } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const url = `${API_URL}${path}`;
  const res = await fetch(url, { headers, next: { revalidate: 0 } });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}
```

Read `apps/web/src/lib/supabase/server.ts` to understand the server-side Supabase client pattern.

### Flags
- Flag: Read each file BEFORE changing it. The existing fetch calls may have specific headers, error handling, or response parsing that needs to be preserved.
- Flag: Some pages are Server Components (no "use client"). Those use `apiServer`. Client Components use `api`.
- Flag: Check if each page is a Server Component or Client Component before choosing which api client to use.
- Flag: `app/l/[publicId]/page.tsx` is a public listing page — use `skipAuth: true` or `apiServer` without auth.
- Flag: Do NOT change the API paths themselves (e.g., `/api/drafts` stays `/api/drafts`).
- Flag: Preserve existing error handling in each page (toast notifications, error states, etc.)
- Flag: The `@/lib/...` import path should work — check tsconfig paths.

### Definition of Done
- [ ] `lib/api-client.ts` created with `api` convenience methods + auth token injection
- [ ] `lib/api-server.ts` created for SSR pages
- [ ] 6 page files updated to use new api client
- [ ] No hardcoded `API_URL` in page files
- [ ] Auth tokens automatically attached
- [ ] Public pages use skipAuth
- [ ] No breaking changes to existing UI behavior

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
