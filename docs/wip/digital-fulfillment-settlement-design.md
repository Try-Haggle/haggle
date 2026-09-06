# Digital Fulfillment Settlement Design

Date: 2026-05-29

## Decision

Shipping 없는 거래는 shipment를 만들지 않고 fulfillment를 바로 진행한다.

Haggle의 거래 레일은 배송 중심이 아니라 다음 상위 모델을 기준으로 정리한다.

```text
Negotiation agreement
→ conditional settlement funding
→ fulfillment proof or fulfillment confirmation
→ buyer review window
→ release / dispute
→ dispute resolution anchoring
```

Physical shipping은 fulfillment의 한 방식일 뿐이다. 디지털 거래는 배송 없이 `digital_delivery`, `onchain_transfer`, `external_platform_transfer` 중 하나로 fulfillment를 완료한다.

## Naming Rules

현재 코드에 이미 결제 관련 제한어가 정의되어 있다.

| Avoid | Use | Reason |
| --- | --- | --- |
| escrow | conditional settlement | `escrow`는 라이선스/규제 의미가 강함 |
| custody | buyer-approved payment authorization | Haggle이 고객 자금이나 키를 보관한다고 표현하면 안 됨 |
| deposit | payment authorization | 은행성 stored value처럼 보일 수 있음 |
| guaranteed safe | rules-limited settlement | 보호 범위를 과장하면 안 됨 |

문서와 UI 카피는 `smart contract escrow` 대신 `conditional settlement`, `rules-limited settlement`, `funded settlement`, `release window`를 사용한다.

기존 코드의 `HnpShippingTerms`는 이미 `digital_transfer`를 포함하지만 이름이 좁다. 새 설계에서는 상위 명칭을 `FulfillmentTerms`로 둔다.

Compatibility rule:

- New code: `FulfillmentTerms`, `fulfillment_terms_hash`, `fulfillment_type`
- Legacy compatibility: `shipping_terms_hash`는 당분간 유지하고 fulfillment hash를 저장할 수 있게 허용
- Physical-only code: `ShippingTerms`, `shipment`, `delivery` 사용 가능

## Fulfillment Types

| Type | Requires shipment? | Completion signal | Review window | Notes |
| --- | --- | --- | --- | --- |
| `physical_shipping` | Yes | carrier delivered or buyer confirm | 24-72h | Existing flow |
| `local_pickup` | No | mutual QR / buyer confirm | optional | Existing concept, not carrier-based |
| `digital_delivery` | No | seller proof + buyer access confirm or timeout | 24h default | Files, licenses, templates |
| `onchain_transfer` | No | tx receipt verifies asset moved | short or none | ENS, NFT, onchain items |
| `external_platform_transfer` | No | platform receipt / official transfer confirmation | 24h default | domain registrar, ticket platform, GitHub transfer |

MVP should support `digital_delivery` first, then `external_platform_transfer`, then `onchain_transfer`.

## Current Gap

The smart contract can support digital deals today:

- `HaggleConditionalSettlement` only knows `FUNDED`, `RELEASED`, `REFUNDED`, `DISPUTED`.
- It does not require shipping.
- It releases/refunds via signed policy-bound calls.
- It pauses release when `raiseDispute` moves the settlement to `DISPUTED`.

The application layer is still physical-shipping biased:

- `SettlementRelease.product_release_status` starts at `PENDING_DELIVERY`.
- `delivery_confirmed_at` drives buyer review and buffer deadlines.
- `finalizeSettledPayment` always creates a shipment record.
- `settlement-auto-release` only closes orders in `DELIVERED`.
- `buffer_release_status` assumes weight/APV even when the buffer is zero.

Therefore the contract does not need a redesign for digital MVP. The first redesign is the app-level fulfillment/release abstraction.

## Smart Contract Payment Boundary

Digital products should use the existing conditional settlement contract. The contract does not need to know whether the asset is physical or digital.

Funding remains:

```text
buyer wallet
→ HaggleConditionalSettlement.createAndFund(...)
→ settlement state = FUNDED
```

Release remains:

```text
fulfillment unlocked by app policy
→ backend signs Release typed data
→ buyer/admin executor submits release(...)
→ settlement state = RELEASED
```

Dispute remains:

```text
buyer or seller calls raiseDispute(settlementId, evidenceHash)
→ settlement state = DISPUTED
→ release/refund blocked until resolution
```

The asset type is bound outside the contract through hash-bound records:

| Binding | Purpose |
| --- | --- |
| `agreement_hash` | exact negotiated terms |
| `listing_hash` | listed asset/evidence bundle |
| `approval_policy_hash` | buyer payment policy |
| `grantNonce` | one-time buyer authorization |
| future `fulfillment_terms_hash` | delivery/transfer/proof rules |

This is enough for digital MVP because the contract's job is not to verify file access, license transfer, or domain ownership. The contract's job is to enforce that funds only move under signed, policy-bound settlement instructions and that disputes stop release.

Do not add `fulfillment_type` directly to the Solidity contract for MVP. Add it to the agreement, settlement approval, fulfillment record, and release policy inputs. The contract remains category-neutral.

## Target Domain Model

### Fulfillment Record

Create a fulfillment-level record or extend the order snapshot before replacing shipment internals.

```ts
type FulfillmentType =
  | "physical_shipping"
  | "local_pickup"
  | "digital_delivery"
  | "onchain_transfer"
  | "external_platform_transfer";

type FulfillmentStatus =
  | "NOT_STARTED"
  | "AWAITING_SELLER_ACTION"
  | "SUBMITTED"
  | "VERIFYING"
  | "FULFILLED"
  | "EXCEPTION"
  | "DISPUTED";

interface FulfillmentRecord {
  id: string;
  order_id: string;
  type: FulfillmentType;
  status: FulfillmentStatus;
  proof_required: boolean;
  proof_status?: "NOT_REQUIRED" | "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED";
  fulfilled_at?: string;
  review_window_hours: number;
  metadata: Record<string, unknown>;
}
```

Physical shipping can continue using `shipments`; the fulfillment record points to the shipment. Digital deals skip shipment creation.

### Fulfillment Proof

```ts
type FulfillmentProofKind =
  | "file_hash"
  | "license_agreement"
  | "access_grant"
  | "domain_transfer_receipt"
  | "github_transfer_receipt"
  | "platform_transfer_receipt"
  | "onchain_tx"
  | "message_attestation";

interface FulfillmentProof {
  id: string;
  fulfillment_id: string;
  kind: FulfillmentProofKind;
  uri?: string;
  sha256?: string;
  external_reference?: string;
  submitted_by: "BUYER" | "SELLER" | "SYSTEM";
  submitted_at: string;
  verification_status: "PENDING" | "VERIFIED" | "REJECTED";
  metadata: Record<string, unknown>;
}
```

Proof verification is category-specific, but the release system should only need one normalized signal: `FULFILLED`.

### Settlement Approval Terms

Current `SettlementTermsSnapshot.fulfillment_type` only supports `shipped` and `local_pickup`. Expand it rather than creating a separate digital payment rail.

Target:

```ts
type FulfillmentType =
  | "physical_shipping"
  | "local_pickup"
  | "digital_delivery"
  | "onchain_transfer"
  | "external_platform_transfer";

interface SettlementTermsSnapshot {
  listing_id: string;
  seller_id: string;
  buyer_id: string;
  final_amount_minor: number;
  currency: string;
  selected_payment_rail: "x402" | "stripe";
  fulfillment_type: FulfillmentType;
  fulfillment_due_at?: string;
  review_window_hours?: number;
  shipping_cost_minor?: number;
  weight_buffer_minor?: number;
}
```

Compatibility:

- Treat missing `fulfillment_type` as `physical_shipping`.
- Map legacy `shipped` to `physical_shipping`.
- Keep `local_pickup` as-is.
- Reject shipping-only fields on no-shipping fulfillment types unless explicitly allowed by a category policy.

## Release State Model

Rename conceptually from delivery release to fulfillment release. DB columns can migrate later.

```text
AWAITING_FULFILLMENT
→ BUYER_REVIEW
→ RELEASED

Any non-terminal state
→ DISPUTED
```

Compatibility mapping:

| Current | Target |
| --- | --- |
| `PENDING_DELIVERY` | `AWAITING_FULFILLMENT` |
| `delivery_confirmed_at` | `fulfillment_confirmed_at` |
| `confirmDelivery()` | `confirmFulfillment()` |
| `shipment_input_due_at` | `fulfillment_due_at` |
| `shipping_terms_hash` | `fulfillment_terms_hash` |

Do not fake a delivery event for digital deals. For a digital template sale, completion should be:

```text
seller submits delivery proof
→ proof verified or buyer confirms access
→ fulfillment_confirmed_at set
→ buyer review starts
→ auto-release if no dispute
```

## Conditional Settlement Flow

### Physical Shipping

```text
payment funded
→ shipment record created
→ carrier delivered
→ confirmFulfillment(source = carrier)
→ buyer review
→ signed release
```

### Digital Delivery

```text
payment funded
→ no shipment record
→ seller submits proof
→ buyer confirms access or proof verifier passes
→ confirmFulfillment(source = digital_proof)
→ buyer review
→ signed release
```

### Onchain Transfer

```text
payment funded
→ seller transfers asset
→ tx receipt / ownership check passes
→ confirmFulfillment(source = onchain_tx)
→ optional short buyer review
→ signed release
```

For pure onchain atomic swaps, a future specialized contract may bypass buyer review. That is a separate lane and should not block digital offchain MVP.

## API Design

### Payment Settlement Finalization

Current payment finalization always calls `prepareFulfillmentForSecuredPayment`, which creates a shipment. Replace that with a router:

```ts
async function prepareFulfillmentForSecuredPayment(db, intent) {
  const terms = await getSettlementTermsForIntent(db, intent);
  const fulfillmentType = normalizeFulfillmentType(terms.fulfillment_type);

  if (fulfillmentType === "physical_shipping") {
    return preparePhysicalShippingFulfillment(db, intent, terms);
  }

  return prepareNoShippingFulfillment(db, intent, terms);
}
```

No-shipping finalization:

```text
create settlement_release
  product_amount = full settled amount
  buffer_amount = 0
  buffer_release_status = RELEASED
create fulfillment
  type = digital_delivery / onchain_transfer / external_platform_transfer
  status = AWAITING_SELLER_ACTION
set order status = FULFILLMENT_PENDING
do not create shipment
```

### Seller Proof Submission

```http
POST /orders/:orderId/fulfillment/proofs
```

Role: seller only.

Body:

```json
{
  "kind": "access_grant",
  "uri": "supabase://private/proofs/...",
  "sha256": "sha256:...",
  "external_reference": "github-transfer-123",
  "metadata": {
    "platform": "github",
    "asset_label": "repo ownership transfer"
  }
}
```

Server behavior:

- verifies order party and fulfillment type;
- stores proof as untrusted seller evidence;
- updates fulfillment to `SUBMITTED`;
- runs category proof validator if available;
- if verified, updates fulfillment to `FULFILLED` or waits for buyer confirmation depending on category policy.

### Buyer Access Confirmation

```http
POST /orders/:orderId/fulfillment/confirm
```

Role: buyer only.

Body:

```json
{
  "confirmation": "access_received",
  "proof_id": "fp_..."
}
```

Server behavior:

- verifies the buyer owns the order;
- requires no active dispute;
- sets `fulfilled_at`;
- starts buyer review by calling `confirmFulfillment`;
- optionally immediately releases if category policy has `review_window_hours = 0`.

### Fulfillment Auto-Review Start

Some categories can start the review window without buyer confirmation when independent verification is strong enough.

Examples:

- `onchain_transfer`: tx receipt + owner check passes.
- `external_platform_transfer`: official transfer receipt API confirms.
- `digital_delivery`: seller proof alone should not start review for MVP unless manually verified.

### Release Request

No new payment endpoint is needed for digital deals. Existing conditional release endpoints should work once `computeReleasePhase(release) === "FULLY_RELEASED"`.

The required change is making digital releases reach `FULLY_RELEASED` without:

- shipment record,
- `DELIVERED` order status,
- weight buffer delay.

## Dispute Flow

Dispute stays shared across physical and digital.

```text
FULFILLED + buyer review active
→ buyer opens dispute
→ conditional settlement raiseDispute
→ release stops
→ evidence packet built
→ dispute-core resolves
→ resolution hash anchored on DisputeRegistry
→ signed release/refund executes according to outcome
```

Digital dispute evidence needs new evidence kinds:

- `digital_access`
- `digital_file_hash`
- `license_terms`
- `platform_transfer`
- `onchain_transfer`

Existing evidence kinds such as `message_transcript` and `payment_record` remain valid.

## Category Policies

| Category | Fulfillment type | Required proof | Release window |
| --- | --- | --- | --- |
| Digital templates / files | `digital_delivery` | file hash, access grant, license terms | 24h |
| Licenses | `digital_delivery` | signed terms or license record | 24h |
| Domains | `external_platform_transfer` | registrar transfer receipt / WHOIS delta | 24-72h |
| GitHub repo / codebase | `external_platform_transfer` | repo transfer receipt + access check | 24-72h |
| ENS / onchain names | `onchain_transfer` | tx receipt + owner check | 0-24h |
| Tickets | `external_platform_transfer` | official transfer receipt | event-aware |
| Physical goods | `physical_shipping` | carrier delivery | 24-72h |

## Implementation Plan

### Phase 0: Naming and Policy Lock

- Update docs and UI copy away from `escrow` except when describing an external legal product.
- Treat `conditional settlement` as the product term.
- Add `digital_delivery`, `onchain_transfer`, `external_platform_transfer` to product/category policy.

### Phase 1: No-Shipping Settlement Path

- Add `fulfillment_type` to settlement approval terms.
- Expand UI options from `shipped | local_pickup` to the full fulfillment type enum.
- On payment settlement, branch:
  - `physical_shipping` creates shipment.
  - no-shipping types create fulfillment record only.
- For no-shipping types, create settlement release with:
  - product amount = full amount unless category has a configured holdback.
  - buffer amount = 0.
  - buffer status = `RELEASED` immediately.
- Add `confirmFulfillment()` as a generic wrapper over current `confirmDelivery()`.
- Auto-release orders based on `fulfillment_confirmed_at + review_window`, not `commerce_orders.status = DELIVERED`.

Acceptance criteria:

- Digital payment can fund `HaggleConditionalSettlement` through `createAndFund`.
- Settled digital payment does not create a shipment.
- Digital settlement release starts with buffer already released.
- Buyer access confirmation starts review.
- Review expiration can unlock conditional release.
- Opening a dispute before release calls `raiseDispute` or marks the settlement as needing dispute lock.

### Phase 2: Digital Proof

- Add `fulfillment_proofs` table.
- Add proof upload/commit endpoints reusing controlled evidence storage patterns.
- Add category-specific proof validators.
- Add proof hashes into agreement/handoff metadata.

### Phase 3: Protocol Rename

- Introduce `fulfillment-terms.ts`.
- Keep `shipping-terms.ts` as a compatibility adapter.
- Extend agreement object with `fulfillment_terms_hash`.
- Keep `shipping_terms_hash` accepted on read paths until migrations finish.

### Phase 4: Dispute Evidence Expansion

- Extend HNP dispute evidence kinds for digital transfer/access.
- Add digital dispute reason codes:
  - `access_not_provided`
  - `license_not_as_agreed`
  - `wrong_digital_asset`
  - `transfer_failed`
  - `revoked_access`
- Ensure dispute finalizer can sign release/refund for conditional settlements, not only provider refunds.

Scaffold status (B9):
- `HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS` / full `HNP_DISPUTE_EVIDENCE_KINDS` allowlist extended in `@haggle/engine-session`.
- Controlled Evidence B4 helpers expose matching category gates in `apps/api/src/lib/dispute-storage-paths.ts` without relaxing path/mime/size gates.
- Digital reason codes + validators remain follow-up work.

## Database Migration Sketch

Minimum additive migration:

```sql
ALTER TABLE settlement_approvals
  ADD COLUMN fulfillment_type text,
  ADD COLUMN fulfillment_due_at timestamptz,
  ADD COLUMN review_window_hours integer;

CREATE TABLE fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  fulfillment_type text NOT NULL,
  status text NOT NULL DEFAULT 'AWAITING_SELLER_ACTION',
  proof_required boolean NOT NULL DEFAULT true,
  proof_status text NOT NULL DEFAULT 'PENDING',
  fulfilled_at timestamptz,
  review_window_hours integer NOT NULL DEFAULT 24,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fulfillment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES fulfillments(id),
  proof_kind text NOT NULL,
  uri text,
  sha256 text,
  external_reference text,
  submitted_by text NOT NULL,
  verification_status text NOT NULL DEFAULT 'PENDING',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Later cleanup migration:

- rename `delivery_confirmed_at` to `fulfillment_confirmed_at`;
- rename `PENDING_DELIVERY` enum value to `AWAITING_FULFILLMENT`;
- move `shipping_terms_hash` to `fulfillment_terms_hash`;
- keep compatibility views or adapters until all routes are migrated.

## Code Touch Points

| File | Change |
| --- | --- |
| `packages/commerce-core/src/approval-policy.ts` | expand `FulfillmentType`; add digital validation |
| `apps/api/src/routes/payments.ts` | branch payment finalization by fulfillment type |
| `packages/payment-core/src/settlement-release.ts` | add generic `confirmFulfillment`; allow zero-buffer immediate release |
| `apps/api/src/services/settlement-release.service.ts` | map new fields while preserving legacy columns |
| `apps/api/src/jobs/settlement-auto-release.ts` | release by fulfillment review deadline, not `DELIVERED` only |
| `packages/engine-session/src/protocol/shipping-terms.ts` | introduce compatibility path toward `fulfillment-terms.ts` |
| `packages/engine-session/src/protocol/dispute-evidence.ts` | add digital evidence kinds |
| `apps/api/src/routes/disputes.ts` | ensure digital disputes lock conditional settlement |

## MVP Developer Sequence

1. Extend `FulfillmentType` enum and terms UI options.
2. Add fulfillment tables and persistence service.
3. Change payment finalization so no-shipping types skip shipment creation.
4. Make zero-buffer releases immediately buffer-released.
5. Add buyer `confirm fulfillment` endpoint.
6. Add seller proof endpoint with storage-backed proof records.
7. Update auto-release job to use fulfillment review deadlines.
8. Add tests for digital `createAndFund → proof → buyer confirm → review expiry → release request`.

## Non-Goals

- Do not build a new smart contract before the app-level no-shipping path works.
- Do not simulate shipping for digital assets.
- Do not make Haggle a registrar, ticket platform, or license issuer.
- Do not market this as custody or licensed escrow.
- Do not auto-release solely because seller uploaded proof; buyer review or independent verification must still gate release.

## Open Questions

1. Should low-value digital file deals use a shorter review window than 24h?
2. Which digital category is first: templates/files, domains, or GitHub/codebase transfer?
3. Should `digital_delivery` require buyer confirmation before review starts, or can verified seller proof start the review clock?
4. Which proof validators are required for the first category?
5. Should category policy live in DB, code registry, or both?

## Recommended First Slice

Implement `digital_delivery` for templates/files with no shipment record and no buffer.

Minimal flow:

```text
accepted agreement
→ buyer funds conditional settlement
→ seller submits file/license proof
→ buyer confirms access
→ review window starts
→ no dispute after 24h
→ conditional release signature generated
→ seller receives funds
```

This validates the key product claim: shipping is optional, but conditional settlement and dispute protection remain shared.

## Stripe Onramp to Conditional Settlement Funding

Date: 2026-06-06

### Decision

Stripe is not a settlement rail. Stripe is a USDC acquisition rail.

Both payment choices must converge on the same contract boundary:

```text
x402 direct
→ buyer already has USDC
→ buyer calls HaggleConditionalSettlement.createAndFund(...)
→ settlement state = FUNDED

Stripe onramp
→ Stripe converts fiat to USDC and delivers it to the buyer wallet
→ buyer calls HaggleConditionalSettlement.createAndFund(...)
→ settlement state = FUNDED
```

The local payment intent is not settled when Stripe reports onramp fulfillment. It is settled only after the backend verifies a matching `SettlementFunded` event from `HaggleConditionalSettlement`.

This keeps Haggle aligned with the payment-policy language in `agent-payment-grant.ts`:

- no custody: Haggle does not hold customer funds or keys;
- buyer-approved rules: the buyer funds the policy-bound contract;
- Stripe fallback: Stripe helps the buyer obtain USDC;
- stablecoin not investment: USDC is only the settlement asset.

### Product Language

Use these terms in API responses, UI, and docs:

| Avoid | Use |
| --- | --- |
| Stripe payment settled | Stripe onramp funded |
| Stripe escrow | card-to-USDC onramp |
| Haggle custody | buyer wallet / buyer-approved contract funding |
| pay with card directly to seller | fund wallet by card, then fund conditional settlement |

The buyer-facing copy should make the extra step explicit:

```text
Your card funds USDC to your wallet. Then you approve funding the Haggle conditional settlement contract.
```

Do not imply that Haggle or Stripe can release funds to the seller before the contract is funded.

### State Model

Provider context is the source of truth for rail-specific progress.

```ts
interface StripeOnrampContext {
  status:
    | "SESSION_CREATED"
    | "ONRAMP_PENDING"
    | "ONRAMP_FUNDED"
    | "ONRAMP_FUNDED_RECONCILIATION_REQUIRED"
    | "ONRAMP_FAILED";
  session_id: string;
  event_id?: string;
  destination_wallet?: string;
  destination_network: "base" | "base-sepolia";
  destination_currency: "usdc";
  destination_amount_minor?: string;
  fulfilled_at?: string;
}

interface ConditionalSettlementContext {
  status:
    | "REQUESTED"
    | "FUNDING_SUBMITTED"
    | "FUNDING_PENDING"
    | "FUNDING_CONFIRMED"
    | "FUNDING_EVENT_MISMATCH"
    | "FUNDING_FAILED";
  settlement_id?: string;
  funding_tx_hash?: string;
  contract_address: string;
  chain_id: 8453 | 84532;
  order_id_hash?: string;
  payment_intent_id_hash?: string;
  approval_policy_hash?: string;
}
```

Payment intent status can remain the existing coarse lifecycle for MVP:

```text
CREATED / QUOTED / AUTHORIZED
→ SETTLEMENT_PENDING after buyer submits createAndFund tx
→ SETTLED only after SettlementFunded event matches the intent
```

`stripe_onramp.status = ONRAMP_FUNDED` alone must never move the intent to `SETTLED`.

### Backend API Design

The conditional settlement endpoints should accept both rails, but with different preconditions.

```text
POST /payments/:id/x402/conditional-settlement-request
POST /payments/:id/x402/conditional-settlement-funding
POST /payments/:id/x402/conditional-settlement-confirmation
```

The path can keep `x402` for compatibility in the first slice, but the internal guard must change from:

```ts
intent.selected_rail === "x402"
```

to:

```ts
intent.selected_rail === "x402"
|| (
  intent.selected_rail === "stripe"
  && providerContext.stripe_onramp?.status === "ONRAMP_FUNDED"
)
```

Later cleanup can rename the route group to:

```text
/payments/:id/conditional-settlement/*
```

without changing behavior.

### Stripe Preconditions

Before returning `createAndFund` typed data for a Stripe-selected intent:

1. Require `stripe_onramp.status = ONRAMP_FUNDED`.
2. Require a valid buyer wallet supplied by the connected checkout session. A saved default may be used only when the client does not supply one; database registration is not a payment prerequisite or proof of ownership.
3. Require the onramp destination wallet to equal the buyer wallet that will call `createAndFund`.
4. Require destination network to be Base or Base Sepolia, matching `HAGGLE_X402_NETWORK`.
5. Require destination currency to be USDC.
6. Require destination amount to be at least the settlement gross amount.
7. If any field is missing from Stripe metadata/webhook payload, return `ONRAMP_RECONCILIATION_REQUIRED` rather than guessing.

The wallet equality check is mandatory. Without it, a buyer could onramp USDC into one wallet and try to fund from another wallet, or a webhook could be mis-bound to the wrong payment intent.

For direct USDC, wallet ownership is proven when that address submits `createAndFund`; the contract rejects any caller other than the signed buyer. The current `user_wallets` write API stores an address without a wallet signature, so a saved row must never be treated as ownership proof.

Before enabling real-money Stripe onramp or seller payouts, add a nonce-based wallet signature challenge when an onramp destination or seller payout address is first selected or changed. Bind the challenge to the Haggle domain, user, wallet address, chain ID, purpose, nonce, and expiry. Keep this proof separate from the optional saved-wallet preference so checkout can continue to accept any wallet the buyer controls.

### Funding Request Behavior

For x402 direct:

```text
buyer wallet has USDC
→ request typed data
→ approve USDC if needed
→ createAndFund
```

For Stripe:

```text
Stripe session fulfilled
→ verify onramp context and destination wallet
→ request typed data
→ approve USDC if needed
→ createAndFund
```

The backend signs the same conditional settlement message for both rails. The signed message must bind:

- buyer wallet;
- seller wallet;
- order id hash;
- payment intent id hash;
- approval policy hash;
- agreement hash;
- listing hash;
- USDC gross amount;
- fee policy;
- contract address and chain id.

### Frontend Flow

The checkout UI should model Stripe as two visible stages.

```text
Card onramp
1. Create Stripe onramp session
2. Buyer completes Stripe hosted flow
3. App waits for ONRAMP_FUNDED
4. App shows "Fund conditional settlement"
5. Buyer approves USDC allowance if needed
6. Buyer calls createAndFund
7. App submits tx hash and waits for confirmation
```

The final payment-complete state should be shown only after `conditional_settlement.status = FUNDING_CONFIRMED`.

### Security Rules

1. Never settle on a Stripe webhook alone.
2. Never trust a client-submitted `settlement_id`; use it only as an expected hint and verify the emitted event.
3. Never trust a client-submitted amount, asset, buyer, seller, or policy hash.
4. Require `SettlementFunded` event matching the local intent before fulfillment starts.
5. Record mismatches as reconciliation state, not silent failures.
6. Keep idempotency around funding submission and confirmation.
7. Keep onramp context and contract funding context separate in `provider_context`.

### Acceptance Criteria

- Stripe webhook fulfillment records `stripe_onramp.status = ONRAMP_FUNDED`.
- A Stripe-selected intent cannot request conditional settlement typed data before onramp funding.
- A Stripe-selected intent can request the same `createAndFund` typed data after verified onramp funding.
- Destination wallet mismatch returns a blocking error.
- Funding confirmation requires a matching `SettlementFunded` event.
- Fulfillment/shipment is not started until `FUNDING_CONFIRMED`.
- x402 direct behavior remains unchanged.
- The branch is not digital-only: `physical_shipping` and legacy `shipped` still create shipment records after verified funding.
- No-shipping fulfillment types (`digital_delivery`, `local_pickup`, `external_platform_transfer`, `onchain_transfer`) can complete payment funding without creating fake shipment records.
- API responses expose fulfillment type and whether shipment is required so test clients can verify the correct post-payment path.

### Actual Payment Test Scope

Use the same conditional settlement path for all fulfillment types.

```text
stored settlement approval
→ payment prepare / quote
→ x402 direct USDC or Stripe test-mode onramp
→ buyer wallet funds HaggleConditionalSettlement
→ backend verifies SettlementFunded
→ payment becomes SETTLED
→ fulfillment branches by fulfillment_type
```

For physical goods, `physical_shipping` and `shipped` create the shipment record and move the order to fulfillment. For digital delivery, local pickup, external platform transfer, and onchain transfer, the order moves to fulfillment without shipment creation. This keeps the settlement contract category-neutral while letting a real payment test run against either a physical or no-shipping deal.

### First Implementation Slice

1. Add a helper that decides whether an intent is eligible for conditional settlement funding:

```ts
function assertConditionalSettlementFundingEligibility(intent, providerContext) {
  if (intent.selected_rail === "x402") return { ok: true };
  if (intent.selected_rail !== "stripe") return { ok: false, error: "PAYMENT_RAIL_NOT_SUPPORTED" };

  const onramp = providerContext.stripe_onramp;
  if (onramp?.status !== "ONRAMP_FUNDED") {
    return { ok: false, error: "STRIPE_ONRAMP_NOT_FUNDED" };
  }

  return { ok: true, source: "stripe_onramp" };
}
```

2. Replace `PAYMENT_RAIL_NOT_X402` guards in the three conditional settlement endpoints with that helper.
3. Add Stripe-specific wallet/network/amount checks in `conditional-settlement-request`.
4. Keep confirmation verification shared for both rails.
5. Add tests for:
   - Stripe blocked before `ONRAMP_FUNDED`;
   - Stripe allowed after `ONRAMP_FUNDED`;
   - destination wallet mismatch;
   - x402 still allowed;
   - Stripe onramp webhook does not settle without `SettlementFunded`.
