# Review Request — Step 20: API Integration Tests

*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

API integration test infrastructure using vitest + Fastify's `app.inject()`. 26 tests across 3 files covering payment, dispute, and shipment route-level behavior: validation, auth, status codes, and error responses.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `apps/api/vitest.config.ts` | 1-28 | NEW — Vitest config with resolve aliases for payment-core heavy subpath stubs. Sets `LOG_LEVEL=silent` to suppress Fastify request logs during test runs. |
| `apps/api/package.json` | 7, 15 | MODIFIED — Added `"test": "vitest run"` script and `vitest` devDependency. |
| `apps/api/src/__tests__/setup.ts` | 1-120 | NEW — Global test setup. Mocks `@haggle/db` (createDb returns Proxy-based mock), MCP SDK, supabase, easypost, viem, payment-core heavy imports. Patches `@haggle/shipping-core` with missing barrel exports via `importOriginal`. |
| `apps/api/src/__tests__/helpers.ts` | 1-27 | NEW — `getTestApp()` builds and caches the Fastify instance; `closeTestApp()` tears it down. |
| `apps/api/src/__tests__/stubs/payment-heavy.ts` | 1-16 | NEW — Stub classes for `RealX402Adapter`, `ViemDisputeRegistryContract`, `ViemSettlementRouterContract`. These resolve the missing `@haggle/payment-core/heavy/*` subpath exports that Vite cannot find. |
| `apps/api/src/__tests__/payments.test.ts` | 1-170 | NEW — 10 tests: health check 200, payment 404, prepare 401, x402 webhook missing sig 400, x402 missing fields 400 (x2), x402 unknown intent 200, stripe webhook missing sig 400, stripe webhook valid 200, authorize 401. |
| `apps/api/src/__tests__/disputes.test.ts` | 1-170 | NEW — 9 tests: dispute creation 400 (empty body, missing fields, invalid reason code), dispute 404, by-order 404, deposits/expire 200, escalate 404, escalate invalid body 400, deposit 404. |
| `apps/api/src/__tests__/shipments.test.ts` | 1-145 | NEW — 7 tests: shipment creation 400 (empty, partial body), shipment 404, by-order 404, event 404, label 404, rates 400. |

## Key Areas to Scrutinize

1. **setup.ts lines 82-111** — The `@haggle/shipping-core` mock uses `importOriginal` to re-export real barrel exports then adds missing ones. Verify that MockCarrierAdapter and EasyPostCarrierAdapter stubs are sufficient for the constructor calls in `shipments.ts:77-89`.
2. **setup.ts lines 13-26** — The DB mock uses a Proxy for `db.query`. Any route that accesses `db.query.<table>.findFirst()` on a table not in the Proxy will still get a mock. This is intentional but worth noting — if a route accesses a different method (e.g., `execute()`) it would return `undefined`.
3. **Service mock duplication** — Each test file has ~80 lines of `vi.mock()` calls for all service modules. This is required by vitest's module-level mock hoisting. If this grows, consider a shared factory.
4. **stubs/payment-heavy.ts** — These are empty classes. They work because `HAGGLE_X402_MODE` defaults to `"mock"`, so the `RealX402Adapter` path in `providers.ts` is never entered. If that env var changes in tests, these stubs would fail silently.

## Open Questions

- Should the shipping-core barrel be fixed to export MockCarrierAdapter, EasyPostCarrierAdapter, computeWeightBuffer, etc.? The route file imports them from `@haggle/shipping-core` but the barrel doesn't re-export them. This is a pre-existing issue outside Step 20 scope.
- Should we add positive-path tests (e.g., create a dispute with valid data, confirm the 201 response shape)? That would require the service mocks to return actual objects instead of null.
