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
└── seller-wizard.spec.ts      # Phase 5: seller publishes → negotiation_agents row side effect
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

### macOS file-descriptor note

Next.js dev (Watchpack) hits `EMFILE: too many open files` under the default
macOS soft limit (256). The `webServer` block in `playwright.config.ts`
raises it via `ulimit -n 65535` inside its bash login shell. If you start
the dev server yourself with `E2E_BASE_URL=http://localhost:3000`, run
`ulimit -n 65535` first.

## Run against a deployed environment

```bash
E2E_BASE_URL=https://staging.tryhaggle.ai pnpm test:e2e
```

## Coverage status

| Spec                       | Phase | Status |
| -------------------------- | ----- | ------ |
| `smoke.spec.ts` (3 tests)  | —     | ✅ 3/3 passing (verified 2026-05-29) |
| `buyer-claim-flow.spec.ts` | 6     | ⚠️ written, gated by `RUN_FLOW_E2E=1` (needs backend + seeded listing + Supabase) |
| `seller-wizard.spec.ts`    | 5     | ⚠️ written, gated by `RUN_FLOW_E2E=1` (needs backend + auth + seller test user) |

The two flow specs are written so they document the expected behaviour
even when skipped — the assertions describe the contract.
