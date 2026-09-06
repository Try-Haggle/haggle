# Staging auth for `POST /tools/payment-test/dispute-ready-order`

Date: 2026-09-06

Tester blocker: calling the fixture without `Authorization` returns `401 AUTH_REQUIRED`. MCP has no fixture tool, so HTTP is the dogfood path.

## Prerequisites (Railway staging)

- `HAGGLE_ENV=staging`
- `NODE_ENV=production` (normal for staging)
- `HAGGLE_ENABLE_PAYMENT_TEST_TOOLS=true`
- No real money / no card PAN — fixture writes mock `SETTLED` payment + `DELIVERED`/`PAID` order only

## Auth header (required)

```http
Authorization: Bearer <access_token>
```

`<access_token>` must be a **UUID-subject** token for the **same buyer** who will call `haggle_start_dispute`:

1. **Staging web session (preferred for curl)**  
   Sign in at `https://app.staging.tryhaggle.ai`, then copy the Supabase `access_token` from the browser session (Application → Local Storage / session under the staging Supabase project).

2. **MCP OAuth access token**  
   Reuse the bearer token already issued to the MCP client for that buyer. Staging accepts non-admin roles (`user` / `authenticated`) when the payment-test flag is on. Production still requires `admin`.

Unsigned local test JWTs (`HAGGLE_ALLOW_UNVERIFIED_TEST_JWT`) are **forbidden** on staging.

## Example

```bash
export STAGING_API=https://api.staging.tryhaggle.ai
export TOKEN='eyJ...'   # staging Supabase or MCP access token

curl -sS -X POST "$STAGING_API/tools/payment-test/dispute-ready-order" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"order_status":"DELIVERED","selected_payment_rail":"stripe","amount_minor":45000}'
```

Success: `201` with `fixture.order_id`, `money_moved: false`, `card_pan_used: false`.  
Then MCP: `haggle_start_dispute` with that `order_id` (suggested reason `ITEM_NOT_AS_DESCRIBED`).

## Common errors

| Status | Error | Cause |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | Missing `Authorization: Bearer …` |
| 401 | `INVALID_TOKEN` | Bad/expired JWT or unknown MCP token |
| 403 | `PAYMENT_TEST_TOOLS_DISABLED` | Flag off, or production without admin |
| 400 | `PAYMENT_TEST_BUYER_ID_MUST_BE_UUID` | Token `sub` is not a UUID (local non-UUID test tokens) |

Related: `docs/wip/dispute-start-api-design.md`, `.env.example` (`HAGGLE_ENABLE_PAYMENT_TEST_TOOLS`).
