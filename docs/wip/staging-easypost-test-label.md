# Staging EasyPost test-label one-step (A9)

Date: 2026-09-06
Ticket: CTO A9 — EasyPost test label 한 스텝 (staging mock/test keys only; no real label / real money).

## Goal

Give dogfood testers a **single** API call that creates a shipping label on staging using EasyPost **test** keys (`EZTK…` / legacy `EZTEST…`) or the local **mock** carrier. Real EasyPost postage (`EZAK…` live keys) is **fail-closed** on this path.

Physical live rehearsal (`physical_live` + `HAGGLE_ENABLE_STAGING_LIVE_SHIPPING`) remains a **separate** multi-step flow (`/prepare` → `/purchase-label` with `acknowledge_live_charge`). A9 does not buy real labels.

## One-step path

```
LABEL_PENDING shipment (integration_manual)
  → POST /shipments/{id}/test-label
       { from_address, to_address, parcel, service_level? }
  → EasyPost test buy (cheapest / requested service)  OR  mock label
  → LABEL_CREATED + label_url + tracking_number
```

### Auth / preconditions

- Seller (or admin) auth; shipment owner.
- Shipment status must be `LABEL_PENDING`.
- Shipment execution mode must be `integration_manual` (default on staging). `physical_live` is rejected with `TEST_LABEL_FORBIDDEN_FOR_PHYSICAL_LIVE`.
- Staging (`HAGGLE_ENV=staging`) recommended for dogfood; the live-key gate applies on staging.

### Env

| Variable | Staging dogfood | Role |
| --- | --- | --- |
| `HAGGLE_ENV` | `staging` | Enables live-key fail-closed on this path |
| `EASYPOST_TEST_API_KEY` | `EZTK…` | Preferred test key for one-step label |
| `EASYPOST_API_KEY` | optional legacy `EZTK…` | Used only if test key unset; must not be `EZAK…` on staging |
| `EASYPOST_LIVE_API_KEY` | optional `EZAK…` for physical rehearsal only | **Never** used by `/test-label` |
| (no key) | — | Mock label; no EasyPost network call |

### Live-key hard gate

When the test-label key slot (`EASYPOST_TEST_API_KEY` or legacy `EASYPOST_API_KEY`) classifies as **live** (`EZAK…`):

- `/test-label` and `createEasyPostTestLabelOneStep` **fail-close** with `503 STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN` (staging assert + defense-in-depth on the one-step path in any env)
- No EasyPost `Shipment.create` / `Shipment.buy` is attempted
- Fix: set `EASYPOST_TEST_API_KEY=EZTK…` or clear the misconfigured key to use mock

Unknown prefixes in the test-key slot do **not** call EasyPost; they fall through to the clear mock artifact.

### Tester curl

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://api.staging.tryhaggle.ai/shipments/$SHIPMENT_ID/test-label \
  -d '{
    "from_address": {
      "name": "Seller Test",
      "street1": "417 Montgomery St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94104",
      "country": "US"
    },
    "to_address": {
      "name": "Buyer Test",
      "street1": "179 N Harbor Dr",
      "city": "Redondo Beach",
      "state": "CA",
      "zip": "90277",
      "country": "US"
    },
    "parcel": { "weight_oz": 16, "length_in": 8, "width_in": 6, "height_in": 4 }
  }'
```

Expect `200` with `source: "easypost_test"` or `"mock"`, `label_environment: "test"|"mock"`, `money_charged: false`, `key_mode: "test"|"missing"|"unknown"`, and `shipment.status: "LABEL_CREATED"`.

After a test label, advance tracking with existing `POST /shipments/{id}/test-tracker` (staging + test key only).

## Safety invariants

- Test-label path never reads `EASYPOST_LIVE_API_KEY`.
- Staging (and the one-step path in any env) refuse live keys in the test-key slots (fail-closed, no postage). Unknown prefixes use mock.
- `physical_live` shipments cannot use `/test-label`.
- No PAN / play / real USDC involved; EasyPost test mode does not create real carrier charges.
