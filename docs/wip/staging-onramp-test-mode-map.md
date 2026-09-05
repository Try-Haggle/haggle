# Staging Onramp checkout test-mode map (A1)

Date: 2026-09-06  
Ticket: CTO A1 — Map staging `ACCEPTED` → checkout → Stripe Onramp test-mode path.

Stripe here is **Crypto Onramp** (fiat/card → USDC on Base), **not** merchant card capture. Haggle APIs and MCP **never** accept or store card PANs.

## End-to-end path

```
Negotiation ACCEPTED
  → settlement approval APPROVED (buyer)
  → MCP haggle_create_checkout  OR  web /buy/negotiations/{sessionId}/checkout
  → PaymentStep method = "card"
  → Connect buyer wallet (Onramp destination = buyer wallet)
  → POST /payments/{intentId}/onramp/session { destination_wallet }
  → Stripe Crypto Onramp widget (client_secret + publishable key)
  → User enters card inside Stripe UI (4242… only in Stripe test/sandbox keys)
  → Webhook crypto.onramp_session.fulfillment_complete
  → providerContext.stripe_onramp.status = ONRAMP_FUNDED
  → buyer funds conditional settlement with USDC
```

### MCP `haggle_create_checkout` (URL-only)

Source: `apps/api/src/mcp/tools/platform.ts`

- Requires buyer actor + session `ACCEPTED` + settlement approval `APPROVED`.
- Returns JSON only:
  - `checkout_url` → `{PUBLIC_APP_URL}/buy/negotiations/{sessionId}/checkout`
  - `message` telling the buyer to open the URL and complete wallet sign / card on-ramp.
- **Does not** collect cards, wallet signatures, or move money.
- PCI: no PAN fields in MCP schema or response.

### Web checkout

- Route: `apps/web/src/app/buy/negotiations/[sessionId]/checkout/`
- Card rail UI: `payment-step.tsx` → `handleStripeOnramp` → embeds `@stripe/crypto` Onramp session.
- Card digits never touch Haggle; only `client_secret` + `stripe_publishable_key` are returned from the API.

## Railway staging env / flags

Staging policy (playbook): **real code path + Stripe test assets**.

| Variable / flag | Staging dogfood value | Role |
| --- | --- | --- |
| `HAGGLE_ENV` | `staging` | Environment label; with `NODE_ENV=production` keeps real rails unless mock opt-in. |
| `NODE_ENV` | `production` | Staging Railway uses production runtime validation. |
| `STRIPE_MODE` | `real` | Selects `RealStripeAdapter`; production/staging rail gate requires this when mock opt-in is off. |
| `STRIPE_SECRET_KEY` | `sk_test_…` | Enables Onramp session creation (`getStripeConfig().enabled`). |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | Returned to web for `loadStripeOnramp`. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (staging endpoint) | Verifies `crypto.onramp_session.*` webhooks. |
| `HAGGLE_STRIPE_DESTINATION_WALLET` | `0x…` (optional default) | Used by `RealStripeAdapter.authorize()`; checkout Onramp uses **request** `destination_wallet` (buyer). |
| `STRIPE_ONRAMP_DESTINATION_WALLET` | legacy alias in `.env.example` | Prefer `HAGGLE_STRIPE_DESTINATION_WALLET`. |
| `HAGGLE_STRIPE_ONRAMP_FEE_BPS` | `150` default | Buyer-facing Onramp fee in quotes. |
| `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS` | `false` for Onramp dogfood | `true` opts staging into mock providers (`provider-runtime-policy.ts`). Mock adapter does **not** drive the embedded Onramp widget. |
| `PUBLIC_APP_URL` | `https://app.staging.tryhaggle.ai` | Builds MCP `checkout_url`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional on web | Onramp publishable key is primarily returned by the API session response. |

Related (not Stripe Onramp, but checkout often needs them after funding):

- `HAGGLE_X402_MODE=real` + base-sepolia / USDC test assets for conditional settlement after Onramp funds the buyer wallet.
- `HAGGLE_X402_*` wallet maps / fee wallet as documented in `.env.example`.

Probe (no secrets): `GET https://api.staging.tryhaggle.ai/payments/onramp/status`

Fields added for dogfood:

- `stripe_mode` — `mock` \| `real`
- `stripe_key_mode` — `test` \| `live` \| `missing` \| `unknown` (from key prefixes only)
- `test_cards_expected` — `true` when secret key is present and keys look like test mode
- `staging_mock_payments_opt_in`

Observed 2026-09-06 before this PR: staging reported `available: true` (secret key present). After deploy, confirm `stripe_key_mode=test` and `stripe_mode=real`.

## 4242 verdict

**Yes — when staging Stripe keys are test/sandbox (`sk_test_` / `pk_test_`).**

| Condition | 4242 in Onramp widget |
| --- | --- |
| `STRIPE_SECRET_KEY=sk_test_…` + `STRIPE_PUBLISHABLE_KEY=pk_test_…` + Onramp available | **Yes** — Stripe Onramp sandbox documents Visa `4242 4242 4242 4242` (OTP `000000`, SSN `000000000`, address line `address_full_match`; keep amount ≤ \$100 in sandbox). |
| Live keys (`sk_live_` / `pk_live_`) | **No / blocked** — test cards rejected; real charges. |
| `STRIPE_SECRET_KEY` unset | **Blocked** — `503 STRIPE_NOT_CONFIGURED`. |
| `STRIPE_MODE≠real` while `requiresRealPaymentProviders()` | **Blocked** — `PAYMENT_RAIL_NOT_CONFIGURED` on Onramp session. |
| Expecting Haggle API to accept raw card numbers | **Blocked by design** — no such API; PCI. |

Haggle never sees the `4242` digits; the tester types them only into Stripe’s hosted/embedded Onramp UI.

## Dogfood steps (tester)

1. Confirm staging probe:  
   `curl -sS https://api.staging.tryhaggle.ai/payments/onramp/status`  
   Expect `available=true`, `stripe_mode=real`, `stripe_key_mode=test`, `test_cards_expected=true`.
2. Reach a buyer negotiation session in `ACCEPTED` with settlement approval `APPROVED`.
3. MCP (optional): call `haggle_create_checkout` → open returned `checkout_url` while logged in as buyer. Confirm response has **only** URL + message (no card fields).
4. Or open `https://app.staging.tryhaggle.ai/buy/negotiations/{sessionId}/checkout` directly.
5. Choose **card**, connect buyer wallet (destination for USDC).
6. Complete Stripe Onramp sandbox KYC/OTP using Stripe’s documented test values; pay with `4242 4242 4242 4242`, any future expiry, any CVC.
7. Wait for widget `fulfillment_complete` / staging webhook; confirm payment intent provider context shows Onramp funded, then finish conditional settlement funding if prompted.

## Code map (primary files)

| Area | Path |
| --- | --- |
| Onramp session + webhook verify | `apps/api/src/payments/stripe-onramp.ts` |
| Real vs mock adapter selection | `apps/api/src/payments/providers.ts` (`STRIPE_MODE`) |
| Real Onramp adapter | `apps/api/src/payments/real-stripe-adapter.ts` |
| Mock adapter (unit / non-Onramp) | `packages/payment-core/src/mock-stripe-adapter.ts` |
| Checkout + Onramp HTTP | `apps/api/src/routes/payments.ts` |
| Staging mock opt-in gate | `apps/api/src/payments/provider-runtime-policy.ts` |
| Payment test tools (modes surface) | `apps/api/src/routes/payment-test-tools.ts` |
| MCP checkout URL | `apps/api/src/mcp/tools/platform.ts` |
| Checkout URL builder | `apps/api/src/lib/public-urls.ts` |
| Web Onramp embed | `apps/web/src/app/buy/negotiations/[sessionId]/payment-step.tsx` |
| Env separation playbook | `docs/wip/Environment_Separation_Playbook.md` |

## Operator checklist (Railway)

If `test_cards_expected` is false on staging:

1. Set `STRIPE_MODE=real`.
2. Set `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` to **test** keys (never live on staging).
3. Point `STRIPE_WEBHOOK_SECRET` at a staging webhook subscribed to `crypto.onramp_session.fulfillment_complete` (and processing events as needed).
4. Keep `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS=false` for Onramp dogfood.
5. Redeploy API; re-check `/payments/onramp/status`.

Do **not** invent any Haggle endpoint that accepts raw card numbers.
