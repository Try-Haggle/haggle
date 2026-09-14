# Saved Address Confirm (Physical Start) — Source of Truth

> **Status:** Docs-first product SoT for **saved shipping address confirm** before physical negotiation start. Reinforces D1/D2; Eng1 owns this SoT; **Eng2** owns web UX wiring.
> **Scope:** Pre-`POST /negotiations/start` buyer address UX on **physical / carrier** listings only. Does **not** change Hard Authority, fees, settlement, or digital fulfillment.
> **Created:** 2026-09-15 (Eng1 ticket — saved-address confirm)
> **Base:** `origin/staging`
> **Priority:** Below **9/18 real-money R2** — small UX + docs; do not block R2.
> **Citations:** [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md) §1 (D1/D2); `delivery-address-start-gate` (D1); `shipping-quote-before-start` (D2); `user_saved_addresses` / `/users/me/addresses`; `PreNegotiationFulfillment`

Prefer this file + [product-decisions §1](./product-decisions-2026-09-07.md) over older ticket or meeting wording when they conflict on **saved-address confirm** behavior.
This document locks **what** to build. It is not a code-change authorization and does **not** authorize main merge or production deploy.

---

## 0. Alignment with D1 / D2 (unchanged)

| Lock | Rule |
| --- | --- |
| **D1** | Physical (carrier) start requires a complete **delivery address** before session create |
| **D2** | Physical (carrier) start requires a **successful** test/mock **shipping quote** before session create; incomplete/failed quotes reject start |
| **Digital / A4 no-shipment** | **Exempt** from address + quote gates and from this confirm step |
| **Quote basis** | Quote amount remains the negotiation/checkout shipping basis |

Do **not** revive “address is checkout-only / must not block start” for physical carrier flows ([product-decisions §4](./product-decisions-2026-09-07.md)).

Code locks (existing): `delivery-address-start-gate`, `shipping-quote-before-start`, start-buyer goldens.

---

## 1. Problem

Today, signed-in buyers with a saved default address can land on pre-negotiation fulfillment with the saved address pre-selected and (on some paths) a full/near-full address shown beside blank-form alternatives. Product wants:

1. An explicit **confirm** when a saved address exists — not a blank form as the first impression.
2. Korean confirm copy: **“이 주소로 받을까요?”** with **이 주소로** / **다른 곳으로**.
3. **Minimize** over-exposure of the full address on the confirm UI (PII).
4. The D2 quote must bind to **only the address confirmed this time** — never reuse a quote computed for a different address.

---

## 2. Flow (physical / carrier only)

Applies when the start path is **physical carrier** (D1/D2 required). Guests and buyers with **no** saved address keep the current blank-form path.

```
Physical start intent
        │
        ├─ Digital / A4 no-shipment ──────────────────► start (no address / no quote gate)
        │
        ├─ No saved address (or guest) ───────────────► blank form → complete address → D2 quote → start
        │
        └─ Buyer has ≥1 saved address ────────────────► CONFIRM step
                                                         │
                                                         ├─ 「이 주소로」 → use confirmed saved address → D2 quote(for that address) → start
                                                         │
                                                         └─ 「다른 곳으로」 → existing blank/new input → complete address → D2 quote(for new address) → start
```

### 2.1 Confirm step (saved address present)

| UI element | Locked |
| --- | --- |
| Prompt | **이 주소로 받을까요?** |
| Primary | **이 주소로** — confirm the preferred saved address (default if set, else first saved) for this start |
| Secondary | **다른 곳으로** — leave confirm; show existing new-address input (and optional “save as default” when signed in) |

- Confirm is **before** quote and **before** `POST /negotiations/start`.
- Choosing **이 주소로** counts as the buyer confirming that address for **this** start attempt.
- Choosing **다른 곳으로** must **not** silently keep the saved address as the start payload; the buyer must complete the new form (D1 completeness rules unchanged).

### 2.2 No saved address

Keep current behavior: blank shipping form → on complete address → D2 quote → start. Optional save-as-default when signed in remains allowed.

### 2.3 Digital exempt

If listing/`fulfillment_type` is A4 no-shipment digital (or start is not carrier), **skip** confirm, address form, and shipping quote entirely (same as D1/D2 today).

---

## 3. Quote binding (must)

| Rule | Locked |
| --- | --- |
| Quote input | D2 quote uses **only** the address the buyer confirmed (or newly entered) **for this start attempt** |
| Address change | If the buyer switches from saved → new (or edits the destination), **invalidate** any prior client/server quote for the previous address and **re-quote** |
| Ban | **Never** reuse an old shipping quote that was computed for a **different** address |
| Start payload | `fulfillment.buyer_address` on `POST /negotiations/start` must be the same address that produced the quote used for that start |

Server-side D2 already quotes from `fulfillment.buyer_address` at start; Eng2 must ensure client UX does not display or attach a stale quote from another address. If a future client caches quotes, cache key **must** include a stable hash/fingerprint of the full address fields used for the quote.

---

## 4. Minimize address PII on confirm UI

Confirm UI must **not** dump the full shipping record (street1, street2, phone, full name block) as the default presentation.

| Allowed on confirm | Avoid on confirm |
| --- | --- |
| Optional label (e.g. home) | Full `street1` / `street2` as primary copy |
| Masked summary: **city · ST · ZIP** (same spirit as `formatAddressLine`) | Phone number |
| Recipient first name or initials only if product needs a human cue | Full multi-line address card by default |

Buyer may expand or open Settings to see/edit the full saved address **outside** the minimal confirm prompt; the confirm step itself stays minimal.

**다른 곳으로** input form may show full fields (necessary for entry); that is not the confirm surface.

---

## 5. What this SoT does not change

- D1/D2 server gates and error codes (`DELIVERY_ADDRESS_REQUIRED`, `SHIPPING_QUOTE_*`).
- EasyPost test/mock quote-only policy (no label purchase at start).
- Saved address book API (`/users/me/addresses`) schema.
- Checkout / order snapshot addresses after deal close.
- Real-money R2 scope or schedule.

---

## 6. Eng split

| Owner | Work |
| --- | --- |
| **Eng1** | This SoT + product-decisions reinforcement (docs PR → staging only) |
| **Eng2** | Web confirm UX on pre-negotiation fulfillment / buyer landing; quote invalidation on address change; KO copy strings |

---

## 7. Acceptance (docs)

- [x] Saved-address confirm flow documented and aligned with D1/D2 physical start.
- [x] Digital exempt stated.
- [x] Quote-only-from-confirmed-address rule stated.
- [x] Confirm UI PII minimization stated.
- [ ] Eng2 web implementation (out of Eng1 scope).
