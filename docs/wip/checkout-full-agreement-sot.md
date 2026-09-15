# Checkout Full Agreement — Source of Truth (Soft → Hard)

> **Status:** Docs-first product SoT for the **Soft → Hard** checkout gate. Before card / wallet, the payment page must show the **full** agreed Soft terms — not a summary.
> **Scope:** Buyer payment page after Soft negotiation is accepted, **before** card (Stripe Crypto Onramp) or wallet (x402 / USDC). Does **not** change Hard Authority, Soft Auto / Manual, rails, or fees.
> **Created:** 2026-09-15 (Eng1 — checkout full agreement)
> **Base:** `origin/staging`
> **Citations:** [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md); [staging-onramp-test-mode-map.md](./staging-onramp-test-mode-map.md); [saved-address-confirm-sot.md](./saved-address-confirm-sot.md); [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md); [haggle-core-platform-protocol-design.md](./haggle-core-platform-protocol-design.md) §7 (Hard / Soft)

Prefer this file over older ticket or meeting wording when they conflict on **checkout agreement display** or the **Soft → Hard** confirm.
This document locks **what** to build. It is not a code-change authorization and does **not** authorize main merge or production deploy.

---

## 0. Soft → Hard (this gate)

| Term | Meaning here |
| --- | --- |
| **Soft** | The negotiated deal (price, fulfillment, criteria). Still changeable only by **leaving checkout** to renegotiate or cancel. |
| **Hard** | Binding payment / settlement. Starts only after the buyer confirms **이대로 결제**. |
| **This page** | The payment page **before** card digits or wallet sign. |

Soft Auto / Manual ([auto-manual SoT](./auto-manual-control-mode-sot.md)) is who drafted Soft turns. Hard Authority is floors / ceilings / forbid rules. **This SoT is the handoff:** accepted Soft terms → explicit buyer confirm → Hard money path ([Onramp map](./staging-onramp-test-mode-map.md)).

```
Soft accepted
    → payment page shows FULL agreed Soft terms (§1)
    → 이대로 결제  (§3)  → card / wallet (Hard)
    → change anything (§2) → leave checkout (renegotiate or cancel)
```

**Ban:** skip this page, collapse to a price-only summary, or open card / wallet before the full terms are on screen.

---

## 1. Full terms — not summary-only

The payment page must show the **entire** agreed Soft deal in one view (scroll OK; hide-behind “see negotiation” / “details” **not** OK). Encode exactly:

| Block | Must show |
| --- | --- |
| **Price** | Agreed item price (the Soft close amount). |
| **Address** | Destination in force for this deal: **full** delivery address for carrier ship; pickup location for **pickup**; none / N/A for digital / no-shipment. |
| **Ship / pickup** | Agreed fulfillment: carrier ship (service / quote basis) **or** local pickup (window / place) **or** digital / no-shipment. |
| **Fees + total** | Item + shipping (if any) + disclosed buyer fees (Haggle 1.5%; card rail adds Onramp so buyer total is **3.0%**) + **buyer pays total**. Seller net is rail-independent. |
| **Seller criteria** | **All** agreed **and** required seller criteria for **this** listing — values, not a “met” badge. Electronics examples: **IMEI**, Find My / FRP / reactivation lock, financing paid-off, water damage, plus agreed Soft facts (battery %, storage, cosmetic, unlock) when they were part of the deal. |

**Not enough:** listing title + negotiated price sidebar; fee line without address / ship-pickup / criteria; “Deal accepted” without the criteria list.

**Required vs agreed:** required HARD gates that closed the deal (e.g. clean IMEI) **and** Soft facts the parties actually agreed. Do not invent criteria for another category (shoes have no IMEI; electronics HARD stays — [product-decisions §5](./product-decisions-2026-09-07.md)). Digital still shows price, fees + total, and criteria; address / ship are N/A.

Start-path address UX (default-use saved, **다른 곳으로**) is [saved-address SoT](./saved-address-confirm-sot.md). Checkout shows the **agreed** address in full so the buyer can confirm it — this is not the masked start cue.

---

## 2. Change = leave checkout

The payment page is **read-only** for Soft terms.

| Buyer wants to… | Locked path |
| --- | --- |
| Pay these terms | **이대로 결제** only (§3) |
| Change price, address, ship/pickup, fees, or any criterion | **Leave checkout** → renegotiate (back to Soft) **or** cancel |
| Edit inline on the payment page | **Forbidden** |

No “change address here and continue,” no re-quote on this page, no toggling IMEI / pickup after Soft close. A new Soft close is a new agreement; Hard must not bind a mutated snapshot.

---

## 3. Confirm CTA — **이대로 결제**

| Lock | Rule |
| --- | --- |
| **Only proceed-Hard CTA** | **이대로 결제** / “Pay as agreed” |
| **What it does** | Buyer attests the **full** Soft terms on screen; then card or wallet may open (Hard). |
| **What it is not** | Rail picker, wallet connect, Onramp widget, or “Continue to payment” that skips the full list |
| **Enablement** | Disabled / absent until every §1 block is rendered for this deal (empty required block = cannot confirm) |

Secondary actions may exist (**leave checkout**, back to negotiation, cancel). They must **not** look like the primary pay CTA and must **not** start Hard.

---

## 4. What this SoT does not change

- Soft Auto / Manual, **Haggle credits**, Hard Authority, platform **1.5%** fee.
- Payment rails or PCI: card PANs stay in Stripe Onramp; MCP still returns `checkout_url` only.
- D1/D2 start gates, saved-address default-use, settlement / dispute money paths.

---

## 5. Related (light)

| Doc | Role |
| --- | --- |
| [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md) | Soft Auto / Manual — who drafts Soft; not this confirm |
| [staging-onramp-test-mode-map.md](./staging-onramp-test-mode-map.md) | Card / wallet **after** 이대로 결제 |
| [saved-address-confirm-sot.md](./saved-address-confirm-sot.md) | Address **before** negotiation start |
| [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md) | D1/D2, electronics HARD (IMEI etc.) |
| [criteria-and-issues.md](../engine/criteria-and-issues.md) | Criteria vs HNP issues (IMEI, Find My, …) |

---

## 6. Decision checklist (encode exactly)

- [x] Before card / wallet: payment page shows **full** agreed Soft terms (not summary-only)
- [x] Required blocks: **price**, **address**, **ship/pickup**, **fees + total**, **all agreed/required seller criteria** (IMEI etc.)
- [x] Change any term → **leave checkout** to renegotiate or cancel (no inline edit)
- [x] Only **이대로 결제** proceeds Hard
- [x] Soft Auto / Manual and payment rails unchanged; this SoT is docs-only (no code)
