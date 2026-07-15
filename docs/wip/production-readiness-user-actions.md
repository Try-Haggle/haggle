# Production Readiness - User Action Items

Last updated: 2026-07-14

## Environment

- Set `NODE_ENV=production` in production.
- Use `HAGGLE_SUPABASE_JWT_MODE=jwks` with the production or staging Supabase project URL and audience. Set `SUPABASE_JWT_SECRET` only for the bounded `legacy_hs256` migration mode; do not keep it as the production default.
- Confirm `DATABASE_URL` points to the intended production or staging database.
- Configure `HAGGLE_CORS_ORIGINS` with exact allowed origins only. Add preview URLs explicitly if a trusted preview must call the API.
- Optionally tune `HAGGLE_MAX_JSON_BODY_BYTES`; default is 262144 bytes. Keep it low unless a specific webhook/provider requires more.
- If the API is behind a reverse proxy, set `HAGGLE_TRUSTED_PROXY_CIDRS` to the exact ingress proxy IP/CIDR allowlist. Leave it unset for direct traffic; never use `/0`.
- Set `HAGGLE_API_RATE_LIMIT_MODE=postgres` in staging and production and set one dedicated `HAGGLE_API_RATE_LIMIT_HMAC_SECRET` of at least 32 bytes across every API and cron worker. Do not reuse a payment, webhook, JWT, or database secret.
- Keep `ENABLE_CRON=true` on at least one trusted worker so the hourly 24-hour API rate-limit counter retention runs. Verify the dashboard reports `postgres distributed / retention on` before load testing.
- Verify payment and shipping secrets are present:
  - `HAGGLE_X402_WEBHOOK_SECRET`
  - `HAGGLE_X402_MODE=real` for x402 production payments
  - `STRIPE_MODE=real` if Stripe payments or Stripe onramp deposits are enabled
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_SECRET_KEY`
  - `EASYPOST_API_KEY`
  - `EASYPOST_WEBHOOK_SECRET`
  - `LEGITAPP_API_KEY` if product authentication is enabled
  - `LEGITAPP_WEBHOOK_SECRET` if product authentication is enabled
  - `HAGGLE_DEPOSIT_ESCROW_WALLET`
  - `DEPOSIT_COLLECTION_MODE=usdc` or `DEPOSIT_COLLECTION_MODE=stripe`
  - `REFUND_MODE=usdc` or `REFUND_MODE=stripe`
  - relayer and RPC variables for USDC settlement, deposit collection, and refund flows

## Database

- Back up staging and production databases before applying the production-readiness migration.
- Check and clean existing duplicates before applying unique indexes:
  - more than one active `payment_intents` row for the same `order_id`
  - more than one `payment_settlements` row for the same `payment_intent_id`
  - more than one `settlement_releases` row for the same `order_id`
  - more than one outbound `shipments` row for the same `order_id`
- Apply the latest Drizzle SQL migration after cleanup.
- Confirm migration `0131_api_rate_limit_windows` exists before enabling PostgreSQL API rate limiting.
- Confirm migration `0132_websocket_auth_tickets` exists before deploying the one-time WebSocket handshake flow.

## Provider Configuration

- In Stripe Dashboard, subscribe the API webhook endpoint to `crypto.onramp_session.fulfillment_complete`.
- Confirm Stripe onramp metadata includes:
  - `payment_intent_id=<payment_intent_id>` for order payments
  - `payment_intent_id=deposit_<deposit_id>` for dispute deposits
- Confirm EasyPost webhook endpoint is enabled for tracker updates.
- Confirm the EasyPost account is in the intended live/test mode and the API key matches that mode.
- Confirm the API endpoint `/shipments/webhooks/easypost` is registered in EasyPost with `EASYPOST_WEBHOOK_SECRET`.
- Confirm label purchase works for outbound shipments and buyer-favor return shipments in staging.
- If product authentication is enabled, confirm LegitApp API access and webhook delivery in staging.

## Product Wiring

- Confirm the buyer checkout screen receives an approved `settlement_approval_id` before calling `/payments/prepare`.
- Register buyer and seller wallet addresses before testing x402, Stripe onramp, dispute deposits, and refunds.
- Enter buyer shipping addresses before seller label preparation. Seller label purchase requires buyer and seller addresses plus parcel dimensions.
- Exercise seller dispute escalation deposits in staging for both configured deposit rails (`usdc` or `stripe`).
- For USDC dispute deposits, confirm sellers can approve the returned spender/token/amount and then complete `/deposit/confirm-usdc`.
- Decide the production UX for Stripe crypto-onramp refunds that still require manual processing.
- Keep `/demo/e2e/create-order` and mock-only commerce demos out of production user flows.

## Supabase Authentication

- Set `SUPABASE_URL=https://<project-ref>.supabase.co`, `HAGGLE_SUPABASE_JWT_MODE=jwks`, and `SUPABASE_JWT_AUDIENCE=authenticated` on every staging and production API instance.
- Do not set `HAGGLE_ALLOW_UNVERIFIED_TEST_JWT=true` outside the local test-console process. Startup rejects this mode in staging and production.
- Keep `legacy_hs256` only during a bounded migration window, then remove `SUPABASE_JWT_SECRET` after HTTP, negotiation WebSocket, and notification WebSocket all pass with Supabase ECC tokens.
- Rehearse one normal token, expired token, wrong issuer, wrong audience, unknown `kid` rotation, and JWKS outage in staging. Authentication must fail closed for every invalid or unavailable-key case.
- Rehearse one correctly signed token whose `sub` is not a UUID. Require HTTP 401 before any payment, shipment, dispute, or WebSocket ticket database query.
- Confirm the web client can issue `/auth/websocket-tickets` and connect with the returned `Sec-WebSocket-Protocol`; access tokens must not appear in WebSocket URLs, proxy logs, or browser history.
- Across at least two staging API instances, reuse one ticket concurrently and require one successful upgrade plus HTTP 401 for every replay. Also test wrong negotiation session, wrong channel, expiry, and database outage.
- From an unlisted browser Origin, attempt both notification and negotiation upgrades with otherwise valid tickets. Require HTTP 403 before DB consumption, then reuse the same tickets from the listed staging app Origin and require successful upgrades. Keep non-browser clients without an Origin header only if they are an approved integration.
- Run at least one `ENABLE_CRON=true` worker with migration `0132` applied. Confirm the five-minute `websocket-auth-ticket-retention` job starts immediately, deletes at most 1,000 expired rows per run, preserves active tickets, and recovers after a database outage.

## Staging Smoke Test

- Replay or trigger x402 `settlement.confirmed`.
- Replay or trigger Stripe order payment onramp fulfillment.
- Replay or trigger Stripe dispute deposit onramp fulfillment.
- Replay or trigger EasyPost delivered webhook.
- Resolve one buyer-favor dispute and confirm refund/order/dispute state.
- Resolve one seller-favor dispute and confirm deposit refund/order/dispute state.
- Manually verify the order detail page refreshes after payment, label, shipment, delivery, and dispute actions.
- From the test console Readiness > 기타 section, run `Run DB Limit` and require 100 allowed, 20 blocked, retention 3/3, and cleanup 0 before the multi-host ingress rehearsal.
- From the same section, run `Run Auth`; require `PASS · JWKS` in staging. `MIGRATION` and `FIXTURE ONLY` are not production approval states.
- Run `Run WS Ticket`; require consume success 1 / blocked 19, 20 parallel issues leave active scope rows 1 and superseded blocked 19, replay and wrong-channel blocked, expired remaining 0, and cleanup rows 0.
- Run `Run WS Retention`; require expired deleted 3/3, active preserved 1, exactly one deleting worker, expired remaining 0, and cleanup rows 0.
