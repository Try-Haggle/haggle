# MCP Buyer Deal (Personal Agent, Staging) — Source of Truth

> **Status:** SoT (staging) — decided 2026-09-28 by the CTO
> **Owner:** Eng1 (docs); **Scope:** staging only; **Base:** `origin/staging` @ `9f2203d`
> **Goal:** a personal agent (e.g. Grok Bot, Hermes) completes one whole buyer deal over MCP: pass conditions, search, negotiate, pay with human approval, confirm shipping.

This document locks **what** to build. It does not authorize a production deploy.

Prefer this file over older MCP tool-name notes when they conflict on the staging buyer-deal contract. Address and shipping-quote locks stay **D1 / D2** in [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md). Decisions in this file are labeled **M-1 … M-6** so they do not clash with those.

---

## 0. Scope and non-goals

**In scope**

- **Stage 1.** MCP start input parity with web, plus the buyer protections in §2 (cap, confirm-before-payment, questions, privacy).
- **Stage 2.** MCP search parity with the existing published-listing service. No new search engine.

**Non-goals**

- `AUTO_APPROVE` or any confirm-off mode.
- A new search engine.
- Production.
- Changes to the web checkout flow this round.

---

## 1. Current state (survey 2026-09-28, `origin/staging` `9f2203d`)

- **MCP start** accepts only `public_id`, `agent_id`, `deadline_hours`, `buyerCriteria` (`apps/api/src/mcp/tools/mcp-start-schema.ts:22-41`). The handler (`apps/api/src/mcp/tools/platform.ts:548-614`) forwards those fields to `parseStartBuyerNegotiationBody` / `startBuyerNegotiation` (`platform.ts:561-573`). Scope on that tool is `negotiate` (`platform.ts:556`).
- **`agent_id` resolves only to a preset id** (`resolveBuyerPresetId`, `platform.ts:125-151`). The start body does not load saved agent builder memory (`platform.ts:561-566`).
- **Web start** builds the body in `apps/web/src/app/l/[publicId]/buyer-landing-v2.tsx:171-205` (default). Legacy `buyer-landing.tsx` stays on `?v=1` (`buyer-landing-v2.tsx:42`, `page.tsx:65-70`). That posts to `POST /negotiations/start` (`apps/api/src/routes/negotiations.ts:940`). Server schema: `startBuyerNegotiationSchema` (`apps/api/src/services/start-buyer-negotiation.service.ts:85-123`).
- **Cap today is item-only and soft.** `negotiation_agent_builder_memory.budgetMax` is a dollar float (`start-buyer-negotiation.service.ts:97`). `toMinorOrUndefined` does `Math.round(x * 100)` and **drops** non-finite or `<= 0` values (`:817-821`). The reservation is that minor value, else the listing ask (`:268-270`). The shipping quote is stored separately on the snapshot (`:512-527`). Settlement `finalAmountMinor` is `agreedPriceMinor` (`apps/api/src/lib/action-handlers.ts:52`). Currency on that row is hardcoded `"USD"` (`action-handlers.ts:51`).
- **No server cap check at agreement.** REST `PATCH …/accept` (`negotiations.ts:686-723`) and MCP `hnp_accept` (`apps/api/src/mcp/tools/index.ts:627-665`) both call `applyHnpAccept` (`apps/api/src/hnp/accept-session.ts:148`). The pipeline pins an `ACCEPT` / `CONFIRM` price to the incoming offer (`apps/api/src/negotiation/pipeline/pipeline.ts:263-268`; `isDealClosingAction` is `ACCEPT` or `CONFIRM` at `apps/api/src/negotiation/types.ts:30-32`), including auto-play. Referee HARD does not block (`docs/engine/SOT.md` §5.5, backlog #10 callout at `SOT.md:473` and the #10 row at `:488`).
- **Settlement is created already `APPROVED`**, with buyer and seller approved timestamps (`action-handlers.ts:48-54`). The human gate today is `POST /payments/prepare`: `soft_agreement_ack.source` must be `buyer_ui_cta` (`apps/api/src/routes/payments.ts:2534-2552`; check at `apps/api/src/services/checkout-full-agreement.ts:306-307`; constant `packages/shared/src/constants.ts:41`). `requireAuth` on that route does not look at token kind (`apps/api/src/middleware/require-auth.ts:7-10`).
- **`AUTO_APPROVE`** is an accepted HNP `payment_decision` on accept (`negotiations.ts:132`, `apps/api/src/hnp/accept-session.ts:18`).
- **MCP OAuth tokens authenticate on REST.** A failed first-party JWT verify falls through to the MCP access-token resolver and sets `request.user` (`apps/api/src/middleware/auth.ts:60-66`). `requireAuth` does not inspect `tokenKind` (`require-auth.ts:7-10`). Scopes are enforced inside MCP tools (`apps/api/src/lib/mcp-scopes.ts:10-15`), not on REST routes.
- **Arrival deadline does not exist.** `deadline_hours` is the negotiation window (`start-buyer-negotiation.service.ts:261-265`, default 24h).
- **Address.** `fulfillment.buyer_address` is a caller-supplied address validated by `buyerShippingAddressSchema` (`apps/api/src/lib/negotiation-fulfillment.ts:34-43`). D1/D2 (`start-buyer-negotiation.service.ts:460-510`) run only when a fulfillment body exists. No fulfillment body skips both gates (`apps/api/src/lib/delivery-address-start-gate.ts:11-12` and `:32-33`; `apps/api/src/shipping/shipping-quote-before-start.ts:94-106`). MCP start sends no fulfillment (`platform.ts:561-566`).
- **Questions.** Start rejects missing required answers via `missingRequiredBuyerCriteria` (`start-buyer-negotiation.service.ts:285-302` and `:609-622`; function at `apps/api/src/negotiation/phase/seller-criteria-pause.ts:83-95`). Mid-session play returns **200** `paused_for_buyer` (`apps/api/src/services/execute-auto-play-next.service.ts:246-272`; REST auto-play/next mirrors this at `negotiations.ts:1137-1155`). `hnp_submit_offer` (`index.ts:548-625`), `hnp_accept` (`index.ts:627-665`), REST offers (`negotiations.ts:489-520`), REST accept (`negotiations.ts:685-723`), `haggle_create_checkout` (`platform.ts:965-988`), and `POST /payments/prepare` (`payments.ts:2506-2552`) have **no** unanswered-question gate. The answer path (`platform.ts` `haggle_answer_pause` `:833-915`; REST `negotiations.ts:1362-1479`) does not check a choice allowlist. Unknown `checkId`s are ignored. A single fallback `answer` fills every unresolved check (`seller-criteria-pause.ts:157-188`, applied at `platform.ts:865-869` and `negotiations.ts:1408-1418`). Another user's session: REST **403** `PAUSE_ANSWER_BUYER_ONLY` (`negotiations.ts:1388-1389`); MCP returns the same code as a tool error, not an HTTP status (`platform.ts:849`). MCP `haggle_builder_chat_turn` does not load `learned_checks` (`platform.ts:519-523`). The REST builder route does (`apps/api/src/routes/negotiation-agents.ts:111-128`).
- **Search.** MCP `haggle_search_listings` takes only `q`, `category` (free string), and `limit` 1–40 (`platform.ts:223-241`). `listPublishedListings` already supports `minPrice` / `maxPrice`, `conditions`, sort `newest` | `price_asc` | `price_desc`, and cursor (`apps/api/src/services/draft.service.ts:785`, `:808-890`). It keeps `status = published` and a non-expired selling deadline (`:825-828`). Draft status values are `draft` | `published` | `expired` (`packages/db/src/schema/listing-drafts.ts:5`). The public select omits floor and strategy (`draft.service.ts:799-801`, `:900-910`). REST validation is in `apps/api/src/routes/public-listing.ts`: `SORT_VALUES` `:18`, category allowlist `:58-74`, prices `:85-111` (non-negative, `min <= max`), conditions `:114-131`, cursor `:145-178`, page size cap `:181` (max 100), `nextCursor` `:202-207`.
- **Seller-role snapshot** stores `buyer_requested_strategy` (reservation, target, builder memory — built at `start-buyer-negotiation.service.ts:333-351`) and fulfillment fields, including buyer address when present (`:558-559`; address copy at `negotiation-fulfillment.ts:235-237`). Per Security review 2026-09-28, **B passed**: the seller LLM does not read those fields (§7). **B-h** still removes them from this snapshot.

---

## 2. Decisions (CTO, 2026-09-28)

### M-1 — Cap

The buyer sets the cap by talking with their agent. Haggle inserts no default and no suggested value.

The cap is the total the buyer actually pays: **item + shipping + fees + tax**, a positive integer in minor units (cents).

1. **No cap, no MCP start.** `pendingBuyerQuestions()` returns a `budget_cap` question (**409**). The agent must ask the buyer. The question cannot be skipped. Do not fall back to the listing ask on MCP (today `start-buyer-negotiation.service.ts:268-270` uses the listing ask when `budgetMax` is missing).
2. The answer is that positive integer total. Zero or negative → **400**. Currency mismatch → **400** (Security criterion).
3. Once set, the server enforces it as before. Over the cap → `BUDGET_EXCEEDED` on REST accept, `hnp_accept`, pipeline `ACCEPT` / `CONFIRM` (includes auto-play), settlement creation, and `POST /payments/prepare`.
4. The pre-payment agreement summary shows the cap.

This replaces today's dollar-float `budgetMax` and the silent drop of bad values.

### M-2 — Confirm-before-payment

Confirm-before-payment **cannot be turned off**. `AUTO_APPROVE` from MCP or HNP → **400** (do not ignore it silently).

A deal started over MCP does **not** create an auto-`APPROVED` settlement. It waits for human approval. Payment is approved only by the human's web confirmation, never by an agent token. The web checkout flow is unchanged this round.

### M-3 — Arrival deadline

v1 stores the arrival deadline as a **condition** and shows it in the pre-payment agreement summary. Nothing more. Engine enforcement is later. It is not `deadline_hours` (that remains the negotiation window).

### M-4 — Questions

One shared `pendingBuyerQuestions()` seam, used by the web API and MCP. The function does not exist yet; Stage 1 adds it. Do not fork a second question list.

While any question is unanswered, every progress path **except play** returns **409**:

- offer (`hnp_submit_offer`, REST offers)
- accept (`hnp_accept`, REST accept)
- `haggle_create_checkout`
- `POST /payments/prepare`

Play keeps the current paused response: **200** `paused_for_buyer`.

Tag Garden, Quick Setup, condition confirmation, the delivery step, and the system question `budget_cap` cannot be skipped on MCP. `budget_cap` is not a seller question. If an MCP start has no cap, `pendingBuyerQuestions()` returns it and start is **409** (M-1). The agent must ask the buyer.

MCP builder loads `learned_checks` the same way as `POST /negotiations/agents/builder/chat-turn`, so the questions match the web.

Choice answers are checked against the allowlist. Free text has a length limit (do not invent the number here; today's stance max is 2000 at `negotiations.ts:119` and `platform.ts:838-840`). Unknown `checkId` → **400**. Remove the fallback answer that fills every unresolved check at once. Another user's session → **404** (not 403).

Parity test: questions the web shows also appear on MCP, via `pendingBuyerQuestions()`.

### M-5 — Untrusted seller question text

Seller question text in `pause_checks[].ask` and `pause_questions` is **untrusted**. A test must show that an answer cannot change buyer protections (cap, confirm-before-payment).

### M-6 — Search

Reuse the existing service: price range, condition, sort, and cursor pagination, with the validation in `routes/public-listing.ts`. Category is an allowlist (`LISTING_CATEGORIES`). Server-side page size cap (reuse the existing cap; do not add a second search implementation).

Results never include draft, private, or deleted listings, and never include seller floor or strategy values. Seller-authored text (title, description) is returned in separate fields marked untrusted.

### General rules

- MCP start scope is `negotiate` (buyer write).
- No raw address in logs.
- Target, cap, and must-haves are buyer-only. They never appear in seller responses, messages, errors, or logs.

---

## 3. Stage 1 contract — MCP start

Passed through to the same start service (`start-buyer-negotiation.service.ts`). No new negotiation logic. Any dollar → minor conversion lives at **one** boundary. Scope: `negotiate`.

Exact MCP field names are chosen in the Stage 1 PR. They must **mirror** the web names. This table does not invent them.

| Ticket field | Web field today | MCP field (new) | Rule |
| --- | --- | --- | --- |
| Cap | `negotiation_agent_builder_memory.budgetMax` (dollar float) | Mirror | **Required on MCP.** No default and no suggested value. Missing → **409** `budget_cap` via `pendingBuyerQuestions()`; no session. No listing-ask fallback (today `start-buyer-negotiation.service.ts:268-270`). Positive integer minor units: item + shipping + fees + tax. Zero or negative → **400**. Currency must match. Once set, enforced as M-1. Shown on the pre-payment agreement summary. |
| Target price | `negotiation_agent_builder_memory.targetPrice` (dollar float) | Mirror | Integer minor units, strictly `<` cap. |
| Must-haves | `negotiation_agent_builder_memory.mustHave` and `buyerCriteria` | Mirror | Same meaning as web builder memory `mustHave` plus `buyerCriteria`. |
| Shipping address | `fulfillment.buyer_address`, validated by `buyerShippingAddressSchema` | Mirror | Same schema. **D1 / D2** are required on MCP for physical carrier listings. |
| Arrival deadline | Does not exist. `deadline_hours` is only the negotiation window. | Mirror (a condition, not `deadline_hours`) | Stored as a condition. Shown on the pre-payment summary. No engine enforcement in v1 (M-3). |
| Confirm-before-payment | Not a start field. Accept allows `payment_decision: AUTO_APPROVE`. | Mirror. No confirm-off value. | Default **on**. Cannot be turned off. `AUTO_APPROVE` or a confirm-off input → **400** (M-2). |

Also in Stage 1, not only on the start body:

- Server-side agreement block on every path in M-1.
- Unanswered-question gate in M-4.
- Human approval in M-2 (MCP-started settlement is not created `APPROVED`).

---

## 4. Stage 2 contract — MCP search

Same service as `listPublishedListings`. Validation matches `routes/public-listing.ts`. Do not add a new query engine.

| Param | Rule |
| --- | --- |
| `q` | Same search string as today. |
| `category` | Allowlist = `LISTING_CATEGORIES` (`public-listing.ts:58-74`). Reject unknown values. |
| `minPrice` / `maxPrice` | Non-negative. `minPrice <= maxPrice`. |
| `condition` | `ITEM_CONDITIONS` allowlist (`public-listing.ts:114-131`). |
| `sort` | `newest` \| `price_asc` \| `price_desc` (`public-listing.ts:18`). |
| `cursor` / `nextCursor` | Same cursor shape as `public-listing.ts:145-178` and `:202-207`. |
| `limit` | Server-side page size cap (existing cap at `public-listing.ts:181`). |

Output rules are M-6: no draft, private, or deleted listings; no seller floor or strategy; seller-authored title and description in separate untrusted fields.

---

## 5. Required tests

### Cap

- [ ] REST accept, `hnp_accept`, and pipeline `ACCEPT` / `CONFIRM` (including auto-play) reject a total over the cap with `BUDGET_EXCEEDED`.
- [ ] Settlement creation and `POST /payments/prepare` enforce the same cap.
- [ ] Zero or negative cap → 400. Currency mismatch → 400.
- [ ] Shipping, fees, and tax count toward the total. Item price alone is not the cap.
- [ ] MCP start with no cap → **409** `budget_cap` via `pendingBuyerQuestions()`, and no session.
- [ ] No listing-ask fallback on MCP (today `start-buyer-negotiation.service.ts:268-270`).
- [ ] The pre-payment agreement summary shows the cap.

### Confirm

- [ ] `AUTO_APPROVE` from MCP → 400. `AUTO_APPROVE` from HNP → 400. No silent ignore.
- [ ] An MCP-started deal does not get an `APPROVED` settlement before the human confirms.
- [ ] An agent token cannot approve payment. Only the human web confirmation can.
- [ ] Accept `transaction_signals` `AUTO_APPROVE` and `settled` are discarded (per Security review 2026-09-28, `apps/api/src/hnp/accept-session.ts:440-447`). This is part of M-2.

### Questions

- [ ] Unanswered question → 409 on `hnp_submit_offer`, REST offers, `hnp_accept`, REST accept, `haggle_create_checkout`, and `POST /payments/prepare`.
- [ ] Play still returns 200 `paused_for_buyer`.
- [ ] Choice answers outside the allowlist are rejected. Free text over the length limit is rejected.
- [ ] Unknown `checkId` → 400.
- [ ] A single fallback answer does not fill every unresolved check.
- [ ] Another user's session → 404 (not 403).
- [ ] MCP builder loads `learned_checks` the same way as the REST builder route.
- [ ] Web ↔ MCP parity on `pendingBuyerQuestions()`: questions the web shows also appear on MCP.
- [ ] `budget_cap` is a system question. It cannot be skipped.

### Untrusted

- [ ] `pause_checks[].ask` and `pause_questions` are marked untrusted.
- [ ] Answering a seller question cannot change the cap or confirm-before-payment.

### Privacy

- [ ] Target, cap, and must-haves are absent from seller responses, messages, errors, and logs.
- [ ] No raw address in logs.
- [ ] Seller snapshot has no buyer strategy and no full buyer address (B-h; per Security review 2026-09-28, `apps/api/src/services/start-buyer-negotiation.service.ts:557-559`). `auto_play_context.buyerTargetMinor` is not exposed to the seller (`apps/api/src/services/negotiation-auto-play.service.ts:98`).
- [ ] Seller `GET /settlement-approvals/:id` hides the buyer's full address and criteria before payment. After payment, that GET may show them only as shipping information.

### Search

- [ ] Category and condition allowlists reject unknown values. Price range and sort match §4. Limit is server-capped.
- [ ] Results exclude draft, expired, private, and deleted listings.
- [ ] Results do not include seller floor or strategy.
- [ ] Title and description are separate untrusted fields.

### Address

- [ ] MCP start of a physical carrier listing enforces D1 and D2 (address + successful quote). Digital / no-shipment stays exempt.

### MCP token (A1)

- [ ] An MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` on the A1 routes. One shared preHandler, `denyMcpToken`: every REST route that dispatches `negotiation.agreed`, `POST /payments/prepare`, mutating `/payments/:id/*` including authorize, settlement-approvals routes, and listing claim. MCP tool paths stay unchanged.
- [ ] `GET /settlement-approvals/:id` with an MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` (no `terms_hash`, no buyer address).
- [ ] Every REST route that dispatches `negotiation.agreed`, with an MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` (not only PATCH accept).

### Nonce (A3)

- [ ] The nonce that replaces `buyer_ui_cta` is single-use and bound to the session and the user. A reuse, or a nonce for another session or user, fails. Only a JWT-only route issues it.

---

## 6. Delivery order

1. **#189** merges first after QA.
2. **A1** (Eng2) is top priority and runs in parallel. This docs PR is not blocked by it.
3. **#189** follow-ups.
4. Implementation: **Stage 1** (including A2, A3, M-2, and B-h), then **Stage 2**.

---

## 7. Security review results (2026-09-28)

File:line citations in this section are as given, per Security review 2026-09-28.

### A — Confirmed blocker

An MCP OAuth token (listings scope only) can call REST accept, which creates the settlement already `APPROVED` (`apps/api/src/lib/action-handlers.ts:47-54`). `GET /settlement-approvals/:id` then exposes `terms_hash` (`apps/api/src/routes/settlement-approvals.ts:103-108`), and `POST /payments/prepare` with `buyer_ui_cta` passes.

Causes: `apps/api/src/middleware/auth.ts:60-66` falls through to the MCP resolver on every route, with no audience or scope check (`apps/api/src/services/mcp-oauth.service.ts:225-241`). `apps/api/src/middleware/require-auth.ts:7-10` checks only that a user exists. The CTA check is a string compare (`apps/api/src/services/checkout-full-agreement.ts:300-318`), and `terms_hash` is a deterministic sha256 with no nonce.

#### Fix plan

**A1** (Eng2, separate small PR, first, top priority). One shared Fastify preHandler, `denyMcpToken`: `tokenKind === "mcp"` → **403** `MCP_TOKEN_NOT_ALLOWED`. Apply it to:

- every REST route that dispatches `negotiation.agreed` (not only PATCH accept)
- `POST /payments/prepare`
- the mutating `/payments/:id/*` routes, including authorize
- the settlement-approvals routes: `GET /settlement-approvals/:id` (blocks `terms_hash` and buyer address) and the mutating routes
- listing claim

MCP tool paths are unchanged in A1. This docs PR does not wait on A1 (§6).

**A2** (later, Stage 1). `requireAuth` rejects MCP tokens by default, with an allowlist of permitted routes. Write that allowlist in this doc **before** implementation. The placeholder below is not the allowlist.

**A3** (later, Stage 1). Replace the `buyer_ui_cta` string with a one-time nonce bound to the session and the user, issued by a JWT-only route. This supersedes the old `buyer_ui_cta` forgery-hardening residual. Removing the auto-`APPROVED` settlement for MCP-started deals, and discarding accept's `transaction_signals` (`AUTO_APPROVE` / `settled`; `apps/api/src/hnp/accept-session.ts:440-447`), are part of implementing **M-2**, not A3.

#### A2 MCP-token REST allowlist — TBD

**Not decided.** Do not implement A2 from this list. `haggle_*` / `hnp_*` tools call services directly and may need **no** REST allowlist entry. Candidates below are needs to decide, not permissions.

| Candidate | Why it is listed | Status |
| --- | --- | --- |
| No REST entries | Tools call services in-process (`haggle_*`, `hnp_*`), so the allowlist may be empty | **TBD — not decided** |
| REST reads mirroring `haggle_whoami`, `haggle_search_listings`, `haggle_get_listing`, `haggle_get_negotiation`, `haggle_get_order`, `haggle_get_shipment` | Only if a client calls REST instead of the tool | **TBD — not decided** |
| REST writes mirroring `haggle_start_negotiation`, `haggle_play_next`, `haggle_answer_pause`, `hnp_submit_offer`, `haggle_reject_negotiation`, `haggle_builder_chat_turn` | Same. Tools already call the services | **TBD — not decided** |
| A1 deny set: `negotiation.agreed` REST routes, `POST /payments/prepare`, mutating `/payments/:id/*` (including authorize), `GET /settlement-approvals/:id` and mutating settlement-approvals, and listing claim | Listed so they are not copied onto the allowlist by accident. Whether any of them is ever allowed is a separate decision. MCP tool paths, including `hnp_accept`, are not this row | **TBD — not decided** |

### B — Passed

The seller LLM (`decide.ts`) does not read `buyer_requested_strategy` or `buyer_shipping_address`. It gets only the buyer's city, state, and zip (`apps/api/src/negotiation/prompts/decide-user-prompt.ts:219-223`).

**B-h** (follow-up hardening, Stage 1): remove buyer strategy and the full address from the seller snapshot (`apps/api/src/services/start-buyer-negotiation.service.ts:557-559`). Limit exposure of `auto_play_context.buyerTargetMinor` (`apps/api/src/services/negotiation-auto-play.service.ts:98`). Clean up the unused path in `apps/api/src/lib/session-reconstructor.ts:114-124`.

**CTO policy:** the buyer's full address and criteria on the seller's `GET` settlement-approvals are exposed only after payment, and only as shipping information.

### Residuals

- Staging `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS` — Eng2 is checking this in A1.
- Nothing enforces `human_confirmation_required` (`agent_wallet` stores false, `apps/api/src/routes/payments.ts:1460`). Adding `agent_wallet` auto-execution later would turn **A** into a real-money path.
- MCP tokens have no audience binding.

---

## 8. Related docs

- [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md) — D1 / D2
- [saved-address-confirm-sot.md](./saved-address-confirm-sot.md)
- [checkout-full-agreement-sot.md](./checkout-full-agreement-sot.md)
- [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md)
- [haggle-core-platform-protocol-design.md](./haggle-core-platform-protocol-design.md)
- [../engine/SOT.md](../engine/SOT.md) — §5.5, backlog #10
