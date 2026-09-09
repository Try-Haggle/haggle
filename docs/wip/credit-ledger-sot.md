# Credit Ledger — Source of Truth (C0)

> **Status:** Docs-first product/engineering SoT for the **AI Soft credit balance ledger**. C0 locks the model; C1+ owns wallet/schema/API wiring.
> **Scope:** Account credit **balance** + append-only **ledger entries** (grant / debit / idempotency). Policy quotes stay in `packages/commerce-core/src/negotiation-credit-policy.ts` — this SoT is the wallet that will consume those numbers.
> **Created:** 2026-09-10 (Eng1 ticket C0)
> **Base:** `origin/staging` @ `266782f`
> **Citations:** [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md) §5 · §5.1 · §5.2; [2026-08-28-credit-hold-model-discussion.md](../meetings/2026-08-28-credit-hold-model-discussion.md) §3; `negotiation-credit-policy.ts`

Prefer this file over older ticket or meeting wording when they conflict on **credit balance / debit / grant** behavior.
This document locks **what** to build for the ledger. It is not a code-change authorization and does **not** move real money.

---

## 0. Explicit non-confusion: `trust-ledger*` ≠ credit balance

Existing `trust-ledger*` surfaces (`packages/commerce-core/src/trust-ledger.ts`, `packages/db/src/schema/trust-ledger.ts`, trust penalty / settlement reliability / onchain trust profile) are **trust and settlement reputation**.

They are **NOT** the AI Soft credit balance wallet.

| Concept | Module | Meaning |
| --- | --- | --- |
| **Credit ledger (this SoT)** | C0/C1 — new | Integer Soft-AI credits: grants in, Soft charge debits out |
| **Trust ledger** | `trust-ledger*` | Reputation / settlement reliability / penalties — orthogonal |

Do not reuse trust tables, trust scores, or trust APIs as the credit balance store.

---

## 1. What the credit ledger is

Credits meter **Haggle-hosted AI Soft turns only** (see [auto-manual SoT §5](./auto-manual-control-mode-sot.md)). They are an abuse brake and Soft AI cost meter, not payment for goods.

| Term | Meaning |
| --- | --- |
| **Balance** | Non-negative integer Soft credits owned by an account (actor). Derived as sum of ledger entries (or maintained as a denormalized row that must stay consistent with entries). |
| **Grant** | Credit increase (signup, attendance, funded bonus, …). Always appends a ledger entry. |
| **Debit** | Credit decrease for Soft AI charge (session band / Auto-ON differential). Always appends a ledger entry when debiting is required. |
| **Policy** | Quote helpers and grant constants in `negotiation-credit-policy.ts` — **not** a wallet. |
| **Ledger** | Append-only store that applies those policy numbers with idempotency and env rules (this SoT). |

**Fee unchanged.** Platform success fee remains **1.5%** and is orthogonal to Soft credits ([credit notes §2](../meetings/2026-08-28-credit-hold-model-discussion.md)).

---

## 2. Balance + ledger entry model

### 2.1 Balance

- One Soft-credit balance per account (actor).
- Balance must never go negative under production debit rules.
- Read path: expose current balance for UI (§6).
- Write path: **only** via ledger entries (grant or debit). No silent balance mutation.

### 2.2 Ledger entry

Each entry is immutable once written. Minimum fields (names illustrative; C1 owns schema):

| Field | Role |
| --- | --- |
| `id` | Stable entry id |
| `account_id` / `actor_id` | Owner |
| `delta` | Signed integer: `+N` grant, `-N` debit |
| `reason` / `kind` | Grant reason or debit kind (Soft AI charge, differential, …) |
| `idempotency_key` | Unique per logical event (see §2.3) |
| `ref` | Optional session / negotiation / grant context ids |
| `created_at` | Append time |
| `metadata` | Optional quote snapshot (band, modes, ask tier) — audit only |

Balance after entry `i` = sum of all `delta` for that account through `i` (or equivalent atomic update in the same transaction).

### 2.3 Idempotency

- Every grant and every debit **must** carry an `idempotency_key` unique for that logical event.
- Replaying the same key returns the prior entry / outcome — **no double grant, no double debit**.
- Soft AI charge keys must survive retries and concurrent Auto toggles: callers lock the session row so two concurrent toggles cannot double-charge (TOCTOU) — same rule as `quoteSoftAiCreditDifferential` in policy.

Suggested key shapes (C1 may refine):

| Event | Idempotency idea |
| --- | --- |
| Signup grant | `grant:signup:{account_id}` |
| Attendance | `grant:attendance:{account_id}:{YYYY-MM-DD}` (account timezone TBD in C1) |
| First complete listing | `grant:first_complete_listing:{account_id}` |
| Funded each side | `grant:funded:{order_or_intent_id}:{side}` |
| Release no dispute | `grant:release_no_dispute:{order_id}:{side}` |
| Invite first funded | `grant:invite_first_funded:{invite_id}` |
| Soft AI debit / differential | `debit:soft_ai:{session_id}:{charged_base_target}` (or equivalent band watermark) |

### 2.4 Debit vs grant

| Direction | When | Policy source |
| --- | --- | --- |
| **Grant** | Signup, attendance streak, first complete listing, FUNDED, release without dispute, invite first funded | `CREDIT_GRANTS` / `attendanceGrantAmount` / constants in policy |
| **Debit** | Soft AI band charge and Auto-ON differentials (§3) | `quoteNegotiationCredits` / `quoteSoftAiCreditDifferential` / Soft band matrix |

No refund when Auto turns OFF after a charge ([auto-manual SoT §5.1](./auto-manual-control-mode-sot.md)). Do not invent negative grants to undo Soft charges.

---

## 3. Charge timing (Soft AI band / Auto ON differential)

**Encode exactly** from [auto-manual SoT §5 · §5.1](./auto-manual-control-mode-sot.md) and policy Soft helpers.

### 3.1 Band quote (buyer Soft AI credits)

| Situation | Credits (buyer, our AI Soft only) |
| --- | --- |
| **Both Auto** | **Pro 10 / Flash 4** |
| **Exactly one Soft side Auto** (buyer Manual + seller AI, or seller Manual + buyer Auto) | **Half: Pro 5 / Flash 2** |
| **Both Manual** | **0** |

- Listing tier: Pro when published ask ≥ ~$100 (`CREDIT_PRO_ASK_THRESHOLD_MINOR`); else Flash.
- **Manual sides do not consume** Haggle Soft AI credits for that party’s Soft drafting.
- Seller Soft AI base on the buyer Soft matrix stays **0** in `quoteNegotiationCredits` for `role: "seller"`; seller better-model **+5** is **out of scope** for C0/C1 ledger wiring (§5).

### 3.2 When to debit

1. **Initial Soft AI charge** — when a session first incurs a non-zero Soft AI band (typically start / first Soft AI work under Auto), debit the quoted band (or record charged-base watermark = 0 → band).
2. **Auto ON differential (§5.1)** — if Auto is ever turned ON such that the applicable Soft AI band **rises**, debit **`max(0, target_base - already_charged_base)`** (lift toward Pro10 / Flash4 as appropriate). Use `quoteSoftAiCreditDifferential`.
3. **Auto OFF** — **no refund**. Credits already taken stay taken. Charged-base watermark does not decrease.
4. **Both Manual (band zero)** — debit **0**; still allowed to keep policy/quote flags for UI.

### 3.3 Production balance gate

When debiting is required (production, `creditsAreUnlimited() === false`):

1. Compute `charge_total` from policy (non-unlimited).
2. If `charge_total > 0` and balance &lt; `charge_total` → **refuse** Soft AI work that needs that charge; surface insufficient credit (§6).
3. Else append debit entry + update balance atomically with idempotency.

---

## 4. Environment: `creditsAreUnlimited()`

From [credit notes §3](../meetings/2026-08-28-credit-hold-model-discussion.md) and policy:

| Env | `creditsAreUnlimited()` | Balance check | Debit ledger write |
| --- | --- | --- | --- |
| **local** | `true` (while `CREDIT_UNLIMITED_IS_TEMPORARY`) | **Skip** | **Skip** |
| **staging** | `true` (same) | **Skip** | **Skip** |
| **production** | **always `false`** | **Required** | **Must debit** |

Encode exactly:

- Staging/local: when unlimited, **skip balance check and skip debit**. Soft AI proceeds without reducing balance.
- **Keep policy flags / quotes** (`unlimited: true`, band, modes, target base, charged-base watermark math). Quotes and differentials still compute; only the wallet debit + insufficient gate are bypassed (`charge_total` may be reported as 0 while `charge_base` / watermark still advance in session state as policy defines).
- Production: **must debit** when Soft AI charge &gt; 0. Never ship production with unlimited bypass left on (`CREDIT_UNLIMITED_IS_TEMPORARY` / `CREDIT_UNLIMITED_ENVS` — turn off before credits go live; W2026-08-22-05).

Grants may still be recorded in staging/local for dogfood of grant paths; unlimited only relaxes **Soft AI debit + balance gate**, not the existence of the ledger.

---

## 5. Grants (keep code constants)

**Do not invent new amounts in C0/C1.** Keep constants from `negotiation-credit-policy.ts` / [credit notes §3](../meetings/2026-08-28-credit-hold-model-discussion.md):

| Reason | Amount | Notes |
| --- | --- | --- |
| `signup` | **200** | `CREDIT_SIGNUP` |
| `attendance_daily` | **10** base, streak **+1**/day, cap **20** | `attendanceGrantAmount(consecutiveDays)` |
| `first_complete_listing` | **20** | Once per account |
| `funded` | **10** each side | On FUNDED |
| `release_no_dispute` | **10** each side | Clean release |
| `invite_first_funded` | **40** | Inviter on invitee’s first funded — not on signup alone |

**Out of C0/C1 ledger product scope:**

- Seller better-model upgrade **+5** (`CREDIT_OWN_BETTER_MODEL`) — cite only; [auto-manual SoT §5.2](./auto-manual-control-mode-sot.md). Mode SoT does not require it; do not block C1 on it.
- Paid top-up / selling credits — not sold now (credit notes).
- Community / likes / SNS / review grants — explicitly do not create for credits.

---

## 6. UI surfaces (balance, insufficient)

C0 locks **which** surfaces; C1+ wires them.

| Surface | Behavior |
| --- | --- |
| **Balance display** | Show current Soft credit balance to the signed-in account (Settings and/or negotiation chrome). Staging/local may show balance and an “unlimited / not debiting” affordance when `creditsAreUnlimited()` is true. |
| **Insufficient credits** | When production (or any env with debit enabled) would charge Soft AI and balance &lt; required charge: block that Soft AI action and show a clear insufficient-credits state (copy + next step). Do not silently proceed. |
| **Quote / charge preview (optional)** | May show Soft band quote (Pro10/Flash4 / half / 0) from policy without implying payment. |
| **Grant feedback (optional)** | Toast or history line when a grant lands (signup, attendance, …). |

MCP / agent surfaces should be able to read balance and receive a stable insufficient error code when debit is required and balance is too low (exact code names in C1).

---

## 7. Out of scope for C0 / C1 ledger

| Topic | Where it lives | Note |
| --- | --- | --- |
| Real-money rails / Stripe Crypto Onramp / PAN | [staging-onramp-test-mode-map.md](./staging-onramp-test-mode-map.md) | Fiat→USDC test path; **not** Soft credits |
| Fake-money / fake-address Stage 1 loop | [fake-money-fake-address-e2e-test-plan.md](./fake-money-fake-address-e2e-test-plan.md) | Settlement rehearsal without real money — **orthogonal** to Soft credit ledger |
| Trust / settlement reputation | `trust-ledger*` | §0 — not credit balance |
| Seller better-model +5 | Policy constant + auto-manual §5.2 | Later product |
| Hard Authority / 1.5% fee | Core protocol / fee notes | Unchanged by this ledger |

C0 is **docs only**. C1 implements ledger storage + debit/grant APIs against this SoT without coupling to onramp or fake-money flows.

---

## 8. Implementation pointers (C1 — do not build in C0)

- Policy-only today: `packages/commerce-core/src/negotiation-credit-policy.ts` (`creditsAreUnlimited`, Soft band, differential, `CREDIT_GRANTS`).
- Add wallet/ledger schema + services that **call** policy for amounts; do not duplicate Pro10/Flash4/half/0 tables in app code.
- Session Soft charge watermark (`already_charged_base`) must live with the negotiation/session so differentials stay correct across toggles.
- Production path: check balance → idempotent debit → then Soft AI. Staging/local unlimited: skip check+debit, keep quotes/flags.
- Never write Soft credits into `trust-ledger*` tables.

---

## 9. Related docs

| Doc | Role |
| --- | --- |
| [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md) §5 · §5.1 · §5.2 | Soft AI credit bands, differential, no refund, +5 out of mode scope |
| [2026-08-28-credit-hold-model-discussion.md](../meetings/2026-08-28-credit-hold-model-discussion.md) §3 | Signup 200, attendance, `CREDIT_UNLIMITED_*` / `creditsAreUnlimited()` |
| `packages/commerce-core/src/negotiation-credit-policy.ts` | Policy constants + quote/differential helpers (not wallet) |
| [staging-onramp-test-mode-map.md](./staging-onramp-test-mode-map.md) | Real-money onramp test map — out of scope for C0/C1 ledger |
| [fake-money-fake-address-e2e-test-plan.md](./fake-money-fake-address-e2e-test-plan.md) | Fake-money Stage 1 — out of scope for C0/C1 ledger |
| `packages/commerce-core/src/trust-ledger.ts` / `packages/db/src/schema/trust-ledger.ts` | Trust/settlement reputation — **not** credit balance |

---

## 10. Decision checklist (encode exactly)

- [x] Balance + append-only ledger entries for grant and debit; idempotency on every write
- [x] Charge timing = Soft AI band quote + Auto ON differential; Manual side / both Manual = 0; Auto OFF = no refund ([auto-manual §5.1](./auto-manual-control-mode-sot.md))
- [x] Staging/local: `creditsAreUnlimited()` true → **skip balance check & debit**; keep policy flags; production **must debit**
- [x] Grants keep code constants (signup **200**, attendance 10/+1/cap20, …); seller better-model **+5** out of scope
- [x] UI surfaces: balance display + insufficient-credits gate (plus optional quote/grant feedback)
- [x] Explicit: existing `trust-ledger*` = trust/settlement reputation, **NOT** credit balance
- [x] Real-money onramp + fake-money plans cited as **out of scope** for C0/C1 ledger
