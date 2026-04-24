# Production Readiness - User Action Items

Last updated: 2026-04-23

## Environment

- Set `NODE_ENV=production` in production.
- Set the real `SUPABASE_JWT_SECRET` in production and staging.
- Confirm `DATABASE_URL` points to the intended production or staging database.
- Configure `HAGGLE_CORS_ORIGINS` with exact allowed origins only. Add preview URLs explicitly if a trusted preview must call the API.
- Optionally tune `HAGGLE_MAX_JSON_BODY_BYTES`; default is 262144 bytes. Keep it low unless a specific webhook/provider requires more.
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

## Staging Smoke Test

- Replay or trigger x402 `settlement.confirmed`.
- Replay or trigger Stripe order payment onramp fulfillment.
- Replay or trigger Stripe dispute deposit onramp fulfillment.
- Replay or trigger EasyPost delivered webhook.
- Resolve one buyer-favor dispute and confirm refund/order/dispute state.
- Resolve one seller-favor dispute and confirm deposit refund/order/dispute state.
- Manually verify the order detail page refreshes after payment, label, shipment, delivery, and dispute actions.
