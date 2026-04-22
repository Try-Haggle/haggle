# Haggle — Payment & Shipping Flow Page Design Prompt

> Claude design tool prompt.
> Last updated: 2026-04-18

---

## What is Haggle

AI-powered P2P trade protocol. AI negotiates the price, USDC stablecoin settles via smart contract.
Goal: "The Stripe of Negotiations."

### Core Principles

- **Non-custodial**: Haggle never holds user fund keys. All transfers are immediate through smart contract.
- **Transparent fees**: `HaggleSettlementRouter` smart contract atomically splits payment — seller gets their share, Haggle gets platform fee — in a single transaction.
- **Buyer protection**: Escrow → delivery confirmation → review period → settlement release.
- **Priority**: Safety > Convenience, Fairness > Revenue, Simplicity > Perfection, Transparency > Efficiency.

---

## What This Page Does

After AI negotiation completes (ACCEPT), this page walks through the entire **Payment → Shipping** flow interactively, step by step on a single page.

Developer-facing: shows which API is called and what happens on-chain at each step, transparently.

---

## Two Payment Rails

The buyer chooses one:

### Option A: USDC Direct (x402)
- Buyer already has USDC in wallet
- Protocol: x402 (HTTP 402 standard)
- Network: Base L2
- Fee: **Haggle 1.5% only**
- Gas: paid by Haggle (relayer)
- Badge: "Recommended"

### Option B: Stripe Onramp (Card)
- Buyer pays with credit/debit card
- Stripe converts fiat → USDC → sends to Base L2
- Fee: **Stripe 1.5% + Haggle 1.5% = 3.0% total**
- No crypto wallet needed
- Stripe handles KYC

### Fee Comparison Table

| | USDC Direct | Card (Stripe Onramp) |
|---|---|---|
| Buyer pays | $450.00 | $450.00 + Stripe fee |
| Haggle fee | 1.5% ($6.75) | 1.5% ($6.75) |
| Stripe fee | — | 1.5% ($6.75) |
| Total fee | **1.5%** | **3.0%** |
| Seller receives | $443.25 | $443.25 |
| Wallet required | Yes | No |
| Settlement | Immediate on-chain | After Stripe fulfillment |

Key point: **Seller always receives the same amount regardless of rail.** Extra Stripe fee is on the buyer.

---

## Full Flow (7 Steps)

```
[Negotiation Complete]
  → Step 1: Payment Rail Select (x402 or Stripe)
  → Step 2: Prepare (create intent)
  → Step 3: Quote (fee calculation)
  → Step 4: Authorize (wallet sign or card entry)
  → Step 5: Settle (on-chain execution)
  → Step 6: Label & Ship (carrier)
  → Step 7: Delivered
```

---

## Page Layout

### 1. Top: Negotiation Result Summary

Data from completed negotiation:
- Item name (e.g. "iPhone 14 Pro 128GB Space Black")
- Agreed price (e.g. $450.00) — monospace font
- Negotiation rounds (e.g. 3 rounds)
- Savings vs market (e.g. Swappa median $520 → saved $70)
- Current step badge

### 2. Progress Timeline (horizontal stepper, vertical on mobile)

7 steps:
1. Rail Select
2. Prepare
3. Quote
4. Authorize
5. Settle
6. Ship
7. Delivered

Visual rules:
- Done: green circle + checkmark
- Current: cyan circle + pulse animation
- Future: gray empty circle
- Connector line: green for completed segments, gray for rest

### 3. Main: Step Action Card

Card content changes per step. Show API endpoint as small gray mono text at bottom of each card.

---

#### Step 1: Payment Rail Select

Two large selectable cards side by side (stack on mobile):

**Card A — USDC Direct:**
- USDC coin icon (cyan)
- Title: "USDC Direct Payment"
- Subtitle: "Base L2 transfer, 1.5% fee, gas paid by Haggle"
- Badge: "Recommended" (cyan)
- Fee breakdown: Haggle 1.5% → total 1.5%

**Card B — Card Payment (Stripe Onramp):**
- Credit card icon (gray)
- Title: "Card Payment"
- Subtitle: "Stripe Onramp, 3.0% total fee, no wallet needed"
- Fee breakdown: Stripe 1.5% + Haggle 1.5% → total 3.0%

Selected card has cyan border highlight.

---

#### Step 2: Prepare

- Order info card: Order ID, item name, amount, selected rail
- If Stripe: show "Stripe Crypto Onramp session will be created"
- CTA button: "Prepare Payment (Prepare Intent)"
- API: `POST /payments/prepare`

---

#### Step 3: Quote

- Fee split visualization:
  - Horizontal stacked bar: seller portion (white/light gray) + Haggle fee (cyan) + Stripe fee if applicable (purple)
  - Below: 2-column (or 3-column if Stripe) grid:
    - Seller receives: $443.25 + wallet address (masked)
    - Haggle fee: $6.75 + fee wallet address
    - Stripe fee (if card): $6.75 + "Processed by Stripe"
- CTA button: "Authorize Payment"
- API: `POST /payments/:id/quote`

---

#### Step 4: Authorize

**If USDC Direct (x402):**
- Smart contract info card (purple border):
  - Contract: `HaggleSettlementRouter`
  - Network: Base L2 (Chain ID: 8453)
  - Protocol: EIP-712 typed signature
  - Description: "Backend signs settlement params via EIP-712. Buyer calls contract. Contract atomically splits USDC."
- Signature detail (collapsible code block):
  ```
  Settlement(
    orderId, paymentIntentId,
    buyer, seller, sellerWallet, feeWallet,
    asset (USDC), grossAmount, sellerAmount, feeAmount,
    deadline, signerNonce
  )
  ```
- Security features list:
  - Duplicate payment prevention (settledOrders mapping)
  - Fee cap 10% max (MAX_FEE_BPS = 1000)
  - Signer rotation 48h delay (SIGNER_ROTATION_DELAY)
  - Guardian emergency pause
  - EIP-1271 smart contract signer support
  - Minimum amount check (0.01 USDC dust prevention)
- CTA: "Execute Payment (Settle)"

**If Stripe Onramp:**
- Stripe widget embed area (or hosted URL redirect)
- "Enter card details via Stripe secure form"
- Stripe handles auth, Haggle receives webhook on fulfillment
- Show: "Stripe converts USD → USDC → delivers to Base L2"
- CTA: "Pay with Card"
- API: `POST /payments/:id/onramp/session`

---

#### Step 5: Settle

**Settling animation:**
- Double-ring spinner
- Status text by rail:
  - x402: "Settlement Router distributing USDC on Base L2..."
  - Stripe: "Waiting for Stripe fulfillment confirmation..."
- Real-time flow visualization:
  - "Buyer → Seller: $443.25"
  - "Buyer → Haggle Fee: $6.75"
  - If Stripe: "Stripe Fee: $6.75 (retained by Stripe)"

**Settled (complete):**
- Success icon (green check circle)
- Settlement receipt card:
  - Total paid: $450.00
  - Seller receives: $443.25 (white)
  - Haggle fee: $6.75 (cyan)
  - Stripe fee: $6.75 (purple) — only if card payment
  - Tx Hash: 0x8f2a...b7c1 (mono)
  - Network: Base L2
- Haggle fee wallet card (cyan border):
  - Wallet icon + address
  - "+$6.75" large (cyan)
  - "Platform fee from this trade"
- Auto-created resources list:
  - Settlement Release (product amount + weight buffer)
  - Shipment Record (LABEL_PENDING)
  - Order status → FULFILLMENT_PENDING
- CTA: "Continue to Shipping →" (blue)
- API: `POST /payments/:id/settle`

---

#### Step 6: Ship

Shipping has 4 sub-states within this step. Each sub-state shows progressively more detail.

**Sub-state A: Label Pending (LABEL_PENDING)**

Top section — Shipment header card:
- Shipment ID (mono), Carrier badge (e.g. "USPS Priority · via EasyPost")
- Status badge: amber "Label pending"

Middle section — 2-column grid: Package & Route details:
| Left column (Package) | Right column (Route) |
|---|---|
| Declared weight: 0.8 lb (12.8 oz) | From: Seller · Austin, TX |
| Weight tier: "up to 1 lb" ($6.00) | To: Buyer · Brooklyn, NY |
| Dimensions: 8" × 6" × 3" | Service: USPS Priority |
| Category: ELECTRONICS_SMALL | Est. delivery: 3 business days |

Bottom section — SLA info card (subtle amber border):
- SLA deadline: "Seller must ship within 3 days"
- Countdown: "2d 23h remaining"
- Grace period: 6 hours after deadline
- Violation penalty: "2% per day late (max 20%)"
- If violated: auto-dispute triggers

CTA: "Create Shipping Label"
API: `POST /shipments/:id/label`

**Sub-state B: Label Created (LABEL_CREATED)**

Top section — same shipment header, status badge: cyan "Label created"

Tracking card (cyan border):
- Tracking number: large mono text (e.g. `9400 1118 9922 4127 5543 21`)
- Carrier: USPS Priority
- Label created at: timestamp
- External tracking link button → USPS tracking page
- Label URL / download button (if available)

Shipping rate card:
- Rate: $8.25 (USPS Priority)
- Weight buffer: $1.50 (difference to next tier: "up to 2 lb")
- Gas: $0.00 (Haggle relayer)

Event timeline (1 event so far):
- `14:02` — Label created · Austin, TX (pulse dot = current)

CTA: "Mark as Shipped"
API: `POST /shipments/:id/event` → event_type: "ship"

**Sub-state C: In Transit (IN_TRANSIT → OUT_FOR_DELIVERY)**

Top section — status badge: blue "In transit" (animate pulse)

Tracking card (same as above, always visible)

Estimated delivery card:
- ETA: "April 21, 2026 (3 days)"
- Progress bar: visual percentage based on elapsed vs estimated days
- Distance visual: Austin, TX → Memphis, TN → Brooklyn, NY (city dots on line)

Event timeline (vertical, growing):
```
14:02  ● Label created          Austin, TX
16:40  ● Accepted at origin     Austin, TX
08:15  ◉ In transit             Memphis, TN     ← current (pulse)
```
Each event shows:
- Timestamp (mono, dim)
- Status dot (green for past, cyan pulse for current, gray for future)
- Status label (bold if current)
- Location
- Optional message from carrier

Weight buffer status card:
- Declared: 0.8 lb → tier "up to 1 lb" ($6.00)
- Buffer held: $1.50 (next tier diff)
- "USPS will measure actual weight at processing — if heavier, adjustment applies"
- Status: "Awaiting APV data"

Sub-state advances:
- "In transit" → button: "Advance → Out for delivery" → event: `out_for_delivery`
- "Out for delivery" → button: "Confirm delivery" → event: `deliver`

When out for delivery, add event:
```
11:22  ◉ Out for delivery       Brooklyn, NY    ← current (pulse)
```

CTA changes per sub-state
API: `POST /shipments/:id/event`

**Sub-state D: Delivered → transitions to Step 7**

---

#### Step 7: Delivered

Top section — success icon (large green check circle) + "Delivered at 14:33 · Brooklyn, NY"

Settlement Release schedule card (2-column grid):

| Phase 1: Product Amount | Phase 2: Weight Buffer |
|---|---|
| Amount: $407.79 (92% of seller amount) | Amount: $35.46 (8% of seller amount) |
| Condition: Delivery + 24h buyer review | Condition: USPS weight correction · 14d hold |
| Countdown: "Releases in 23h 57m" | Release date: "May 2, 2026" |
| Status badge: cyan "Active" | Status badge: violet "Held" |

Weight buffer detail card:
- Declared weight: 0.8 lb (12.8 oz) → tier "up to 1 lb"
- Buffer amount: $1.50
- APV status: "Pending USPS measurement"
- If actual weight matches: "Full buffer returned to seller"
- If actual weight higher: "Adjustment = actual tier rate - declared tier rate, deducted from buffer"
- Compensation tiers table:
  | Actual weight | Tier | Adjustment |
  |---|---|---|
  | ≤ 1 lb | Same | $0.00 (full buffer returned) |
  | ≤ 2 lb | +1 | $1.50 (full buffer absorbed) |
  | ≤ 3 lb | +2 | $3.00 (buffer + $1.50 extra) |

Full delivery event log:
```
14:02  ✓ Label created          Austin, TX
16:40  ✓ Accepted at origin     Austin, TX
08:15  ✓ In transit             Memphis, TN
11:22  ✓ Out for delivery       Brooklyn, NY
14:33  ✓ Delivered              Brooklyn, NY    signed for · left at door
```

SLA result card:
- SLA deadline was: April 20
- Actual ship date: April 18
- Status: "Fulfilled" (green badge)
- Days early: 2
- Compensation: $0.00

Dispute option card (subtle, not prominent):
- "Not what you expected?"
- "Open a dispute before the review window closes (23h 57m remaining)"
- Button: "Report an issue" (red border, small)

CTA: "Run demo again" (secondary button)

---

### 4. Always-Visible Bottom Panel: On-Chain Settlement Structure

Visual diagram of smart contract fund flow:

```
Buyer Wallet
    ↓ USDC ($450.00)
[HaggleSettlementRouter] (Base L2)
    ├→ Seller Wallet: $443.25 (98.5%)
    └→ Haggle Fee Wallet: $6.75 (1.5%)
```

If Stripe Onramp selected, show additional:
```
Buyer Credit Card
    ↓ $456.75 (amount + Stripe fee)
[Stripe Onramp]
    ├→ Stripe retains: $6.75 (1.5%)
    └→ USDC $450.00 → Base L2
        ↓
[HaggleSettlementRouter]
    ├→ Seller Wallet: $443.25
    └→ Haggle Fee Wallet: $6.75
```

- Contract address display
- "Non-custodial: Haggle never holds funds. All transfers execute immediately."
- Contract security: EIP-712 signatures, one-time-per-order settlement, asset allowlist, emergency pause, 48h signer rotation delay

### 5. Activity Log (collapsible)

- Each API call: timestamp + action name + result (success: green dot, fail: red dot)
- Newest on top, scrollable

---

## Design System

### Colors
- Background: `#0a0e17` (page), `#111827` (card)
- Primary action: Cyan-500 `#06b6d4`
- Success: Emerald-500
- Warning / Dispute: Red-500
- On-chain info: Purple-500
- Stripe-related: Purple-400
- Text hierarchy: White → Slate-300 → Slate-500 → Slate-600

### Components
- Card: `rounded-2xl border border-slate-800 bg-[#111827]`
- Accent card: `border-cyan-500/20` or `border-emerald-500/20` (translucent border)
- Button Primary: `rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white`
- Button Secondary: `rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500`
- Button Danger: `rounded-xl border border-red-500/30 bg-red-500/10 text-red-400`
- Input: `rounded-xl border border-slate-700 bg-[#0d1321] text-white focus:border-cyan-500`
- Money amounts: `font-mono`
- API hints: `text-[10px] text-slate-600 font-mono text-center`

### Mode
Dark mode only. No light mode.

### Spacing
4px-based grid (p-4, p-5, gap-3, gap-4, mb-6)

### Responsive
Mobile-first. Timeline horizontal on md+, vertical below. Rail select cards side-by-side on md+, stacked on mobile.

### Language
- UI labels: Korean (e.g. "결제 승인", "배송 라벨 생성")
- Technical terms: English alongside (e.g. "결제 준비 (Prepare Intent)")
- All text should be easy to swap to English — use label constants, not hardcoded strings

---

## Smart Contract Reference

### HaggleSettlementRouter.sol
- Purpose: Non-custodial USDC routing from buyer → seller + fee wallet
- Network: Base L2
- Standard: EIP-712 typed signatures
- Key function: `executeSettlement(SettlementParams, signature)`
  - Caller must be buyer (msg.sender == params.buyer)
  - Backend signs params — prevents parameter manipulation
  - Each orderId settles once only
  - Only allowlisted assets (USDC)
  - Atomic: both transfers succeed or both revert
- On-chain transfers:
  1. `IERC20(asset).safeTransferFrom(buyer, sellerWallet, sellerAmount)`
  2. `IERC20(asset).safeTransferFrom(buyer, feeWallet, feeAmount)`
- Security:
  - MAX_FEE_BPS: 1000 (10% cap)
  - MIN_GROSS_AMOUNT: 0.01 USDC
  - SIGNER_ROTATION_DELAY: 48 hours
  - Guardian emergency pause (separate from owner)
  - Ownable2Step (two-phase ownership transfer)
  - ReentrancyGuard
  - EIP-1271 smart contract signer support

### HaggleDisputeRegistry.sol
- Purpose: On-chain anchor for dispute resolutions (immutable evidence/resolution hashes)
- Does NOT hold funds — purely record-keeping
- Key function: `anchorDispute(orderId, disputeCaseId, evidenceRootHash, resolutionHash)`
- Supports: supersede (appeal), revoke (fraud), resolver role management

---

## Data Models

### PaymentIntent
```
Status: CREATED → QUOTED → AUTHORIZED → SETTLEMENT_PENDING → SETTLED | FAILED | CANCELED
Amount: { currency: "USD", amount_minor: number } (cents)
Rails: "x402" (USDC direct) | "stripe" (card onramp)
Fee (x402): 1.5% (150 BPS) → Haggle fee wallet
Fee (stripe): 1.5% Stripe + 1.5% Haggle = 3.0% total
Seller always receives: amount - Haggle fee (98.5%)
```

### Shipment
```
Status: LABEL_PENDING → LABEL_CREATED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED | DELIVERY_EXCEPTION
Carrier: USPS / UPS / FedEx (via EasyPost) or Mock
Events: { status, occurred_at, message, location }[]
```

### SettlementRelease
```
Phase 1 — Product amount: delivery confirmed → 24h buyer review → release to seller
Phase 2 — Weight buffer: held 14 days → USPS weight correction → release remainder
```

---

## API Endpoints Referenced

| Step | Method | Endpoint | Description |
|------|--------|----------|-------------|
| Prepare | POST | `/payments/prepare` | Create payment intent from settlement approval |
| Quote | POST | `/payments/:id/quote` | Calculate fee split, resolve wallets |
| Authorize | POST | `/payments/:id/authorize` | Mark payment as authorized |
| Settle | POST | `/payments/:id/settle` | Execute settlement (auto-creates shipment) |
| Onramp | POST | `/payments/:id/onramp/session` | Create Stripe onramp session (card path) |
| Onramp Status | GET | `/payments/onramp/status` | Check Stripe availability + fee info |
| x402 Requirements | GET | `/payments/:id/x402/requirements` | Get EIP-712 signing requirements |
| Create Label | POST | `/shipments/:id/label` | Generate shipping label via carrier |
| Record Event | POST | `/shipments/:id/event` | Record ship/deliver/exception event |
| Track | POST | `/shipments/:id/track` | Poll carrier for tracking update |
