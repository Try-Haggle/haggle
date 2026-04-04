# Review Feedback — Step 6
Date: 2026-04-03
Ready for Builder: NO

## Must Fix

1. **intents.ts:142** — `updateIntentStatus(db, id, "CANCELLED")` hardcodes the status string instead of using `nextStatus` returned from `transitionIntent` on line 138. Same issue at **line 171**: `updateIntentStatus(db, id, "MATCHED", ...)` hardcodes instead of using `nextStatus` from line 167. If the state machine mapping ever changes, this diverges silently. Fix: replace the hardcoded string with `nextStatus` in both locations.

2. **intents.ts:186-198** — `GET /intents/:id/matches` is not in the brief. Bob flagged this himself as potential scope creep. The service function `getMatchesByIntentId` can stay (natural service-layer utility), but the route must be removed. If the endpoint is wanted, Arch adds it to the brief first.

## Should Fix

1. **intents.ts:200** — Comment reads "MUST be before /:id routes but Fastify handles this via method+path." The first clause is incorrect. Fastify uses a radix-tree router (find-my-way) that resolves static path segments over parametric regardless of registration order. The "MUST be before" wording will mislead the next reader. Remove or rewrite to just say Fastify's router handles static vs parametric correctly.

2. **intents.ts:97-111** — `GET /intents` with no query params returns `{ intents: [] }`. The brief lists query params `user_id?, category?, status?, role?` but does not specify behavior when none are provided. Returning an empty array avoids a full table scan but gives the caller no indication they forgot a filter. Recommend 400 `FILTER_REQUIRED` listing accepted params. Not blocking for MVP.

3. **waiting-intents.ts:26** — `sessionId` in `intentMatches` is nullable (no `.notNull()`). The brief shows `sessionId: uuid -- the negotiation session created` without an explicit nullable marker, unlike `counterpartyIntentId` and `listingId` which both say "null if...". Ambiguous in the brief, and nullable is the safer MVP choice. Flagging for awareness.

## Escalate to Architect

1. **intents.ts:224** — `currentActiveSessions: 0` hardcode in trigger-match DB-to-WaitingIntent mapping. The matcher (engine-session matcher.ts:34) checks `currentActiveSessions < maxActiveSessions` as a filter condition. With 0 hardcoded, every intent passes this check regardless of how many sessions it actually has. The brief flag says "MVP simplification." Arch should confirm this is acceptable, or whether a per-intent `getActiveIntentCount` subquery is needed to avoid over-matching.

2. **intents.ts:231-233** — `contextBuilder` returns the identical `context_template` for every intent. Since `evaluateMatch` calls `computeUtility(context)` and context is the same object for all intents, every intent gets the same `utotal`. The only differentiator is `minUtotal` threshold (and `currentActiveSessions`, which is hardcoded to 0). Arch should confirm this is the intended MVP behavior or specify how per-intent context differentiation should work.

## Cleared

Schema file matches brief columns exactly: 16 columns on `waitingIntents`, 8 columns on `intentMatches`. Types, precision, defaults, and nullability all correct. Schema index export at `packages/db/src/schema/index.ts:27` matches brief. Service file has all 9 functions with correct signatures matching the brief. `server.ts` import (line 19) and registration (line 68) correct. Zod validation present on all POST/PATCH bodies (`createIntentSchema`, `matchIntentSchema`, `triggerMatchSchema`). Strategy validated as `z.record(z.unknown())` per brief flag. Error handling patterns (400/404/409 codes with error code strings) match existing route conventions. `transitionIntent` and `evaluateIntents` imports resolve to correct engine-session exports. DB row to `WaitingIntent` mapping covers all 11 required fields. `expireStaleIntents` correctly filters `status = ACTIVE AND expiresAt < now()` and returns count.
