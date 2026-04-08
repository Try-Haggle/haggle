# Haggle Phase 0 — Community-First Distribution Plan

Generated 2026-04-08 as companion to `2026-04-08_phase0-electronics-wedge.md`
Status: EXECUTION-READY
Scope: Phase 0 (0-6 months), iPhone 14 Pro wedge, US market only

---

## Why Community-First (Not Paid-First)

Paid acquisition math is structurally incompatible with Phase 0 unit economics.

| Item | Value |
|---|---|
| iPhone 14 Pro ASP | ~$620 |
| Haggle fee (1.5%) | ~$9.30 |
| Verification API cost (CheckMEND + carrier) | ~$0.50-1.00 |
| Contribution margin per transaction | **~$8** |
| Google Ads electronics CPC | $3-8 |
| Conversion rate (industry, C2C marketplace) | 1-3% |
| Implied paid CAC (buyer) | **$100-250** |
| Seller-side biological repeat cycle (iPhone alone) | 24 months |
| LTV (iPhone only, 1.2x repeat assumption) | ~$12 |
| **LTV:CAC with paid-first** | **0.08-0.12** |

Conclusion: paid-first is cash incineration. Phase 0 must use community channels to reach unit-economic viability.

## The C2C Chicken-and-Egg Principle

In C2C marketplaces, one side is always the **hard side** and the other follows inventory. For used iPhones in the US:

- **Hard side = sellers**. Supply is scarce because sellers have 3+ credible alternatives (eBay, Swappa, Facebook Marketplace, carrier trade-in) and each has its own friction.
- **Easy side = buyers**. Buyers follow inventory. They will try a new marketplace the moment it has listings they want at prices they want.

**Phase 0 principle: solve sellers first. Buyers follow.**

Haggle's seller-side pitch is concrete and dollar-denominated:
- eBay takes 13% of $620 = $80.60
- Haggle takes 1.5% of $620 = $9.30
- **Seller nets $71 more per transaction on Haggle**

This is a hard number a power seller cannot ignore. The hook is not AI or escrow or anything abstract — it is $71.

---

## Week 1-2: Seller Seeding (target: 50 power sellers)

### Target Communities

| Community | Size | Signal-to-noise | Target count |
|---|---|---|---|
| r/appleswap | 27k | Very high (Apple-only, verified trades) | 25 sellers |
| r/hardwareswap | 400k+ | High (electronics focus) | 10 sellers |
| MacRumors Marketplace forum | ~5k active | Very high (enthusiast, high-value trades) | 10 sellers |
| Swappa seller forums | ~3k active | High (already using Swappa, iPhone-native) | 5 sellers |

### Power Seller Identification Criteria

A "power seller" qualifies for outreach if, in the trailing 30 days, they have:
- Completed 5+ transactions in iPhone Pro or similar high-value electronics
- 100+ accumulated positive feedback points
- No recent scam or dispute flags visible in public profile

Manual identification is required. This is not automatable in Week 1-2.

### Outreach Message Template

```
Subject: quick offer for Apple resellers — 1.5% fee vs eBay's 13%

Hey [username],

I saw your recent trades on [r/appleswap / MacRumors / etc]. I'm launching
Haggle (tryhaggle.ai) — it's a US-only marketplace for used Apple devices,
built around AI-automated negotiation and smart-contract escrow.

The seller-side pitch is simple: we charge 1.5%, eBay charges 13%. On a
$620 iPhone 14 Pro, you net ~$71 more with us.

For our first 50 sellers, first 3 transactions are 0% fee. No lock-in.
If it doesn't work, you go back to eBay/Swappa with zero friction.

Would you try it on your next listing? I'll personally walk you through
the seller attestation flow. Reply here or DM.

— [Founder name]
tryhaggle.ai
```

### Expected Conversion Funnel

```
50 DMs sent
 → 30 reads (60% open rate on targeted Reddit DMs)
 → 15 responses (30-50% response rate on relevant value prop)
 → 10-15 onboarded sellers (conversion to first listing)
```

**Week 2 target:** 30+ live listings on Haggle (2-3 listings per onboarded seller, average).

### Critical Success Factor

The founder or a designated ops person must personally handhold every one of the first 50 sellers through the attestation flow. This is not scalable and that is the point — the first 50 are the data source for the entire attestation UX, and their friction notes become the Week 3-4 engineering backlog.

---

## Week 3-6: Buyer Organic Inflow

Sellers now exist. Buyers must now discover Haggle.

### Seller Cross-Post Incentive

Each onboarded seller is offered a $20 Haggle credit for cross-posting their Haggle listing to r/appleswap with a standard footer:

```
Listed on Haggle — 1.5% fee, AI-automated negotiation, smart contract escrow.
[link to listing]
```

This pushes Haggle listings into the community where buyers already are. The cross-post is visible, auditable, and the credit is paid after the first sale (not upfront, to prevent abuse).

### Haggle-Authored Content

Once the first 5-10 transactions complete, Haggle posts authored case studies:

**Reddit r/appleswap post template:**
```
Title: AI negotiated my iPhone 14 Pro purchase — saved $73 vs HFMI median

[Screenshot of transaction, IMEI and personal info redacted]

I bought a used iPhone 14 Pro 256GB last week on Haggle. Seller listed
at $695. AI ran a 3-round negotiation with seller and settled at $622.

HFMI (Haggle's open-source fair market index) for this exact condition
was $622, so I paid exactly at median. Without AI the seller's opening
at $695 was 35th percentile high — I would have probably paid ~$660 after
manual haggling.

Full attestation flow worked: seller filmed battery health and Find My
off, I verified on receipt, escrow released automatically.

Methodology at tryhaggle.ai/hfmi — AMA
```

### HackerNews Show HN (single post)

After 10+ transactions complete, one carefully crafted Show HN:

```
Show HN: Haggle – AI agent that negotiates used iPhone purchases (10 txns in)

[Link to tryhaggle.ai]

We're building an AI-first marketplace for used Apple devices. The AI negotiates
on the buyer's behalf, settles in USDC, and both sides film a guided attestation
(battery health, Find My off, IMEI) with on-chain hash commitment.

10 transactions completed so far. Average savings vs HFMI (our open fair-price
index): $68. 0 disputes.

Technical bits:
- engine-core (pure TypeScript utility function, 0 external deps)
- dispute-core (DS panel with weighted precedent voting)
- Base L2 smart contracts for escrow + attestation hash
- HFMI methodology published at tryhaggle.ai/hfmi

Would love feedback on the attestation UX and HFMI weighting.
```

### MacRumors Marketplace Forum Thread

One pinned thread documenting real cases as they accumulate. Update weekly with new transaction examples. This is a slow-burn channel that compounds over months.

### Week 6 Targets

- 200 buyer signups
- 20 completed transactions
- 5+ external (non-Haggle) mentions in r/appleswap, r/hardwareswap, or MacRumors

---

## Week 7-12: Content Flywheel

Automation of the Week 3-6 playbook.

### Automated Savings Case Study Generator

Every completed transaction triggers an automated generation of a redacted, shareable case study:

```
Input: transaction_id
Output:
  - 1 high-res PNG (Twitter/LinkedIn-ready)
  - 1 markdown block (Reddit-ready)
  - All PII redacted (IMEI, names, addresses)
  - HFMI comparison chart embedded
  - One-click share to connected social accounts (seller and buyer can opt in)
```

This turns every transaction into a marketing asset at zero marginal cost.

### Mid-Tier YouTube Creator Partnerships

Three Apple-review YouTubers in the 10k-100k subscriber range. Not Marques Brownlee. Think channels that review specific phones, compare carriers, or focus on used-device value.

**Deal structure:**
- $0 upfront
- Revenue share: 50% of Haggle fee on transactions from their referral link for 12 months
- Haggle provides case study data, not scripts (creators keep editorial independence)

**Conversion expectation:** 3 creators × 50k avg subs × 0.5% conversion × 1.5 txns per converted user = ~1,125 transactions over 12 months. If this channel fires, it carries Gate 2.

### Week 12 Targets

- 100 cumulative completed transactions
- 3 active YouTube creator partnerships
- Automated case study generator live and producing 1 asset per transaction
- ≥30 external community mentions

---

## Week 13-24: Gate 2 Pursuit (revised 180-day window)

All prior channels continue. Gate 2 (500 cumulative 14 Pro transactions in trailing 180 days) must be hit by Week 24.

### Paid Ads Enter As Supplement (Month 4+)

Paid ads are introduced only if:
- Community-led CAC exceeds $30 per buyer
- Gate 2 trajectory requires additional buyer pull

**Constraints:**
- Paid budget capped at 5% of total acquisition spend for entire Phase 0
- Google Ads only, no Facebook/Instagram (different audience)
- Exact-match keywords only ("used iphone 14 pro", "iphone 14 pro unlocked", "sell iphone 14 pro")
- Landing page is the iPhone 14 Pro wedge page, not the homepage

### Week 24 Target

- **500+ completed iPhone 14 Pro transactions in trailing 180 days** (Gate 2 cleared)
- Average savings $50+ (Gate 1 cleared)
- Dispute rate ≤5% (Gate 3 cleared)

Hitting all three simultaneously unlocks Phase 1.5 (sneakers).

---

## CAC Budget Allocation (Phase 0, 180-day basis)

| Channel | Cost basis | Estimated total spend | Expected txns |
|---|---|---|---|
| Seller seeding (Week 1-2) | Fee waivers | ~$1,500 | - |
| Seller cross-post incentives | $20/seller × 15 | ~$300 | 30-50 |
| Haggle-authored Reddit/HN/MacRumors | Founder time | $0 | 40-60 |
| Automated case study flywheel | Engineering | $0 marginal | 80-120 |
| YouTube creator partnerships | Rev share only | $0 upfront | 200-400 |
| Paid ads (Month 4+, capped 5%) | ~$5,000 max | ~$5,000 | 50-100 |
| **Total** | | **~$6,800** | **400-730** |

**Implied blended CAC:** ~$10-17 per completed transaction. **LTV:CAC at Apple-ecosystem LTV $25-40: 2-4x.**

This is still not a lavish margin. It is a viable margin.

---

## Failure Modes and Early Warnings

### Failure Mode 1: Seller Seeding Doesn't Convert

**Early warning:** Week 2, fewer than 20+ live listings despite 50+ DMs sent.

**Diagnosis questions:**
- Is the 1.5% vs 13% pitch not landing? (Maybe sellers don't actually pay 13% — Swappa's 3% may be their real baseline)
- Is the attestation flow friction too high for the first-time trial?
- Is there a trust barrier (new brand, no reviews, no volume)?

**Mitigation:** Pivot to founder-as-seller. Haggle ops personally buys iPhones from Swappa, relists them on Haggle, and runs through attestation as seller. Bootstraps listings directly. Slow but eliminates seller risk during first 30 transactions.

### Failure Mode 2: Sellers Exist But Buyers Don't Come

**Early warning:** Week 6, ≥30 listings live but <5 completed buyer-initiated transactions.

**Diagnosis questions:**
- Is r/appleswap cross-posting actually happening? (Check link analytics.)
- Are listings priced competitively vs Swappa for the same device condition?
- Does the landing page convert visitor → signup → transaction?

**Mitigation:** Escalate Reddit presence. Founder posts weekly in r/appleswap with real transaction breakdowns. Single HackerNews Show HN with real numbers. Targeted outreach to MacRumors reviewers.

### Failure Mode 3: Volume Stagnates at ~50-100 txns

**Early warning:** Month 3, cumulative transactions in the 50-100 range with flat week-over-week growth.

**Diagnosis questions:**
- Is the YouTube partnership channel firing? (Track referral links.)
- Is the automated case study flywheel actually generating shares? (Check social analytics.)
- Is there a retention tail from Apple-ecosystem cross-device listings?

**Mitigation:** Allow paid ads earlier than Month 4, but still capped at 5% of spend. Increase creator partnership count from 3 to 6. Extend transaction-wide scope announcements (e.g., "MacBook and iPad now live on Haggle") as organic news hooks.

---

## Execution Checklist (Week 1)

- [ ] Identify 50 power sellers across 4 communities (manual, founder task)
- [ ] Draft outreach message, personalize for each seller
- [ ] Set up Haggle internal CRM to track seller outreach → onboarding funnel
- [ ] Prepare founder onboarding calendar: 30-min walkthrough slots for first 50 sellers
- [ ] Ship Week 1 critical product: attestation flow MVP on mobile web
- [ ] Ship HFMI v0 aggregator (Gazelle + Back Market + eBay sources)
- [ ] Landing page live at tryhaggle.ai with iPhone 14 Pro wedge narrative
- [ ] HFMI methodology page live at tryhaggle.ai/hfmi

---

## Key Metrics Dashboard (Week 1 setup)

Build and deploy an internal dashboard at `/admin/distribution` tracking:

- Seller funnel: DMs sent → reads → responses → onboarded → first listing → first sale
- Buyer funnel: landing page visits → signups → first offer → first completed purchase
- Content flywheel: case studies generated → shares → click-throughs → conversions
- Channel attribution: first-touch source per completed transaction
- CAC per channel (fully-loaded)
- HFMI accuracy: predicted median vs actual completed transaction price (calibration signal)

This dashboard is the companion to the `/admin/inbound-network-signals` dashboard from Garry's Q2 assignment — one tracks distribution health, the other tracks Network-layer transition signals.

---

## Reference to Design Doc

This plan is the distribution companion to:

`docs/strategy/office-hours/2026-04-08_phase0-electronics-wedge.md`

All product-side decisions (attestation flow, HFMI, gate definitions, Phase 1.5 trigger) are specified there. This document is the execution plan for acquiring the transactions that will prove those decisions.
