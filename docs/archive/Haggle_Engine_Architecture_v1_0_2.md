# Haggle Engine Architecture v1.0.2
## Multi-Issue Negotiation Engine with Opponent Modeling

**Version:** 1.0.2
**Date:** 2026-03-07
**Status:** Implementation Specification (Approved for Development)
**Architecture:** 4-Layer Skills (L0 Gateway -> L1 Skill Layer -> L2 Engine Core -> L3 Wire+Data)
**Scope:** Multi-Issue Utility, Offer Inversion, Bayesian Opponent Model, Dynamic Deadline, Selection Policy

**References:**
- Faratin, P., Sierra, C., & Jennings, N.R. (1998). *Negotiation Decision Functions for Autonomous Agents.* Robotics and Autonomous Systems, 24(3-4), 159-182.
- Jonker, C.M., Hindriks, K.V., Wiggers, P., & Broekens, J. (2012). *Negotiating Agents.* AI Magazine, Fall 2012, 79-91.
- Jennings, N.R., Parsons, S., Sierra, C., & Faratin, P. *Automated Negotiation.* Proceedings of the 5th PAAM.

---

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| v1.0.2 | 2026-03-07 | **Multi-Issue Engine Upgrade**: (1) Issue Type System (NEGOTIABLE/INFORMATIONAL) + Multi-Issue Offer Inverter, (2) 6-type Move Classification (Jonker et al. Fig.2), (3) Bayesian Opponent Model with Reputation Prior, (4) Dynamic Deadline with Listing Deadline integration (Faratin 4.2.1), (5) Selection Policy for parallel negotiations, (6) Mirroring Strategy (Tactic Engine extension). Backward-compatible with v1.0.1 -- existing single-issue mode preserved. |
| v1.0.1 | 2026-03-04 | Engine 4-Gap: OpponentModel (EMA), Dynamic Beta, Utility-Space Concession, AC_next. AgentStats system (8 stats). |
| v1.0.0 | 2026-02-17 | Initial release. 4D Utility + Decision Maker + Faratin concession. |

---

## 0. Architecture Overview

### 0.1 System Position

```
+--------------------------------------------------------------+
|  L0: Gateway                                                  |
|  Protocol Adapters (MCP, UCP, REST, AP2)                      |
|  Channel Adapters (Web App, ChatGPT Apps, WhatsApp)           |
|  Auth & Limits (OAuth 2.0, Rate Limiting)                     |
+-----------------------------+--------------------------------+
                              |
+-----------------------------v--------------------------------+
|  L1: Skill Layer                                              |
|  +----------------------------------------------------------+|
|  | Skill Router | Skill Coordinator | Event Bus              ||
|  +----------------------------------------------------------+|
|  | Core:   GoalParser | Strategy | Negotiation | Session     ||
|  | Domain: Listing | Reputation | MarketResearch             ||
|  | Infra:  Settlement | Escrow | Shipping | Dispute          ||
|  | Intel:  Prediction | IntelligenceRouter | StrategyAPI     ||
|  +----------------------------------------------------------+|
|  | v1.0.2 NEW:                                               ||
|  | IssueRegistry | OpponentPrior | DeadlineManager           ||
|  | SelectionPolicy | TacticRouter                            ||
|  +----------------------------------------------------------+|
+-----------------------------+--------------------------------+
                              |
+-----------------------------v--------------------------------+
|  L2: Engine Core  <-- THIS DOCUMENT                           |
|  +----------------------------------------------------------+|
|  | Multi-Issue Utility Calculator (V_j weighted sum)         ||
|  | Issue Space: NEGOTIABLE + INFORMATIONAL                   ||
|  +----------------------------------------------------------+|
|  | Decision Maker (rule-based)                               ||
|  | U_total vs thresholds -> ACCEPT/COUNTER/REJECT/ESCALATE   ||
|  +----------------------------------------------------------+|
|  | Concession Curve (utility-space Faratin)                   ||
|  | U_target(t) + Dynamic Beta + AC_next                      ||
|  +----------------------------------------------------------+|
|  | Offer Inverter (v1.0.2 NEW)                               ||
|  | U_target -> multi-issue value combination                 ||
|  +----------------------------------------------------------+|
|  | Move Classifier (v1.0.2 EXTENDED: 6-type)                 ||
|  | + Bayesian Opponent Model + Reputation Prior              ||
|  +----------------------------------------------------------+|
|  | Dynamic Deadline (v1.0.2 NEW)                             ||
|  | listing_deadline + Faratin t_max formula                  ||
|  +----------------------------------------------------------+|
|  | Selection Policy (v1.0.2 NEW)                             ||
|  | Parallel negotiation best-offer selection                 ||
|  +----------------------------------------------------------+|
|  | Batch Evaluator | Multi-Session Comparator                ||
|  +----------------------------------------------------------+|
+-----------------------------+--------------------------------+
                              |
+-----------------------------v--------------------------------+
|  L3: Wire + Data                                              |
|  HNP (Protobuf/gRPC) | Redis (Hot) | PostgreSQL (Cold)       |
+--------------------------------------------------------------+
```

### 0.2 Design Principles

1. **Determinism** -- Same input -> same output. No implicit state, no randomness.
2. **Bounded Output** -- All V_j in [0, 1], U_total in [0, 1]. No exceptions.
3. **Dimensional Independence** -- Each V_j depends on disjoint input sets.
4. **Role Symmetry** -- Buyer/seller formulas are structurally identical; only parameter direction differs.
5. **Skill Boundary Clarity** -- Engine Core MUST NOT call DB, API, or LLM.
6. **Engine as Funnel** -- Engine Core batch evaluation IS listing selection. No separate filter.
7. **Backward Compatibility** -- Single-issue (price-only) mode remains default. Multi-issue is opt-in via `issue_space` parameter.

### 0.3 Engine-First, Reactive Escalation

```
Hot Path (per round, 95%+ traffic):
  Incoming offer -> Skill Coordinator -> Engine Core (200us) -> Decision Maker
    -> v1.0.2: Classify Move (6-type) -> Update Opponent Model (Bayesian)
    -> Dynamic Beta -> Counter-Offer (utility-space + Offer Inverter)
    -> AC_next check -> Response
  LLM calls: 0

Cold Path (initial strategy):
  User goal -> Strategy Skill -> LLM (Grok 4.1 Fast) -> MasterStrategy
  Frequency: 1+ per product

Reactive Escalation:
  Incoming offer -> Engine cannot handle -> ESCALATE
  -> LLM interprets + updates strategy -> re-input to Engine
```

---

## 1. Issue Space (v1.0.2 NEW)

### 1.1 Issue Type Classification

Every negotiation issue falls into one of two types. This classification drives the Offer Inverter and determines what the engine can adjust.

```
NEGOTIABLE Issue
  Definition: Real-time adjustable during negotiation
  Properties: Has domain [min, max], direction (lower/higher is better)
  Offer Inverter: YES -- engine computes target value from U_target
  Examples: price, delivery_speed, shipping_cost, warranty_months
  Scope: Universal across all categories (system-level)

INFORMATIONAL Issue
  Definition: Fixed fact. Not a negotiation lever.
  Properties: No domain range. Has weight (w_j) only.
  Offer Inverter: NO -- value is fixed, only affects U_total for accept/reject
  Examples: battery_health, scratch_level, original_box, component_included
  Scope: Category-specific, loaded from DB via inheritance hierarchy
```

### 1.2 Issue Interface

```typescript
interface Issue {
  id: string;                          // e.g., "price", "battery_health"
  type: 'NEGOTIABLE' | 'INFORMATIONAL';
  weight: number;                      // w_j, sum of all w_j = 1.0
  domain?: {                           // NEGOTIABLE only. null for INFORMATIONAL.
    min: number;
    max: number;
    direction: 'lower_is_better' | 'higher_is_better';
  };
}
```

### 1.3 Utility Function Generalization

**v1.0.0-v1.0.1 (4D fixed):**
```
U_total = w_p * V_p + w_t * V_t + w_r * V_r + w_s * V_s
```

**v1.0.2 (multi-issue, backward-compatible):**
```
U_total = SUM_j( w_j * V_j(x_j) )    -- j spans ALL issues (NEGOTIABLE + INFORMATIONAL)

Constraints:
  SUM(w_j) = 1.0   (across all issues, type-agnostic)
  All V_j in [0, 1]
  Therefore U_total in [0, 1]
```

**Backward Compatibility:** When `issue_space` is not provided, the engine uses the legacy 4D mode:
- `V_p` (price) = NEGOTIABLE, domain from PriceContext
- `V_t` (time) = INFORMATIONAL (fixed per round)
- `V_r` (risk) = INFORMATIONAL (fixed per round)
- `V_s` (relationship) = INFORMATIONAL (fixed per round)

This means the existing `NegotiationContext` interface continues to work unchanged. Multi-issue mode activates only when `IssueSpace` is explicitly provided.

### 1.4 V_j Evaluation Functions

**Linear (default for NEGOTIABLE):**
```
Buyer (lower_is_better):
  V_j(x_j) = (max_j - x_j) / (max_j - min_j)

Seller (higher_is_better):
  V_j(x_j) = (x_j - min_j) / (max_j - min_j)
```

**Logarithmic (V_p, preserved from v1.0.0):**
```
Buyer:
  V_p = ln(P_limit - P_effective + 1) / ln(P_limit - P_target + 1)

Seller:
  V_p = ln(P_effective - P_limit + 1) / ln(P_target - P_limit + 1)
```

**INFORMATIONAL issues:**
Value is fixed (provided by Skill Layer). No domain range. V_j is computed by the Skill that provides the data.

### 1.5 Skill Layer Integration

```
IssueRegistry Skill (v1.0.2 NEW):
  - Manages issue definitions per category
  - Inherits from category hierarchy: Electronics > Apple > MacBook
  - Provides issue weights and domains to Engine Core
  - GoalParser can override weights based on user intent

Data flow:
  GoalParser -> IssueRegistry -> Issue[] with weights
  Listing data -> INFORMATIONAL issue values (fixed)
  Strategy -> NEGOTIABLE issue domains
  -> Engine Core receives complete IssueSpace
```

### 1.6 TypeScript Interface

```typescript
interface IssueSpace {
  issues: Issue[];
  current_values: Record<string, number>;  // Current x_j for each issue
}

// Attached to MasterStrategy (optional -- null means legacy 4D mode)
interface MasterStrategy {
  // ... existing fields ...
  issue_space?: IssueSpace;  // v1.0.2: null = legacy, set = multi-issue
}
```

---

## 2. Total Utility Function

### 2.1 Core Formula (unchanged)

$$U_{total} = \sum_{i} w_i \cdot V_i$$

**Constraints:**
- All w_i >= 0, SUM(w_i) = 1.0
- All V_i in [0, 1]
- Therefore U_total in [0, 1]

### 2.2 Legacy 4D Mode (V_p, V_t, V_r, V_s)

Preserved exactly as v1.0.1. See sections 2-5 of v1.0.1 document for full V_p/V_t/V_r/V_s specifications.

Key formulas (unchanged):

```
V_p: ln-scaled price utility (buyer/seller symmetric)
V_t: max(V_t_floor, (max(0, 1 - t_elapsed/t_deadline))^alpha)
V_r: w_rep * r_score + w_info * i_completeness
V_s: clamp(V_s_base + N_success/N_threshold + P_dispute, 0, 1)
```

### 2.3 Multi-Issue Mode

When `issue_space` is provided:

```typescript
function computeMultiIssueUtility(issueSpace: IssueSpace): number {
  let total = 0;
  for (const issue of issueSpace.issues) {
    const x = issueSpace.current_values[issue.id];
    const v = evaluateIssue(issue, x);
    total += issue.weight * v;
  }
  return total;
}
```

The 4D V_p/V_t/V_r/V_s can be mapped as issues:
```
{ id: "price",        type: "NEGOTIABLE",    weight: w_p, domain: {min: p_target, max: p_limit, ...} }
{ id: "time",         type: "INFORMATIONAL", weight: w_t }
{ id: "risk",         type: "INFORMATIONAL", weight: w_r }
{ id: "relationship", type: "INFORMATIONAL", weight: w_s }
{ id: "battery",      type: "INFORMATIONAL", weight: 0.05 }
{ id: "shipping_cost",type: "NEGOTIABLE",    weight: 0.08, domain: {min: 0, max: 50, ...} }
```

---

## 3. Concession Curve (Utility-Space)

### 3.1 Faratin Utility-Space Formula (v1.0.1, preserved)

```
U_target(t) = U_start + (RV - U_start) * (t / t_max)^(1/beta)

Where:
  U_start   = Initial offer utility target (maps to u_aspiration)
  RV        = Reservation Value (maps to u_threshold)
  t         = Current round (or elapsed time)
  t_max     = Deadline (round count or time)
  beta      = Concession shape parameter
              beta < 1:  Boulware (hold firm, concede at end)
              beta = 1:  Linear
              beta > 1:  Conceder (concede early)
```

### 3.2 Dynamic Beta (v1.0.1 + v1.0.2 enhancements)

**v1.0.1 formula (preserved):**
```
beta_competition = beta_base * (1 + kappa * ln(n_competitors + 1))
beta_dynamic = beta_competition * (1 + lambda * opponent_concession_rate)
result = clamp(beta_dynamic, 0.1, 10.0)
```

**v1.0.2 addition -- Faratin 4.2.1 Resource-Dependent adjustment:**

When `listing_deadline` is provided, the engine also computes:

```
t_max_dynamic = mu * |N|^2 / max(avg_thread_length, 1)
t_max_calendar = max(1, days_left * avg_rounds_per_day)
t_max_final = min(t_max_calendar, t_max_dynamic)
```

This affects beta_effective:
```
ratio = t_max_dynamic / mu_baseline
beta_faratin = beta_base / max(ratio, 0.1)
```

**Reconciliation:** Both formulas run. The engine uses the MORE CONSERVATIVE (lower beta = more Boulware) of the two:

```typescript
function computeEffectiveBeta(params: EffectiveBetaParams): number {
  // v1.0.1 dynamic beta (competition + opponent EMA)
  const betaDynamic = computeDynamicBeta({
    beta_base: params.beta_base,
    n_competitors: params.n_competitors,
    opponent_concession_rate: params.opponent_concession_rate,
    kappa: params.kappa,
    lambda: params.lambda,
  });

  // v1.0.2 Faratin resource-dependent beta
  if (params.listing_deadline && params.mu_baseline) {
    const betaFaratin = computeFaratinBeta(params);
    // Use more conservative (Boulware-leaning) value
    return Math.min(betaDynamic, betaFaratin);
  }

  return betaDynamic;
}
```

### 3.3 AC_next (v1.0.1, preserved)

```
If incoming_offer >= counter_offer (from our perspective):
  Upgrade COUNTER -> ACCEPT immediately

shouldAcceptNext(incoming, counter, p_target, p_limit) -> boolean
```

### 3.4 Dynamic Deadline Parameters

```typescript
interface DynamicDeadlineParams {
  listing_deadline?: string;          // ISO date, seller-set (default: 14 days, min: 7)
  mu_baseline: number;               // Baseline negotiation time (default: 10.0)
  n_active_sessions: number;         // Current parallel negotiation count
  avg_thread_length: number;         // Average rounds across active threads
  avg_rounds_per_day: number;        // Estimated rounds per calendar day (default: 5)
}
```

### 3.5 t_max Integration

```
t_max_final = min(t_max_calendar, t_max_dynamic)

This value feeds into:
1. Concession curve: U_target(t) uses t_max_final as T
2. V_t computation: t_deadline can be overridden by t_max_final
3. Session timeout: sessions auto-expire at t_max_final

Meaning:
  Many competitors -> t_max_dynamic increases -> more room -> Boulware
  Competitors leaving -> t_max_dynamic decreases -> pressure -> Conceder
  Listing deadline near -> t_max_calendar decreases -> hard cap
  The faster deadline always wins.
```

---

## 4. Offer Inverter (v1.0.2 NEW)

### 4.1 Purpose

When Decision Maker returns COUNTER, the engine must generate an actual counter-offer. v1.0.1 could only invert in price-space (single issue). v1.0.2 adds multi-issue inversion.

### 4.2 Pipeline

```
1. Compute U_target(t) via Faratin utility-space curve
2. Separate issues: NEGOTIABLE vs INFORMATIONAL
3. Compute fixed contribution from INFORMATIONAL issues
4. Remaining utility = U_target - informational_utility
5. Distribute remaining utility across NEGOTIABLE issues
6. Invert V_j -> x_j for each NEGOTIABLE issue
7. Return complete offer {issue_id: value}
```

### 4.3 Inversion Strategy

Two strategies, selected by `inversion_strategy` parameter:

**PROPORTIONAL (default, no Opponent Model needed):**
```
Maintain current ratio of NEGOTIABLE issue utilities.
Scale all proportionally to hit U_target.

scale = negotiable_target / current_negotiable_u
For each NEGOTIABLE issue j:
  v_target_j = min(1.0, v_current_j * scale)
  x_j = invert_V_j(v_target_j, domain_j)
```

**OPPONENT_AWARE (requires Opponent Model):**
```
Use estimated opponent weights to allocate concessions.
Concede MORE on issues opponent values LESS.
Concede LESS on issues opponent values MORE.

For each NEGOTIABLE issue j:
  Give more on low-opponent-weight issues (cheap concession for us)
  Hold firm on high-opponent-weight issues (expensive concession for us)
```

### 4.4 V_j Inverse Functions

**Linear V_j (buyer, lower_is_better):**
```
x_j = max_j - v_j * (max_j - min_j)
```

**Linear V_j (seller, higher_is_better):**
```
x_j = min_j + v_j * (max_j - min_j)
```

**Logarithmic V_p (existing invertVp, preserved):**
```
P_effective = P_limit - exp(v_p * ln(P_limit - P_target + 1)) + 1
```

### 4.5 Interface

```typescript
interface OfferInverterParams {
  u_target: number;                    // Target total utility
  issues: Issue[];                     // Issue definitions
  current_values: Record<string, number>;
  inversion_strategy: 'PROPORTIONAL' | 'OPPONENT_AWARE';
  estimated_opponent_weights?: Record<string, number>;  // For OPPONENT_AWARE
}

interface InvertedOffer {
  values: Record<string, number>;      // Proposed value for each issue
  achieved_utility: number;            // Actual U of the inverted offer
}

function invertOffer(params: OfferInverterParams): InvertedOffer;
```

### 4.6 Single-Issue Backward Compatibility

When `issue_space` is null (legacy 4D mode), the existing `computeUtilitySpaceCounterOffer()` function remains the active path. It inverts only V_p using `invertVp()`, which is equivalent to the Offer Inverter with a single NEGOTIABLE issue (price) and three INFORMATIONAL issues (time, risk, relationship).

---

## 5. Move Classifier (v1.0.2 EXTENDED)

### 5.1 v1.0.1 (3-type, preserved as fallback)

```
CONCESSION: Opponent moved price toward our preference
SELFISH:    Opponent moved price away from our preference
SILENT:     Price unchanged (within noise threshold)
```

This remains the active classifier when in single-issue (price-only) mode.

### 5.2 v1.0.2 (6-type, Jonker et al. 2012 Figure 2)

When Opponent Model provides estimated opponent utility, the full 6-type classification activates:

```
delta_u_self    = Change in OUR utility from opponent's latest offer
delta_u_opp     = Change in ESTIMATED OPPONENT utility (requires Opponent Model)
epsilon         = Noise threshold (default: 0.02)

Classification rules:
  delta_u_self > epsilon  AND delta_u_opp > epsilon  -> FORTUNATE
  delta_u_self < -epsilon AND delta_u_opp > epsilon  -> CONCESSION
  delta_u_self > epsilon  AND delta_u_opp < -epsilon -> SELFISH
  delta_u_self < -epsilon AND delta_u_opp < -epsilon -> UNFORTUNATE
  |delta_u_self| <= epsilon AND delta_u_opp > epsilon -> NICE
  Otherwise                                          -> SILENT
```

### 5.3 Optimal Response per Move Type

```
FORTUNATE   -> Consider immediate ACCEPT (Pareto improvement)
CONCESSION  -> Respond with CONCESSION (cooperate with cooperation)
SELFISH     -> Respond with SILENT or Boulware (resist exploitation)
UNFORTUNATE -> Respond with NICE (be generous, likely a mistake)
NICE        -> Respond with CONCESSION or ACCEPT (reciprocate goodwill)
SILENT      -> Strong COUNTER or deadline pressure
```

### 5.4 Interface

```typescript
type OpponentMoveType6 =
  | 'FORTUNATE' | 'CONCESSION' | 'SELFISH'
  | 'UNFORTUNATE' | 'NICE' | 'SILENT';

interface OpponentMove6 {
  type: OpponentMoveType6;
  delta_u_self: number;
  delta_u_opp: number;
}

function classifyMove6(
  delta_u_self: number,
  delta_u_opp_estimated: number,
  epsilon?: number,
): OpponentMove6;
```

### 5.5 Activation Logic

```
if (opponentModel has estimated_utilities):
  use classifyMove6 (6-type)
else:
  use classifyMove (3-type, price-based)  -- v1.0.1 fallback
```

---

## 6. Opponent Model (v1.0.2 EXTENDED)

### 6.1 Architecture

v1.0.2 introduces a dual-layer opponent model:

```
Layer 1: EMA Concession Tracker (v1.0.1, preserved)
  - Fast, simple, works from round 1
  - Tracks concession_rate via Exponential Moving Average
  - Feeds into computeDynamicBeta()

Layer 2: Bayesian Opponent Model (v1.0.2 NEW)
  - Activates after 2+ rounds of observation
  - Estimates opponent beta (concession shape)
  - Estimates opponent issue weights (w_j)
  - Uses Reputation data as Bayesian prior
```

### 6.2 EMA Concession Tracker (Layer 1, preserved)

```typescript
interface OpponentModel {
  concession_rate: number;   // EMA of opponent concession rate
  move_count: number;        // Number of moves observed
  last_move: OpponentMove | null;
}

// EMA update (alpha = 0.3 default)
new_rate = alpha * observed + (1 - alpha) * current_rate
```

### 6.3 Bayesian Opponent Model (Layer 2, v1.0.2 NEW)

#### 6.3.1 Beta Estimation

Estimate opponent's concession shape (beta_opp) from observed behavior:

```
Prior:
  beta_prior_mean = from Reputation Skill (or 1.0 if no history)
  beta_prior_var = from Reputation Skill (or 1.0 if no history)

Observation:
  Compute average concession magnitude from offer history
  High avg concession -> Conceder (beta > 1)
  Low avg concession  -> Boulware (beta < 1)
  Stable concession   -> Linear (beta ~ 1)

Bayesian Update (deterministic weighted average):
  likelihood_weight = min(n_observations / 10.0, 1.0)
  beta_posterior = (1 - likelihood_weight) * beta_prior_mean
                 + likelihood_weight * beta_likelihood
  posterior_var = beta_prior_var * (1 - likelihood_weight)
```

**Determinism guarantee:** No random sampling. Always use posterior mean.

#### 6.3.2 Weight Estimation

Estimate opponent's issue preferences (which issues they value most):

```
Key insight (Hindriks & Tykhonov 2008):
  Issue j where opponent concedes a lot -> low w_j (they don't care)
  Issue j where opponent barely concedes -> high w_j (they care a lot)

Initial: uniform weights (1/n for n issues)
Update: Adjust based on observed per-issue concession patterns
```

#### 6.3.3 Cold Start Resolution

```
No history (new opponent):
  beta_prior_mean = 1.0  (neutral assumption)
  beta_prior_var = 1.0   (maximum uncertainty)
  estimated_weights = uniform
  -> Requires 15-20 moves to converge

5 past sessions:
  beta_prior_mean = historical average
  beta_prior_var = sigma^2 / 5
  -> Requires 8-10 moves to converge

50+ past sessions:
  beta_prior_mean = well-calibrated
  beta_prior_var = very low
  -> Converges in 2-3 moves (near-instant profiling)
```

### 6.4 Reputation as Prior (Skill Layer Integration)

```
L1: Reputation Skill provides:
  - r_global (public reputation score)
  - beta_history_mean (avg beta from past negotiations with this opponent)
  - beta_history_var (uncertainty of that estimate)
  - n_past_sessions (number of past sessions)
  - defection_count (post-agreement defaults)

L2: Engine Core receives:
  - OpponentPrior { beta_mean, beta_var }
  - Uses this as Bayesian prior for in-session estimation
```

Engine Core does NOT query Reputation directly. The Skill Layer injects the prior data into the `OpponentContext` parameter.

### 6.5 Interface

```typescript
interface OpponentContext {
  opponent_id: string;
  // Bayesian beta estimation
  beta_prior_mean: number;        // From Reputation (default: 1.0)
  beta_prior_var: number;         // Uncertainty (default: 1.0)
  beta_posterior?: number;         // Engine-computed (auto-updated)
  // Weight estimation
  estimated_weights?: Record<string, number>;  // Per-issue weight estimate
  // Trust calibration
  trust_weight: number;           // Prior vs session balance [0,1] (default: 0.5)
  // Observation history
  offer_history: OfferRecord[];
  move_history: MoveRecord[];
  epsilon: number;                // Move classification threshold (default: 0.02)
}

interface OfferRecord {
  round: number;
  u_from_my_perspective: number;
  u_from_opp_estimated: number;
  issue_values: Record<string, number>;
}

interface MoveRecord {
  round: number;
  move_type: OpponentMoveType6;
  delta_u_self: number;
  delta_u_opp: number;
}
```

### 6.6 Escalation Context Enhancement

When ESCALATE fires, the LLM now receives richer context:

```typescript
interface EscalationContext {
  // v1.0.1 fields (preserved)
  reason: 'UNKNOWN_PROPOSAL' | 'STRATEGY_REVIEW';
  session_round: number;
  // v1.0.2 additions
  last_move_type: OpponentMoveType6;
  beta_estimated: number;           // Opponent beta posterior
  u_target_current: number;         // Current target utility
  opponent_pattern: string;         // 'BOULWARE' | 'LINEAR' | 'CONCEDER'
  estimated_opponent_weights?: Record<string, number>;
}
```

---

## 7. Decision Maker (v1.0.2 EXTENDED)

### 7.1 Core Logic (v1.0.0, preserved)

```
if u >= u_aspiration:                      -> ACCEPT
if u >= u_threshold AND v_t < 0.1:         -> ACCEPT
if u >= u_threshold:                       -> NEAR_DEAL
if rounds_no_concession >= 4:              -> ESCALATE
if v_t < 0.05 AND u < u_threshold:        -> ESCALATE
if u > 0:                                 -> COUNTER
otherwise:                                -> REJECT
```

### 7.2 v1.0.2 Additions to Decision Flow

After the core decision, additional checks:

```
1. Core decision (above)
2. If COUNTER or NEAR_DEAL:
   a. Compute effective beta (dynamic + Faratin)
   b. Compute U_target via utility-space curve
   c. Run Offer Inverter (PROPORTIONAL or OPPONENT_AWARE)
   d. AC_next check: if incoming >= counter_offer -> ACCEPT
3. Classify opponent move (6-type if model available, 3-type otherwise)
4. Update opponent model (EMA + Bayesian)
5. Apply Mirroring Strategy adjustment (optional, see Section 8)
```

### 7.3 FORTUNATE Move Short-Circuit

When `classifyMove6` returns FORTUNATE (both parties gained), the engine considers immediate acceptance even if U_total < u_aspiration, provided U_total > u_threshold.

```
if move_type == 'FORTUNATE' AND u_total > u_threshold:
  -> ACCEPT (Pareto improvement, don't risk losing it)
```

---

## 8. Tactic Engine (v1.0.2 NEW)

### 8.1 Overview

The Tactic Engine governs HOW the engine concedes, beyond just how MUCH. It selects and applies negotiation tactics based on the opponent model and session state.

### 8.2 Mirroring Strategy (Jonker et al. 5.2)

```
1. Classify opponent's last move (6-type)
2. Mirror with our own move in the same category
3. Optionally add a NICE move (Pareto improvement attempt)

Example:
  Opponent: CONCESSION (price +$20)
  Our response: CONCESSION (price -$10) + NICE (delivery 1 day faster)
  -> Reciprocate their cooperation, attempt Pareto improvement
```

### 8.3 Tactic Selection Matrix

```
Opponent Pattern    Session Phase     Tactic
BOULWARE            Early             Mirror + hold firm
BOULWARE            Late              Gradual concession + deadline signal
CONCEDER            Early             Hold firm (they'll come to us)
CONCEDER            Late              Small reciprocal concession
LINEAR              Any               Mirror proportionally
UNKNOWN             Early             Default (PROPORTIONAL inversion)
UNKNOWN             Late              Escalate for strategy review
```

### 8.4 Integration with Offer Inverter

The Tactic Engine adjusts the `inversion_strategy` and may modify `U_target` before passing to the Offer Inverter:

```
Opponent is BOULWARE (holding firm)?
  -> Reduce U_target reduction rate (we hold too)
  -> Use PROPORTIONAL inversion (don't reveal our model)

Opponent is CONCEDER (conceding fast)?
  -> Maintain high U_target (extract more value)
  -> Use OPPONENT_AWARE inversion (optimize what we concede)

FORTUNATE move detected?
  -> Skip inversion, accept or hold position
```

---

## 9. Selection Policy (v1.0.2 NEW)

### 9.1 Purpose

When a seller is negotiating with multiple buyers simultaneously, and multiple offers reach acceptable levels, the engine needs a selection mechanism.

### 9.2 Formula

```
score_i = alpha * U(offer_i) + (1 - alpha) * R(buyer_i)

Where:
  alpha           = utility vs reputation weight (default: 0.7)
  U(offer_i)      = total utility of the offer
  R(buyer_i)      = buyer's public reputation score [0, 1]
```

### 9.3 Interface

```typescript
interface SelectionPolicyParams {
  alpha_selection: number;            // Utility vs reputation weight (default: 0.7)
  selection_threshold: number;        // Auto-accept utility threshold
  dropout_policy: 'TIMEOUT' | 'RV_MISS' | 'EXPLICIT_REJECT' | 'LISTING_EXPIRED';
}

interface OfferCandidate {
  session_id: string;
  u_total: number;
  r_score: number;
  buyer_id: string;
}

function selectBestOffer(
  candidates: OfferCandidate[],
  alpha?: number,
): OfferCandidate;
```

### 9.4 Skill Layer Integration

```
L1: NegotiationSkill manages parallel sessions
    -> When any session reaches ACCEPT-worthy state:
       1. Collect all active session states
       2. Call selectBestOffer()
       3. Accept the winner, reject or hold others
       4. Emit 'session.selected' event
```

---

## 10. Agent Stats System (v1.0.1, preserved)

### 10.1 Overview

8 user-friendly stats define negotiation personality. Strategy Skill converts stats to engine parameters. Engine Core never sees stats directly.

```
Total budget: 400 points
Per-stat range: 10 - 90

Group 1 (Battle Style): Anchoring, Tenacity, Resolve
Group 2 (Analysis): Market Sense, Risk Radar, Scrutiny
Group 3 (Time/Relations): Patience, Rapport
```

### 10.2 Stats -> Multi-Issue Mapping (v1.0.2 extension)

In multi-issue mode, AgentStats influence issue weight distribution:

```
Anchoring -> U_start (how aggressively we open)
Tenacity  -> beta_base (concession shape)
Resolve   -> u_threshold, u_aspiration (acceptance criteria)
Market Sense -> Inversion strategy selection (PROPORTIONAL vs OPPONENT_AWARE)
Risk Radar -> Weight of risk-related INFORMATIONAL issues
Scrutiny  -> Weight of quality-related INFORMATIONAL issues
Patience  -> t_deadline scaling, V_t_floor
Rapport   -> trust_weight in Opponent Model (how much to trust prior)
```

---

## 11. Complete Round Execution Pipeline (v1.0.2)

```
executeRound(session, strategy, incomingOffer, roundData):

  1. Assemble context
     - If issue_space: use multi-issue utility
     - Else: use legacy 4D (NegotiationContext)

  2. Compute utility (U_total)

  3. Make core decision
     ACCEPT / COUNTER / NEAR_DEAL / REJECT / ESCALATE

  4. If COUNTER or NEAR_DEAL:
     4a. Compute dynamic deadline (if listing_deadline provided)
     4b. Compute effective beta
         - v1.0.1: computeDynamicBeta(competition + EMA)
         - v1.0.2: min(betaDynamic, betaFaratin) if deadline data available
     4c. Compute U_target via Faratin utility-space curve
     4d. Offer Inversion:
         - Single-issue: computeUtilitySpaceCounterOffer() [existing]
         - Multi-issue: invertOffer() [v1.0.2 NEW]
     4e. AC_next check: incoming >= counter -> ACCEPT

  5. Classify opponent move
     - 3-type (price-based) if no opponent utility estimation
     - 6-type (Jonker) if opponent model provides estimated utilities

  6. Update opponent model
     - Layer 1: EMA update (always)
     - Layer 2: Bayesian beta + weight estimation (if OpponentContext provided)

  7. Apply tactic adjustments (Mirroring Strategy, optional)

  8. Generate outgoing HNP message

  9. Build escalation request if ESCALATE
     - Include v1.0.2 enriched context (move_type, beta_estimated, etc.)

  10. Return RoundResult
```

---

## 12. Parameter Hierarchy (v1.0.2 Complete)

### Layer 1: Issue Space (v1.0.2 NEW)

| Parameter | Type | Description | Source | LLM Tunable |
|-----------|------|-------------|--------|-------------|
| `issues` | `Issue[]` | Negotiation issue set | IssueRegistry Skill | via GoalParser |
| `issue.type` | enum | NEGOTIABLE / INFORMATIONAL | Category DB | No |
| `domain[j]` | `(min, max)` | Issue j range (NEGOTIABLE only) | Strategy Skill | Yes |
| `V_j(x_j)` | function | Issue evaluation (linear default) | Engine Core | Indirect |
| `w_j` | float | Issue weight (SUM=1.0, type-agnostic) | GoalParser -> Strategy | Yes |

### Layer 2: Single-Thread Strategy (preserved + extended)

| Parameter | Type | Description | Source | LLM Tunable |
|-----------|------|-------------|--------|-------------|
| `RV` / `u_threshold` | float [0,1] | Reservation Value | Strategy Skill | Yes |
| `U_start` / `u_aspiration` | float [RV,1] | Initial offer utility target | Strategy Skill | Yes |
| `beta` | float > 0 | Concession shape | Strategy Skill / AgentStats | Yes |
| `T` / `t_deadline` | int/float | Deadline | Strategy Skill | Yes |
| `use_utility_space` | bool | Utility vs price-space curve | Strategy Skill | Yes |
| `inversion_strategy` | enum | PROPORTIONAL / OPPONENT_AWARE | Strategy Skill | Yes |

### Layer 3: Counter-Offer Generation (v1.0.2 NEW)

| Parameter | Type | Description | Source | LLM Tunable |
|-----------|------|-------------|--------|-------------|
| `move_history` | MoveRecord[] | Session move classification history | Engine (auto) | No |
| `last_move_type` | string | Opponent's last move (6-type) | Engine (auto) | No |
| `epsilon` | float | Move classification threshold | Strategy Skill | Indirect |

### Layer 4: Opponent Model (v1.0.2 NEW)

| Parameter | Type | Description | Source | LLM Tunable |
|-----------|------|-------------|--------|-------------|
| `beta_prior_mean` | float | Opponent beta prior | Reputation Skill | No |
| `beta_prior_var` | float | Prior uncertainty | Reputation Skill | No |
| `beta_posterior` | float | Session-updated estimate | Engine (auto) | No |
| `estimated_weights` | dict | Opponent issue weight estimate | Engine (auto) | No |
| `trust_weight` | float [0,1] | Prior vs session balance | Strategy / AgentStats | Yes |

### Layer 5: Multi-party & Competition (v1.0.2 EXTENDED)

| Parameter | Type | Description | Source | LLM Tunable |
|-----------|------|-------------|--------|-------------|
| `n_active_sessions` | int | Current parallel negotiation count | System | No |
| `avg_thread_length` | float | Average thread round count | System | No |
| `mu_baseline` | float | Baseline negotiation time (default: 10) | Strategy Skill | Yes |
| `listing_deadline` | date | Seller-set deadline (default: 14 days) | Listing Skill | Yes |
| `t_max_final` | int | Integrated deadline (auto) | Engine (auto) | No |
| `alpha_selection` | float [0,1] | Utility vs reputation selection weight | Strategy Skill | Yes |
| `selection_threshold` | float | Auto-accept utility threshold | Strategy Skill | Yes |

### Layer 6: Reputation (preserved + extended)

| Parameter | Type | Description | Source | LLM Tunable |
|-----------|------|-------------|--------|-------------|
| `r_global` | float [0,1] | Public reputation score | Reputation Skill | No |
| `beta_history_mean` | float | Historical beta average | Reputation Skill | No |
| `beta_history_var` | float | Historical uncertainty | Reputation Skill | No |
| `n_past_sessions` | int | Past negotiation count | Reputation Skill | No |
| `defection_count` | int | Post-agreement defaults | Reputation Skill | No |

---

## 13. Intent-First API Integration

### 13.1 How Multi-Issue Maps to Intent-First API

The Intent-First API (from Agentic Implementation spec) naturally supports multi-issue negotiation:

```
Explicit params -> NEGOTIABLE issue domains
  max_price, target_price -> price issue domain

Hard constraints -> INFORMATIONAL issue filters
  { key: "battery_cycle", op: "lt", value: 100 }
  -> Issue { id: "battery_cycle", type: INFORMATIONAL, ... }

Soft preferences -> Issue weight adjustments
  { key: "original_box", weight: 0.4 }
  -> Increases w_j for "original_box" issue

Well-known keys -> Legacy 4D weight seeds
  price_sensitivity -> w_p seed
  time_pressure -> w_t seed

Free context + Intent -> GoalParser LLM fills remaining weights
  "battery health is critical" -> increases battery_health w_j
```

### 13.2 GoalParser v1.0.2 Enhancement

GoalParser now produces `IssueSpace` in addition to the legacy weights:

```
GoalParser output (v1.0.2):
  NegotiationGoal {
    // Legacy (preserved)
    weights: UtilityWeights
    p_target, p_limit, alpha, beta, ...

    // v1.0.2 NEW
    issue_space?: IssueSpace {
      issues: Issue[]           // From IssueRegistry + user overrides
      current_values: {...}     // From listing data
    }
  }
```

---

## 14. Implementation Plan

### 14.1 Dependency Order

```
Phase 1: Foundation (no dependencies)
  [A] Issue type system (Issue interface + IssueSpace)
  [B] V_j evaluation functions (linear, logarithmic)
  [C] Dynamic Deadline computation (compute_t_max)
  [D] Selection Policy (selectBestOffer)

Phase 2: Core (depends on Phase 1)
  [E] Offer Inverter (depends on A, B)
      - PROPORTIONAL strategy
      - V_j inverse functions
  [F] 6-type Move Classifier (depends on A)
      - classifyMove6() function
  [G] computeEffectiveBeta() integration (depends on C)
      - Reconcile v1.0.1 dynamic beta + v1.0.2 Faratin beta

Phase 3: Opponent Model (depends on Phase 2)
  [H] Bayesian beta estimation (depends on F)
      - Prior from Reputation, posterior from session
  [I] Opponent weight estimation (depends on F)
      - Per-issue concession tracking
  [J] OPPONENT_AWARE inversion strategy (depends on E, I)

Phase 4: Integration (depends on Phase 3)
  [K] executeRound() pipeline update (depends on all above)
  [L] Tactic Engine + Mirroring Strategy (depends on F, H)
  [M] Escalation context enrichment (depends on H, I)
  [N] E2E tests (depends on all above)
```

### 14.2 Backward Compatibility Guarantee

- All existing tests (137 engine-core + 178 engine-session = 315 tests) MUST pass unchanged.
- `computeUtility()`, `makeDecision()`, `computeCounterOffer()`, `executeRound()` signatures unchanged.
- New functionality activates ONLY when `issue_space` or `OpponentContext` is provided.
- Default behavior (no new params) = identical to v1.0.1.

### 14.3 Package Placement

```
engine-core (pure math, 0 external deps):
  + src/issue/types.ts           -- Issue, IssueSpace interfaces
  + src/issue/evaluate.ts        -- V_j evaluation functions
  + src/issue/invert.ts          -- Offer Inverter (PROPORTIONAL + OPPONENT_AWARE)
  + src/decision/dynamic-deadline.ts  -- t_max computation
  + src/decision/selection.ts    -- selectBestOffer()
  + src/decision/classify-move6.ts    -- 6-type classifier
  + src/opponent/bayesian.ts     -- Bayesian beta estimation
  + src/opponent/weight-estimator.ts  -- Opponent weight estimation

engine-session (orchestration):
  * src/round/executor.ts        -- Updated pipeline (backward-compatible)
  + src/round/tactic-engine.ts   -- Mirroring strategy + tactic selection
  * src/round/types.ts           -- Extended OpponentModel, MoveRecord6
  * src/strategy/types.ts        -- Extended MasterStrategy (issue_space?, opponent_context?)
```

`*` = modified, `+` = new file

### 14.4 Test Strategy

Each phase gets its own test suite:

```
Phase 1: ~30 tests
  - Issue type validation
  - V_j evaluation edge cases (0, 1, boundary, direction)
  - Dynamic deadline with various competition scenarios
  - Selection policy scoring

Phase 2: ~40 tests
  - Offer Inverter: single-issue, multi-issue, boundary cases
  - Proportional inversion: scale up, scale down, clamp
  - 6-type classification: all 6 types + epsilon boundary
  - Effective beta reconciliation

Phase 3: ~30 tests
  - Bayesian beta: prior only, with observations, convergence
  - Weight estimation: uniform start, asymmetric concession
  - OPPONENT_AWARE inversion: weight-guided distribution

Phase 4: ~20 tests
  - Full pipeline E2E: multi-issue negotiation lifecycle
  - Backward compatibility: all existing tests pass
  - Tactic engine: mirroring responses
  - Escalation enrichment
```

---

## 15. Data Ethics (from Agentic Implementation)

### 15.1 Opponent Model Data Handling

The Bayesian Opponent Model creates sensitive data about counterparties. Rules:

| Data | Visibility | Reason |
|------|-----------|--------|
| Aggregated category beta averages | Public (Intelligence API) | Category-level statistic |
| Individual opponent beta_posterior | Private (engine only) | Personal behavior pattern |
| Estimated opponent weights | Private (engine only) | Personal preference data |
| Move classification history | Private (per-session) | Session confidentiality |

### 15.2 Principles

1. **Bilateral Fairness:** Haggle serves both buyers and sellers. No one-sided data exposure.
2. **Aggregation Only Public:** Intelligence API exposes only category-level aggregates.
3. **Private = Brokerage Value:** Individual patterns are the engine's "secret weapon" -- available only through Haggle's brokerage service.
4. **Symmetric Application:** Seller patterns hidden from buyers AND buyer patterns hidden from sellers.

---

## 16. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Multi-issue complexity explosion | Medium | Limit NEGOTIABLE issues to 5 max per negotiation. INFORMATIONAL unlimited. |
| Bayesian model overfitting | Low | Posterior variance floor (never goes below 0.05). Trust weight caps prior influence. |
| Backward compatibility break | High | Default = legacy 4D. Multi-issue = opt-in. All 315 existing tests must pass. |
| Offer Inverter degenerate cases | Medium | Fallback to PROPORTIONAL when OPPONENT_AWARE produces invalid offers. Clamp all V_j to [0,1]. |
| Cold start (no opponent history) | Medium | Neutral prior (beta=1.0, var=1.0). Uniform weights. Conservative behavior until data accumulates. |
| Performance regression (multi-issue overhead) | Low | All computation is O(n_issues), n_issues typically < 10. Still sub-millisecond. |

---

## Summary: v1.0.1 -> v1.0.2 Changes

| Component | v1.0.1 | v1.0.2 | Reason |
|-----------|--------|--------|--------|
| Issue Model | 4D fixed (V_p, V_t, V_r, V_s) | Multi-issue (NEGOTIABLE + INFORMATIONAL) | Faratin 3.1 compliance |
| Concession Unit | Utility (single-issue V_p inversion) | Utility (multi-issue Offer Inverter) | Faratin 3.2 compliance |
| Move Classifier | 3-type (price-based) | 6-type (Jonker Fig.2) + 3-type fallback | Jonker 2012 4 |
| Opponent Model | EMA concession rate | EMA (L1) + Bayesian beta + weight est. (L2) | Hindriks 2008 |
| Reputation Use | V_r accept/reject only | V_r + Bayesian prior for Opponent Model | Jonker 2012 4 |
| Competition | Dynamic beta (log-scale) | + Dynamic Deadline + Faratin beta | Faratin 4.2.1 |
| Deadline | t_deadline (fixed) | t_max_final = min(calendar, dynamic) | Faratin 4.2.1 |
| Selection | None | alpha * U + (1-alpha) * R | Haggle design |
| Tactic Engine | None | Mirroring Strategy + tactic selection | Jonker 2012 5.2 |
| AgentStats | 8 stats -> 4D params | 8 stats -> multi-issue + opponent config | Extension |
| Backward Compat | -- | 100% (legacy mode = default) | Design principle |

---

*This document is the complete technical specification for Haggle Engine v1.0.2.
All formulas include paper section references for cross-validation against source literature.
Implementation follows the phased approach in Section 14.*

**END OF DOCUMENT**
