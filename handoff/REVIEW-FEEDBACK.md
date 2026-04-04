# Review Feedback — Step 11
Date: 2026-04-04
Ready for Builder: YES

## Must Fix

None.

## Should Fix

- `auth.ts:25` — `SUPABASE_JWT_SECRET` is read once at module load via `process.env.SUPABASE_JWT_SECRET`. If the env var is set after the module loads (e.g., dotenv loading order), the secret will be stale. For MVP this is fine since dotenv runs before server creation. Log this as a known limitation if env loading order ever changes.

- `auth.ts:60` — Role resolution chain is `payload.role ?? payload.user_metadata?.role ?? payload.app_metadata?.role`. Supabase puts the default role in `payload.role` (typically `"authenticated"`), not the app-level role. In practice, admin roles are usually in `app_metadata.role`. This means `requireAdmin` will see `"authenticated"` instead of `"admin"` for users who have an admin role set in `app_metadata` but also have the default `role` field populated. Bob should verify what field Supabase actually populates for admin users in the Haggle Supabase project. If `payload.role` is always `"authenticated"`, the precedence should be `app_metadata?.role ?? user_metadata?.role ?? payload.role`. Not blocking because the Supabase project is not yet configured with admin roles, but this will bite when it is.

- `intents.ts:149-184` — `POST /intents/:id/match` has no auth guard. The brief does not list it, so Bob followed the brief correctly. However, this is a mutation that creates a match record and transitions intent status. Flagging for awareness — if this is intentional (e.g., system/engine calls it internally), fine. If users can call it directly, it should have `requireAuth` at minimum. Not a code fix — Arch should confirm.

- `tags.ts:265-300` — `POST /tags/:tagId/experts/qualify` has no auth guard. Same situation: not in the brief, Bob followed the brief. But this is a mutation that grants expert qualification status. Flagging for Arch awareness.

## Escalate to Architect

- **Supabase JWT `role` field precedence** — Supabase JWTs include a top-level `role` field that is typically `"authenticated"` for all logged-in users. The actual application role (e.g., `"admin"`) is usually in `app_metadata.role`. The current code at `auth.ts:60` checks `payload.role` first, which will mask the real app role. Arch should confirm the correct field precedence for the Haggle Supabase configuration before admin routes are tested in staging.

- **Unguarded mutation routes** — `POST /intents/:id/match`, `POST /intents/trigger-match`, `POST /tags`, `PATCH /tags/:id`, `POST /tags/:tagId/experts/qualify` are all public mutations. The brief did not list them for guarding, so Bob is spec-compliant. Arch should confirm these are intentionally public (e.g., called by internal services) or add them to a future auth pass.

## Cleared

10 files reviewed against the Step 11 brief.

**auth.ts**: Fastify plugin via `fastify-plugin`. JWT decoded from `Authorization: Bearer` header. When `SUPABASE_JWT_SECRET` is set, `jwt.verify()` validates signature. When unset, `jwt.decode()` passes through for local dev with `sub` field validation. Type augmentation correctly extends `FastifyRequest` with optional `user`. `AuthUser` interface matches the brief. No token = request passes through unauthenticated. Invalid token = 401 `INVALID_TOKEN`. Correct.

**require-auth.ts**: `requireAuth` returns 401 if no `request.user`. `requireAdmin` returns 401 if no user, 403 if role is not `"admin"`. Matches the brief exactly. Clean, minimal.

**server.ts**: `authPlugin` imported and registered (line 50) before all route registrations (lines 59-82). Registration order is correct: CORS, auth, health, then routes. `x-haggle-actor-id` kept in CORS `allowedHeaders` per brief flag for backwards compat.

**payments.ts**: Fake `actorFromHeaders` and `actorRoleSchema` fully removed. No references to `x-haggle-actor-id` or `x-haggle-actor-role` in route logic. `requireAuth` applied to all POST routes: prepare, quote, x402/submit-signature, authorize, settlement-pending, settle, fail, cancel, refund. Webhook routes (`/payments/webhooks/x402`, `/payments/webhooks/stripe`) correctly left unguarded with their own signature verification. GET `/payments/:id` and GET `/payments/:id/x402/requirements` remain public. `request.user!.id` used at line 198 for `actor_id`. `actor_role` hardcoded to `"buyer"` at line 199 — matches Bob's rationale that only buyers call `/payments/prepare`. Non-null assertion is safe because `requireAuth` preHandler guarantees `request.user` exists.

**intents.ts**: `requireAuth` on `POST /intents` (line 47) and `PATCH /intents/:id/cancel` (line 130). `POST /intents/expire` left public (line 234) — correct per brief, cron endpoint. GET routes public. Matches brief.

**tags.ts**: `requireAdmin` on `POST /tags/merge` (line 75), `POST /tags/:id/promote` (line 189), `POST /tags/:id/deprecate` (line 223). GET routes public. Matches brief.

**trust.ts**: `requireAdmin` on `POST /trust/:actorId/compute` (line 59). GET routes public. Matches brief.

**arp.ts**: `requireAdmin` on `POST /arp/segments/:id/adjust` (line 76). GET routes public. Matches brief.

**skills.ts**: `requireAdmin` on PATCH activate (line 153), suspend (line 171), deprecate (line 189). `requireAuth` on POST execute (line 208). Routes are PATCH not POST — Bob flagged this deviation. The actual handlers were already PATCH from Step 9; the brief listed them as POST but the auth guards are applied to the actual handlers. No functional issue. GET routes and POST `/skills` (create) left public per brief.

**package.json**: `jsonwebtoken` ^9.0.0, `fastify-plugin` ^5.0.0 in dependencies. `@types/jsonwebtoken` ^9.0.0 in devDependencies. All three present and correct.

No breaking changes introduced. Unauthenticated requests pass through the auth hook without error. Only routes with explicit `preHandler` guards reject unauthenticated callers.
