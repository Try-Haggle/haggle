# Staging Onramp checkout test-mode map (A1 / R1)

Date: 2026-09-10 (R1 readiness pass; originally 2026-09-06 A1)
Ticket: CTO A1 map + Eng2 R1 staging Onramp real-path readiness.

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
- **Network pairing:** Stripe Onramp API destinations are `base` (mainnet) only. Staging settlement is pinned to `base-sepolia`. With Stripe **test** keys on `HAGGLE_ENV=staging`, conditional settlement accepts Onramp `base` + settle `base-sepolia` so dogfood can continue; production still requires exact network match. Stage 1 fake-money E2E does **not** exercise this rail.

### Public probe (minimal fingerprint)

`GET https://api.staging.tryhaggle.ai/payments/onramp/status` is **unauthenticated** and intentionally minimal:

- `available` — secret key present (Onramp can be attempted)
- `provider` — `"stripe"`
- `supported_destination` / `supported_source` — product capability
- `pci_note` — Haggle never takes PANs

It does **not** expose `stripe_key_mode`, `test_cards_expected`, `staging_mock_payments_opt_in`, `stripe_mode`, `stripe_mode_real`, `fee_info`, or staging dogfood notes.

### Auth-gated diagnostics (how to verify test vs live)

Use the existing payment-test runtime probe (requires auth):

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://api.staging.tryhaggle.ai/tools/payment-test/runtime
```

Look under `runtime` for:

- `stripe_mode` / `stripe_mode_real`
- `stripe_key_mode` — expect `test` on staging
- `test_cards_expected` — expect `true` when `sk_test_` / `pk_test_` are set
- `staging_mock_payments_opt_in`

Operators can also confirm key prefixes directly in Railway env (never paste secrets into chat/tickets).

### Staging live-key hard gate

When `HAGGLE_ENV=staging` and Stripe keys classify as `live` (`sk_live_` / `pk_live_`):

- Onramp session creation **fail-closes** with `503 STAGING_LIVE_STRIPE_KEYS_FORBIDDEN`
- Applies to `POST /payments/:id/onramp/session`, `createOnrampSession`, and `RealStripeAdapter.authorize`
- Do **not** put live Stripe keys on staging — use `sk_test_` / `pk_test_` only

## 4242 verdict

**Yes — when staging Stripe keys are test/sandbox (`sk_test_` / `pk_test_`).**

| Condition | 4242 in Onramp widget |
| --- | --- |
| `STRIPE_SECRET_KEY=sk_test_…` + `STRIPE_PUBLISHABLE_KEY=pk_test_…` + Onramp available | **Yes** — Stripe Onramp sandbox documents Visa `4242 4242 4242 4242` (OTP `000000`, SSN `000000000`, address line `address_full_match`; keep amount ≤ \$100 in sandbox). |
| Live keys (`sk_live_` / `pk_live_`) on staging | **Hard-blocked** — `503 STAGING_LIVE_STRIPE_KEYS_FORBIDDEN` (no session / no live publishable key to clients). |
| Live keys in production | Real charges only; test cards rejected by Stripe. |
| `STRIPE_SECRET_KEY` unset | **Blocked** — `503 STRIPE_NOT_CONFIGURED`. |
| `STRIPE_MODE≠real` while `requiresRealPaymentProviders()` | **Blocked** — `PAYMENT_RAIL_NOT_CONFIGURED` on Onramp session. |
| Expecting Haggle API to accept raw card numbers | **Blocked by design** — no such API; PCI. |

Haggle never sees the `4242` digits; the tester types them only into Stripe’s hosted/embedded Onramp UI.

## Dogfood steps (tester)

> **Not Stage 1 fake money.** `docs/wip/fake-money-fake-address-e2e-test-plan.md` is mock/test-contract only.
> This checklist is the **real** staging path: Stripe test Onramp (`4242`) → webhook `ONRAMP_FUNDED` → conditional settlement on **base-sepolia** test assets. Do not conflate the two.

1. Confirm public probe is up (minimal):
   `curl -sS https://api.staging.tryhaggle.ai/payments/onramp/status`
   Expect `available=true`, `provider=stripe`, and **no** `stripe_key_mode` / `test_cards_expected` fields.
2. Confirm test-mode diagnostics via auth-gated runtime (or Railway env prefixes):
   `GET /tools/payment-test/runtime` → `stripe_key_mode=test`, `test_cards_expected=true`, `stripe_mode=real`.
   Confirm `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS` is **false** (mock adapter does not drive the embedded Onramp widget).
3. Reach a buyer negotiation session in `ACCEPTED` with settlement approval `APPROVED`.
4. MCP (optional): call `haggle_create_checkout` → open returned `checkout_url` while logged in as buyer. Confirm response has **only** URL + message (no card fields / no PAN).
5. Or open `https://app.staging.tryhaggle.ai/buy/negotiations/{sessionId}/checkout` directly.
6. Choose **card**, connect buyer wallet on the staging settlement network (base-sepolia). That wallet is also the Onramp destination address.
7. Complete Stripe Onramp sandbox KYC/OTP using Stripe’s documented test values; pay with `4242 4242 4242 4242`, any future expiry, any CVC. Keep amount ≤ $100 in sandbox. Haggle never sees the digits.
8. Wait for widget `fulfillment_complete`. Checkout must **not** treat this as order-paid yet — UI continues to the settlement quote step.
9. Confirm staging webhook set `providerContext.stripe_onramp.status = ONRAMP_FUNDED` (UI retries briefly on `STRIPE_ONRAMP_NOT_FUNDED` while the webhook lands).
10. Finish **conditional settlement** funding with staging test USDC/hUSDC on **base-sepolia** (faucet if needed). Stripe Onramp destinations are Base mainnet (`base`) only; staging intentionally allows Onramp `base` + settle `base-sepolia` when Stripe keys are test-mode. Do **not** expect Onramp sandbox to deposit spendable sepolia hUSDC.
11. Confirm wallet `createAndFund` succeeds and payment/order shows settlement funded (not merely onramp session created).

### Dogfood readiness checklist (R1)

- [ ] Public `/payments/onramp/status` → `available=true`, minimal fingerprint only
- [ ] Auth runtime → `stripe_key_mode=test`, `test_cards_expected=true`, `stripe_mode=real`, mock opt-in **false**
- [ ] MCP `haggle_create_checkout` → URL + message only (PCI)
- [ ] Web card path: wallet connect → Onramp session → widget mounts
- [ ] `4242` sandbox completes; webhook → `ONRAMP_FUNDED` (not live keys / not mock rail)
- [ ] UI continues to conditional settlement after Onramp (does not stop at “Payment complete”)
- [ ] Staging network pairing: Onramp `base` + settle `base-sepolia` accepted under test keys
- [ ] Conditional settlement funding confirmed on staging test assets

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

If auth-gated `test_cards_expected` is false on staging (or Onramp returns `STAGING_LIVE_STRIPE_KEYS_FORBIDDEN`):

1. Set `STRIPE_MODE=real`.
2. Set `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` to **test** keys (`sk_test_` / `pk_test_`). Live keys are hard-blocked on staging.
3. Point `STRIPE_WEBHOOK_SECRET` at a staging webhook subscribed to `crypto.onramp_session.fulfillment_complete` (and processing events as needed).
4. Keep `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS=false` for Onramp dogfood.
5. Redeploy API; re-check public `/payments/onramp/status` (`available=true`) and auth-gated `/tools/payment-test/runtime` (`stripe_key_mode=test`).

Do **not** invent any Haggle endpoint that accepts raw card numbers.
Do **not** put key-mode diagnostics back on the public status probe.
