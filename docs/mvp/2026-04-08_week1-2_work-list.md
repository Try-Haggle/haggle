# Phase 0 Week 1-2 Work List

Generated 2026-04-08 from `/plan-eng-review` session
Status: READY FOR BOB (Builder)
Scope: iPhone 13/14/15 Pro family (6 SKUs), 14 Pro primary Gate, US market, 2-week sprint

---

## Locked Decisions (이 세션에서 확정)

1. **Dispute-triggered attestation** (not pre-transaction video)
   - Seller upfront = photos + IMEI + battery health + Find My off screenshot + hash commit (30s flow)
   - Buyer on receipt = "received" click only, no evidence
   - Review period managed by existing `arp-core` package
   - Evidence submission only when `dispute-core` triggers
2. **No onchain commit in v0** — Postgres append-only audit log. Onchain attestation deferred to Phase 0.5.
3. **HFMI = Browse API + Terapeak hybrid** — eBay Finding API deprecated. v0 uses Browse API (active listings with correction factor) + weekly manual Terapeak sold snapshots. Marketplace Insights API application submitted Day 1 for Phase 0.5. Gazelle/Back Market demoted to anchor-only.
4. **Unlocked devices only** — carrier-locked inventory (~40%) excluded from v0.
5. **Consumer UI free, API monetization Phase 1** — schema design in Phase 0, build deferred.
6. **Marketing narrow / transaction wide** — landing page = 14 Pro narrative, HFMI coverage = 13/14/15 Pro family, listings = full Apple ecosystem allowed.

---

## Attestation v0 — Dispute-Triggered

### Data Model

```typescript
// New table: seller_attestation_commits
{
  id: uuid
  listing_id: uuid
  seller_id: uuid
  imei: string (encrypted)
  battery_health_pct: int
  find_my_off: boolean
  photo_urls: string[] (S3, server-side encrypted)
  commit_hash: string (sha256 of canonical payload)
  committed_at: timestamp
  expires_at: timestamp (review period end)
}

// Extend existing dispute-core tables with:
{
  seller_evidence_url: string (video, submitted on dispute open)
  buyer_evidence_url: string (video + diagnostic screenshots)
  seller_commit_hash_verified: boolean (prove pre-ship consistency)
}
```

### Flow

1. Seller creates listing → guided attestation wizard
   - IMEI input + carrier/lock status check (manual, Unlocked only)
   - Battery health screenshot upload
   - Settings > General > [About] screenshot (shows Find My status)
   - 3-4 exterior photos (front, back, sides, screen on)
   - Client computes `sha256(canonical_json)` → stored as `commit_hash`
   - Photos encrypted at rest in S3, 90-day retention
2. Buyer purchase → escrow locked (existing flow)
3. Shipping → buyer receives → clicks "Received" button
4. `arp-core` review period begins (7-14 days, adaptive by price + seller trust)
5. **Happy path**: review period passes → `arp-core` emits event → escrow auto-releases
6. **Dispute path**: buyer opens dispute within review window
   - Both parties get 48h to submit evidence
   - Seller's original `commit_hash` verified against pre-committed photos (tamper detection)
   - `dispute-core` DS panel reviews (manual queue for first 20 cases — no auto-retrieval)

### Integration Points

- `arp-core` — review period trigger (reuse existing 57 tests)
- `dispute-core` — evidence submission hooks (DS panel + 117 tests)
- `trust-core` — seller trust score modulates review period length
- New: `attestation-core` package? Or merge into `dispute-core`? **Bob decides.**

### Out of Scope (Phase 0.5+)

- ❌ Onchain hash commitment
- ❌ Carrier-locked devices
- ❌ Automated precedent similarity search (manual review queue)
- ❌ Pre-ship/post-receive video (only on dispute)
- ❌ CheckMEND / carrier API integration

---

## HFMI v0 — eBay Hedonic

### Data Model

```typescript
// New table: hfmi_price_observations
{
  id: uuid
  source: 'ebay_sold' | 'gazelle' | 'backmarket' | 'haggle_internal'
  model: string (e.g., 'iphone_14_pro')
  storage_gb: int
  battery_health_pct: int | null
  cosmetic_grade: 'A' | 'B' | 'C' | null
  carrier_status: 'unlocked' | 'locked'
  observed_price_usd: decimal
  observed_at: timestamp
  raw_payload: jsonb
}

// New table: hfmi_model_coefficients
{
  id: uuid
  model: string
  fitted_at: timestamp
  intercept: decimal
  coefficients: jsonb  // {storage_256: 0.12, battery_per_pct: 0.005, ...}
  r_squared: decimal
  sample_size: int
  residual_std: decimal
}
```

### Hedonic Regression

```
log(price) ~ intercept
           + storage_fe           (128, 256, 512, 1024)
           + battery_health_pct
           + cosmetic_grade_fe    (A, B, C)
           + carrier_fe           (unlocked=baseline)
           + days_since_listing
```

- OLS via `simple-statistics` or Python microservice (Bob picks — prefer TS for single runtime)
- Refit nightly on rolling 30-day window
- Expose `HFMI_median(model, storage, battery, cosmetic)` function

### Data Sources

| Source | Method | v0 Weight | Notes |
|---|---|---|---|
| **eBay Browse API** | `item_summary/search`, free OAuth | **primary** | Active listings; apply ~0.92 correction factor to approximate sold |
| **Terapeak (manual)** | Weekly CSV export via eBay Store account ($22/mo) | **secondary** | True sold data; calibrates correction factor |
| Marketplace Insights API | Application submitted Day 1 | 0 | Phase 0.5 when approved (2-4 weeks) |
| Gazelle | Manual sampling weekly | anchor | Sanity check: HFMI < Gazelle ⇒ alarm |
| Back Market | Manual sampling weekly | anchor | Sanity check: HFMI > Back Market refurb ⇒ alarm |
| Haggle internal | Own completed txns | 0 | Phase 0.5 when ≥50 txns |

**Note**: eBay Finding API `findCompletedItems` is deprecated and no longer free at scale. See §4.1 of `2026-04-08_hfmi-spec.md` for full rationale.

### Public Methodology Page

Published at `tryhaggle.ai/hfmi`:
- Regression formula
- Coefficient values (updated nightly)
- R² and residual std
- Backtest accuracy: "HFMI predicts 78% of historical completions within ±$35"
- Sample size per SKU

### API Schema (design only, no build)

```
GET /api/v1/hfmi/:model
  ?storage=256
  &battery_health=92
  &cosmetic=A

Response: {
  median_usd: 618,
  confidence_interval: [598, 640],
  sample_size: 47,
  last_refit: "2026-04-08T03:00:00Z",
  coefficient_version: "v0.1.3"
}
```

Rate limiting + auth stubs only. Consumer UI calls internal endpoint directly.

### Out of Scope (Phase 0.5+)

- ❌ Gazelle/Back Market scraping (manual sampling only)
- ❌ Haggle internal weight ramping
- ❌ Marketplace Insights API integration (waiting on approval)
- ❌ Public API rate limiting / billing
- ❌ Non-Pro iPhone models, MacBook, iPad (v0 = 13/14/15 Pro family, 6 SKUs)

---

## Product Surface (Week 1-2)

### Landing Page `tryhaggle.ai`
- Hero: "AI negotiates your next used iPhone 14 Pro"
- HFMI widget showing current 14 Pro median
- CTA: buyer "Find a 14 Pro" / seller "List your 14 Pro"

### Seller Flow
- List device (14 Pro required for wedge, other Apple devices allowed)
- Guided attestation wizard (photos + metadata + hash commit)
- Confirmation + listing live

### Buyer Flow
- Browse 14 Pro listings (HFMI median displayed prominently)
- Click listing → AI negotiation starts automatically
- Confirm final price → USDC escrow
- Receive device → click "Received"
- Review period countdown visible in dashboard
- Auto-release or dispute button

### Admin Dashboard `/admin/distribution`
- Seller seeding funnel (DMs → onboarded → first listing → first sale)
- Buyer signup + completion funnel
- HFMI calibration: predicted vs actual final prices
- CAC per channel

### Methodology Page `tryhaggle.ai/hfmi`
- Static MDX with nightly regenerated coefficients

---

## Engineering Task Breakdown

### Week 1

**Day 1-2 — Foundation**
- [ ] Create `seller_attestation_commits` table + migration
- [ ] S3 bucket with SSE, 90-day lifecycle policy
- [ ] Seller attestation wizard (mobile web, React Hook Form)
- [ ] Hash commit function + canonical JSON spec

**Day 3-4 — HFMI Core**
- [ ] eBay Browse API OAuth client + rate limit wrapper + Terapeak CSV importer
- [ ] `hfmi_price_observations` ingestion job (cron, hourly)
- [ ] OLS regression fitter (`simple-statistics`)
- [ ] `HFMI_median()` query function

**Day 5 — Landing**
- [ ] `tryhaggle.ai` landing page with 14 Pro HFMI widget
- [ ] Methodology page MDX stub

### Week 2

**Day 6-7 — Transaction Flow**
- [ ] Listing creation with attestation wizard integration
- [ ] Buyer browse + AI negotiation trigger (existing engine-session)
- [ ] USDC escrow integration (existing contracts)
- [ ] "Received" button + `arp-core` review period trigger

**Day 8-9 — Dispute Path**
- [ ] Dispute open UI (within review window)
- [ ] Evidence upload (48h deadline enforcement)
- [ ] Commit hash verification on seller evidence
- [ ] DS panel manual review queue (`/admin/disputes`)

**Day 10 — Polish**
- [ ] `/admin/distribution` dashboard
- [ ] Seller seeding CRM (Airtable or Postgres table)
- [ ] End-to-end smoke test: list → buy → negotiate → ship (mock) → receive → auto-release
- [ ] Deploy to production (`tryhaggle.ai`)

---

## Dependencies on Existing Packages

| Package | Reuse | Tests |
|---|---|---|
| `engine-core` | Utility + counter-offer computation | 102 |
| `engine-session` | Round execution pipeline | 121 |
| `dispute-core` | DS panel + evidence flow | 117 |
| `arp-core` | Adaptive review period | 57 |
| `trust-core` | Seller trust score | 85 |
| `db` (Drizzle) | Schema + migrations | - |
| `contracts` | Existing USDC escrow | - |

**Do not touch**: `shared`, `db` (DO NOT TOUCH per CLAUDE.md — extend via new schema files only).

---

## Decisions Still Open (Bob's Call)

1. `attestation-core` as new package vs merge into `dispute-core`?
2. OLS regression: TypeScript (`simple-statistics`) vs Python microservice?
3. eBay Browse API client: build from scratch (~200 lines) vs `ebay-api` npm package?
4. S3 direct upload vs presigned URL through API?
5. Mobile web attestation wizard: PWA vs plain responsive web?

---

## Success Criteria (end of Week 2)

- [ ] 1 end-to-end transaction completes on production (internal test, founder as seller, designated tester as buyer)
- [ ] HFMI median displayed on landing page, refits nightly
- [ ] 1 seller onboarded through attestation wizard end-to-end
- [ ] `/admin/distribution` dashboard live with seeding funnel
- [ ] Zero onchain changes (all Postgres)
- [ ] All existing package tests still green (599 total)

---

## Handoff to Bob

Bob, read this doc + reference:
- `docs/strategy/office-hours/2026-04-08_phase0-electronics-wedge.md` (design)
- `docs/strategy/office-hours/2026-04-08_distribution-plan-community-first.md` (distribution)
- `packages/arp-core/` (review period reuse)
- `packages/dispute-core/` (evidence flow reuse)
- `CLAUDE.md` rules 6-8 (MVP, non-custodial, governance-safe)

Write `handoff/BUILD-LOG.md` entries as you progress. Ping Arch on open decisions #1-5 above.
