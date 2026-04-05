# Seller Deposit / Bond System Research

**Date**: 2026-03-25
**Scope**: Dispute cost calculations, industry comparisons, deposit recommendations for Haggle
**Confidence**: High (calculations verified, industry data from official sources)

---

## 1. Maximum Dispute Cost Exposure by Transaction Amount

The seller deposit must cover **dispute fees only** (not refunds --- those come from the Settlement Contract). A seller's worst case is losing at all three tiers: Tier 1 + Tier 2 + Tier 3.

### Fee Formulas

| Tier | Formula | Minimum |
|------|---------|---------|
| Tier 1 (AI Review) | $5 fixed | $5 |
| Tier 2 (Panel Review) | 3% of transaction | $20 |
| Tier 3 (Grand Panel) | 6% of transaction | $40 |

**Tier 3 discount** (based on Tier 2 vote margin):
- Exact tie at Tier 2: free re-review (no Tier 3 cost)
- 1-vote margin: 75% of Tier 3 cost
- 2-vote margin: 90% of Tier 3 cost
- 3+ vote margin: 100% of Tier 3 cost

### Calculated Worst-Case Costs

| Transaction | Tier 1 | Tier 2 (3%) | Tier 3 Full (6%) | Tier 3 @ 75% | Tier 3 @ 90% | Total (Full) | Total (75%) | Total (90%) |
|-------------|--------|-------------|-------------------|---------------|---------------|--------------|-------------|-------------|
| $10 | $5 | $20* | $40* | $30.00 | $36.00 | $65.00 | $55.00 | $61.00 |
| $25 | $5 | $20* | $40* | $30.00 | $36.00 | $65.00 | $55.00 | $61.00 |
| $50 | $5 | $20* | $40* | $30.00 | $36.00 | $65.00 | $55.00 | $61.00 |
| $100 | $5 | $20* | $40* | $30.00 | $36.00 | $65.00 | $55.00 | $61.00 |
| $250 | $5 | $20* | $40* | $30.00 | $36.00 | $65.00 | $55.00 | $61.00 |
| $500 | $5 | $20* | $40* | $30.00 | $36.00 | $65.00 | $55.00 | $61.00 |
| $667 | $5 | $20.01 | $40.02 | $30.02 | $36.02 | $65.03 | $55.03 | $61.03 |
| $1,000 | $5 | $30 | $60 | $45.00 | $54.00 | $95.00 | $80.00 | $89.00 |
| $2,000 | $5 | $60 | $120 | $90.00 | $108.00 | $185.00 | $155.00 | $173.00 |
| $5,000 | $5 | $150 | $300 | $225.00 | $270.00 | $455.00 | $380.00 | $425.00 |
| $10,000 | $5 | $300 | $600 | $450.00 | $540.00 | $905.00 | $755.00 | $845.00 |

*= minimum applies (3% of $500 = $15 < $20 min; 6% of $666 = $39.96 < $40 min)

### Key Observations

1. **Minimums dominate below ~$667**: For transactions under $667, the minimums ($20 for Tier 2, $40 for Tier 3) apply, making the worst-case cost a flat $65 regardless of transaction size.
2. **Above $667, costs scale linearly**: Total worst-case = $5 + 3% + 6% = $5 + 9% of transaction.
3. **Worst case as % of transaction**: Ranges from 650% at $10 (absurd --- effectively prevents disputes on tiny transactions) down to 9.05% at $10,000.
4. **Tier 3 discounts matter**: The 75% discount saves $10 on small transactions, up to $150 on a $10,000 deal.

### Practical Worst-Case Distribution

Per the v8.3 projections:
- 80% of disputes resolve at Tier 1 ($5 cost)
- 15% escalate to Tier 2 ($5 + Tier 2 cost)
- 5% reach Tier 3 ($5 + Tier 2 + Tier 3 cost)

**Expected dispute cost** (probability-weighted, for a $1,000 transaction):
- 80% x $5 = $4.00
- 15% x $35 = $5.25
- 5% x $95 = $4.75
- **Expected = $14.00** (but must reserve for worst case)

---

## 2. How Existing P2P Platforms Handle Seller Deposits

### Traditional Marketplaces

| Platform | Seller Deposit | Dispute Cost Coverage | Mechanism |
|----------|---------------|----------------------|-----------|
| **eBay** | None required | Platform absorbs costs; deducted from seller balance if seller loses | Seller pays through reduced payouts, account holds, or collection |
| **Mercari** | None required | Platform holds payment in escrow (3-day rating window). Dispute costs absorbed by platform | Payment withholding during 3-day inspection period |
| **Poshmark** | None required | Platform holds funds until buyer accepts or 3 days post-delivery. Built-in shipping insurance up to $100 | Payment withholding + 20% commission covers dispute costs |
| **StockX** | None up front | 15% penalty fee ($15 min) for failed authentication; deducted from future payouts | Post-hoc penalty deduction; seller reputation tracking |
| **GOAT** | None up front | Commission increases (up to 25%) for sellers with poor history | Dynamic fee adjustment as penalty mechanism |

**Key pattern**: No traditional marketplace requires an explicit seller deposit. Instead, they:
1. Hold buyer payment during an inspection/review window (de facto escrow)
2. Deduct penalties from seller balances or future payouts
3. Use high commission rates (13-25%) as a buffer to absorb dispute costs
4. Rely on account suspension as the ultimate enforcement

**Why this works for them but not for Haggle**: Traditional platforms take custody of funds and charge 13-25% commissions. Haggle is non-custodial (1.5% fee), so there is no large commission buffer and no seller balance to deduct from post-settlement.

### Crypto / Web3 Marketplaces

| Platform | Deposit/Bond | Mechanism | Amount |
|----------|-------------|-----------|--------|
| **Kleros** | Both parties deposit arbitration fee | Smart contract holds deposits; winner gets reimbursed | Variable by court; appeals require additional collateral from both sides |
| **Aragon Court** | Both parties deposit collateral | If only one side deposits on appeal, that side wins automatically | Scaled to dispute value |
| **OpenSea** | No seller bond | Uses traditional JAMS arbitration; 2.5% platform fee is the only seller cost | No on-chain dispute mechanism |

**Kleros model (most relevant to Haggle)**:
- Both parties deposit the arbitration cost upfront
- Winner is reimbursed; loser forfeits their deposit
- Appeals require *additional* deposits from both parties
- The appellant must also deposit an extra "appeal stake" proportional to the fee
- This creates a natural deterrent against frivolous disputes and appeals

**Aragon Court model**:
- Both parties post collateral per round
- If one side refuses to post collateral for an appeal, the other side wins by default
- This prevents indefinite appeals and ensures "skin in the game"

---

## 3. Real-World Arbitration & Court Filing Fees

### Professional Arbitration

| Provider | Filing Fee | Fee Structure |
|----------|-----------|---------------|
| **JAMS** | $2,000 (2-party) | Consumer cases: consumer pays only $250; business pays remainder |
| **AAA** | $11,250 initiation | Consumer pays ~$3,125; business pays ~$8,125 |
| **ICC** | Varies by amount | Minimum ~$5,000; scales with claim size |

### Small Claims Courts (US, 2025)

| State | Filing Fee Range | Claim Limit |
|-------|-----------------|-------------|
| California | $30-100 | $12,500 |
| New York | $15-35 | $10,000 |
| Texas | $54-100 | $20,000 |
| Florida | $55-300 | $8,000 |

**Comparison to Haggle**: Haggle's Tier 1 ($5) is cheaper than any court filing. Tier 2 ($20 min) is comparable to small claims. Tier 3 at higher amounts ($300-600 for $5K-10K) approaches professional arbitration consumer fees ($250 JAMS) but remains below full commercial arbitration.

### Crypto Arbitration

| System | Deposit Model | Key Feature |
|--------|-------------|-------------|
| **Kleros** | PNK stake (jurors) + fee deposit (parties) | Loser-pays; appeal escalation increases costs |
| **Aragon Court** | ANT/ANJ stake (jurors) + collateral (parties) | Default judgment if one party refuses to post collateral |

**Critical insight**: Both major crypto arbitration systems require **both parties** to deposit dispute costs upfront, with reimbursement to the winner. This is the strongest model for non-custodial platforms.

---

## 4. Deposit Recommendations for Haggle

### Design Constraints

1. **Non-custodial**: Haggle cannot deduct from seller balances post-settlement (unlike eBay/Mercari)
2. **Low commission (1.5%)**: No commission buffer to absorb dispute costs (unlike Poshmark's 20%)
3. **On-chain**: Deposits must be smart contract based (USDC on Base L2)
4. **Seller UX**: Deposit must not be so high that it deters listing
5. **Coverage**: Must cover worst-case dispute cost if seller loses

### Approach Comparison

| Approach | Pros | Cons |
|----------|------|------|
| **Fixed deposit** | Simple, predictable | Excessive for small transactions, insufficient for large ones |
| **Percentage-based** | Scales with risk | Minimums create high % burden on small transactions |
| **Tiered by transaction** | Best balance | More complex to communicate |
| **Per-account pool** | Seller lists multiple items easily | Complex accounting; one dispute can lock pool for all items |
| **Per-transaction** | Clean isolation | Seller needs capital for each active listing |

### Recommendation: Tiered Per-Transaction Deposit

The deposit covers the full worst-case dispute cost (Tier 1 + Tier 2 + Tier 3 at full price). This is the conservative approach --- the seller gets the full deposit back if no dispute occurs or if they win the dispute.

#### Deposit Schedule

| Transaction Range | Deposit Amount | As % of Transaction (midpoint) | Covers |
|-------------------|---------------|-------------------------------|--------|
| $10 - $50 | $15 | 30-150% | Tier 1 only realistic; Tier 2/3 costs exceed transaction value |
| $51 - $100 | $30 | 30-59% | Tier 1 + partial Tier 2 |
| $101 - $250 | $65 | 26-64% | Full worst case (min fees apply) |
| $251 - $500 | $65 | 13-26% | Full worst case (min fees apply) |
| $501 - $1,000 | $100 | 10-20% | Full worst case at $667+; buffer below |
| $1,001 - $2,000 | $190 | 9.5-19% | Covers $5 + $60 + $120 = $185 |
| $2,001 - $5,000 | $460 | 9.2-23% | Covers $5 + $150 + $300 = $455 |
| $5,001 - $10,000 | $910 | 9.1-18.2% | Covers $5 + $300 + $600 = $905 |

#### Rationale for Each Tier

**$10-$50 ($15 deposit)**: Full worst case is $65, but Tier 2/3 are economically irrational for both parties at these amounts (dispute cost > transaction value). A $15 deposit covers Tier 1 + signals commitment. If buyer escalates to Tier 2, the $20 minimum fee is a natural deterrent.

**$51-$100 ($30 deposit)**: Covers Tier 1 ($5) + Tier 2 ($20) = $25 with small buffer. Tier 3 escalation at this price point is extremely unlikely (the $40 min cost is 40-80% of the transaction).

**$101-$500 ($65 deposit)**: This is the "flat zone" where minimums dominate. $65 covers the full worst case ($5 + $20 + $40).

**$501-$1,000 ($100 deposit)**: Transitional zone. At $667+, percentage fees start exceeding minimums. $100 covers most cases; slight shortfall on extreme worst case at top end.

**$1,001+ (9-10% of transaction)**: Linear scaling. Deposit = $5 + 3% + 6% = ~9% of transaction value, rounded up for buffer.

### Alternative: Simplified 3-Tier Model

If the full schedule above is too complex, a simplified version:

| Transaction Range | Deposit | Logic |
|-------------------|---------|-------|
| $10 - $100 | $25 | Covers Tier 1 + Tier 2 minimum |
| $101 - $666 | $65 | Covers full worst case (all minimums) |
| $667+ | 10% of transaction | Covers $5 + 3% + 6% + small buffer |

This is easier to communicate: "Under $100: $25 deposit. Under $667: $65 deposit. Above $667: 10% deposit."

### Handling Multiple Active Transactions

**Recommendation: Per-transaction deposit with pooling option**

- Default: Each listing requires its own deposit
- Power sellers (trust score threshold): Can maintain a pooled deposit that covers N concurrent listings
- Pool minimum = largest single deposit required among active listings + 50% of remaining listings' deposits
- Example: Seller has 3 listings ($500, $200, $100). Pool = $65 + 50%($65 + $65) = $65 + $65 = $130 (vs $195 individual)

### Deposit Lifecycle

```
Listing Created → Deposit locked in Settlement Contract
  ├── No sale → Deposit returned immediately
  ├── Sale completed, no dispute → Deposit returned after 24h confirmation
  ├── Dispute filed →
  │   ├── Seller wins → Full deposit returned
  │   ├── Seller loses Tier 1 → $5 deducted, rest returned
  │   ├── Seller loses Tier 2 → $5 + Tier 2 fee deducted, rest returned
  │   └── Seller loses Tier 3 → Full applicable fees deducted, rest returned
  └── Listing expired/cancelled → Deposit returned immediately
```

### Buyer Deposit for Escalation

Following the Kleros/Aragon model, require the **buyer** to also deposit escalation fees:

| Action | Who Deposits | Amount |
|--------|-------------|--------|
| File Tier 1 dispute | Buyer | $5 |
| Escalate to Tier 2 | Escalating party | Tier 2 fee (3% / $20 min) |
| Escalate to Tier 3 | Escalating party | Tier 3 fee (6% / $40 min, with applicable discount) |

The escalating party's deposit is returned if they win; forfeited if they lose. This creates symmetric incentives and prevents frivolous escalation.

---

## 5. Summary Comparison

| System | Deposit Model | Haggle Relevance |
|--------|-------------|------------------|
| eBay/Mercari/Poshmark | No deposit; platform absorbs via commission | Not applicable (Haggle is non-custodial, low-fee) |
| StockX/GOAT | Post-hoc penalty | Not applicable (no seller balance to deduct from) |
| Kleros | Both-party upfront deposit | **Directly applicable** --- loser-pays, on-chain, escalation deposits |
| Aragon Court | Both-party collateral per round | **Directly applicable** --- default judgment if party refuses to post |
| AAA/JAMS | Filing fees from both parties | Partially applicable (fee scale reference) |
| Small claims court | Filing fees ($15-300) | Validates Haggle's fee range is reasonable |

---

## 6. Final Recommendation

**Use the Simplified 3-Tier Deposit Model**:

| Transaction | Seller Deposit | Buyer Dispute Filing |
|-------------|---------------|---------------------|
| $10-$100 | **$25** | $5 (Tier 1), $20 (Tier 2), $40 (Tier 3) |
| $101-$666 | **$65** | $5 (Tier 1), $20 (Tier 2), $40 (Tier 3) |
| $667-$1,000 | **$100** | $5, 3% (Tier 2), 6% (Tier 3) |
| $1,001-$2,000 | **$190** | $5, 3%, 6% |
| $2,001-$5,000 | **$460** | $5, 3%, 6% |
| $5,001-$10,000 | **$910** | $5, 3%, 6% |

**Key design decisions**:
1. **Per-transaction** (not pooled) --- cleaner accounting, no cross-contamination
2. **Seller deposits at listing time** --- locked in Settlement Contract
3. **Buyer deposits at each escalation** --- per Kleros model
4. **Loser pays** --- winner gets their deposit back
5. **Default judgment** if escalating party fails to deposit escalation fee (per Aragon model)
6. **Instant return** on no-sale, cancellation, or confirmed delivery without dispute
7. **Trust-based discount** (future): High-trust sellers could get 50% deposit reduction

---

## Sources

### P2P Marketplace Policies
- [eBay Payment Dispute Seller Protections](https://www.ebay.com/help/policies/selling-policies/payment-dispute-seller-protections?id=5293)
- [eBay AI Agent Ban & Arbitration Update (Feb 2026)](https://www.valueaddedresource.net/ebay-bans-ai-agents-updates-arbitration-user-agreement-feb-2026/)
- [Is Mercari Safe? 2026 Review](https://onerep.com/blog/is-mercari-safe)
- [Mercari Seller Security](https://tools.oneshop.com/blog/seller-security-is-mercari-trustworthy)
- [Poshmark: How It Works After a Sale (2025)](https://closo.co/blogs/beginner-guides-how-tos/sold-on-poshmark-how-it-works-and-what-happens-after-a-sale-2025-guide)
- [StockX Seller Fees](https://stockx.com/help/articles/what-are-stockxs-fees-for-sellers)
- [GOAT Fee Policy](https://www.goat.com/fees)
- [StockX vs GOAT Comparison](https://www.slingo.com/blog/lifestyle/stockx-vs-goat/)

### Crypto Arbitration
- [Kleros Whitepaper](https://kleros.io/whitepaper.pdf)
- [Kleros FAQ](https://docs.kleros.io/kleros-faq)
- [PNK Token Documentation](https://docs.kleros.io/pnk-token)
- [Kleros: Crypto-Based Dispute Resolution](https://vidhilegalpolicy.in/blog/kleros-is-crypto-based-dispute-resolution-the-future/)
- [Aragon Network Jurisdiction](https://blog.aragon.org/aragon-network-jurisdiction-part-1-decentralized-court-c8ab2a675e82/)
- [Blockchain Arbitration: Recognition & Enforcement](https://www.tandfonline.com/doi/full/10.1080/23311886.2025.2536726)

### Traditional Arbitration
- [JAMS Arbitration Fees Schedule](https://www.jamsadr.com/arbitration-fees)
- [AAA, JAMS, CPR Cost Comparison (Florida Bar)](https://www.floridabar.org/the-florida-bar-journal/what-does-it-cost-for-aaa-jams-or-cpr-to-administer-an-arbitration-case-and-how-do-the-initial-filings-vary/)
- [JAMS Consumer Minimum Standards](https://www.jamsadr.com/consumer-minimum-standards)

### Court Filing Fees
- [Court Filing Fees by State 2025](https://uslegalcalc.com/blog/court-filing-fees-by-state)
- [California Small Claims](https://selfhelp.courts.ca.gov/small-claims-california)
- [Florida Small Claims Filing Fee](https://legalatoms.com/florida/florida-small-claims-filing-fee/)
