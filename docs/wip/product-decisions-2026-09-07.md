# Product decisions — 2026-09-07 (Jeonghaeng)

Short SoT for staging/product alignment. Prefer these over older ticket wording when they conflict.

**CTO note:** PR [#120](https://github.com/Try-Haggle/haggle/pull/120) (A3) said delivery address is checkout-only and must not block negotiation start — **superseded for physical** by D1/D2; prefer this Jeonghaeng product decision.

## 1. Physical start = address + shipping quote (D1/D2); digital exempt

- **Physical (carrier):** buyer must have a delivery address **and** a successful test/mock shipping quote **before** `POST /negotiations/start` creates a session (D1 + D2). Incomplete/failed quotes reject start; quote amount is the negotiation/checkout shipping basis.
- **Digital / A4 no-shipment** (`fulfillment_type` digital paths): exempt from address + quote gates.
- Code locks: `delivery-address-start-gate`, `shipping-quote-before-start`, start-buyer goldens.

## 2. MCP `haggle_get_negotiation` defaults to full transcript + offers (E1)

- MCP omit / `expand: []` → full **transcript + offers** (plus `recent_messages` as today), so agents negotiate without an extra expand round-trip.
- Explicit `expand` may still request a subset.
- **Web SoT unchanged** — MCP-facing default via `normalizeGetNegotiationExpand` only.
- Cross-user reject unchanged (`SESSION_ACTOR_MISMATCH` / 403).

## 3. T1 human-before-resolve (extends B5)

- After `POST /disputes/:id/ai/assess` reaches **COMPLETED**, do **not** call resolve / finalizer / refund / settlement-release without **human review**.
- B5 invariant: completed assessments always stamp `auto_applied: false` (`dispute-ai-assessment-money-guard`).
- A later auto-release / auto-apply policy may exist as design, but is **not default-on**.

## 4. #120 wording corrected

| Old (#120 / A3) | Current (D1/D2) |
| --- | --- |
| Delivery address belongs to checkout/shipping; must not gate listing start | Physical: address + shipping quote **do** gate start; digital exempt |

Do not revive “address is checkout-only / must not block start” for physical carrier flows.

## Related PRs

- D1 [#143](https://github.com/Try-Haggle/haggle/pull/143), D2 [#142](https://github.com/Try-Haggle/haggle/pull/142), E1 [#144](https://github.com/Try-Haggle/haggle/pull/144), B5 money-guard, superseded A3 [#120](https://github.com/Try-Haggle/haggle/pull/120).
