# Haggle Landing Page — Claude Design Prompt

> For Claude Design Tool. Create a production-quality landing page.

---

## What is Haggle

Haggle is an AI-powered P2P trade protocol. AI agents negotiate prices on behalf of both buyer and seller, then settle instantly via USDC stablecoin on Base L2 through smart contracts.

**One-liner:** "The protocol where AI negotiates so humans don't have to."

**Company:** Delaware LLC, domain tryhaggle.ai

---

## Why This Page Matters

This is the public-facing business website. It must:
1. Convince Stripe reviewers this is a legitimate business (for payment onboarding)
2. Convert visitors into waitlist signups or demo users
3. Make the fee advantage impossible to ignore — this is our #1 selling point
4. Look credible enough for investors, partners, press

---

## Design Direction

**Theme:** Light mode, warm off-white (#f6f4ee) — same as our checkout flow. Professional, fintech-grade. NOT the typical dark crypto look.

**Typography:** Inter (body) + JetBrains Mono (numbers, code, technical). Clean, modern.

**Color palette:**
- Background: #f6f4ee (warm cream), cards: #ffffff
- Primary accent: Cyan #0891b2 (trust, action)
- Success/money: Emerald #059669
- On-chain/tech: Violet #7c3aed
- Warning: Red #dc2626
- Text: #14141a (ink), #3d3d45 (dim), #6b6b75 (mute), #a29b8d (faint)

**Mood:** Confident but not arrogant. Technical but approachable. Premium fintech — think Stripe's marketing site meets Robinhood's clarity.

---

## Haggle Philosophy — Must Be Felt Throughout the Page

These aren't just about-page copy. They should influence every design decision.

**Mission:** "Democratizing negotiation — everyone deserves to negotiate fairly."
- Not just the rich, not just the aggressive, not just the experienced. AI levels the playing field.

**Vision:** "The standard for P2P trade — like Stripe for payments, OAuth for auth, Haggle for negotiation."

**Core Values (weave into sections, don't list them as bullet points):**
- **Fairness** — Both sides get their own AI agent with equal information and equal power. Haggle is NOT the buyer's agent or the seller's agent. Haggle is the protocol.
- **Transparency** — Fees, trust scores, price sources are always visible. No hidden charges, ever. The settlement receipt shows every cent.
- **Safety** — Smart contract escrow, not "trust us." Non-custodial means we literally cannot take your money.
- **Convenience** — AI does the work. Humans approve the result. One click to list, one click to buy.
- **Honesty** — "AI can be wrong" is stated openly. We don't oversell.

**Design Principles That Should Show in UI:**
1. "User protection over revenue" — The protection timeline section exists because we prioritize buyer safety over fast payouts
2. "Fair to BOTH sides" — Hero should show both buyer saving money AND seller receiving more. Not adversarial.
3. "Simple > Perfect" — Clean page, few elements, strong message. Don't over-design.
4. "Data belongs to users" — We only take transaction fees. No data selling, no ads, no dark patterns.

**Trade-off hierarchy (when in doubt):** Safety > Convenience, Fairness > Revenue, Simple > Perfect, Transparent > Efficient

**How philosophy shows in design:**
- Receipt animation: shows BOTH what buyer pays AND what seller receives — fair to both
- Fee comparison: transparent — we show exact numbers, not vague "low fees"
- Settlement diagram: shows the smart contract, not a black box — transparent
- "Non-custodial" badge everywhere — safety, we never hold funds
- "Both sides get AI" messaging — not "AI helps you beat the seller"

---

## Page Sections (top to bottom)

### 1. Navigation Bar
- Logo: "H" gradient badge (cyan→violet) + "Haggle" text
- Links: How it Works, Pricing, Demo, Docs
- CTA button: "Try Demo" (cyan, small)
- Minimal, clean, sticky on scroll

### 2. Hero Section

**Headline:** "AI negotiates. You keep more."

**Subheadline:** "The P2P marketplace where AI agents handle price negotiation. 1.5% total fee. Payments via smart contract. Non-custodial."

**Two CTA buttons:**
- Primary: "Try AI Negotiation" (cyan)
- Secondary: "See How Much You Save" (outline)

**Hero visual (RIGHT SIDE):** An animated receipt comparison. This is the key visual concept:

#### Receipt Tear Animation (HERO CENTERPIECE)

Show two receipts side by side that morph/transition:

**Receipt A (fading out / tearing away):** A typical eBay seller receipt:
```
═══════════════════════════════
  eBay Seller Receipt
  ─────────────────────────────
  Item: iPhone 14 Pro 128GB
  Sale Price:          $500.00
  ─────────────────────────────
  eBay Final Value Fee  -$65.00
  Payment Processing    -$14.85
  Promoted Listing      -$10.00
  ─────────────────────────────
  Deductions:           -$89.85
  ─────────────────────────────
  YOU RECEIVE:          $410.15
═══════════════════════════════
```
- This receipt has a red tint/overlay
- The deduction lines are highlighted in red
- The "YOU RECEIVE" amount feels painfully low

**Animation:** The eBay receipt tears/peels away (paper tear effect or dissolve), revealing...

**Receipt B (appearing underneath):** A Haggle seller receipt:
```
═══════════════════════════════
  Haggle Settlement Receipt
  ─────────────────────────────
  Item: iPhone 14 Pro 128GB
  Agreed Price:        $500.00
  ─────────────────────────────
  Haggle Fee (1.5%)     -$7.50
  Gas Fee               -$0.00
  ─────────────────────────────
  Deductions:            -$7.50
  ─────────────────────────────
  YOU RECEIVE:          $492.50
  ─────────────────────────────
  Settled via USDC on Base L2
  tx: 0x8f2a...b7c1
  Non-custodial ✓
═══════════════════════════════
```
- Clean white receipt with cyan accents
- The "YOU RECEIVE" amount is large, green, bold
- The difference ($82.35 more) pulses/highlights

**Below receipts:** A simple comparison line:
```
eBay: $410.15 received  →  Haggle: $492.50 received  →  +$82.35 more in your pocket
```

This animation should loop or replay on scroll. The emotional impact: "I'm losing $82 every time I sell on eBay."

#### Alternative/Additional Hero Visual Ideas

**Option B — Live negotiation preview:**
A small floating card showing a real-time AI negotiation in progress:
```
🤖 Buyer AI: "I'll offer $430 given the battery at 89%"
🤖 Seller AI: "Counter at $465 — mint condition screen"
🤖 Buyer AI: "Meet at $450?"
✅ Deal at $450 — both sides satisfied
```
Chat bubbles appearing one by one with typing indicators.

**Option C — Fee waterfall:**
Animated waterfall chart. Start with $500 at the top. eBay's fees cascade down like a waterfall (each fee is a drop), landing at $410. Then Haggle's single small fee drops, landing at $492. The visual gap between $410 and $492 is the hook.

Use whichever is most impactful, or combine them (receipt as main hero, negotiation preview as floating element).

### 3. Trust Bar (logos/badges)
A subtle row of trust indicators:
- "Powered by x402 Protocol" (Linux Foundation)
- "Payments on Base L2"
- "USDC Settlement"
- "Non-custodial"
- "Delaware LLC"

Small, monochrome logos/text. Not flashy — just credibility.

### 4. The Fee Problem (Emotional Section)

**Headline:** "Platform fees are eating your profits"

Show a dramatic comparison. For a $500 iPhone sale:

| Platform | Fee | You Receive | Lost to Fees |
|----------|-----|-------------|-------------|
| Poshmark | 20% | $400.00 | $100.00 |
| eBay | 15.6% | $422.00 | $78.00 |
| StockX | 12% | $440.00 | $60.00 |
| Mercari | 10% | $450.00 | $50.00 |
| **Haggle** | **1.5%** | **$492.50** | **$7.50** |

Make this table interactive — let user change the sale price ($100, $500, $1000, $2000) and watch numbers update.

Below the table, a single powerful stat:
**"The average seller loses $847/year to platform fees. Switch to Haggle."**
(or similar calculated stat)

### 5. How It Works (3 Steps)

Clean horizontal stepper:

**Step 1 — List**
"Take a photo, set your price. AI suggests optimal pricing from market data."
Visual: Phone screenshot of listing creation UI

**Step 2 — AI Negotiates**
"Your AI agent handles the back-and-forth. Fair price for both sides in seconds."
Visual: Chat-style negotiation bubbles with AI avatars

**Step 3 — Instant Settlement**
"USDC payment via smart contract. Funds go directly to your wallet — Haggle never holds your money."
Visual: Settlement Router diagram (simplified version of our on-chain visual — buyer → router → seller + fee)

### 6. On-Chain Settlement (Technical Credibility)

**Headline:** "Non-custodial. Transparent. Atomic."

Show a simplified version of the Settlement Router diagram:
```
Buyer Wallet → [HaggleSettlementRouter] → Seller Wallet (98.5%)
                                        → Haggle Fee (1.5%)
```

Key points (as small cards):
- EIP-712 signed settlements
- One transaction, one block
- Gas paid by Haggle
- Open-source smart contracts

### 7. Two Payment Rails

Show two cards side by side:

**Card A — USDC Direct:**
- "Already have crypto? Pay directly."
- Fee: 1.5% total
- Speed: Instant
- Badge: "Recommended"

**Card B — Card Payment:**
- "No wallet? Pay with any card."
- Fee: 3.0% total (Stripe 1.5% + Haggle 1.5%)
- Speed: ~30 seconds
- Powered by Stripe Crypto Onramp

### 8. Buyer Protection

**Headline:** "Your money is protected at every step"

Visual timeline showing the protection phases:
```
Payment → Escrow → Delivery → 24h Review → Release
                                    ↘ Dispute → Resolution
```

Key points:
- Smart contract escrow — funds locked until delivery confirmed
- 24-hour buyer review period
- 3-tier dispute resolution (auto → panel → arbitration)
- Weight buffer verification (APV)
- On-chain dispute evidence anchoring

### 9. For Developers (Optional — adds Stripe credibility)

**Headline:** "Built on open protocols"

- x402 payment protocol (Linux Foundation)
- MCP integration (ChatGPT, Claude can list items)
- REST API for custom integrations
- Open HNP (Haggle Negotiation Protocol)

Small code snippet showing API usage:
```
POST /negotiations/sessions
{ listing_id, buyer_strategy: "balanced" }

→ AI negotiates automatically
→ Settlement via smart contract
→ Webhook on completion
```

CTA: "View API Docs"

### 10. Company Info (REQUIRED for Stripe)

**Headline:** "Built in Delaware. Backed by protocol."

- Company: Haggle LLC, Delaware
- Domain: tryhaggle.ai
- Contact: hello@tryhaggle.ai
- Mission: "Democratizing negotiation — everyone deserves a fair deal."

Team section (if available) or founding story.

### 11. Final CTA

**Headline:** "Stop losing money to platform fees"

Large comparison:
```
Your next $500 sale:
eBay → you get $410     Haggle → you get $492
                    +$82 more ✨
```

CTA: "Try AI Negotiation — Free Demo"
Secondary: "Join Waitlist — Early members get fee-free trades"

### 12. Footer

- Links: How it Works, Pricing, Demo, API Docs, Privacy, Terms
- Company: Haggle LLC · Delaware · hello@tryhaggle.ai
- Social: Twitter/X, GitHub (smart contracts)
- "Non-custodial · Transparent · Buyer-protected"

---

## Key Design Principles

1. **The receipt animation is the hero** — this single visual should make someone immediately understand why Haggle exists
2. **Numbers are the argument** — every section shows concrete dollar amounts, not vague claims
3. **Light theme = trust** — dark crypto sites feel sketchy to mainstream users. Warm, bright, fintech-grade.
4. **Mobile-first** — receipt animation works on phone screens
5. **Speed** — page should feel fast. No heavy assets. CSS animations over JS where possible.
6. **Credibility markers** — Delaware LLC, x402 Linux Foundation, smart contract addresses visible. We are legitimate.

## Interactive Elements

1. **Receipt tear animation** — loops on hero, replays on scroll
2. **Fee comparison table** — price slider ($100-$2000) updates all platform fees live
3. **Live negotiation preview** — floating chat bubbles with typing indicators
4. **Settlement diagram** — animates flow when scrolled into view
5. **Protection timeline** — steps highlight as user scrolls

## Text Tone

- Professional English
- Confident, direct statements ("Stop overpaying" not "Consider reducing fees")
- Numbers first, explanation second
- Short sentences. No corporate jargon.
- Technical terms used correctly (USDC, EIP-712, Base L2) — we know our stuff

## What This Page Must Communicate in 5 Seconds

A visitor glancing at the hero for 5 seconds should understand:
1. **What:** AI negotiates prices for P2P trades
2. **Why:** You keep $82 more per sale vs eBay
3. **How:** Smart contract, 1.5% fee
4. **Trust:** Real company, real protocol, non-custodial

---

## Technical Notes for Implementation

- This will be a Next.js page at `apps/web/src/app/(marketing)/landing.tsx`
- Use Inter + JetBrains Mono (Google Fonts, already in project)
- Animations: CSS keyframes preferred, React state for interactive elements
- Images: Use CSS/SVG for all visuals (no external image assets needed)
- The receipt should be rendered as styled HTML, not an image (for text selection/SEO)
- Responsive: stack receipts vertically on mobile, horizontal on desktop
