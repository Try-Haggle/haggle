# Review Request — Step 6: WaitingIntent DB + Service + API Route (rev 2)
*Written by Builder. Read by Reviewer.*

Ready for Re-Review: YES

---

## Rev 2 Fixes (from REVIEW-FEEDBACK.md must-fix items)

1. **MF-1 — hardcoded status strings**: Replaced `"CANCELLED"` (line 142) and `"MATCHED"` (line 171) with `nextStatus` variable returned by `transitionIntent()`. State machine is now the single source of truth for status values.
2. **MF-2 — scope creep endpoint removed**: Deleted `GET /intents/:id/matches` route (lines 186-198) and its `getMatchesByIntentId` import. Service function retained per reviewer guidance.

## What Was Built

WaitingIntent persistence layer (DB schema, service, API routes) connecting Step 5's pure logic to the API. One new schema file with two tables, one new service file with 9 functions, one new route file with 7 endpoints, schema index and server.ts updated.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `packages/db/src/schema/waiting-intents.ts` | 1-33 | NEW — waitingIntents table (16 cols) + intentMatches table (8 cols) |
| `packages/db/src/schema/index.ts` | 27 | MODIFIED — added waitingIntents, intentMatches exports |
| `apps/api/src/services/intent.service.ts` | 1-157 | NEW — 9 service functions (getIntentById, getActiveIntentsByCategory, getIntentsByUserId, createIntent, updateIntentStatus, getActiveIntentCount, createMatch, getMatchesByIntentId, expireStaleIntents) |
| `apps/api/src/routes/intents.ts` | 1-237 | NEW — registerIntentRoutes: POST /intents, GET /intents, GET /intents/:id, PATCH /intents/:id/cancel, POST /intents/:id/match, POST /intents/trigger-match, POST /intents/expire |
| `apps/api/src/server.ts` | 19, 68 | MODIFIED — import registerIntentRoutes + registration call |

## Remaining Areas to Scrutinize (should-fix + escalate items from review)

1. **trigger-match endpoint** — `currentActiveSessions: 0` hardcode and `context_template` passthrough are MVP simplifications. Escalated to Architect.
2. **capacity check** — uses `max_active_sessions` from request body (default 5). Per-request cap vs system-wide constant.
3. **GET /intents with no filters** — returns empty array instead of 400 `FILTER_REQUIRED`. Reviewer flagged as should-fix.
4. **Comment at line 185** — "MUST be before /:id routes" wording is misleading per reviewer. Fastify radix-tree router handles static vs parametric correctly regardless of order.

## Open Questions

1. Should GET /intents with no query params return 400 "FILTER_REQUIRED" instead of empty array?
2. Is `currentActiveSessions: 0` in trigger-match acceptable for MVP, or should we add a count subquery? (Escalated to Architect)

## Verification

```
pnpm --filter @haggle/db typecheck      — 0 errors
pnpm --filter @haggle/api typecheck     — 0 errors in new files (KG-3 shipping-core pre-existing only)
```
