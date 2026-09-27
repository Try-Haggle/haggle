# MCP Buyer Deal (Personal Agent, Staging) — Source of Truth

> **Status:** SoT (staging) — decided 2026-09-28 by the CTO
> **Owner:** Eng1 (docs); **Scope:** staging only; **Base:** `origin/staging` @ `9f2203d`
> **Goal:** a personal agent (e.g. Grok Bot, Hermes) completes one whole buyer deal over MCP: pass conditions, search, negotiate, pay with human approval, confirm shipping.

This document locks **what** to build. It does not authorize a production deploy.

Prefer this file over older MCP tool-name notes when they conflict on the staging buyer-deal contract. Address and shipping-quote locks stay **D1 / D2** in [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md). Decisions in this file are labeled **M-1 … M-7** so they do not clash with those.

**Principle.** MCP follows the web's required pre-negotiation flow exactly (staging `9f2203d`, web as-is). Haggle adds no MCP-only required items and provides no new defaults beyond the web's.

**외부 에이전트는 MCP 도구만 쓴다 (external agents use MCP tools only).** The official path is the MCP tools (`haggle_start_negotiation`, `haggle_answer_pause`, `haggle_play_next`, `hnp_*`, etc.). The required questions (`pendingBuyerQuestions()`) and the 409 rules apply there. REST called with an MCP token returns **403** `MCP_TOKEN_NOT_ALLOWED` per PR #191 (tip `2e97b13`), including `POST /negotiations/start` and `POST /negotiations/sessions/:id/pause/answer`, so REST cannot bypass those rules. See §7.

---

## 0. Scope and non-goals

**In scope**

- **Stage 1.** MCP start input parity with the web's required pre-negotiation flow, plus the buyer protections in §2 (buyer-set cap, confirm-before-payment, questions, privacy).
- **Stage 2.** MCP search parity with the existing published-listing service. No new search engine.

**Non-goals**

- `AUTO_APPROVE` or any confirm-off mode.
- A new search engine.
- Production.
- Changes to the web checkout flow this round.
- Any required start item the web does not already require.
- Any default the web does not already apply.

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

### Web start: required vs optional (9f2203d)

Required before a web start — exactly these three. MCP requires the same three and nothing else. Item 3 is carrier shipping only; digital / no-shipment stays exempt, as on the web. Optional fields keep the web's defaults and no others.

**Required before a web start**

1. **Agent preset.** `negotiation_agent_preset_id` is required (`apps/api/src/services/start-buyer-negotiation.service.ts:87`). Missing → **400** `INVALID_START_REQUEST` (`:166-170`). The web client says "Pick an agent" (`apps/web/src/components/listing-detail/listing-detail-v2.tsx:579-593`). A preset is enough; no agent creation. MCP today: `agent_id` is optional, and `resolveBuyerPresetId` falls back to the balancer (`apps/api/src/mcp/tools/platform.ts:125-151`). On MCP it is the M-7 required question (no silent balancer).
2. **Seller-required criteria.** **409** `BUYER_CRITERIA_REQUIRED` (`start-buyer-negotiation.service.ts:276-303`, `:607-627`). The web client also blocks (`apps/web/src/app/l/[publicId]/buyer-landing-v2.tsx:157-168`).
3. **Carrier shipping.** Delivery address: **409** `DELIVERY_ADDRESS_REQUIRED` (`apps/api/src/lib/delivery-address-start-gate.ts:28-50`), plus the pre-start shipping quote (`start-buyer-negotiation.service.ts:478-510`). The web client uses `canStartWithFulfillment` (`apps/web/src/components/shipping/pre-negotiation-fulfillment-state.ts:53-61`).

**Optional, with the web's defaults**

- Budget cap = the listing ask. Target = `max(floor, ask × 0.9)` (`start-buyer-negotiation.service.ts:270-274`). If target is greater than or equal to the cap → **400** `INVALID_PRICE_RANGE`.
- Style `balanced`. `control_mode` `auto`. `deadline_hours` 24h (`start-buyer-negotiation.service.ts:261`).
- Tag Garden and Quick Setup are builder-chat questions, not gates.
- Scoped condition confirmation is not a gate (no start check found in the code).

---

## 2. Decisions (CTO, 2026-09-28)

### M-1 — Cap

The buyer sets the cap in conversation with their agent. Haggle inserts no suggested value.

The cap is not required before start. There is no cap question.

Record `cap_source` (`buyer_set` | `default`) in the snapshot.

1. **Buyer-set cap.** Only a buyer-set cap is enforced against the all-in total the buyer pays: **item + shipping + fees + tax**, an integer in minor units. Over that total → `BUDGET_EXCEEDED` on REST accept, `hnp_accept`, pipeline `ACCEPT` / `CONFIRM` (includes auto-play), settlement creation, and `POST /payments/prepare`. The pre-payment agreement summary shows the cap and `cap_source` when the cap is buyer-set. At accept time (REST accept, `hnp_accept`, pipeline `ACCEPT` / `CONFIRM`) the all-in total is compared as an **estimate** (agreed item price + the pre-start shipping quote + disclosed fees + estimated tax); `POST /payments/prepare` blocks again using the **confirmed** total.
2. **Default cap.** When the buyer does not set one, the server fills the cap from the listing ask, as on the web (`start-buyer-negotiation.service.ts:270-274`). A default cap is used only as the item-price negotiation ceiling. It is not enforced against the all-in total. A deal at the ask is not blocked because shipping (or fees, or tax) is added on top.
3. **Rejected.** Option (b), default = ask + the shipping quote, is rejected. That is a new rule the web does not have.
4. A buyer-set cap of zero or negative → **400**. Currency mismatch → **400**.

This replaces today's dollar-float `budgetMax` and the silent drop of bad values (`toMinorOrUndefined`, `start-buyer-negotiation.service.ts:817-821`).

### M-2 — Confirm-before-payment

Confirm-before-payment **cannot be turned off**. `AUTO_APPROVE` from MCP or HNP → **400** (do not ignore it silently).

Every agreement reached through an MCP tool or an agent token, whatever path started the negotiation, does **not** create an auto-`APPROVED` settlement. It waits for human approval. Payment is approved only by the human's web confirmation, never by an agent token. The web checkout flow is unchanged this round. Stage 1's first item (§3; also §6) is this rule on the tool paths: stop `hnp_accept` and `haggle_play_next` / `haggle_play_until` from creating an auto-`APPROVED` settlement via `create_settlement`. Approval only by the human on the web.

### M-3 — Arrival deadline

v1 stores the arrival deadline **optionally** as a **condition** and shows it in the pre-payment agreement summary when it is set. It is not required before start. Nothing more. Engine enforcement is later. It is not `deadline_hours` (that remains the negotiation window).

### M-4 — Questions

One shared `pendingBuyerQuestions()` seam, used by the web API and MCP. The function does not exist yet; Stage 1 adds it. Do not fork a second question list.

`pendingBuyerQuestions()` returns exactly the web-required items that apply to this listing — agent preset (M-7), seller-required criteria, and (carrier shipping only) delivery address — plus in-session pause questions. No MCP-only required item.

MCP start returns **409** while any of those that apply is unfilled, with the same question the web shows.

While a required item or an in-session pause question is unanswered, every progress path **except play** returns **409**:

- offer (`hnp_submit_offer`, REST offers)
- accept (`hnp_accept`, REST accept)
- `haggle_create_checkout`
- `POST /payments/prepare`

Play keeps the current paused response: **200** `paused_for_buyer`.

Tag Garden and Quick Setup are builder-chat questions. They are offered, not gates. Scoped condition confirmation is not a gate. MCP builder loads `learned_checks` the same way as `POST /negotiations/agents/builder/chat-turn`, so those builder questions match the web.

Choice answers are checked against the allowlist. Free text has a length limit (do not invent the number here; today's stance max is 2000 at `negotiations.ts:119` and `platform.ts:838-840`). Unknown `checkId` → **400**. Remove the fallback answer that fills every unresolved check at once. Another user's session → **404** (not 403).

Parity test: web-required items and pause questions shown on the web appear on MCP, via `pendingBuyerQuestions()`. No MCP-only required item.

### M-5 — Untrusted seller question text

Seller question text in `pause_checks[].ask` and `pause_questions` is **untrusted**. A test must show that an answer cannot change buyer protections (cap, confirm-before-payment).

### M-6 — Search

Reuse the existing service: price range, condition, sort, and cursor pagination, with the validation in `routes/public-listing.ts`. Category is an allowlist (`LISTING_CATEGORIES`). Server-side page size cap (reuse the existing cap; do not add a second search implementation).

Results never include draft, private, or deleted listings, and never include seller floor or strategy values. Seller-authored text (title, description) is returned in separate fields marked untrusted.

### M-7 — Agent preset on MCP

If MCP start has no preset chosen, the server does **not** silently fill `balancer`. Today `resolveBuyerPresetId` (`apps/api/src/mcp/tools/platform.ts:125-151`) falls back to `DEFAULT_NEGOTIATION_AGENT_PRESET_ID` (`balancer`, `packages/shared/src/agent-presets/types.ts:98`) when `agent_id` is omitted (`platform.ts:130`), unknown (`platform.ts:135`), or a saved agent the caller cannot use (`platform.ts:143`). A usable saved agent whose config does not resolve to a known preset also falls back (`platform.ts:150`).

The preset is a required question in `pendingBuyerQuestions()`. Choices are only the allowed preset ids in `NEGOTIATION_AGENT_PRESETS` (`packages/shared/src/agent-presets/negotiation-agent-presets.ts:26`; today `hunter` `:28`, `closer` `:61`, `verifier` `:94`, `balancer` `:128`). An answer outside that allowlist → **400** (same answer rules as M-4). Only those ids are accepted. An unknown id → **400**. An answer referencing another session or another question → **404**. Changing the preset over MCP cannot bypass the cap or confirm-before-payment.

While that question is unanswered, MCP start returns **409** with the preset question from `pendingBuyerQuestions()` and creates no session. The progress paths return **409**, like the other required items (M-4): offer (`hnp_submit_offer`, REST offers), accept (`hnp_accept`, REST accept), `haggle_create_checkout`, and `POST /payments/prepare`.

This does not conflict with "an external agent needs no web-created Haggle agent." A preset is not a separately created agent (no `haggle_create_agent`, no saved agent row). It is a negotiation-style value that the buyer picks while talking with their own agent. The web also requires the pick (`apps/web/src/components/listing-detail/listing-detail-v2.tsx:579-593`) and the server requires `negotiation_agent_preset_id` (`apps/api/src/services/start-buyer-negotiation.service.ts:87`), so this is parity, not an MCP-only item.

### General rules

- MCP start scope is `negotiate` (buyer write).
- No raw address in logs.
- Target, cap, and must-haves are buyer-only. They never appear in seller responses, messages, errors, or logs.
- If start ever accepts a saved address id, the server checks that the caller owns it and returns **404** if not. (The start schema has no such id field today: `fulfillment.buyer_address` is a full address, `apps/api/src/lib/negotiation-fulfillment.ts:34-43`.)

---

## 3. Stage 1 contract — MCP start

**First item (M-2; §6).** Stop `hnp_accept` (scope check at `apps/api/src/mcp/tools/index.ts:635`; tool `:627-665`) and `haggle_play_next` / `haggle_play_until` (the pipeline dispatches `negotiation.agreed` at `apps/api/src/negotiation/pipeline/executor.ts:1185`) from creating an auto-`APPROVED` settlement via `create_settlement` (`apps/api/src/lib/action-handlers.ts:22-25` handler, `APPROVED` write at `:47-54`). Approval only by the human on the web.

Passed through to the same start service (`start-buyer-negotiation.service.ts`). No new negotiation logic. Scope: `negotiate`.

MCP field names are the web field names. No MCP-only required item. No default beyond the web's. Cap storage is an integer in minor units, not a dollar float, and bad values are **400** rather than dropped (M-1).

### MCP gaps (implementation targets)

a. **No `fulfillment` on MCP start** (`apps/api/src/mcp/tools/mcp-start-schema.ts:22-41`), so the address gate and the quote are bypassed. Add `fulfillment` with the same schema as the web (`fulfillmentPreferenceSchema` / `buyerShippingAddressSchema`, `apps/api/src/lib/negotiation-fulfillment.ts`). Omitting it, or omitting the address, on a carrier listing does not skip the gate: the server returns **409** `DELIVERY_ADDRESS_REQUIRED`. When the address is present, the pre-start quote runs (`start-buyer-negotiation.service.ts:478-510`).

b. **No path to pass builder memory** (`targetPrice` / `budgetMax` / `style` / `mustHave` / `avoid`) to start. `resolveBuyerPresetId` (`platform.ts:125-151`) resolves only a preset. MCP start accepts the same `negotiation_agent_builder_memory` as the web. When that object is absent, the web defaults apply (cap = listing ask, target = `max(floor, ask × 0.9)`, style `balanced`, `control_mode` `auto`, `deadline_hours` 24h).

c. **No `buyer_control_mode`.** Add the same field as the web (`start-buyer-negotiation.service.ts:122`).

d. **`pendingBuyerQuestions()`** reflects exactly the three web-required items in §1 (carrier address only when the web requires it), including the preset question (M-7), plus in-session pause questions. No MCP-only required item.

e. **Remove the silent default in `resolveBuyerPresetId`** (`apps/api/src/mcp/tools/platform.ts:125-151`): no preset → M-7 required question (**409**), not balancer.

f. **Remove `haggle_claim` from the MCP tool list** (`apps/api/src/mcp/tools/index.ts:743-805`; §8 decision, option (b)). Listing claim stays web-only.

| Ticket field | Web field today | MCP field | Rule |
| --- | --- | --- | --- |
| Cap | `negotiation_agent_builder_memory.budgetMax` (dollar float today) | Same field as web | **Optional.** Default = listing ask, as on the web (`start-buyer-negotiation.service.ts:270-274`). `cap_source` = `default`. Used only as the item-price ceiling (M-1). If the buyer sets it: positive integer total in minor units (item + shipping + fees + tax), `cap_source` = `buyer_set`, enforced on the all-in total. Zero or negative → **400**. Currency mismatch → **400**. Pre-payment summary shows the cap and `cap_source` only when buyer-set. |
| Target price | `negotiation_agent_builder_memory.targetPrice` (dollar float) | Same field as web | **Optional.** Web default `max(floor, ask × 0.9)` (`start-buyer-negotiation.service.ts:270-274`). **400** `INVALID_PRICE_RANGE` if target is greater than or equal to the cap. |
| Must-haves | `negotiation_agent_builder_memory.mustHave` / `avoid`, plus `buyerCriteria` | Same as web | **Optional.** Not a start gate. Seller-required criteria remain required (web item 2). |
| Shipping address | `fulfillment` (`fulfillmentPreferenceSchema` / `buyerShippingAddressSchema`, `apps/api/src/lib/negotiation-fulfillment.ts`) | `fulfillment` (same schema) | **Required for carrier** (web item 3). D1 / D2. Missing address → **409** `DELIVERY_ADDRESS_REQUIRED`. Quote runs when the address is present. Digital / no-shipment stays exempt. |
| Arrival deadline | Does not exist. `deadline_hours` is only the negotiation window. | A stored condition, not `deadline_hours` | **Optional.** Not required. Shown on the pre-payment summary when set. No engine enforcement in v1 (M-3). |
| Confirm-before-payment | Not a start field. Accept allows `payment_decision: AUTO_APPROVE`. | Not an input | Always on (M-2). Cannot be turned off. `AUTO_APPROVE` or a confirm-off input → **400**. |
| Agent preset | `negotiation_agent_preset_id` required (`start-buyer-negotiation.service.ts:87`) | Same as web. MCP today: `agent_id` optional; `resolveBuyerPresetId` falls back to the balancer (`platform.ts:125-151`) | **Required** (M-7), as on the web (web item 1). Choices are only the allowed preset ids in `NEGOTIATION_AGENT_PRESETS` (`packages/shared/src/agent-presets/negotiation-agent-presets.ts:26`; today `hunter` `:28`, `closer` `:61`, `verifier` `:94`, `balancer` `:128`). A value outside that allowlist → **400**. Web: missing → **400** `INVALID_START_REQUEST` (`:166-170`). A preset is enough; no agent creation. No silent balancer. `pendingBuyerQuestions()` includes this question, and MCP start returns **409** until it is filled, with the same "Pick an agent" question the web shows (`apps/web/src/components/listing-detail/listing-detail-v2.tsx:579-593`). |

Also in Stage 1, not only on the start body:

- Buyer-set cap block on every path in M-1. Default cap stays an item-price ceiling only. Snapshot stores `cap_source`.
- Unanswered-question gate in M-4 (the three web-required items and in-session pause questions only).
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

- [ ] Buyer-set cap: REST accept, `hnp_accept`, pipeline `ACCEPT` / `CONFIRM` (including auto-play), settlement creation, and `POST /payments/prepare` reject an all-in total over the cap with `BUDGET_EXCEEDED`. Shipping, fees, and tax count toward that total.
- [ ] Accept compares the estimated all-in total; `POST /payments/prepare` re-checks the confirmed total and returns `BUDGET_EXCEEDED` if it is over the buyer-set cap.
- [ ] Default cap (listing ask): item-price negotiation ceiling only. A deal at the ask plus shipping is **not** blocked. No all-in enforcement.
- [ ] The snapshot records `cap_source` (`buyer_set` | `default`).
- [ ] Zero or negative cap → 400. Currency mismatch → 400.
- [ ] The pre-payment agreement summary shows the cap and `cap_source` when the cap is buyer-set.

### Confirm

- [ ] `AUTO_APPROVE` from MCP → 400. `AUTO_APPROVE` from HNP → 400. No silent ignore.
- [ ] An agreement reached through an MCP tool or an agent token (whatever path started it) does not get an `APPROVED` settlement before the human confirms.
- [ ] An agent token cannot approve payment. Only the human web confirmation can.
- [ ] Accept `transaction_signals` `AUTO_APPROVE` and `settled` are discarded (per Security review 2026-09-28, `apps/api/src/hnp/accept-session.ts:440-447`). This is part of M-2.

### Questions

- [ ] MCP start → **409** while any web-required item that applies to this listing is unfilled (the three in §1, including the agent preset as the M-7 question; carrier address only for carrier shipping), with the same question the web shows.
- [ ] While a required item or an in-session pause question is unanswered → 409 on `hnp_submit_offer`, REST offers, `hnp_accept`, REST accept, `haggle_create_checkout`, and `POST /payments/prepare`.
- [ ] Play still returns 200 `paused_for_buyer`.
- [ ] Choice answers outside the allowlist are rejected. Free text over the length limit is rejected.
- [ ] Unknown `checkId` → 400.
- [ ] A single fallback answer does not fill every unresolved check.
- [ ] Another user's session → 404 (not 403).
- [ ] MCP builder loads `learned_checks` the same way as the REST builder route. Tag Garden and Quick Setup match the web and are offered, not gates.
- [ ] Parity on `pendingBuyerQuestions()`: web-required items and pause questions shown on the web appear on MCP. No MCP-only required item.

### Agent preset (M-7)

- [ ] MCP start with no preset → **409** with the preset question from `pendingBuyerQuestions()`; no session; balancer is not filled silently.
- [ ] Choices are exactly the `NEGOTIATION_AGENT_PRESETS` ids (`packages/shared/src/agent-presets/negotiation-agent-presets.ts:26`; today `hunter` `:28`, `closer` `:61`, `verifier` `:94`, `balancer` `:128`). A value outside that allowlist → **400**. An unknown id → **400**.
- [ ] An answer referencing another session or another question → **404**.
- [ ] While the preset is unanswered, offer (`hnp_submit_offer`, REST offers), accept (`hnp_accept`, REST accept), `haggle_create_checkout`, and `POST /payments/prepare` → **409**.
- [ ] Preset parity: the web's required preset pick and MCP's `pendingBuyerQuestions()` preset question list the same allowed ids.
- [ ] Changing the preset over MCP does not change or bypass the cap (buyer-set or default) or confirm-before-payment.

### Untrusted

- [ ] `pause_checks[].ask` and `pause_questions` are marked untrusted.
- [ ] Answering a seller question cannot change the cap or confirm-before-payment.

### Privacy

- [ ] Target, cap, and must-haves are absent from seller responses, messages, errors, and logs.
- [ ] No raw address in logs.
- [ ] Seller snapshot has no buyer strategy and no full buyer address (B-h; per Security review 2026-09-28, `apps/api/src/services/start-buyer-negotiation.service.ts:557-559`). `auto_play_context.buyerTargetMinor` is not exposed to the seller (`apps/api/src/services/negotiation-auto-play.service.ts:98`).
- [ ] Seller `GET /settlement-approvals/:id` hides the buyer's full address and criteria before payment. After payment, that GET may show them only as shipping information.
- [ ] If a saved address id is ever accepted at start, another user's id → **404**.

### Search

- [ ] Category and condition allowlists reject unknown values. Price range and sort match §4. Limit is server-capped.
- [ ] Results exclude draft, expired, private, and deleted listings.
- [ ] Results do not include seller floor or strategy.
- [ ] Title and description are separate untrusted fields.

### Stage 1 gaps

- [ ] MCP start accepts `fulfillment` (web schema). A carrier listing with no address → **409** `DELIVERY_ADDRESS_REQUIRED`. With an address, the pre-start quote runs. Digital / no-shipment stays exempt.
- [ ] `negotiation_agent_builder_memory` (`targetPrice`, `budgetMax`, `style`, `mustHave`, `avoid`) is passed through to the start service.
- [ ] `buyer_control_mode` is passed through (same field as the web, `start-buyer-negotiation.service.ts:122`).
- [ ] When builder memory is absent, the web defaults apply: cap = listing ask, target = `max(floor, ask × 0.9)`, style `balanced`, `control_mode` `auto`, `deadline_hours` 24h.
- [ ] `haggle_claim` is not listed in MCP `tools/list`, and calling it over MCP fails (§8).

### MCP token (A1)

- [ ] An MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` on the A1 routes. One shared preHandler, `denyMcpToken`: every REST route that dispatches `negotiation.agreed`, `POST /payments/prepare`, mutating `/payments/:id/*` including authorize, settlement-approvals routes, and listing claim. MCP tool paths stay unchanged.
- [ ] `GET /settlement-approvals/:id` with an MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` (no `terms_hash`, no buyer address).
- [ ] Every REST route that dispatches `negotiation.agreed`, with an MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` (not only PATCH accept).
- [ ] Widened #191 routes: an MCP token → **403** `MCP_TOKEN_NOT_ALLOWED` on confirm-delivery (`POST`, `apps/api/src/routes/orders.ts:180`), OAuth consent (`POST /oauth/consent`, `apps/api/src/routes/mcp-oauth.ts:100`), and the orders, addresses, shipments, disputes, settlement-releases, negotiations, and groups routes.
- [ ] REST `POST /negotiations/start` and pause/answer with an MCP token → **403** `MCP_TOKEN_NOT_ALLOWED`.

### Nonce (A3)

- [ ] The nonce that replaces `buyer_ui_cta` is single-use and bound to the session and the user. A reuse, or a nonce for another session or user, fails. Only a JWT-only route issues it.

---

## 6. Delivery order

1. **#189** merges after QA.
2. **A1** (#191, Eng2) is top priority and runs in parallel. This docs PR is not blocked by it.
3. **A2** (Eng2), right after #191 merge, ahead of #189 follow-ups.
4. **#189** follow-ups.
5. **Eng1 claim-atomicity ticket** (after the #189 follow-up bundle): web `POST /api/claim` / `claimListing` — one conditional update that checks ownership and writes in the same step, then invalidate the used claim token (§8).
6. **Stage 1** (first item: stop the auto-`APPROVED` settlement from `hnp_accept` / `haggle_play_next` / `haggle_play_until` — M-2, §3; then the rest, including A3 and B-h), then **Stage 2**.

---

## 7. Security review results (2026-09-28)

File:line citations in this section are as given, per Security review 2026-09-28.

### A — Confirmed blocker

An MCP OAuth token (listings scope only) can call REST accept, which creates the settlement already `APPROVED` (`apps/api/src/lib/action-handlers.ts:47-54`). `GET /settlement-approvals/:id` then exposes `terms_hash` (`apps/api/src/routes/settlement-approvals.ts:103-108`), and `POST /payments/prepare` with `buyer_ui_cta` passes.

Causes: `apps/api/src/middleware/auth.ts:60-66` falls through to the MCP resolver on every route, with no audience or scope check (`apps/api/src/services/mcp-oauth.service.ts:225-241`). `apps/api/src/middleware/require-auth.ts:7-10` checks only that a user exists. The CTA check is a string compare (`apps/api/src/services/checkout-full-agreement.ts:300-318`), and `terms_hash` is a deterministic sha256 with no nonce.

#### Fix plan

**A1** (Eng2, PR #191, separate small PR, first, top priority). One shared Fastify preHandler, `denyMcpToken`: `tokenKind === "mcp"` → **403** `MCP_TOKEN_NOT_ALLOWED`. Per PR #191 the deny set is wider than the original list. Apply it to:

- every REST route that dispatches `negotiation.agreed` (not only PATCH accept)
- `POST /payments/prepare`
- the mutating `/payments/:id/*` routes, including authorize
- the settlement-approvals routes: `GET /settlement-approvals/:id` (blocks `terms_hash` and buyer address) and the mutating routes
- listing claim
- confirm-delivery (`POST` at `apps/api/src/routes/orders.ts:180`)
- OAuth consent (`POST /oauth/consent`, `apps/api/src/routes/mcp-oauth.ts:100`) (line numbers at PR #191 tip `2e97b13`, the `denyMcpToken` preHandler line; on staging `9f2203d` the routes start at `orders.ts:178` / `mcp-oauth.ts:98`)
- the orders, addresses, shipments, disputes, settlement-releases, negotiations, and groups routes

MCP tool paths are unchanged in A1. This docs PR does not wait on A1 (§6). External agents use MCP tools only (Principle): REST with an MCP token, including `POST /negotiations/start` and `POST /negotiations/sessions/:id/pause/answer`, returns **403** `MCP_TOKEN_NOT_ALLOWED` (PR #191 (tip `2e97b13`)) and cannot bypass `pendingBuyerQuestions()` or the 409 rules.

**A2 = default deny** (Eng2, right after #191 merges, ahead of the #189 follow-ups — §6). MCP tokens get **403** `MCP_TOKEN_NOT_ALLOWED` on all REST outside `/mcp`. The REST allowlist starts **empty**; entries are decided one by one.

- `dispute-ready-order` gets **403** `MCP_TOKEN_NOT_ALLOWED` for MCP tokens even on staging; the tester calls it with a web JWT. This replaces the earlier decision that staging MCP stays allowed there.
- **Principle:** environment-specific exceptions (for example staging-only switches such as `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS` in Residuals) never go into the A2 allowlist.

Per PR #191, `denyMcpToken` is also added to: settlement-releases buyer-confirm, `POST` / `DELETE /wallets`, complete-test-buffer, shipments event, reviewer vote.

Payout wallet selection (primary-only; block payout if none) is a separate follow-up ticket (Eng2).

**A3** (later, Stage 1). Replace the `buyer_ui_cta` string with a one-time nonce bound to the session and the user, issued by a JWT-only route. This supersedes the old `buyer_ui_cta` forgery-hardening residual. Removing the auto-`APPROVED` settlement for agreements reached through an MCP tool or an agent token, and discarding accept's `transaction_signals` (`AUTO_APPROVE` / `settled`; `apps/api/src/hnp/accept-session.ts:440-447`), are part of implementing **M-2**, not A3.

### B — Passed

The seller LLM (`decide.ts`) does not read `buyer_requested_strategy` or `buyer_shipping_address`. It gets only the buyer's city, state, and zip (`apps/api/src/negotiation/prompts/decide-user-prompt.ts:219-223`).

**B-h** (follow-up hardening, Stage 1): remove buyer strategy and the full address from the seller snapshot (`apps/api/src/services/start-buyer-negotiation.service.ts:557-559`). Limit exposure of `auto_play_context.buyerTargetMinor` (`apps/api/src/services/negotiation-auto-play.service.ts:98`). Clean up the unused path in `apps/api/src/lib/session-reconstructor.ts:114-124`.

**CTO policy:** the buyer's full address and criteria on the seller's `GET` settlement-approvals are exposed only after payment, and only as shipping information.

### Residuals

- Staging `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS` — Eng2 is checking this in A1.
- Nothing enforces `human_confirmation_required` (`agent_wallet` stores false, `apps/api/src/routes/payments.ts:1460`). Adding `agent_wallet` auto-execution later would turn **A** into a real-money path.
- MCP tokens have no audience binding.

---

## 8. `haggle_claim` (MCP) — DECIDED — option (b): blocked for MCP, web-only

`haggle_claim` claims ownership of a published listing (a listing draft). It does not claim a negotiation session, and it is not a guest→account merge. **Decision (CTO, 2026-09-28): option (b).** `haggle_claim` is blocked for MCP; listing claim stays web-only (`POST /api/claim` with a web session). Reasons: a buyer agent does not need it (see "Does an external buyer agent need haggle_claim?"), and the seller side stays on Haggle Auto. Reopening is decided only when external seller agents are discussed again.

### Registration

Registered in `apps/api/src/mcp/tools/index.ts:743-805` (tool name `"haggle_claim"`). Description string at `apps/api/src/mcp/tools/index.ts:745`.

### Input and auth

- **Input:** `claim_token` (`z.string().min(1)`) (`apps/api/src/mcp/tools/index.ts:747`).
- **Auth/scope:** `requireActorWithScope("listings")` (`apps/api/src/mcp/tools/index.ts:750`) — the connected MCP user must hold the `listings` scope.

### Service

`claimListing` (`apps/api/src/services/draft.service.ts:1066-1101`):

- Finds a draft whose `claimToken` matches and whose status is `"published"` (`draft.service.ts:1072-1075`). No such row → `invalid_token`.
- Draft already has a `userId` → `already_claimed` (`draft.service.ts:1081-1083`).
- `claimExpiresAt` has passed → `expired` (`draft.service.ts:1086-1088`).
- Otherwise `UPDATE listing_drafts SET userId = caller, updatedAt` (`draft.service.ts:1091-1097`).

**Side effects:** one DB write that makes the caller the listing's seller/owner. No money, no settlement, and no negotiation-session or deal-state change.

**Note (observation, not a decision):** the `UPDATE` is keyed by draft id only, not `WHERE user_id IS NULL`, so the `already_claimed` check is read-then-write (not atomic). The claim token is not cleared after a successful claim. Both findings also apply to web `POST /api/claim` (same `claimListing`, `apps/api/src/routes/claim.ts:33`). Fix (Eng1 ticket after the #189 follow-up bundle, §6): one conditional update that checks ownership and writes in the same step (e.g. `WHERE id = … AND user_id IS NULL`), then invalidate the used claim token.

### Token source

`publishDraft` mints a 24h claim token only when the draft has no owner (`apps/api/src/services/draft.service.ts:350-355`). Every current publish caller requires an owned draft:

- MCP `haggle_publish_listing` uses `requireOwnedDraft` (`apps/api/src/mcp/tools/index.ts:295` tool, `:318`). An unowned draft is `DRAFT_UNCLAIMED` (`apps/api/src/mcp/tools/platform.ts:191-196`).
- REST `POST /api/drafts/:id/publish` checks `draft.userId === user` (`apps/api/src/routes/drafts.ts:163-172`).
- `createAndPublishOwnedListing` (`apps/api/src/services/draft.service.ts:63`, publish at `:95`).

No live staging publish path was found that mints a new claim token. Legacy rows that already hold tokens were not checked in the DB — **not verified against DB**.

### Relation to buyers

A listing must be claimed (it must have a seller) before a buyer can start. Start returns **409** `LISTING_UNCLAIMED` (`apps/api/src/services/start-buyer-negotiation.service.ts:235-236`). Claiming is a seller-side action.

### REST equivalents

`apps/api/src/routes/claim.ts`:

- `POST /api/claim` (`claim.ts:21`) calls the same `claimListing` (`claim.ts:33`). `requireAuth` only. Maps `invalid_token` → **404**, `expired` → **410**, `already_claimed` → **409** (`claim.ts:36-41`).
- `POST /claim/negotiation-sessions` (`claim.ts:53`) is a different feature: guest-buyer session merge after sign-up. It requires a proof-of-possession per `guest_buyer_id` (`claim.ts:66-73`, **403** `POP_REQUIRED`) and moves `negotiation_sessions.buyer_id` and matching `settlement_approvals.buyer_id` / `terms_snapshot.buyer_id` to the new user, skipping sessions that already have a commerce order (`claim.ts:83-126`). There is no MCP tool for the session merge.

PR #191 (Eng2, A1) blocks both REST claim routes for MCP tokens. Per the §8 decision (option (b)), the MCP tool `haggle_claim` is also blocked for MCP; its removal is a Stage 1 item (§3).

### Does an external buyer agent need `haggle_claim`?

No. The tool claims listing (seller) ownership. The buyer flow never calls it. Buyer MCP needs are start / get / play / `answer_pause` / `hnp_*` / `create_checkout` / `get_order` / `get_shipment`. It matters only for a seller agent linking an unowned published listing, and no live publish path mints new tokens (see Token source). Not verified against DB.

### Options

Kept as history. **Option (b) was chosen** (CTO, 2026-09-28).

| Option | What it would change | Pros | Cons |
| --- | --- | --- | --- |
| **(a) Keep for MCP with constraints** | Keep the `listings` scope. Make the claim atomic (`WHERE user_id IS NULL`). Clear the token after use. Rate-limit. | No behavior change for seller agents. Parity with the ChatGPT-widget seller flow. | Keeps a token-bearer ownership transfer on the MCP surface. Inconsistent with #191 blocking the REST equivalent. |
| **(b) Block for MCP tokens — CHOSEN** | The tool returns an error, as the REST routes do under #191. | Consistent with A1. Smallest attack surface. Buyer flow unaffected. | Any seller-agent flow that relies on it breaks (none found on live publish paths). Needs a web claim path for legacy tokens. |
| **(c) Move to web-only** | Remove the MCP tool. Claim via the web with a JWT session. | Ownership changes only through a human web session. Matches the M-2 "human on the web" spirit. | Removes an MCP capability. Docs and tests for the ChatGPT widget flow must be updated. |

**Status: DECIDED — option (b).** Removal of the MCP tool happens in Stage 1 (§3, tests in §5). The atomic-claim fix is a separate Eng1 ticket (§6).

---

## 9. Related docs

- [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md) — D1 / D2
- [saved-address-confirm-sot.md](./saved-address-confirm-sot.md)
- [checkout-full-agreement-sot.md](./checkout-full-agreement-sot.md)
- [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md)
- [haggle-core-platform-protocol-design.md](./haggle-core-platform-protocol-design.md)
- [../engine/SOT.md](../engine/SOT.md) — §5.5, backlog #10
