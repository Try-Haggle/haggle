# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 6 — WaitingIntent DB + Service + API Route

### Context
Step 5 built WaitingIntent types, state machine, and matcher as pure logic in engine-session. This step connects it to DB and API, following Phase 3 patterns exactly.

### Build Order

#### 1. DB Schema: `packages/db/src/schema/waiting-intents.ts`

Follow exact pattern from `trust-scores.ts` / `tags.ts`.

```
waitingIntents = pgTable("waiting_intents", {
  id:                    uuid PK defaultRandom
  userId:                uuid NOT NULL
  role:                  text enum("BUYER","SELLER") NOT NULL
  category:              text NOT NULL
  keywords:              jsonb NOT NULL              -- string[]
  strategySnapshot:      jsonb NOT NULL              -- MasterStrategy snapshot
  minUtotal:             numeric(8,4) NOT NULL DEFAULT "0.3"
  maxActiveSessions:     integer NOT NULL DEFAULT 5
  status:                text enum("ACTIVE","MATCHED","FULFILLED","EXPIRED","CANCELLED") NOT NULL DEFAULT "ACTIVE"
  matchedAt:             timestamptz
  fulfilledAt:           timestamptz
  expiresAt:             timestamptz NOT NULL
  metadata:              jsonb
  createdAt:             timestamptz NOT NULL DEFAULT now()
  updatedAt:             timestamptz NOT NULL DEFAULT now()
})

intentMatches = pgTable("intent_matches", {
  id:                    uuid PK defaultRandom
  intentId:              uuid NOT NULL
  counterpartyIntentId:  uuid                        -- null if matched against a listing
  listingId:             uuid                        -- null if matched against another intent
  sessionId:             uuid                        -- the negotiation session created
  buyerUtotal:           numeric(8,4) NOT NULL
  sellerUtotal:          numeric(8,4)                -- null for one-sided match (listing trigger)
  createdAt:             timestamptz NOT NULL DEFAULT now()
})
```

Update `packages/db/src/schema/index.ts`:
```ts
export { waitingIntents, intentMatches } from "./waiting-intents.js";
```

#### 2. Service: `apps/api/src/services/intent.service.ts`

Follow pattern from `tag.service.ts` / `trust-score.service.ts`.

```ts
// Functions:
getIntentById(db, intentId)
getActiveIntentsByCategory(db, category, role?)
  → WHERE status = "ACTIVE" AND category = ?
  → If role provided: AND role = ?

getIntentsByUserId(db, userId, status?)
  → WHERE userId = ? (AND status = ? if provided)

createIntent(db, data: { userId, role, category, keywords, strategySnapshot, minUtotal?, maxActiveSessions?, expiresAt })
  → INSERT, defaults status ACTIVE

updateIntentStatus(db, intentId, status, extraFields?)
  → UPDATE status + optional matchedAt/fulfilledAt

getActiveIntentCount(db, userId)
  → SELECT COUNT(*) from waitingIntents WHERE userId = ? AND status IN ("ACTIVE","MATCHED")
  → For capacity check

createMatch(db, data: { intentId, counterpartyIntentId?, listingId?, sessionId, buyerUtotal, sellerUtotal? })
  → INSERT into intentMatches

getMatchesByIntentId(db, intentId)
  → SELECT from intentMatches WHERE intentId = ?

expireStaleIntents(db)
  → UPDATE waitingIntents SET status = "EXPIRED" WHERE status = "ACTIVE" AND expiresAt < now()
  → Return count of expired
```

#### 3. API Route: `apps/api/src/routes/intents.ts`

Follow pattern from `tags.ts` / `trust.ts`.

```
registerIntentRoutes(app, db)

POST /intents
  → Zod: { user_id, role: "BUYER"|"SELLER", category, keywords: string[], strategy: object, min_u_total?, max_active_sessions?, expires_in_days? }
  → Check active intent count (capacity)
  → createIntent(db, ...)
  → Return { intent: created }

GET /intents
  → Query params: user_id?, category?, status?, role?
  → listIntents or getIntentsByUserId
  → Return { intents: rows }

GET /intents/:id
  → getIntentById(db, id)
  → 404 if not found

PATCH /intents/:id/cancel
  → getIntentById first
  → Import transitionIntent from @haggle/engine-session
  → transitionIntent(current.status, "CANCEL")
  → If null: 400 "INVALID_TRANSITION"
  → updateIntentStatus(db, id, "CANCELLED")
  → Return { intent: updated }

POST /intents/:id/match
  → Zod: { listing_id?, counter_intent_id?, session_id, buyer_u_total, seller_u_total? }
  → getIntentById — verify ACTIVE
  → transitionIntent(status, "MATCH") — must succeed
  → updateIntentStatus(db, id, "MATCHED", { matchedAt: new Date() })
  → createMatch(db, matchData)
  → Return { intent: updated, match: created }

POST /intents/trigger-match
  → Zod: { category, listing_id?, trigger_intent_id? }
  → This is the main matching endpoint:
    1. getActiveIntentsByCategory(db, category)
    2. For each intent, build NegotiationContext using assembleContext from engine-session
    3. Import evaluateIntents from @haggle/engine-session
    4. evaluateIntents(intents, contextBuilder)
    5. Return { match_result: { matched: [...], rejected: [...], total_evaluated: N } }
  → NOTE: This endpoint does NOT auto-create sessions. It returns candidates. 
    The caller (or a future event handler) decides what to do with matches.

POST /intents/expire
  → expireStaleIntents(db)
  → Return { expired_count: N }
  → Admin/cron endpoint
```

#### 4. Update `apps/api/src/server.ts`

```ts
import { registerIntentRoutes } from "./routes/intents.js";
// In createServer():
registerIntentRoutes(app, db);
```

### Flags
- Flag: Do NOT add @haggle/engine-session as a dependency to apps/api/package.json IF it's already there. Check first.
- Flag: If NOT there, add it: `"@haggle/engine-session": "workspace:*"`
- Flag: Also add @haggle/engine-core if not already a dependency (needed for NegotiationContext type)
- Flag: POST /intents/trigger-match is the most complex endpoint. Keep it simple for MVP — just evaluate and return results. Do NOT auto-create sessions or update statuses. That's a future step.
- Flag: For trigger-match contextBuilder: this is a simplification. In MVP, accept a `context_template` in the request body that provides the NegotiationContext fields. The caller assembles the context. We don't query listings from DB in this endpoint.
- Flag: Zod schema for strategy can be `z.record(z.unknown())` — we don't validate strategy shape at the API level.
- Flag: No FK constraints in schema. No indexes. No migrations.
- Flag: Import from `@haggle/db` for all drizzle helpers (eq, sql, and, etc.)

### Definition of Done
- [ ] 1 new schema file + index.ts update
- [ ] 1 new service file
- [ ] 1 new route file + server.ts update
- [ ] Typecheck passes
- [ ] Follows Phase 3 patterns exactly

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
