# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 11 — Auth Middleware (Supabase JWT)

### Context
All API routes currently have no authentication. Payments route uses fake `x-haggle-actor-id` header. The web app uses Supabase Auth (`@supabase/ssr`). We need a Fastify middleware that validates Supabase JWTs and injects user info into requests.

### Architecture
```
Client → Authorization: Bearer <supabase_jwt> → Fastify → Auth Plugin → route handler
                                                           ↓
                                                  request.user = { id, email, role }
```

### Build Order

#### 1. `apps/api/src/middleware/auth.ts` — Auth plugin

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

export interface AuthUser {
  id: string;          // Supabase user UUID
  email?: string;
  role?: string;       // from user_metadata or app_metadata
}

// Extend Fastify request
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// Verify Supabase JWT
// Supabase JWTs are standard JWTs signed with the project's JWT secret.
// For MVP: decode + verify signature using SUPABASE_JWT_SECRET env var.
// No external library needed — use Node.js crypto + base64 decode.
// OR use jsonwebtoken package (simpler).

async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public routes
    const publicPaths = [
      "/health",
      "/mcp",                  // MCP routes have their own auth
      "/public-listing",       // Public listing pages
    ];
    if (publicPaths.some(p => request.url.startsWith(p))) return;

    // Also skip if no Authorization header (allow unauthenticated access where needed)
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      // No token = unauthenticated request. Route handlers decide if they need auth.
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifySupabaseJwt(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role || payload.user_metadata?.role,
      };
    } catch {
      return reply.code(401).send({ error: "INVALID_TOKEN" });
    }
  });
}

export default fp(authPlugin, { name: "auth" });
```

For JWT verification, two options:
**Option A (recommended for MVP):** Use `jsonwebtoken` package. Simple `jwt.verify(token, secret)`.
**Option B:** Pure Node.js crypto. More code but no dep.

Go with Option A.

#### 2. `apps/api/src/middleware/require-auth.ts` — Guard helper

```ts
import type { FastifyRequest, FastifyReply } from "fastify";

// Use as a preHandler on routes that REQUIRE authentication
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "AUTH_REQUIRED" });
  }
}

// Use for admin-only routes
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "AUTH_REQUIRED" });
  }
  if (request.user.role !== "admin") {
    return reply.code(403).send({ error: "ADMIN_REQUIRED" });
  }
}
```

#### 3. Update `apps/api/src/server.ts`

Register the auth plugin BEFORE route registration:
```ts
import authPlugin from "./middleware/auth.js";
// ...
await app.register(authPlugin);
// Then register routes...
```

#### 4. Update `apps/api/src/routes/payments.ts`

Replace the fake header auth with `request.user`:
```ts
// Before (fake):
const actorId = headers["x-haggle-actor-id"];
const actorRole = headers["x-haggle-actor-role"];

// After (real):
import { requireAuth } from "../middleware/require-auth.js";
// Add preHandler to routes that need auth:
app.post("/payments/prepare", { preHandler: [requireAuth] }, async (request, reply) => {
  const actorId = request.user!.id;
  // ...
});
```

Do NOT add requireAuth to ALL routes. Only to:
- POST /payments/* (all payment mutations)
- PATCH /intents/:id/cancel (user action)
- POST /intents (user action)
- POST /tags/:id/promote, /deprecate, /merge (admin)
- POST /trust/:actorId/compute (admin)
- POST /arp/segments/:id/adjust (admin)
- POST /skills/:skillId/activate, /suspend, /deprecate (admin)
- POST /skills/:skillId/execute

Leave these public (no auth):
- GET routes (read-only for MVP)
- /health
- /mcp/*
- /public-listing/*
- POST /intents/expire (cron, will get separate auth later)

#### 5. Dependencies

Add to `apps/api/package.json`:
```json
"jsonwebtoken": "^9.0.0",
"fastify-plugin": "^5.0.0"
```
Add to devDependencies:
```json
"@types/jsonwebtoken": "^9.0.0"
```

Check if `fastify-plugin` is already a dependency.

### Flags
- Flag: JWT secret comes from `SUPABASE_JWT_SECRET` env var. If not set, auth is effectively disabled (all requests pass through as unauthenticated). This allows local dev without Supabase.
- Flag: Do NOT break existing functionality. If no auth header, request passes through. Routes that need auth use `requireAuth` preHandler.
- Flag: Remove the fake `x-haggle-actor-id` header from payments.ts. Replace with `request.user.id`.
- Flag: Keep `x-haggle-actor-id` in CORS allowedHeaders for backwards compat (MCP might still use it).
- Flag: Read the existing payments.ts carefully — the actor logic is complex with SettlementApproval.

### Definition of Done
- [ ] Auth middleware plugin created
- [ ] requireAuth/requireAdmin guard helpers
- [ ] server.ts registers auth plugin
- [ ] payments.ts uses request.user instead of fake headers
- [ ] Critical mutation routes have requireAuth preHandler
- [ ] GET routes remain public
- [ ] No breaking changes (unauthenticated requests still work for non-guarded routes)

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
