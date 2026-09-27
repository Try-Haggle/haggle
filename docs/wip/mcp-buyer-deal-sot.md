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
- **Seller-role snapshot** stores `buyer_requested_strategy` (reservation, target, builder memory — built at `start-buyer-negotiation.service.ts:333-351`) and fulfillment fields, including buyer address when present (`:558-559`; address copy at `negotiation-fulfillment.ts:235-237`). See open item B. No conclusion here.

---

## 2. Decisions (CTO, 2026-09-28)

### M-1 — Cap

The cap is the total the buyer actually pays: **item + shipping + fees + tax**, in integer minor units (cents).

The server enforces it on every agreement path:

- REST accept
- `hnp_accept`
- pipeline `ACCEPT` / `CONFIRM` (includes auto-play)
- settlement creation
- `POST /payments/prepare`

Over the cap → `BUDGET_EXCEEDED`. Zero or negative → **400**. Currency mismatch → **400** (Security criterion). This replaces today's dollar-float `budgetMax` and the silent drop of bad values.

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

Tag Garden, Quick Setup, condition confirmation, and the delivery step cannot be skipped on MCP.

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
| Cap | `negotiation_agent_builder_memory.budgetMax` (dollar float) | Mirror | Total the buyer pays (item + shipping + fees + tax). Integer minor units, `> 0`, currency must match. Maps to the reservation input of the same start service. Bad values are rejected, not dropped (M-1). |
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

### Confirm

- [ ] `AUTO_APPROVE` from MCP → 400. `AUTO_APPROVE` from HNP → 400. No silent ignore.
- [ ] An MCP-started deal does not get an `APPROVED` settlement before the human confirms.
- [ ] An agent token cannot approve payment. Only the human web confirmation can.

### Questions

- [ ] Unanswered question → 409 on `hnp_submit_offer`, REST offers, `hnp_accept`, REST accept, `haggle_create_checkout`, and `POST /payments/prepare`.
- [ ] Play still returns 200 `paused_for_buyer`.
- [ ] Choice answers outside the allowlist are rejected. Free text over the length limit is rejected.
- [ ] Unknown `checkId` → 400.
- [ ] A single fallback answer does not fill every unresolved check.
- [ ] Another user's session → 404 (not 403).
- [ ] MCP builder loads `learned_checks` the same way as the REST builder route.
- [ ] Web ↔ MCP parity on `pendingBuyerQuestions()`: questions the web shows also appear on MCP.

### Untrusted

- [ ] `pause_checks[].ask` and `pause_questions` are marked untrusted.
- [ ] Answering a seller question cannot change the cap or confirm-before-payment.

### Privacy

- [ ] Target, cap, and must-haves are absent from seller responses, messages, errors, and logs.
- [ ] No raw address in logs.

### Search

- [ ] Category and condition allowlists reject unknown values. Price range and sort match §4. Limit is server-capped.
- [ ] Results exclude draft, expired, private, and deleted listings.
- [ ] Results do not include seller floor or strategy.
- [ ] Title and description are separate untrusted fields.

### Address

- [ ] MCP start of a physical carrier listing enforces D1 and D2 (address + successful quote). Digital / no-shipment stays exempt.

---

## 6. Delivery order

1. **#189** merges after QA.
2. This docs PR.
3. **#189** follow-ups.
4. **Stage 1** (MCP start parity + M-1 … M-5 and the general rules).
5. **Stage 2** (MCP search, M-6).

If Security confirms open item A or B, that small PR lands **before** Stage 1.

---

## 7. Open items (pending Security — no conclusion)

**A.** Whether an MCP OAuth token can call REST `POST /payments/prepare` and accept with a forged `buyer_ui_cta` and still pass `terms_hash`. If yes: a separate small PR first rejects MCP tokens on those REST routes by scope. **Status: pending.**

**B.** Whether buyer strategy, memory, or address on the seller-role snapshot (`start-buyer-negotiation.service.ts:558-559`) reaches a seller-side LLM prompt. If yes: a separate PR first. **Status: pending.**

---

## 8. Related docs

- [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md) — D1 / D2
- [saved-address-confirm-sot.md](./saved-address-confirm-sot.md)
- [checkout-full-agreement-sot.md](./checkout-full-agreement-sot.md)
- [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md)
- [haggle-core-platform-protocol-design.md](./haggle-core-platform-protocol-design.md)
- [../engine/SOT.md](../engine/SOT.md) — §5.5, backlog #10
