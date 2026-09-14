# i18n Scope A — Source of Truth (conditional GO(A))

> **Status:** Docs-first product SoT for **multilingual MVP Scope A** (conditional GO(A), C-meeting 2026-09-15).
> **Scope:** UI / settings / screen **copy localization only**. Eng1 owns this SoT; **Eng2** owns web/api feature wiring.
> **Created:** 2026-09-15 (Eng1 ticket — i18n A + Haggle credits rename)
> **Base:** `origin/staging`
> **Citations:** [credit-ledger-sot.md](./credit-ledger-sot.md); [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md) §5 · §5.1 · §5.2

Prefer this file over older ticket or meeting wording when they conflict on **i18n Scope A** boundaries.
This document locks **what** Scope A may localize. It is not a code-change authorization and does **not** authorize main merge or production deploy.

---

## 0. Conditional GO(A)

C-meeting **conditional GO(A)** for multilingual MVP:

| Lock | Rule |
| --- | --- |
| **In scope** | UI / settings / screen **copy** localization only |
| **Numbers** | Charge / grant / band numbers stay locked to **EN source SoT** (unchanged: Pro **10** / Flash **4**, half **5** / **2**, grant table) |
| **Conditions** | Product conditions and gates stay EN SoT |
| **Credits name** | External / balance UI / human SoT copy uses **Haggle credits** (not “Soft AI credits” / “Soft credits”) |
| **Agent dialogue** | Agent dialogue stays **EN source SoT** |
| **Ban** | Do **not** ship or draft copy claiming **“다국어 협상”** |
| **B / C** | **NO** — Scope B/C out of this GO |
| **ES / ZH UI** | **NO** until real-money smoke **and** Jeonghaeng explicit GO |
| **Deploy** | **No main / no production deploy** from this ticket |

Language order **EN → ES → ZH → KO** is an **assumption only**, not a confirmed roadmap.

---

## 1. What Scope A is (and is not)

### 1.1 In Scope A

- Localize **UI chrome**, **settings labels**, and **screen copy** strings that humans read.
- Keep protocol identifiers readable where they appear as product labels, but do not invent new negotiation-protocol semantics in a locale.
- For human-facing Soft jargon, prefer plain language (e.g. **사람 흥정** / **AI 흥정**) when explaining Soft Preference turns to people — while still keeping protocol names **Soft Auto** / **Soft Manual** and **Hard** / **Soft** where they are protocol identifiers.

### 1.2 Out of Scope A (locked)

| Topic | Rule |
| --- | --- |
| Numbers / bands / grants | EN SoT only — do not localize-alter amounts |
| **Haggle credits** product name | External/SoT/balance UI use **Haggle credits**; do not rebrand per locale into Soft-AI wording |
| Agent dialogue | EN source SoT |
| “다국어 협상” marketing/copy | **Banned** |
| Scope B / C | **NO** under this GO |
| ES / ZH UI shipping | **NO** until real-money smoke + Jeonghaeng explicit |
| Soft Auto / Soft Manual / Hard / Soft | Keep as **protocol identifiers** (do not rename the protocol) |
| Web/api feature code | **Eng2** owns implementation; this SoT does not authorize feature PRs |

---

## 2. Naming: Soft jargon vs Haggle credits

| Audience | Prefer | Keep unchanged |
| --- | --- | --- |
| Humans (UI, settings, balance, external SoT prose) | **Haggle credits**; Soft Preference explained in plain language (e.g. 사람 흥정 / AI 흥정) | — |
| Protocol / engineering identifiers | — | **Soft Auto**, **Soft Manual**, **Hard**, **Soft**, code keys like `quoteSoftAiCreditDifferential`, `debit:soft_ai:…`, `SOFT_MANUAL_WAITING` |

Product rename (CTO 2026-09-15): Soft AI credits / Soft credits → **Haggle credits** for external/SoT/balance UI copy. Charge numbers unchanged.

Credit product SoT: [credit-ledger-sot.md](./credit-ledger-sot.md). Mode credit bands: [auto-manual-control-mode-sot.md](./auto-manual-control-mode-sot.md) §5.

---

## 3. Ownership

| Owner | Owns |
| --- | --- |
| **Eng1** | This SoT + credit-ledger / auto-manual §5 **docs** wording for Haggle credits + human Soft plain language |
| **Eng2** | Web/api feature localization wiring (not this ticket) |

---

## 4. Decision checklist (encode exactly)

- [x] Scope A = UI/settings/screen copy localization only
- [x] Numbers, conditions, Haggle credits, agent dialogue = EN source SoT
- [x] Ban copy claiming “다국어 협상”
- [x] B/C NO; ES/ZH UI NO until real-money smoke + Jeonghaeng explicit
- [x] No main / no production deploy from this SoT
- [x] EN→ES→ZH→KO order is assumption only, not confirmed roadmap
- [x] Soft Auto / Soft Manual / Hard / Soft remain protocol identifiers
- [x] Soft AI credits → **Haggle credits** in external/SoT/balance UI language
