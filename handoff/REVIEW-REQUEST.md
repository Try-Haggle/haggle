# Review Request — Step 11: Auth Middleware (Supabase JWT)
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

Fastify auth middleware that validates Supabase JWTs and injects `request.user` into requests. Guard helpers (`requireAuth`, `requireAdmin`) applied as preHandlers on mutation routes. Fake `x-haggle-actor-id` header auth removed from payments.ts. All GET routes remain public. Webhooks and cron endpoints left unguarded (they have their own auth mechanisms).

## Files Changed

| File | Lines | Change |
|---|---|---|
| `apps/api/src/middleware/auth.ts` | 1-70 | NEW — Fastify plugin via `fastify-plugin`. Decodes JWT from `Authorization: Bearer` header. Verifies with `SUPABASE_JWT_SECRET` if set; decodes without verification if unset (local dev). Decorates `request.user`. |
| `apps/api/src/middleware/require-auth.ts` | 1-25 | NEW — `requireAuth` (401 if no user) and `requireAdmin` (401/403) preHandler functions. |
| `apps/api/src/server.ts` | 4, 48-49 | MODIFIED — import `authPlugin` + `await app.register(authPlugin)` before route registration. |
| `apps/api/src/routes/payments.ts` | 1-5, 105-116 removed, 205 | MODIFIED — removed `actorFromHeaders`, `actorRoleSchema`. Added `requireAuth` preHandler to all POST routes except webhooks. `/payments/prepare` reads `request.user!.id`. |
| `apps/api/src/routes/intents.ts` | 5, 46, 128 | MODIFIED — `requireAuth` on `POST /intents`, `PATCH /intents/:id/cancel`. `POST /intents/expire` left public. |
| `apps/api/src/routes/tags.ts` | 4, 74, 188, 221 | MODIFIED — `requireAdmin` on `POST /tags/merge`, `POST /tags/:id/promote`, `POST /tags/:id/deprecate`. |
| `apps/api/src/routes/trust.ts` | 4, 56 | MODIFIED — `requireAdmin` on `POST /trust/:actorId/compute`. |
| `apps/api/src/routes/arp.ts` | 4, 73 | MODIFIED — `requireAdmin` on `POST /arp/segments/:id/adjust`. |
| `apps/api/src/routes/skills.ts` | 4, 151, 168, 185, 203 | MODIFIED — `requireAdmin` on activate/suspend/deprecate. `requireAuth` on execute. |
| `apps/api/package.json` | deps, devDeps | MODIFIED — added `jsonwebtoken`, `fastify-plugin`, `@types/jsonwebtoken`. |

## Key Areas to Scrutinize

1. **JWT passthrough logic** (`auth.ts:28-34`) — When `SUPABASE_JWT_SECRET` is unset, `jwt.decode()` is used without verification. This is intentional for local dev but Richard should verify this is acceptable security posture. The `sub` field is still validated.

2. **Actor role hardcoded to "buyer"** (`payments.ts:211`) — `actorFromHeaders` previously read role from a header. Now `actor_role` is hardcoded to `"buyer"` since only buyers call `/payments/prepare`. If sellers need to call this route in future, the role should come from the JWT payload or request body.

3. **Fastify type augmentation** (`auth.ts:34-38`) — `declare module "fastify"` extends `FastifyRequest` with optional `user`. This is project-global — Richard should verify no other module declares the same augmentation.

4. **preHandler array syntax** — All routes use `{ preHandler: [requireAuth] }` (array form). This is correct for Fastify 5 and allows composing multiple preHandlers in future.

5. **Skills lifecycle routes are PATCH not POST** — The brief listed these as `POST /skills/:skillId/activate` etc. but the actual implementation uses `PATCH`. Auth guards applied to the actual `PATCH` handlers.

## Open Questions

1. The `actor_role` in `/payments/prepare` is now hardcoded to `"buyer"`. Should this be derived from JWT `role` or from the request body instead? Current approach is simplest and matches the business logic (only buyers prepare payments).

2. Should `POST /skills` (create skill) also require `requireAdmin`? The brief did not list it but it seems like an admin operation. Left public for now per brief.

## Verification

```
pnpm install                             — 15 packages added (jsonwebtoken, fastify-plugin, @types/jsonwebtoken + transitive deps)
pnpm --filter @haggle/api typecheck      — 0 new errors (pre-existing shipping-core KG-3 errors only)
```
