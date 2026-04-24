# Haggle Dispute Resolution Center — Claude Design Prompt

> For Claude Design Tool. Create four production-quality HTML pages for the dispute resolution system.
> This shares the SAME design system as the Haggle Landing Page — refer to it for all tokens, fonts, colors, and component patterns.

---

## Context: What is the Dispute System

Haggle uses a 3-tier dispute resolution system modeled after a jury trial. When a buyer or seller has an issue with a transaction, they can open a dispute. The system escalates through tiers if either party is unsatisfied.

**Important terminology:** Haggle CANNOT use legal terms like "lawyer", "attorney", "judge", or "court". Instead:
- Lawyer/Attorney → **"AI Advocate"** (구매자측 AI Advocate, 판매자측 AI Advocate)
- Judge → **"AI Arbiter"** (T1 only)
- Jury → **"Community Reviewers"** or **"Review Panel"** (T2/T3)
- Court → **"Resolution Center"**
- Trial → **"Review"**
- Verdict → **"Decision"** or **"Outcome"**
- Evidence → **"Supporting Materials"** (or just "Evidence" — this one is fine)
- Expert Witness → **"Specialist Verification"** (e.g., LegitApp for luxury goods)

**The 3 Tiers:**

| Tier | Name | Who Decides | Cost | Speed |
|------|------|-------------|------|-------|
| T1 | AI Review | AI Arbiter (automated) | $5 flat (or 0.5% if >$600) | Minutes |
| T2 | Panel Review | 3–27 Community Reviewers | ~1.2% of transaction | 24–48 hours |
| T3 | Grand Panel | 5–31 Community Reviewers | ~6% of transaction | 48–72 hours |

**Key Principles to SHOW in the design:**
1. **Fair to BOTH sides** — Each side gets their own AI Advocate. The system is neutral.
2. **Loser pays** — Dispute cost is always borne by the losing party. This deters frivolous disputes.
3. **Transparent** — Every cost, every step, every timeline is visible. No hidden fees.
4. **On-chain evidence** — Evidence is anchored on-chain for tamper-proof records.
5. **Community-driven** — Real users (who passed a qualification test) serve as reviewers.
6. **AI assists, humans decide** — AI summarizes and advocates; humans (or AI at T1) make the final call.

---

## Design Direction

**Tone:** MORE serious than the landing page. This is where real money disputes are resolved. Think law-firm-meets-fintech. Professional, trustworthy, calm under pressure.

**Key differences from landing page:**
- Less playful animations, more deliberate state transitions
- More structured information hierarchy
- Heavier use of cards, panels, and dividers to separate concerns
- Status indicators and progress tracking are critical
- Color usage is more restrained — accent colors signal meaning (red=urgent, emerald=resolved, amber=pending, cyan=action)

**Shared design system (from landing page):**
- Background: #f6f4ee (warm cream), cards: #ffffff
- Typography: Inter (body) + JetBrains Mono (numbers, code, IDs, timestamps)
- Font: `font-feature-settings: "cv11","ss01","ss03"`
- Accent: Cyan #0891b2 (primary action), Violet #7c3aed (on-chain/tech), Emerald #059669 (success), Red #dc2626 (urgent/loss)
- Additional for disputes: Amber #b45309 (pending/warning), Slate #475569 (neutral status)
- Shadows: same shadow-sm, shadow, shadow-lg tokens
- Radius: 14px (cards), 10px (buttons), 6px (small elements)
- Components: `.btn`, `.btn-primary`, `.btn-ghost`, `.eyebrow`, `.mono` classes

**NEW dispute-specific colors:**
- `--dispute-bg: #faf9f6` — slightly warmer than main bg for dispute pages
- `--status-open: #b45309` (amber)
- `--status-review: #0891b2` (cyan)
- `--status-waiting: #7c3aed` (violet)
- `--status-resolved: #059669` (emerald)
- `--status-closed: #6b6b75` (mute)

---

## Pages to Design (3 total)

### PAGE 1: Buyer's Dispute View (`dispute-buyer.html`)

The buyer opened a dispute. They see their case from the buyer's perspective.

**Layout:** Single-column centered (max-width 880px), with a sticky sidebar on desktop showing the case summary.

#### Top: Case Header
```
[OPEN · T1 AI Review]                                    Case #DSP-2847
───────────────────────────────────────────────────────────────────────
iPhone 14 Pro 128GB · $500.00
Seller: @mike_deals · Trust Score 72
Opened: Apr 19, 2026 · 14:32 UTC
Reason: Item not as described
```
- Status badge: amber pill for OPEN, with tier indicator
- Case ID in JetBrains Mono
- Item + price prominent
- Seller info (linked, with trust score badge)
- Reason code displayed prominently

#### Section: Timeline / Progress Bar
Horizontal progress bar showing dispute lifecycle:
```
[Opened] ──── [Evidence] ──── [AI Review] ──── [Decision] ──── [Settlement]
   ✓              ●               ○               ○               ○
```
- Filled nodes for completed steps, pulsing node for current, empty for future
- Below each node: timestamp or ETA
- If escalated: show branch `[T1 Decision] → [Escalate to T2] → [Panel Review] → ...`

#### Section: Your AI Advocate (Buyer Side)
This is the AI assistant that builds the buyer's case. Chat-style interface.

**Header:**
```
🛡 Your AI Advocate
Building your case · Analyzing evidence
```

**Chat messages (styled like the landing page negotiation bubbles but more serious):**
```
[AI Advocate]: I've reviewed your submission. Here's your case summary:

  📋 Key Claim: Battery health was listed as 95% but measured at 82%
  📸 Evidence: 2 photos uploaded, 1 screenshot of listing
  📊 Market Impact: 13% battery degradation = ~$65 value reduction

  Strength Assessment: ██████████░ 85% — Strong case
  
  Recommendation: This evidence strongly supports your claim. 
  The 13% discrepancy exceeds the 5% tolerance threshold.

[You]: What happens next?

[AI Advocate]: Your case will now go to AI Review (Tier 1). 
  The AI Arbiter will examine both sides within minutes.
  
  If you're unsatisfied with the T1 decision, you can escalate 
  to a Community Panel (Tier 2) for $12.00.
  
  ⚠️ Important: If you escalate and lose, you pay the dispute cost.
```

- Chat area should feel professional but accessible
- AI Advocate messages have a subtle cyan left border
- User messages have standard styling
- Strength assessment shown as a progress bar with percentage
- Warnings (like escalation cost) shown in amber-bordered cards

#### Section: Evidence Submitted
Grid of evidence cards:
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 📸 Photo 1   │  │ 📸 Photo 2   │  │ 📝 Text      │
│ Battery       │  │ Listing      │  │ Description   │
│ screenshot    │  │ screenshot   │  │ of issue      │
│ Apr 19, 14:35 │  │ Apr 19, 14:36│  │ Apr 19, 14:32 │
│ ✓ Anchored   │  │ ✓ Anchored   │  │ ✓ Anchored    │
└──────────────┘  └──────────────┘  └──────────────┘
```
- Each card shows type icon, brief description, timestamp
- "Anchored" badge (with small chain icon) = evidence hash stored on-chain
- Upload button for adding more evidence (if still in evidence collection phase)

#### Section: Dispute Cost Breakdown
Transparent cost card:
```
┌─ Dispute Cost ──────────────────────────────────┐
│                                                  │
│  Tier 1 (AI Review)              $5.00           │
│  ──────────────────────────────────────          │
│  Paid by: Losing party                           │
│  Current escrow: $500.00 (held in smart contract)│
│                                                  │
│  If escalated to Tier 2:         $12.00          │
│  If escalated to Tier 3:         $30.00          │
│                                                  │
│  ℹ️ You only pay if you lose.                     │
│  The winner's costs are fully refunded.          │
└──────────────────────────────────────────────────┘
```

#### Section: Case Status Updates (Reverse chronological)
```
Apr 19, 15:01 · AI Arbiter reviewing case...
Apr 19, 14:40 · Seller submitted response
Apr 19, 14:36 · Evidence uploaded (2 photos)
Apr 19, 14:32 · Dispute opened — Item not as described
```

#### Sticky Sidebar (Desktop)
```
┌─ Case Summary ─────────────┐
│ Case #DSP-2847             │
│ Status: OPEN               │
│ Tier: T1 (AI Review)       │
│ Item: iPhone 14 Pro        │
│ Amount: $500.00            │
│ Escrow: $500.00 (held)     │
│                            │
│ [Escalate to T2 — $12]     │
│ [Withdraw Dispute]         │
└────────────────────────────┘
```

---

### PAGE 2: Seller's Dispute View (`dispute-seller.html`)

The seller is responding to a dispute. Their view is a mirror of the buyer's but from the defense perspective.

**Same layout structure as buyer view**, but with these differences:

#### AI Advocate (Seller Side)
```
🛡 Your AI Advocate
Defending your position · Reviewing buyer's claims
```

**Chat:**
```
[AI Advocate]: The buyer claims the battery health is 82% vs your listed 95%.
  I've analyzed the situation:

  📋 Their Claim: Battery at 82%, listed as 95%
  📸 Their Evidence: Battery screenshot (post-delivery)
  
  📋 Your Position: 
  You listed battery at 95% with a screenshot taken at listing time.
  
  🔍 Analysis: 
  - Battery health can decrease with usage (normal: 1-2% over 2 weeks)
  - 13% gap is unusual for 5 days of ownership
  - Your listing screenshot shows 95% — this is strong evidence
  
  Defense Strength: ████████░░ 72% — Moderate
  
  Recommended Action: Upload your original battery screenshot 
  with EXIF data to prove the timing. This will strengthen 
  your case significantly.

[You]: Here's the screenshot from when I listed it [photo]

[AI Advocate]: Excellent. EXIF data shows this was taken Apr 12 — 
  7 days before the dispute. Battery shows 95%. 
  This is now in evidence.
  
  Updated Strength: ██████████░ 88% — Strong defense
```

#### Seller-specific sections:
- **Deposit requirement card** (if T2/T3): "You must deposit $12.00 within 48 hours to contest this dispute. Failure to deposit = automatic loss."
- **Response deadline** prominent countdown timer
- **Counter-evidence upload** section with guidance from AI Advocate
- Same cost breakdown but from seller's perspective

#### Seller Sidebar
```
┌─ Case Summary ─────────────┐
│ Case #DSP-2847             │
│ Status: WAITING FOR YOU    │
│ Tier: T1 (AI Review)       │
│ Item: iPhone 14 Pro        │
│ Amount: $500.00            │
│ Escrow: $500.00 (held)     │
│                            │
│ ⏰ Respond by: 48:00:00    │
│                            │
│ [Submit Response]          │
│ [Accept Buyer's Claim]     │
└────────────────────────────┘
```

---

### PAGE 3: T2 Panel Review View (`dispute-panel.html`)

This shows the case AFTER T1 decision, when it's been escalated to T2 Community Panel Review. This view is split — showing what both parties see.

**Layout:** Two-column split view with shared center panel.

#### Top: Escalation Banner
```
⚡ Escalated to Tier 2 — Community Panel Review
9 reviewers have been assigned · Voting period: 48 hours
Decision expected by: Apr 22, 2026 · 14:32 UTC
```

#### Left Column: Buyer's Case (summarized by Buyer AI Advocate)
```
┌─ Buyer's Position ──────────────────┐
│ 🛡 Buyer AI Advocate Summary        │
│                                      │
│ "The battery health was advertised   │
│ at 95% but measured only 82% upon    │
│ receipt. This 13% discrepancy        │
│ represents approximately $65 in      │
│ value reduction. The buyer requests  │
│ a full refund."                      │
│                                      │
│ Evidence:                            │
│ · 📸 Battery screenshot (82%)       │
│ · 📸 Listing screenshot (95%)       │
│ · 📝 Detailed description           │
│                                      │
│ Key Argument:                        │
│ 13% gap exceeds normal variance      │
│ (1-2% over 2 weeks)                  │
└──────────────────────────────────────┘
```

#### Right Column: Seller's Case (summarized by Seller AI Advocate)
```
┌─ Seller's Position ─────────────────┐
│ 🛡 Seller AI Advocate Summary        │
│                                      │
│ "Battery was 95% at time of sale,    │
│ verified by EXIF-dated screenshot.   │
│ The 13% decrease in 5 days suggests  │
│ either heavy usage or a different    │
│ measurement condition. Seller acted  │
│ in good faith with accurate listing."│
│                                      │
│ Evidence:                            │
│ · 📸 Original battery screenshot    │
│   (95%, EXIF: Apr 12)               │
│ · 📸 Shipping confirmation          │
│ · 📝 Listing accuracy statement     │
│                                      │
│ Key Argument:                        │
│ EXIF data proves 95% at listing      │
│ Normal usage cannot cause 13% drop   │
└──────────────────────────────────────┘
```

#### Center: Core Question for Reviewers
```
┌─────────────────────────────────────────────────┐
│  ⚖️ Core Question                               │
│                                                  │
│  "Is a 13% battery health discrepancy            │
│  (listed 95% → received 82%) grounds             │
│  for a refund, given the seller's EXIF           │
│  evidence showing 95% at listing time?"          │
│                                                  │
│  [Full Refund to Buyer]                          │
│  [No Refund — Seller Keeps Payment]              │
│  [Partial Refund: ___% ]                         │
│                                                  │
│  ℹ️ Specialist Verification Available:            │
│  LegitApp battery analysis requested — pending   │
└─────────────────────────────────────────────────┘
```

#### Panel Status Section
```
Reviewers: 9 assigned · 6 voted · 3 remaining
Voting Deadline: 38:24:15 remaining

Vote Distribution (anonymized until close):
████████░░ — Voting in progress
```

#### Below: AI Chat for Each Party
Both buyer and seller have their own chat section where they can talk to their AI Advocate about the ongoing review:

**Buyer's Chat:**
```
[You]: What's happening with the panel review?

[AI Advocate]: 6 of 9 reviewers have voted. 
  The voting period closes in 38 hours.
  
  I've also requested a Specialist Verification 
  from LegitApp for battery analysis. This may 
  provide additional evidence if the panel needs it.
  
  📊 Based on similar cases in our records:
  Battery discrepancies >10% typically favor the buyer.
  Your case strength remains strong.
```

**Seller's Chat (separate, private):**
```
[You]: Can I add more evidence?

[AI Advocate]: The evidence submission window has closed 
  for T2 review. However, your existing EXIF-dated 
  screenshot is strong evidence.
  
  If you're unsatisfied with the T2 outcome, you can 
  escalate to T3 (Grand Panel) for approximately $30.
  
  ⚠️ Note: If you escalate and lose at T3, 
  the dispute cost increases to ~$30.
```

#### Settlement Preview
```
┌─ If Buyer Wins ─────────┐  ┌─ If Seller Wins ────────┐
│ Buyer receives: $500.00  │  │ Buyer receives: $0.00   │
│ Seller receives: $0.00   │  │ Seller receives: $488.00│
│                          │  │                          │
│ Dispute cost: $12.00     │  │ Dispute cost: $12.00     │
│ Paid by: Seller          │  │ Paid by: Buyer           │
│                          │  │                          │
│ Reviewers: $8.40 (70%)   │  │ Reviewers: $8.40 (70%)   │
│ Platform: $3.60 (30%)    │  │ Platform: $3.60 (30%)    │
│                          │  │                          │
│ Seller deposit: Forfeited│  │ Seller deposit: Refunded │
└──────────────────────────┘  └──────────────────────────┘
```

---

### PAGE 4: Reviewer's Voting View (`dispute-reviewer.html`)

This is the page a Community Reviewer sees when they're assigned to vote on a dispute. This is the "jury duty" experience — it must be efficient, clear, and make the reviewer feel respected and informed.

**Design goal:** Make reviewing feel rewarding, not tedious. Quick to scan, easy to decide, clear impact of your vote.

**Layout:** Single-column, focused reading experience (max-width 760px). No distractions. Like a well-designed article reading app.

#### Top: Assignment Header
```
┌─────────────────────────────────────────────────────────────────┐
│  ⚖️ Review Assignment                           Case #DSP-2847  │
│                                                                  │
│  iPhone 14 Pro 128GB · $500.00 · Tier 2 Panel                   │
│  Reason: Item not as described                                   │
│                                                                  │
│  ⏰ Voting deadline: 36:42:18 remaining                          │
│  💰 Estimated reward: $4.20 (if majority)                        │
│  ⚡ Slot usage: 1/3                                              │
└─────────────────────────────────────────────────────────────────┘
```
- Prominent countdown timer for voting deadline
- Estimated reward shown clearly (motivational)
- Slot usage indicator (how many of their 3 slots this case uses)
- Tier badge and case metadata

#### Section: Case Briefing (AI-Generated Summary)

This is the **neutral** summary prepared by the system. Unlike the buyer/seller AI Advocates, this briefing presents BOTH sides fairly without advocacy.

```
┌─ Case Briefing ─────────────────────────────────────────────────┐
│                                                                  │
│  📋 Dispute Summary                                              │
│  Buyer claims battery health was listed at 95% but measured     │
│  at 82% upon receipt — a 13% discrepancy.                       │
│                                                                  │
│  ─────────────────────────────────────────────────────────────   │
│                                                                  │
│  🔵 Buyer's Position (AI Advocate Summary):                      │
│  "Battery health 95% listed → 82% received. 13% gap exceeds    │
│  normal variance (1-2%/week). Evidence: post-delivery battery   │
│  screenshot showing 82%."                                        │
│                                                                  │
│  🟣 Seller's Position (AI Advocate Summary):                     │
│  "Battery was 95% at listing time — EXIF-dated photo proves     │
│  this. 5 days of buyer usage could reduce battery health.       │
│  Seller acted in good faith."                                    │
│                                                                  │
│  ─────────────────────────────────────────────────────────────   │
│                                                                  │
│  ⚖️ Core Question:                                               │
│  Is a 13% battery discrepancy (95% listed → 82% received)      │
│  grounds for a refund, given seller has EXIF evidence showing   │
│  95% at listing time?                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

- Clean, scannable layout
- Buyer position in cyan-tinted card
- Seller position in violet-tinted card
- Core question prominently displayed in larger font
- Neutral tone throughout — no advocacy language

#### Section: Evidence Gallery

Two columns — buyer's evidence left, seller's evidence right.

```
┌─ Buyer's Evidence ──────────┐  ┌─ Seller's Evidence ─────────┐
│                              │  │                              │
│  📸 Battery Screenshot       │  │  📸 Original Battery Photo   │
│  [Image: 82% battery]       │  │  [Image: 95% battery]       │
│  Taken: Apr 19, 2026        │  │  EXIF Date: Apr 12, 2026    │
│  ✓ Hash anchored on-chain   │  │  ✓ Hash anchored on-chain   │
│                              │  │                              │
│  📸 Listing Screenshot       │  │  📦 Shipping Confirmation    │
│  [Image: "95%" in listing]  │  │  [Tracking: delivered Apr 17]│
│  Taken: Apr 19, 2026        │  │  ✓ Hash anchored on-chain   │
│  ✓ Hash anchored on-chain   │  │                              │
│                              │  │  📝 Statement                │
│  📝 Text Description         │  │  "Battery was verified at    │
│  "I received the phone and  │  │  95% before shipping..."     │
│  immediately checked..."     │  │                              │
│                              │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
```

- Clickable images expand to full view
- EXIF metadata highlighted when relevant
- On-chain hash badge on each piece of evidence
- Clear separation between buyer and seller evidence

#### Section: Specialist Verification (Optional, if applicable)

```
┌─ 🔬 Specialist Verification ────────────────────────────────────┐
│                                                                  │
│  Provided by: LegitApp Battery Analysis                          │
│  Status: ✓ Complete                                              │
│                                                                  │
│  Finding: "Battery health degradation from 95% to 82% in 5     │
│  days is inconsistent with normal usage patterns. Typical        │
│  degradation: 0.5-1% per week under heavy use."                  │
│                                                                  │
│  Confidence: 87%                                                 │
│  ℹ️ This is an automated analysis and may not account for all   │
│  factors. Use as supporting evidence, not sole basis.            │
└──────────────────────────────────────────────────────────────────┘
```

- Subtle different background (very light blue/gray) to distinguish from party evidence
- Confidence level shown
- Honesty disclaimer always present ("AI can be wrong")

#### Section: Your Vote (THE KEY INTERACTION)

This is the most important UI on the page. Must be dead simple.

```
┌─ Cast Your Vote ────────────────────────────────────────────────┐
│                                                                  │
│  What percentage should go to the buyer?                         │
│                                                                  │
│  0% ────────────────────●────────────────────── 100%             │
│  (Seller wins fully)    72%         (Buyer wins fully)           │
│                                                                  │
│  ┌─ Quick Options ─────────────────────────────────────┐        │
│  │                                                      │        │
│  │  [0% — Seller wins]  [50% — Split]  [100% — Buyer]  │        │
│  │                                                      │        │
│  │  [25% — Mostly seller]  [75% — Mostly buyer]         │        │
│  │                                                      │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  Your vote: 72% to buyer ($360 refund, seller keeps $140)        │
│                                                                  │
│  ─────────────────────────────────────────────────────────       │
│                                                                  │
│  📝 Optional: Brief reasoning (visible after voting closes)      │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ 13% gap is too large for 5 days of use, but seller  │        │
│  │ did have evidence of 95% at listing...              │         │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  [Submit Vote]                                                   │
│                                                                  │
│  ⚠️ Your vote is final and cannot be changed.                    │
│  ⚠️ Voting with the majority earns $4.20.                        │
│     Minority votes receive $0.                                   │
└──────────────────────────────────────────────────────────────────┘
```

- **Slider (0-100):** The primary input. 0 = full seller win, 100 = full buyer refund
- **Quick option buttons:** Preset values for common decisions
- **Live calculation:** As slider moves, show dollar amounts (buyer refund / seller keeps)
- **Optional reasoning:** Text field for brief explanation (shown anonymously post-vote)
- **Clear warnings:** Vote is final, majority/minority consequences stated
- **Submit button:** Large, primary cyan, with confirmation dialog

#### Section: Your Reviewer Profile (Collapsible)

```
┌─ Your DS Profile ───────────────────────────────────────────────┐
│                                                                  │
│  Tier: ⭐⭐⭐ GOLD (Score: 67/100)                                │
│  Vote Weight: 1.10x                                              │
│  Cases Reviewed: 43                                              │
│  Zone Hit Rate: 78%                                              │
│  Active Slots: 1/3                                               │
│                                                                  │
│  Specializations:                                                │
│  · Electronics 📱 (89% hit rate, 22 cases)                       │
│  · Luxury Goods 👜 (71% hit rate, 11 cases)                      │
│                                                                  │
│  Recent Earnings:                                                │
│  · Last 7 days: $18.60 (4 cases)                                 │
│  · Last 30 days: $62.40 (14 cases)                               │
│                                                                  │
│  ──────────────────────────────────────────────────              │
│  Next tier (PLATINUM): 4 more points needed                      │
│  ████████████████████░░░░ 67/71                                  │
└──────────────────────────────────────────────────────────────────┘
```

- DS tier with star visual (BRONZE ⭐ to DIAMOND ⭐⭐⭐⭐⭐)
- Vote weight (how much their vote counts)
- Zone hit rate (accuracy metric)
- Tag specializations with category icons
- Earnings summary (motivational)
- Progress bar toward next tier (gamification)

#### Section: Similar Past Cases (Reference, Collapsible)

```
┌─ 📚 Similar Cases ──────────────────────────────────────────────┐
│                                                                  │
│  Case #DSP-1892 · iPhone 13 · Battery 91% → 78% (13% gap)      │
│  Outcome: 80% to buyer · Panel strength: Strong                  │
│  ────                                                            │
│  Case #DSP-2103 · iPhone 14 · Battery 96% → 89% (7% gap)       │
│  Outcome: 30% to buyer · Panel strength: Moderate                │
│  ────                                                            │
│  Case #DSP-2445 · Galaxy S23 · Battery 94% → 85% (9% gap)      │
│  Outcome: 60% to buyer · Panel strength: Strong                  │
│                                                                  │
│  💡 Pattern: Battery gaps >10% typically favor buyer (70%+)      │
└──────────────────────────────────────────────────────────────────┘
```

- Shows anonymized past cases with similar characteristics
- Outcome percentages and panel strength
- Pattern insight at the bottom (from precedent DB)
- Helps reviewers maintain consistency with past decisions

#### Post-Vote View (After Submission)

Once the reviewer votes, the page transitions to:

```
┌─────────────────────────────────────────────────────────────────┐
│  ✓ Vote Submitted                                                │
│                                                                  │
│  Your vote: 72% to buyer                                         │
│  Submitted: Apr 20, 2026 · 09:15 UTC                            │
│                                                                  │
│  Results will be available when voting closes.                    │
│  Estimated: Apr 22, 2026 · 14:32 UTC                            │
│                                                                  │
│  ──────────────────────────────────────────────────              │
│  Voting Progress: 7/9 reviewers voted                            │
│  ████████████████████████░░░ 78%                                 │
│                                                                  │
│  [View My Other Active Cases →]                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Post-Decision View (After All Votes In)

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 Case #DSP-2847 — Decision Reached                            │
│                                                                  │
│  Outcome: 75% to buyer ($375 refund)                             │
│  Panel Strength: Strong (82% agreement)                          │
│  Your Vote: 72% — ✓ In Majority                                  │
│                                                                  │
│  ──────────────────────────────────────────────────              │
│                                                                  │
│  💰 Your Reward: $4.20                                            │
│  ⭐ DS Impact: +0.8 (zone hit: within 3% of median)              │
│                                                                  │
│  Vote Distribution (anonymized):                                 │
│  ██ 15%  ████ 30%  █████████████████ 72%  ████████ 75%  ██ 80%  │
│  ─────────────────────────────────────────────────────           │
│  median: 75% │ agreement zone: 60-90% │ your vote: 72% ✓        │
│                                                                  │
│  Peer Reasoning (anonymized):                                    │
│  · "13% in 5 days is abnormal, but seller had EXIF proof"       │
│  · "Partial refund fair — degradation too fast for normal use"   │
│  · "Similar to DSP-1892, battery gaps >10% = buyer favored"     │
└─────────────────────────────────────────────────────────────────┘
```

- Clear outcome with dollar amounts
- Whether the reviewer was in majority or minority
- Reward earned (or $0 if minority)
- DS score impact
- Vote distribution visualization (dot plot or histogram)
- Agreement zone highlighted
- Anonymized peer reasoning (educational)

---

## Shared Components Across All Pages

### AI Advocate Chat Component
- Clean chat interface with message bubbles
- AI messages have a subtle left border (cyan for buyer advocate, violet for seller advocate)
- User messages are right-aligned, neutral background
- Typing indicator (reuse landing page's `.typing` dots)
- Expandable analysis cards within messages
- Strength meter (progress bar with percentage)
- Warning cards (amber border) for cost/escalation info
- Chat input at bottom with "Ask your AI Advocate" placeholder

### Status Badge Component
```css
/* Reuse pill styling from landing page */
.status-open { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.status-review { background: #ecfeff; color: #0891b2; border: 1px solid #cffafe; }
.status-waiting { background: #f5f3ff; color: #7c3aed; border: 1px solid #ede9fe; }
.status-resolved { background: #ecfdf5; color: #059669; border: 1px solid #bbf7d0; }
.status-closed { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
```

### Evidence Card Component
- Thumbnail (image) or icon (text/tracking)
- Type label
- Timestamp in JetBrains Mono
- "On-chain anchored" badge with chain-link icon
- Click to expand/view

### Cost Calculator Component
Interactive component where user can see dispute costs at each tier:
- Current tier cost highlighted
- Future tier costs shown (grayed)
- "Loser pays" principle clearly stated
- Settlement breakdown (who gets what)

### Timeline Component
- Horizontal on desktop, vertical on mobile
- Each node: icon + label + timestamp
- Active node pulses subtly (like landing page's protection timeline)
- Completed nodes have checkmark + emerald color
- Future nodes are gray/dashed

---

## Animations (Subtle, Purposeful)

Unlike the landing page, animations here are **restrained and meaningful**:
1. **Status transitions**: Smooth color/icon transition when status changes
2. **Timeline progress**: Fill bar animates when a step completes
3. **Chat messages**: Fade-in with slight upward motion (like landing page bubbles but slower)
4. **Evidence cards**: Subtle scale on hover (1.02), lift shadow
5. **Cost numbers**: Counter animation when tier changes
6. **Voting progress**: Smooth width transition on the progress bar
7. **AI Advocate typing**: Reuse landing page typing indicator dots

**No animations:** No receipt tear, no floating chips, no sparkles. This is serious business.

**`prefers-reduced-motion`:** All animations must respect this.

---

## Responsive Behavior

- **Desktop (>1024px):** Two-column layout with sticky sidebar or split view
- **Tablet (768-1024px):** Single column, sidebar collapses to top summary card
- **Mobile (<768px):** Full single column, chat becomes full-width, timeline becomes vertical

---

## Text Tone

- **Professional but human.** Not cold, not casual.
- **Clear warnings about costs.** Never hide the fact that escalation costs money.
- **Empathetic but neutral.** "We understand this is frustrating" but never "You're right."
- **AI honesty.** Strength assessments say things like "moderate" not "guaranteed win."
- **Korean UI text** for user-facing labels (this is a Korean-market product), but AI Advocate speaks in the user's language setting.

---

## What This Page Must Communicate in 5 Seconds

A user opening the dispute page should immediately understand:
1. **Where am I:** This is my dispute case (#DSP-XXXX)
2. **What's happening:** Current status and tier
3. **What's next:** Next step and timeline
4. **Who's helping me:** My AI Advocate is on my side
5. **What it costs:** Clear, visible, no surprises

---

## Technical Notes

- These will be Next.js pages at `apps/web/src/app/(app)/disputes/`
- Reuse Inter + JetBrains Mono (already in project)
- Chat component will connect to real AI backend (for now, static mockup)
- Evidence upload will use Vercel Blob storage
- All IDs, timestamps, amounts in JetBrains Mono
- Status badges use the same pill pattern as landing page trust items
- Responsive: mobile-first approach

---

## Reference: Dispute Reason Codes

These are the types of disputes users can open:

| Code | Label | Auto-open | Default Opener |
|------|-------|-----------|----------------|
| ITEM_NOT_RECEIVED | Item not received | Yes | Buyer |
| ITEM_NOT_AS_DESCRIBED | Item not as described | No | Buyer |
| PAYMENT_NOT_COMPLETED | Payment not completed | Yes | System |
| SHIPMENT_SLA_MISSED | Shipment info not provided | Yes | System |
| DELIVERY_EXCEPTION | Delivery exception | Yes | System |
| SELLER_NO_FULFILLMENT | Seller didn't fulfill | Yes | System |
| REFUND_DISPUTE | Refund request disputed | No | Buyer |
| PARTIAL_REFUND_DISPUTE | Partial refund disputed | No | Buyer |
| COUNTERFEIT_CLAIM | Counterfeit item claimed | No | Buyer |
| OTHER | Other | No | Buyer |

---

## Reference: Settlement Flow

```
Transaction Complete → Escrow Holds Funds
                         ↓
              Buyer Opens Dispute
                         ↓
         ┌── T1: AI Arbiter Review (minutes) ──┐
         │                                       │
    [Accept]                              [Escalate → T2]
         ↓                                       ↓
    Settlement                    Seller deposits $12
                                         ↓
                           T2: 9 Community Reviewers (48h)
                                         ↓
                              ┌──────────┴──────────┐
                         [Accept]              [Escalate → T3]
                              ↓                      ↓
                         Settlement          Seller deposits $30
                                                     ↓
                                       T3: 15+ Reviewers (72h)
                                                     ↓
                                               FINAL Decision
                                                     ↓
                                               Settlement
```

Each settlement shows:
- Who gets the escrowed funds
- Who pays the dispute cost
- How dispute cost is split (70% reviewers, 30% platform)
- Seller deposit status (refunded or forfeited)

---

*This prompt references the Haggle Landing Page design for shared design tokens, typography, color palette, and component patterns. The dispute pages should feel like a natural extension of the same brand — but with a more serious, trustworthy tone appropriate for financial dispute resolution.*
