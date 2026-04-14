# Production Checklist — Haggle MVP

Pre-deployment checklist for the Haggle MVP (API + Web + Base Sepolia).
Complete all items before promoting to production.

---

## 1. Environment Variables

All required vars must be set in the deployment environment.
Reference: `apps/api/.env.example`

### Database
- [ ] `DATABASE_URL` — Supabase pooler connection string (port 6543)

### Server
- [ ] `PORT` — API port (default: 3001)
- [ ] `HOST` — Bind address (default: 0.0.0.0)
- [ ] `LOG_LEVEL` — Log verbosity (`info` for prod, `debug` for staging)
- [ ] `PUBLIC_APP_URL` — Full public URL of the web app (e.g. `https://tryhaggle.ai`)

### Supabase
- [ ] `SUPABASE_URL` — Supabase project URL
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Service role key (never expose client-side)
- [ ] `SUPABASE_JWT_SECRET` — JWT secret from Supabase project settings (Auth → JWT Settings)

### x402 Payment (Base + USDC)
- [ ] `HAGGLE_X402_MODE` — Set to `real` for production (NOT `mock`)
- [ ] `HAGGLE_X402_FACILITATOR_URL` — x402 facilitator endpoint
- [ ] `HAGGLE_X402_NETWORK` — `base` for mainnet, `base-sepolia` for testnet
- [ ] `HAGGLE_X402_WALLET_NETWORK` — `eip155:8453` (mainnet) or `eip155:84532` (Sepolia)
- [ ] `CDP_API_KEY_ID` — Coinbase Developer Platform API key ID
- [ ] `CDP_API_KEY_SECRET` — Coinbase Developer Platform API key secret
- [ ] `HAGGLE_X402_USDC_ASSET_ADDRESS` — USDC contract address on Base
- [ ] `HAGGLE_BASE_RPC_URL` — Base RPC endpoint (e.g. Alchemy/Infura)
- [ ] `HAGGLE_SETTLEMENT_ROUTER_ADDRESS` — Deployed SettlementRouter contract address
- [ ] `HAGGLE_DISPUTE_REGISTRY_ADDRESS` — Deployed DisputeRegistry contract address
- [ ] `HAGGLE_ROUTER_RELAYER_PRIVATE_KEY` — Relayer wallet private key (keep in secrets manager)
- [ ] `HAGGLE_X402_FEE_BPS` — Platform fee in basis points (e.g. `250` = 2.5%)
- [ ] `HAGGLE_X402_FEE_WALLET` — Haggle fee collection wallet address
- [ ] `HAGGLE_X402_DEFAULT_BUYER_AUTH_MODE` — `human_wallet` for production

### Webhook Secrets
- [ ] `HAGGLE_X402_WEBHOOK_SECRET` — HMAC-SHA256 secret for x402 webhooks (generate: `openssl rand -hex 32`)
- [ ] `EASYPOST_WEBHOOK_SECRET` — HMAC secret from EasyPost dashboard → Webhooks
- [ ] `LEGITAPP_WEBHOOK_SECRET` — Webhook secret from LegitApp dashboard (if authentication enabled)

### LLM / Negotiation Engine
- [ ] `NEGOTIATION_ENGINE` — `rule` (default) or `llm`
- [ ] `XAI_API_KEY` — xAI API key for Grok (required if `NEGOTIATION_ENGINE=llm`)
- [ ] `XAI_MODEL` — Model override (default: `grok-4-fast`)
- [ ] `LLM_TELEMETRY` — `0` (disabled), `1` (stdout), or `db` (persist to DB)

---

## 2. Database Migrations

Run all migrations in order before first deployment:

- [ ] `0000_elite_iron_monger.sql` — initial schema
- [ ] `0001_add_listings_published.sql` — listings published flag
- [ ] `0002_phase3_5_tables.sql` — Phase 3.5 tables
- [ ] `0003_tag_system_dag.sql` — tag system DAG
- [ ] `0004_data_moat_columns.sql` — data moat columns
- [ ] `0005_data_moat_tables.sql` — data moat tables
- [ ] `0006_analytics_moat_tables.sql` — analytics moat tables
- [ ] `0007_user_wallets.sql` — user wallets
- [ ] `0008_webhook_idempotency.sql` — webhook idempotency

Run command: `pnpm --filter @haggle/db db:migrate`

---

## 3. Smart Contract Deployment (Base Sepolia / Mainnet)

- [ ] `SettlementRouter` deployed and verified on target network
- [ ] `DisputeRegistry` deployed and verified on target network
- [ ] Contract addresses copied to `HAGGLE_SETTLEMENT_ROUTER_ADDRESS` and `HAGGLE_DISPUTE_REGISTRY_ADDRESS`
- [ ] Relayer wallet funded with ETH for gas
- [ ] Timelock (48h+) configured on upgrade functions
- [ ] Multisig configured for admin operations
- [ ] Emergency pause function tested

---

## 4. Authentication

- [ ] `SUPABASE_JWT_SECRET` set and matches Supabase project's JWT secret
- [ ] Supabase Auth providers configured (email, Google, etc.)
- [ ] Row Level Security (RLS) policies reviewed for all tables
- [ ] Service role key stored in secrets manager (not in .env files in version control)

---

## 5. Webhook Configuration

- [ ] **x402**: Webhook endpoint registered at facilitator — `POST /payments/webhooks/x402`
- [ ] **EasyPost**: Webhook endpoint registered in EasyPost dashboard — `POST /shipments/webhooks/easypost`
- [ ] **LegitApp**: Webhook endpoint registered in LegitApp dashboard — `POST /authentications/webhooks/legit`
- [ ] All webhook secrets match what's configured in respective dashboards
- [ ] Webhook idempotency DB table (`webhook_idempotency`) migration applied

---

## 6. CORS Configuration

- [ ] CORS origins updated in `apps/api/src/server.ts` to include `https://tryhaggle.ai`
- [ ] `PUBLIC_APP_URL` env var set to production domain
- [ ] Wildcard CORS (`*`) NOT used in production

---

## 7. Rate Limiting

- [ ] Rate limiting middleware active (`apps/api/src/middleware/rate-limit.ts`)
- [ ] Limits appropriate for production traffic
- [ ] IP-based rate limiting for public endpoints confirmed
- [ ] Auth-aware rate limits for authenticated endpoints confirmed

---

## 8. Monitoring & Logging

- [ ] `LOG_LEVEL=info` (not `debug`) for production
- [ ] Application logs routed to observability platform (Datadog, Axiom, etc.)
- [ ] Error alerting configured for 5xx response spikes
- [ ] Webhook failure alerting configured
- [ ] DB connection pool monitoring enabled
- [ ] Smart contract event monitoring set up (settlement failures, dispute escalations)

---

## 9. HFMI Initial Data Seed

- [ ] HFMI price observations seeded for iPhone 13/14/15 Pro baseline prices
- [ ] HFMI model coefficients initialized
- [ ] Swappa 30d median baseline data loaded for Phase 0 attribution calculations
- [ ] Verify: `GET /hfmi/models` returns populated coefficient set

---

## 10. DNS & SSL

- [ ] DNS A/CNAME records configured: `tryhaggle.ai` → API + web app
- [ ] SSL/TLS certificate provisioned and auto-renewing (Let's Encrypt / Cloudflare)
- [ ] HTTPS redirect enforced (HTTP → HTTPS)
- [ ] HSTS header enabled
- [ ] `api.tryhaggle.ai` subdomain configured (if separate API domain)

---

## 11. Test Accounts

- [ ] Buyer test account created: `buyer-test@tryhaggle.ai`
- [ ] Seller test account created: `seller-test@tryhaggle.ai`
- [ ] Admin account created with `admin` role in Supabase user metadata
- [ ] Both test accounts have trust scores seeded (≥50 for DS qualification tests)

---

## 12. Smoke Test (Testnet End-to-End)

Run the full happy path on Base Sepolia before going live:

- [ ] **Create listing**: Seller creates iPhone 15 Pro listing via `/api/listings`
- [ ] **Create intent**: Buyer creates purchase intent via `POST /intents`
- [ ] **Trigger match**: System matches intent to listing via `POST /intents/trigger-match`
- [ ] **Create session**: Buyer creates negotiation session via `POST /negotiations/sessions`
- [ ] **Submit offers**: Execute 3+ negotiation rounds via `POST /negotiations/sessions/:id/offers`
- [ ] **Accept deal**: Final round returns `decision: ACCEPT` with `session_status: ACCEPTED`
- [ ] **Prepare payment**: `POST /payments/prepare` returns payment intent
- [ ] **Authorize payment**: `POST /payments/:id/authorize` submits x402 payment (testnet USDC)
- [ ] **Webhook confirmed**: x402 `settlement.confirmed` webhook received and processed
- [ ] **Shipping label**: `POST /shipments/labels` generates EasyPost label
- [ ] **Dispute (optional)**: Create, escalate, and resolve a test dispute
- [ ] **Settlement release**: Verify `POST /settlement-releases/:id/release` triggers after ARP window

---

## 13. Final Sign-off

- [ ] Security review completed (no secrets in code, all auth guards active)
- [ ] All 453+ unit/integration tests passing: `pnpm test`
- [ ] TypeCheck clean: `pnpm typecheck`
- [ ] ToS and Privacy Policy pages deployed at `tryhaggle.ai/terms` and `tryhaggle.ai/privacy`
- [ ] Incident response runbook documented
- [ ] Rollback plan documented (migration rollback scripts ready)

---

*Last Updated: 2026-04-13*
*Owner: Engineering Team*
