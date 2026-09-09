# Dogfood Test Login — Source of Truth (T0)

> **Status:** Docs-first product/engineering SoT for **staging/local dogfood auth** (buyer ≠ seller personas). T0 locks the model; follow-on tickets own API/web/MCP wiring.
> **Scope:** Fixed-persona dogfood session mint for R2 buyer≠seller dogfood. Does **not** enable `supabase-jwt` `test_unverified`. Does **not** move real money / Stripe live / PAN.
> **Created:** 2026-09-10 (Eng1 ticket T0)
> **Base:** `origin/staging` @ `8f2de6e`
> **Citations:** [Environment_Separation_Playbook.md](./Environment_Separation_Playbook.md) (`HAGGLE_ENV`); [dispute-ready-order-staging-auth.md](./dispute-ready-order-staging-auth.md) (unsigned local JWTs forbidden on staging); `apps/api/src/services/supabase-jwt.service.ts` (`test_unverified` startup reject on staging/prod)

Prefer this file over older ticket or meeting wording when they conflict on **dogfood login / persona session** behavior.
This document locks **what** to build. It is not a code-change authorization and does **not** deploy or merge itself.

---

## 0. Why this exists (unblocks R2)

R2 dogfood needs **buyer ≠ seller** on staging: one account lists/sells; a **different** account starts/checks out. Sharing a single human Supabase login cannot exercise that path cleanly.

T0 introduces a **dedicated dogfood auth path** with two fixed personas (`dogfood_buyer`, `dogfood_seller`), gated fail-closed by env + secret. Independent of live Stripe / real money.

---

## 1. Environment gate (fail-closed)

Encode exactly:

| Condition | Route / page behavior |
| --- | --- |
| `HAGGLE_ENV` ∈ {`staging`, `local`} **AND** `HAGGLE_DOGFOOD_AUTH_SECRET` set (≥ **32 bytes**) | Dogfood auth route **active** (registered) |
| `HAGGLE_ENV=production` | Route **unregistered** or **404** — fail-closed |
| Secret missing / shorter than 32 bytes (any env) | Route **unregistered** or **404** — fail-closed |
| Prod web build / prod host | `/dogfood-login` → **404** |

- Secret comparison must be constant-time; never log the secret or minted tokens.
- Do **not** treat “secret present on production” as enablement — production stays dark even if misconfigured with a secret (still prefer unset in prod Railway).

---

## 2. Fixed personas (allowlist only)

Two **fixed** personas. Seed/ensure in DB with **different UUIDs** (stable across staging deploys):

| Persona key | Suggested handle / label | Role in dogfood |
| --- | --- | --- |
| `buyer` → actor `dogfood_buyer` | Dogfood Buyer | **Start negotiation / checkout** |
| `seller` → actor `dogfood_seller` | Dogfood Seller | **Create / own listing** |

Encode exactly:

- **Listing** = seller persona.
- **Start / checkout** = buyer persona.
- **No arbitrary user impersonation** — allowlist these two personas only. Reject any other `persona` value.
- Personas are app accounts (UUID subjects) usable as normal authenticated actors once a dogfood session is minted. They are not Supabase magic-link users and must not require production OAuth.

---

## 3. API: mint short-TTL session

```http
POST /tools/dogfood-auth/session
X-Haggle-Dogfood-Secret: <HAGGLE_DOGFOOD_AUTH_SECRET>
Content-Type: application/json

{"persona":"buyer"|"seller"}
```

### 3.1 Success behavior

- Validates secret (header only; never accept secret in query/body).
- Maps `persona` → fixed UUID allowlist (§2); ensure row exists in DB.
- Issues a **short TTL** session suitable for **web** access (cookie and/or storage as implementers choose — SoT requires short TTL + web-usable session).
- Response **must never echo** the dogfood secret.
- Response may include session metadata needed by the client (e.g. persona, expiry, non-secret session handle) — **never** paste tokens into chat (ops §7).

### 3.2 Fail-closed / errors (illustrative)

| Situation | Expected |
| --- | --- |
| Env gate fails (§1) | Route absent / **404** |
| Missing/wrong secret | **401** / **403** (no secret leak in body) |
| Unknown `persona` | **400** |
| Rate limit exceeded | **429** |

### 3.3 Rate limit

- **Rate limit** this endpoint (per IP and/or per secret fingerprint). Exact numbers are implementer choice; SoT requires a non-unlimited limiter so secret stuffing cannot mint freely.

---

## 4. Web: staging-only login surface

| Surface | Rule |
| --- | --- |
| `/dogfood-login` | Staging (and local) only: pick persona → call API (§3) → set cookie/storage → enter app |
| Settings hidden link (optional) | Same flow; discoverability for dogfooders without bookmarking |
| Production build / prod host | **404** — do not ship the page in prod bundles if avoidable; host must still 404 |

Flow:

1. Open staging web `/dogfood-login` (or Settings hidden link).
2. Choose **Buyer** or **Seller**.
3. Client `POST`s with `X-Haggle-Dogfood-Secret` only where the secret is available to the client layer that is allowed to hold it (prefer server-side BFF proxy on staging so the browser never stores the long-lived secret — implementer detail; SoT requires secret not in chat/logs and not echoed).
4. Store short-TTL session → navigate into app as that persona.

---

## 5. MCP: buyer / seller tokens (same secret)

Document for operators/agents:

- MCP clients may obtain buyer or seller access using the **same** `HAGGLE_DOGFOOD_AUTH_SECRET` and persona allowlist (exact MCP tool name is follow-on; may wrap §3 or a twin issuer).
- Issue **buyer** token for start/checkout dogfood; **seller** token for listing dogfood.
- **Never paste tokens in chat.** Never paste the secret in chat.
- Same fail-closed env gate: no MCP dogfood issuer on production; secret missing → unavailable.

---

## 6. Security rules (encode exactly)

| Rule | Locked |
| --- | --- |
| Allowlist personas only | No arbitrary user impersonation |
| No secret/token in logs | Redact headers `X-Haggle-Dogfood-Secret`, session tokens, Authorization |
| Never echo secret in responses | §3.1 |
| Independent of live Stripe / real money | Dogfood auth ≠ payment; no PAN; no live rails required |
| **Do NOT enable** existing `supabase-jwt` `test_unverified` | Startup already **rejects** `test_unverified` on staging/production (`supabase-jwt.service.ts`). Dogfood is a **new path only** — do not flip `HAGGLE_ALLOW_UNVERIFIED_TEST_JWT` / `HAGGLE_SUPABASE_JWT_MODE=test_unverified` on staging |
| Fail-closed | Production or missing/short secret → unregistered/404 |

---

## 7. Ops

| Item | Rule |
| --- | --- |
| Secret storage | `HAGGLE_DOGFOOD_AUTH_SECRET` lives in **Railway only** (staging; local via private `.env` never committed) |
| Chat / tickets / PRs | **Never** put secret or minted tokens in chat, PR bodies, or screenshots |
| Rotation | Rotate in Railway; invalidate outstanding dogfood sessions on rotate (follow-on may add revoke-all) |
| Prod Railway | Keep secret **unset** on production |

---

## 8. Non-goals / out of scope for T0

| Topic | Note |
| --- | --- |
| Implementing the route/UI/MCP issuer | Follow-on tickets after this SoT |
| Enabling `test_unverified` JWTs on staging | Explicitly forbidden (§6) |
| Real-money onramp / live Stripe | [staging-onramp-test-mode-map.md](./staging-onramp-test-mode-map.md) — orthogonal |
| Fake-money Stage 1 loop | [fake-money-fake-address-e2e-test-plan.md](./fake-money-fake-address-e2e-test-plan.md) — orthogonal; may **use** dogfood personas later |
| Arbitrary admin impersonate-any-user | Not this feature |
| Merge / deploy of this PR | Docs tip only; do not merge/deploy from T0 alone |

---

## 9. Related docs

| Doc | Role |
| --- | --- |
| [Environment_Separation_Playbook.md](./Environment_Separation_Playbook.md) | `HAGGLE_ENV` local/staging/production separation |
| [dispute-ready-order-staging-auth.md](./dispute-ready-order-staging-auth.md) | Staging auth for payment-test; unsigned JWTs forbidden on staging |
| [staging-onramp-test-mode-map.md](./staging-onramp-test-mode-map.md) | Real-money test map — out of scope for dogfood auth |
| [fake-money-fake-address-e2e-test-plan.md](./fake-money-fake-address-e2e-test-plan.md) | Fake-money rehearsal — may consume personas later |
| `apps/api/src/services/supabase-jwt.service.ts` | `test_unverified` rejected on staging/prod — do not reopen |

---

## 10. Decision checklist (encode exactly)

- [x] Active only when `HAGGLE_ENV` ∈ {`staging`,`local`} **AND** `HAGGLE_DOGFOOD_AUTH_SECRET` (≥32 bytes) set
- [x] `HAGGLE_ENV=production` OR secret missing → route unregistered or 404 (fail-closed)
- [x] Two fixed personas: `dogfood_buyer` · `dogfood_seller` (different UUIDs); listing=seller; start/checkout=buyer
- [x] `POST /tools/dogfood-auth/session` + `X-Haggle-Dogfood-Secret` + `{persona:"buyer"|"seller"}` → short TTL web session; never echo secret; rate limit
- [x] Web staging only: `/dogfood-login` (or Settings hidden link); prod build/host → 404
- [x] MCP: document issuing buyer/seller tokens with same secret (**never paste tokens in chat**)
- [x] Security: allowlist only; no secret/token in logs; independent of live Stripe/real money
- [x] Do **not** enable existing `supabase-jwt` `test_unverified` — new path only
- [x] Ops: secret in Railway only; chat never gets secret/token
