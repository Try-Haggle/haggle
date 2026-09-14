# Auto / Manual Control Mode — Source of Truth (M0)

> **Status:** Accepted product SoT for staging. M1/M2 shipped Soft control_mode; **M4** locks Soft Manual `/auto-play/next` → `SOFT_MANUAL_WAITING` precedence.
> **Scope:** Soft-side negotiation control mode only. Does **not** change Hard Authority, fees, or settlement.
> **Created:** 2026-09-09 (Eng1 ticket M0)
> **Base:** `origin/staging` @ `f90703e`
> **Citations:** [haggle-core-platform-protocol-design.md](./haggle-core-platform-protocol-design.md) §7 (Hard/Soft), [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md), credit draft numbers in [2026-08-28-credit-hold-model-discussion.md](../meetings/2026-08-28-credit-hold-model-discussion.md) / [2026-08-29-branch-meeting-brief.md](../meetings/2026-08-29-branch-meeting-brief.md) (Pro **10** / Flash **4**)

Prefer this file over older ticket or meeting wording when they conflict on Auto/Manual behavior.
This document locks **what** to build. M1/M2 own API/UI wiring; do not treat this as a code change authorization.

---

## 1. What Auto / Manual is

| Term | Meaning |
| --- | --- |
| **Auto** | Haggle AI negotiates Soft Preference turns for that party (buyer or seller). |
| **Manual** | That party drives Soft turns themselves (human or their own external agent). Haggle AI does not spend turns for them. |
| **Control mode** | Per-party Soft-side switch: `Auto` \| `Manual`. Orthogonal to Hard Authority. |

**Hard Authority unchanged.** Floors, ceilings, forbid rules, auto-accept bands, payment limits, and human-approval gates stay as today ([core protocol §7.1](./haggle-core-platform-protocol-design.md)). Soft Preference strategy, pace, and who drafts the next Soft move are what Auto/Manual changes.

**Fee unchanged.** Platform success fee remains **1.5%**, mode-independent ([credit notes](../meetings/2026-08-28-credit-hold-model-discussion.md) §2). Seller “better-model +5” (Pro-tier cap) is a **later** credit product; not required for M0/M1 mode toggle.

---

## 2. Defaults and settings

| Rule | Locked |
| --- | --- |
| Session default | **Auto ON** for each party when a negotiation starts |
| Start UX | **No forced Auto/Manual choice** at session start |
| Account preference | **Settings** stores the user’s default preference for future sessions (still does not force a start modal) |

Users may change preference in Settings anytime; the next new session applies it. Mid-session toggle is separate (§3).

---

## 3. Mid-session toggle and handoff

- **Either party** (buyer **and** seller) may switch Auto ↔ Manual **anytime** while the session is active.
- **Handoff:** if an in-flight AI/API turn is already running for that party, the mode change applies **after that in-flight call finishes**. Do not cancel/abort mid-call; do not double-send.
- Turning Manual → Auto (or Auto → Manual) does not rewrite Hard Authority or past offers.
- Counterpart must be able to see the new mode (§6) after the handoff commits.

---

## 4. Who can Manual

- **Buyer can Manual.**
- **Seller can Manual.**
- Modes are **independent per party** (four Soft combinations: Auto/Auto, Manual/Auto, Auto/Manual, Manual/Manual).

---

## 5. Credits (our AI side only) — **Haggle credits**

**Haggle credits** meter **Haggle-hosted Soft Auto / AI 흥정 turns only** (Soft Preference when Haggle AI drafts). Soft Manual sides (**사람 흥정**) do not consume **Haggle credits** for that party’s Soft drafting. Protocol identifiers **Soft Auto** / **Soft Manual** / **Hard** / **Soft** stay unchanged. External/SoT/balance UI name: **Haggle credits** (not “Soft AI credits”). See [i18n-scope-a-sot.md](./i18n-scope-a-sot.md).

Baseline listing-tier draft numbers (buyer charge when our Soft Auto runs), from meetings credit notes:

| Listing model band | Full Auto session (both Soft Auto) | Buyer Soft Manual + seller Soft Auto | Both Soft Manual |
| --- | --- | --- | --- |
| Pro (≥ ~$100 ask) | **10** | **5** | **0** |
| Flash (< ~$100 ask) | **4** | **2** | **0** |

Encode exactly:

| Situation | **Haggle credits** (buyer, our Soft Auto / AI 흥정 only) |
| --- | --- |
| **Both Soft Auto** | **Pro 10 / Flash 4** |
| **Buyer Soft Manual + seller Soft Auto** | **5 / 2** |
| **Both Soft Manual** | **0** |

**Derived (same principle — our Soft Auto / AI 흥정 only):** seller Soft Manual + buyer Soft Auto still runs buyer Soft Auto → charge the half band (**5 / 2**). Soft Manual never bills **Haggle credits** for a Soft Manual side. If product later splits buyer-AI-only vs seller-AI-only, update this SoT; do not invent a different number in M1 without a product decision.

### 5.1 Differential when Soft Auto is ever turned ON

- If a party (or session) starts without full Soft Auto billing and **Soft Auto is ever turned ON** such that Haggle Soft Auto / AI 흥정 work begins, charge the **differential** to reach the applicable **Haggle credits** band (**+5 / +2** vs the Soft Manual-reduced amount, i.e. lift toward Pro10 / Flash4 as appropriate).
- **Turning Soft Auto OFF again = no refund.** **Haggle credits** already taken stay taken.
- Do not refund when switching Soft Manual after Soft Auto has already been ON in that session.

### 5.2 Out of M0 scope (cite only)

- Seller better-model upgrade **+5** (Pro cap) — later; see credit discussion. Mode SoT does not block or require it.
- Staging/local unlimited **Haggle credits** flags remain as in credit notes; production must debit when credits are enabled. Balance/ledger wallet SoT: [credit-ledger-sot.md](./credit-ledger-sot.md) (C0).

---

## 6. Counterpart mode visibility (CU-ready)

- Each party’s current control mode is **mutually visible** to the counterpart.
- UI/copy must be **CU-ready**: a short, unambiguous label (e.g. counterpart is Auto vs Manual) suitable for Cursor / agent surfaces and web — not buried only in debug.
- Visibility updates after a committed handoff (§3), not while an in-flight call is still the old mode.

---

## 7. Seller Manual timeout → Soft Auto resume

**Draft timeouts** (product may tune; behavior is locked):

| Phase | Draft timeout |
| --- | --- |
| Seller’s **first** Manual reply | **30 minutes** |
| **Later** seller Manual replies | **2 hours** |

On timeout:

1. **Soft Auto resume** — seller Soft side returns to **Auto** automatically.
2. **Not** a choose/cancel dialog; **not** session cancel; Hard Authority unchanged.
3. **Notify** the seller (and keep counterpart label accurate).
4. Seller **may Manual again** afterward (timeout clock restarts per phase rules above).

Buyer Manual timeout is **not** locked in M0; do not invent one here.

---

## 8. Non-goals (M0 / this SoT)

- No API routes, DB columns, or UI implementation in this ticket (→ M1/M2).
- No merge to main, no production deploy, no play/real-money runs.
- No change to Hard Authority, 1.5% fee, settlement, or dispute money paths.
- No forced start-of-session mode picker.
- No refund on Auto → Manual after Auto was ON.

---

## 9. Implementation pointers (for M1/M2 — do not build in M0)

When implementing later:

- Persist per-party `control_mode` on the negotiation session (or equivalent), default `auto`.
- Apply Settings default only at session create.
- Serialize mode changes behind in-flight Soft AI completion for that party.
- **Haggle credits** quote/debit uses §5 matrix; differential on first Soft Auto-ON that expands our Soft Auto / AI 흥정 work.
- Seller Manual watchdog uses §7 draft timers → Soft Auto resume + notify.
- Expose counterpart mode on get-negotiation / MCP / CU-ready surfaces.

---

## 10. Related docs

| Doc | Role |
| --- | --- |
| [haggle-core-platform-protocol-design.md](./haggle-core-platform-protocol-design.md) | Hard Authority vs Soft Preference; autonomy stages |
| [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md) | Staging product decision index (cross-link) |
| [2026-08-28-credit-hold-model-discussion.md](../meetings/2026-08-28-credit-hold-model-discussion.md) | Pro10 / Flash4 / +5 draft credit numbers; 1.5% fee |
| [2026-08-29-branch-meeting-brief.md](../meetings/2026-08-29-branch-meeting-brief.md) | Meeting brief restating Flash 4, Pro 10 |
| [credit-ledger-sot.md](./credit-ledger-sot.md) | C0 **Haggle credits** **balance/ledger** SoT (grants/debits/idempotency; not trust-ledger) |
| [i18n-scope-a-sot.md](./i18n-scope-a-sot.md) | Scope A i18n; external name **Haggle credits**; Soft Auto/Manual protocol names kept |

---

## 11. Decision checklist (encode exactly)

- [x] Default Auto ON; no forced choice at start; Settings holds default preference
- [x] Toggle anytime mid-session; handoff after in-flight API finishes
- [x] Both buyer and seller can Manual
- [x] **Haggle credits** = our Soft Auto / AI 흥정 only: both Soft Auto → buyer Pro10/Flash4; buyer Soft Manual + seller Soft Auto → 5/2; both Soft Manual → 0; Soft Auto ever ON → charge differential 5/2; off again → no refund
- [x] Seller Manual timeout (draft 30m first / 2h later) → Soft Auto resume + notify + can Manual again (not choose/cancel)
- [x] Counterpart mode mutually visible (CU-ready label)
- [x] Hard Authority unchanged; Soft only is mode
- [x] Fee 1.5% mode-independent; seller better-model +5 later (Pro cap)

---

## 12. Soft Manual + `/auto-play/next` (Eng1 M4)

When Soft AI would draft for a party that is **Manual**, `POST .../auto-play/next` (and the shared `executeAutoPlayNext` / MCP play path) returns **HTTP 409** with error code **`SOFT_MANUAL_WAITING`** (`waiting_for_manual: true`, `party`, both Soft modes).

**Precedence:** `SOFT_MANUAL_WAITING` takes priority over **`AUTO_PLAY_CONTEXT_MISSING`** when the next Soft AI draft party is Manual — even if auto-play context/token is absent. Non-Soft-Manual sessions keep existing context/token missing behavior.

Buyer Manual + user-specified counter (`price_minor` / `message`) remains allowed through this gate (human Soft turn).
