# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Phase 0 Week 1-2 — Dispute-Triggered Attestation + HFMI v0 (Reference Signal)

### Context

Phase 0 iPhone Pro wedge. 2-week sprint. Goal: 1 end-to-end transaction on production by end of Week 2 + HFMI reference widget live. Full strategic context and decisions locked in:

- `docs/mvp/2026-04-08_week1-2_work-list.md` — task breakdown, day-by-day plan, success criteria
- `docs/mvp/2026-04-08_hfmi-spec.md` — HFMI regression spec, data sources, schema
- `docs/strategy/office-hours/2026-04-08_phase0-electronics-wedge.md` — wedge rationale, gates
- `docs/strategy/office-hours/2026-04-08_distribution-plan-community-first.md` — seller seeding plan

**Scope**: iPhone 13/14/15 Pro family (6 SKUs), US market, Unlocked only. iPhone 14 Pro is Gate SKU for North Star attribution.

### 핵심 제약

1. **Reuse existing packages — do not rebuild**:
   - `arp-core` (57 tests) — adaptive review period, trust-modulated 7-14 days
   - `dispute-core` (117 tests) — DS panel, evidence submission flow
   - `trust-core` (85 tests) — seller trust score feeds arp-core
   - `engine-session` (121 tests) — negotiation round execution
   - `engine-core` (102 tests) — utility + counter-offer math
   - `contracts/` — existing USDC escrow on Base L2

2. **DO NOT TOUCH** `packages/shared` or `packages/db` core. Extend db via **new schema files only** under `packages/db/src/schema/`.

3. **No onchain in v0**. All attestation commits land in Postgres append-only log. Onchain hash commitment is Phase 0.5 after Week 2 review.

4. **Non-custodial + Governance-safe** (CLAUDE.md rules 7-8) — no contract changes in this sprint.

5. **Fairness principle** (CLAUDE.md rule 4) — HFMI is always free/current for consumers. B2B API monetization is Phase 1, schema only in Phase 0.

6. **Dispute-triggered attestation** — upfront is photos + IMEI + battery health screenshot + Find My off screenshot + sha256 commit hash only. **No video upfront.** Video evidence only submitted when `dispute-core` triggers.

7. **HFMI v0 is REFERENCE ONLY**:
   - eBay Browse API returns active listings only (not sold)
   - Apply ~0.92 correction factor for active→sold estimation
   - Display wide confidence intervals (±$35)
   - Marketing copy: "eBay 활성 시세 기준 추정" — never "실거래가"
   - Internal negotiation engine weight: **0.3** (low) — Haggle internal sold data is the real goal, accumulate aggressively
   - Week 1-2 engineering priority: **data ingestion pipeline > model sophistication**

### Verified External API Reality (confirmed 2026-04-08)

**eBay Browse API** (`item_summary/search`):
- ✅ **Rate limit**: 5,000 calls/day per application token (free tier, OAuth client credentials)
- ✅ **Page size**: max 200 items/request, 10,000 items/query cap (offset 9,999)
- ✅ **Fields available**: `title`, `price`, `condition` (New/Used/Seller refurbished), `itemLocation`, `seller.feedbackScore`, `seller.feedbackPercentage`, `buyingOptions`, `itemCreationDate`, `categories`, `image`
- ❌ **Sold data**: NOT returned. Active listings only.
- ❌ **Battery health**: not a structured field — must parse from `title` via regex (~40% coverage expected, impute median for rest)
- ❌ **Carrier lock status**: not structured — parse from title ("Unlocked" keyword filter)

**Terapeak** (sold data, manual):
- Requires eBay Store subscription (~$22/mo)
- Weekly CSV export workflow, manual
- Used to **calibrate the Browse API correction factor**, not continuous ingestion

**Marketplace Insights API** (sold, programmatic):
- Gated — application submission required Day 1 of sprint
- Approval typical 2-4 weeks → Phase 0.5 enablement

**Budget realism for 6 SKUs**:
- ~1 query per (SKU × hour) × 6 SKUs × 24h = 144 calls/day → **35x headroom under 5,000/day limit**
- Expected corpus: ~6,000 observations/week, ~25,000 rolling 30-day window → sufficient for OLS fit

### Open Decisions (Bob's Call)

These are implementation-level — Architect trusts Bob's judgment, but must record decision in `handoff/BUILD-LOG.md`:

1. **`attestation-core` as new package vs merge into `dispute-core`?**
   - Recommendation: **merge into `dispute-core`** for v0. Attestation is just another evidence type. Split only when it grows its own logic (Phase 0.5+).

2. **OLS regression: TypeScript `simple-statistics` vs Python microservice?**
   - Recommendation: **TypeScript `simple-statistics`**. Single runtime. 6 SKUs × ~25K observations is trivial load. Revisit if R² plateaus.

3. **eBay Browse API client: build from scratch (~200 lines) vs `ebay-api` npm package?**
   - Recommendation: **build from scratch**. Single endpoint (`item_summary/search`) + OAuth client credentials. npm package adds surface area we don't need.

4. **S3 direct upload vs presigned URL through API?**
   - Recommendation: **presigned URL through API**. We control upload auth, rate limit, and size cap. Direct upload leaks bucket permissions.

5. **Mobile web attestation wizard: PWA vs plain responsive web?**
   - Recommendation: **plain responsive web**. PWA install friction kills conversion on first-time sellers. Revisit after 50 onboarded sellers report back.

### Build Order (high-level — see work-list.md for day-by-day)

#### Part A — Foundation (Day 1-2)

##### A1. New schema: `packages/db/src/schema/seller-attestation-commits.ts`

```typescript
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const sellerAttestationCommits = pgTable('seller_attestation_commits', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').notNull(),
  sellerId: uuid('seller_id').notNull(),
  imeiEncrypted: text('imei_encrypted').notNull(), // AES-256, key in env
  batteryHealthPct: integer('battery_health_pct').notNull(),
  findMyOff: boolean('find_my_off').notNull(),
  photoUrls: jsonb('photo_urls').notNull().$type<string[]>(), // S3 SSE keys
  commitHash: text('commit_hash').notNull(), // sha256 of canonical JSON
  canonicalPayload: jsonb('canonical_payload').notNull(), // for dispute verification
  committedAt: timestamp('committed_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(), // review period end
});
```

Index on `(listing_id)`, `(seller_id, committed_at desc)`.

##### A2. New schemas: HFMI tables under `packages/db/src/schema/hfmi-*.ts`

See `docs/mvp/2026-04-08_hfmi-spec.md` §9 for full schema. Two tables:
- `hfmi_price_observations` (ingestion log)
- `hfmi_model_coefficients` (per-SKU fitted coefficients, versioned)

##### A3. Migration

Generate via `pnpm --filter @haggle/db generate`. Review SQL before commit. **Do not edit existing migration files.**

##### A4. S3 bucket + lifecycle

- Bucket: `haggle-attestation-evidence-prod`
- SSE-S3 enabled, bucket policy denies public read
- Lifecycle rule: delete objects 90 days after creation
- Access via presigned PUT URL issued from API

##### A5. Canonical JSON + hash function

New util in `apps/api/src/lib/attestation-hash.ts`:

```typescript
export function canonicalizeAttestation(input: AttestationInput): string {
  // Deterministic key ordering + whitespace normalization
  // Return stable string ready for sha256
}

export function computeCommitHash(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}
```

Unit test with fixed fixture to lock hash output (regression guard against future canonicalizer drift).

#### Part B — HFMI Ingestion (Day 3-4)

##### B1. eBay Browse API client: `apps/api/src/lib/ebay-browse-client.ts`

- OAuth client credentials flow, token cached in-memory with expiry
- Single method: `searchActiveListings(query: BrowseQuery): Promise<BrowseResponse>`
- Retry with exponential backoff on 429/5xx
- Rate limit guard (internal counter, fail fast at 4,500/day)

##### B2. Ingestion cron: `apps/api/src/jobs/hfmi-ingest.ts`

- Runs hourly (or every 6h — Bob's call based on volume observation)
- Iterates 6 SKU queries, inserts into `hfmi_price_observations`
- Dedupe by `(source, external_id, observed_at)` — use eBay `itemId` as external_id

##### B3. Title parser: `apps/api/src/lib/hfmi-title-parser.ts`

Regex extraction of `storage_gb`, `battery_health_pct`, `carrier_locked`, `cosmetic_grade_hint` from listing titles. Cover ~40-60% of titles; rest get null → median imputation at fit time.

##### B4. OLS fitter: `apps/api/src/jobs/hfmi-fit.ts`

- Runs nightly (cron 03:00 UTC)
- For each of 6 SKUs: pull trailing 30d observations → fit OLS via `simple-statistics` → write coefficients row
- Log R², sample size, residual std

##### B5. Query function: `apps/api/src/services/hfmi.service.ts`

```typescript
export async function getHfmiMedian(input: {
  model: ModelId;
  storageGb: number;
  batteryHealthPct?: number;
  cosmeticGrade?: 'A' | 'B' | 'C';
}): Promise<{
  medianUsd: number;
  confidenceInterval: [number, number]; // wide, ±$35 floor
  sampleSize: number;
  lastRefit: Date;
  coefficientVersion: string;
}>
```

#### Part C — Landing + Methodology (Day 5)

##### C1. Landing page `apps/web/src/app/page.tsx`

- Hero: "AI가 협상하는 중고 iPhone 14 Pro"
- Live HFMI widget (fetches `iphone_14_pro` median for 256GB/battery 90+)
- Dual CTA: buyer "Find a 14 Pro" / seller "List your 14 Pro"

##### C2. Methodology page `apps/web/src/app/hfmi/page.tsx`

- Static MDX, data hydrated from `hfmi_model_coefficients` at build or request time
- Show: regression formula, coefficients, R², sample size, last refit timestamp
- Explicit disclaimer: "eBay 활성 시세 기반 추정. Terapeak sold 데이터로 주간 보정. 참고용."

#### Part D — Transaction Flow (Day 6-7)

##### D1. Listing creation with attestation wizard
- New route `apps/web/src/app/sell/page.tsx`
- Wizard steps: device info → photos → battery screenshot → Find My screenshot → review → commit
- On submit: presigned URL upload → hash compute → insert `seller_attestation_commits` → listing published

##### D2. Buyer browse + negotiation
- Existing `engine-session` integration (already built)
- Display HFMI median prominently on listing card + detail page
- Negotiation trigger on "Start Haggle" button

##### D3. USDC escrow
- Existing contracts. Just wire button.

##### D4. "Received" button + arp-core trigger
- Emits event → `arp-core` starts review period timer
- Review period length from `trust-core` seller score lookup

#### Part E — Dispute Path (Day 8-9)

##### E1. Dispute open UI
- Button visible during review window only
- Opens 48h evidence submission form

##### E2. Evidence upload + commit hash verification
- Seller's original photos re-hashed and compared to stored `commit_hash` (tamper detection)
- Buyer uploads video + diagnostic screenshots
- Feeds into existing `dispute-core` DS panel flow

##### E3. Admin dispute queue: `apps/web/src/app/admin/disputes/page.tsx`
- Manual review queue for first 20 cases (no auto-precedent retrieval yet)
- Shows: commit hash verification result, both evidence sets, seller trust score

#### Part F — Polish + Ship (Day 10)

##### F1. `/admin/distribution` dashboard
- Seller funnel: DMs → onboarded → first listing → first sale
- Buyer funnel: visits → signups → first negotiation → completion
- HFMI calibration chart: predicted vs actual (once data exists)
- CAC per channel

##### F2. Seller CRM
- Airtable OR new Postgres table — Bob picks. Airtable faster for Week 1.

##### F3. E2E smoke test
- Mock seller → list → mock buyer → negotiate → mock shipping → receive → auto-release
- Run in Playwright, committed under `apps/web/tests/e2e/phase0-happy-path.spec.ts`

##### F4. Production deploy
- `tryhaggle.ai` live
- Methodology page live
- Error monitoring confirmed

### Success Criteria (end of Week 2)

- [ ] 1 end-to-end transaction completes on production (internal, founder seller + designated buyer)
- [ ] HFMI median displays on landing + listing pages, refits nightly, covers all 6 SKUs
- [ ] 1 external seller onboarded through attestation wizard end-to-end
- [ ] `/admin/distribution` dashboard live
- [ ] Zero onchain changes
- [ ] All existing package tests still green (599 total)
- [ ] New tests: attestation hash canonicalization (unit), HFMI title parser (unit), ingestion dedupe (integration), E2E happy path (Playwright)

### Reviewer Notes (for Richard)

When reviewing:
- Verify **no changes** to `packages/shared` or existing `packages/db` core
- Verify new schemas are **additive only** (no column renames, no drops)
- Verify HFMI v0 marketing copy reflects "reference signal" positioning — reject any copy claiming "actual market price" or "실거래가"
- Verify attestation commit hash is **deterministic** — run the unit test twice on same input, bytes must be identical
- Verify S3 bucket policy denies public read (check via console + test with unsigned curl)
- Verify rate limit guard on eBay client — artificially set counter to 4500 and confirm next call throws

### Handoff

Bob: read this brief + the 4 referenced docs. Start with Part A Day 1. Write progress to `handoff/BUILD-LOG.md`. Ping Arch on any of the 5 open decisions if you diverge from recommendations.

Richard: standby for review after Part B completes (Day 4) for mid-sprint gate, and again after Part F (Day 10) for ship gate.
