# apps/web E2E (Playwright)

Smoke + flow tests for the Negotiation Agent rebuild.

## Layout

```
e2e/
├── README.md              # this file
├── fixtures/
│   └── test-users.ts      # seeded test-account credentials
├── smoke.spec.ts          # public-page smoke (no auth, no API)
├── buyer-claim-flow.spec.ts   # Phase 6: anonymous buyer → guest_buyer_id → sign-up → claim
├── seller-wizard.spec.ts      # Phase 5: seller publishes → negotiation_agents row side effect
└── two-account-transaction-rehearsal.spec.ts
                              # seller link → buyer negotiation → wallet funding → both order views
```

## Run locally

```bash
# 1. Dependencies (root-level @playwright/test)
pnpm install

# 2. Chromium browser
npx playwright install chromium

# 3. Smoke specs run without backend (no auth, no API mutations).
#    Verified passing: 3/3 in ~13s on macOS arm64.
pnpm test:e2e:smoke

# 4. Flow specs need the API, the DB with migration 0024 applied,
#    and seeded test users (see fixtures/test-users.ts).
#    Enable them with RUN_FLOW_E2E=1.
RUN_FLOW_E2E=1 pnpm test:e2e
```

## Two-account transaction rehearsal

This release rehearsal uses two isolated browser sessions. Use the seller's real staging account
and a separate Haggle buyer test account. By default, the test shows each sign-in page in turn so
the operator can enter credentials without storing a personal password in a file.

Create an ignored `.env.e2e.local` at the repository root:

```dotenv
RUN_TRANSACTION_REHEARSAL=1
E2E_BASE_URL=https://app.staging.tryhaggle.ai
# Required: use the actual test item's PNG, JPG, or WebP file (max 5 MB)
E2E_LISTING_PHOTO_PATH=/absolute/path/to/a-test-product-image.png
```

CI-owned test accounts may opt into automatic login by setting both the email and password for
each role. Never commit these values, and do not use this option for a personal account:

```dotenv
E2E_SELLER_EMAIL=staging-seller@example.test
E2E_SELLER_PASSWORD=secret-from-the-CI-vault
E2E_BUYER_EMAIL=staging-buyer@example.test
E2E_BUYER_PASSWORD=secret-from-the-CI-vault
```

Load the ignored file into the current terminal, then start the visible rehearsal:

```bash
set -a
source .env.e2e.local
set +a
pnpm test:e2e:transaction
```

The test opens separate seller and buyer browser sessions. After the two manual logins, it automates
file upload, publishing, link handoff, negotiation, checkout selection, and both order views. It
waits for the operator again at these buyer-wallet checkpoints:

1. Connect a dedicated Base Sepolia test wallet with test ETH and hUSDC.
2. Approve the single atomic hUSDC approval + deposit transaction.

The run is successful only when both accounts can open the same order and observe `SETTLED`.
The seller payout address must already be registered for the seller account or configured as the
staging x402 seller fallback. Do not use a personal/mainnet wallet.

### Wallet and navigation variations

Every transaction rehearsal automatically verifies all of the following before funding:

- checkout Back preserves the fulfillment and payment choices;
- browser Back returns to the negotiation and Forward restores checkout choices;
- quote Back allows a fresh quote without creating a second payment intent.

Add any of these flags to `.env.e2e.local` for the manual wallet variations. They can be combined
in one run:

| Flag | Operator action | Required result |
| --- | --- | --- |
| `E2E_EXERCISE_WRONG_NETWORK=1` | Change the buyer wallet away from Base Sepolia | checkout is blocked and switches safely back to Base Sepolia |
| `E2E_EXERCISE_WALLET_CHANGE=1` | Prepare with wallet A, then choose wallet B | the request bound to A is discarded and B receives a fresh quote |
| `E2E_EXERCISE_REJECTED_SIGNATURE=1` | Reject the first atomic payment request | the same prepared payment remains retryable and only the approved retry is submitted |

The component-level suite covers these cases without touching staging: persisted choices,
connected-wallet reuse, wrong-network blocking, disconnect/reconnect after preparation, immutable
shipping mode, wallet A-to-B request rebinding, rejected-signature retry, non-atomic wallet
rejection, double-click suppression, and the successful atomic funding path.

### macOS file-descriptor note

Next.js dev (Watchpack) hits `EMFILE: too many open files` under the default
macOS soft limit (256). The `webServer` block in `playwright.config.ts`
raises it via `ulimit -n 65535` inside its bash login shell. If you start
the dev server yourself with `E2E_BASE_URL=http://localhost:3000`, run
`ulimit -n 65535` first.

## Run against a deployed environment

```bash
E2E_BASE_URL=https://app.staging.tryhaggle.ai pnpm test:e2e
```

## Coverage status

| Spec                       | Phase | Status |
| -------------------------- | ----- | ------ |
| `smoke.spec.ts` (3 tests)  | —     | ✅ 3/3 passing (verified 2026-05-29) |
| `buyer-claim-flow.spec.ts` | 6     | ⚠️ written, gated by `RUN_FLOW_E2E=1` (needs backend + seeded listing + Supabase) |
| `seller-wizard.spec.ts`    | 5     | ⚠️ written, gated by `RUN_FLOW_E2E=1` (needs backend + auth + seller test user) |
| `two-account-transaction-rehearsal.spec.ts` | release | ⚠️ headed, gated by `RUN_TRANSACTION_REHEARSAL=1` (creates staging data and needs manual wallet approval) |

The two flow specs are written so they document the expected behaviour
even when skipped — the assertions describe the contract.
