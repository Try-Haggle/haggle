# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 8 — Fix shipping-core Build Errors

### Context
`packages/shipping-core` has build errors. The `types.ts` only has SLA types but the rest of the package references `Shipment`, `ShipmentStatus`, `ShipmentEvent` which don't exist. Also `@haggle/commerce-core` and `@easypost/api` dependencies are missing from package.json.

The `index.ts` only exports SLA modules, not the shipment state machine, service, provider, etc.

### Root Cause
The package was partially implemented — SLA system (tests passing via vitest which doesn't need build) but shipment tracking types were never added to types.ts. The non-SLA files (state-machine.ts, provider.ts, service.ts, easypost-adapter.ts, etc.) reference types that don't exist.

### Fix Strategy
Two options:
**Option A (Recommended):** Add missing types to types.ts, add missing deps to package.json, update index.ts to export all modules.
**Option B:** Remove the unfinished files and keep only SLA (regressive).

Go with Option A.

### Build Order

#### 1. Add missing types to `src/types.ts`
Append after existing SLA types. Derive from what state-machine.ts and other files expect:

```ts
// ─── Shipment Tracking Types ─────────────────────────────────

export type ShipmentStatus =
  | "LABEL_PENDING"
  | "LABEL_CREATED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_EXCEPTION"
  | "RETURN_IN_TRANSIT"
  | "RETURNED";

export interface ShipmentEvent {
  event_type: string;
  status: ShipmentStatus;
  timestamp: string;          // ISO
  location?: string;
  description?: string;
  carrier_detail?: Record<string, unknown>;
}

export interface Shipment {
  shipment_id: string;
  order_id: string;
  carrier: string;            // "easypost", "usps", "ups", "fedex"
  tracking_number?: string;
  status: ShipmentStatus;
  events: ShipmentEvent[];
  label_url?: string;
  estimated_delivery?: string;  // ISO
  created_at: string;
  updated_at: string;
}
```

Read ALL files that import these types to verify the shapes match:
- `src/state-machine.ts` — uses ShipmentStatus
- `src/provider.ts` — uses Shipment, ShipmentEvent, ShipmentStatus
- `src/service.ts` — uses Shipment, ShipmentEvent, ShipmentStatus, imports from @haggle/commerce-core
- `src/easypost-adapter.ts` — uses Shipment, ShipmentEvent, ShipmentStatus, imports @easypost/api
- `src/easypost-webhook.ts` — uses ShipmentStatus
- `src/escalation.ts` — uses ShipmentStatus, Shipment
- `src/mock-carrier-adapter.ts` — uses Shipment, ShipmentEvent

Adjust the types as needed based on actual usage.

#### 2. Add dependencies to `package.json`
```json
"dependencies": {
  "@haggle/commerce-core": "workspace:*"
}
```
For `@easypost/api`: check if it's actually used at runtime or just for types. If the adapter is optional, wrap the import with try/catch or make it a peerDependency. 

Read `src/easypost-adapter.ts` to determine the right approach. If it imports EasyPostClient directly, add as optional/peer dep.

#### 3. Update `src/index.ts`
Export all modules:
```ts
export * from "./types.js";
export * from "./sla-defaults.js";
export * from "./sla-validation.js";
export * from "./sla-violation.js";
export * from "./state-machine.js";
export * from "./provider.js";
export * from "./service.js";
export * from "./escalation.js";
// Don't export easypost-adapter or mock-carrier-adapter (provider implementations, not public API)
```

#### 4. Verify
- `pnpm --filter @haggle/shipping-core typecheck` passes (or at least drastically reduced errors)
- `pnpm --filter @haggle/shipping-core test` still passes (184 existing tests)

### Flags
- Flag: Do NOT change any existing logic. Only add missing types and deps.
- Flag: Read every file that has errors to understand what types they expect. Don't guess.
- Flag: The easypost-adapter.ts imports from `@easypost/api`. If this package isn't installed and we can't install it easily, mark the import as `// @ts-ignore` with a TODO, or add `@easypost/api` as an optional peerDependency. Check if it exists in the workspace root.
- Flag: `service.ts` imports from `@haggle/commerce-core`. This workspace package exists and builds. Just add it as a dependency.
- Flag: If type shapes need adjustment, adjust them. The goal is build success with 0 logic changes.

### Definition of Done
- [ ] types.ts has ShipmentStatus, ShipmentEvent, Shipment
- [ ] package.json has needed deps
- [ ] index.ts exports all public modules
- [ ] Build errors drastically reduced or eliminated
- [ ] Existing tests still pass

---

## Step 9 — Skill DB + Service + API (Phase 5b-c)

### Context
skill-core (Step 7) provides in-memory types, manifest validation, registry, and pipeline. This step persists skills to DB and exposes via API. Same pattern as Phase 3.

### Build Order

#### 1. DB Schema: `packages/db/src/schema/skills.ts`

```
skills = pgTable("skills", {
  id:                  uuid PK defaultRandom
  skillId:             text NOT NULL UNIQUE          -- "legit-app-auth-v1"
  name:                text NOT NULL
  description:         text NOT NULL
  version:             text NOT NULL                 -- semver
  category:            text enum("STRATEGY","DATA","INTERPRETATION","AUTHENTICATION","DISPUTE_RESOLUTION") NOT NULL
  provider:            text enum("FIRST_PARTY","THIRD_PARTY","COMMUNITY") NOT NULL
  status:              text enum("DRAFT","ACTIVE","SUSPENDED","DEPRECATED") NOT NULL DEFAULT "DRAFT"
  supportedCategories: jsonb NOT NULL                -- string[]
  hookPoints:          jsonb NOT NULL                -- HookPoint[]
  pricing:             jsonb NOT NULL                -- SkillPricing
  configSchema:        jsonb
  usageCount:          integer NOT NULL DEFAULT 0
  averageLatencyMs:    numeric(8,2) NOT NULL DEFAULT "0"
  errorRate:           numeric(8,4) NOT NULL DEFAULT "0"
  metadata:            jsonb
  registeredAt:        timestamptz NOT NULL DEFAULT now()
  updatedAt:           timestamptz NOT NULL DEFAULT now()
})

skillExecutions = pgTable("skill_executions", {
  id:           uuid PK defaultRandom
  skillId:      text NOT NULL                        -- matches skills.skillId
  hookPoint:    text NOT NULL
  success:      boolean NOT NULL
  latencyMs:    integer NOT NULL
  inputSummary: jsonb                                -- truncated input for debugging
  outputSummary: jsonb                               -- truncated output
  error:        text
  createdAt:    timestamptz NOT NULL DEFAULT now()
})
```

Update `packages/db/src/schema/index.ts`.

#### 2. Service: `apps/api/src/services/skill.service.ts`

```ts
getSkillBySkillId(db, skillId)
listSkills(db, filters?: { category?, status?, hookPoint? })
createSkill(db, data)          -- from SkillManifest
updateSkillStatus(db, skillId, status)
updateSkillMetrics(db, skillId, latencyMs, success)  -- rolling avg update
recordExecution(db, data)      -- insert into skillExecutions
getExecutionsBySkillId(db, skillId, limit?)
```

#### 3. API Route: `apps/api/src/routes/skills.ts`

```
registerSkillRoutes(app, db)

POST /skills                    -- register a new skill (validates manifest via skill-core)
GET /skills                     -- list skills (query: category?, status?, hook_point?)
GET /skills/:skillId            -- get skill details
PATCH /skills/:skillId/activate -- DRAFT → ACTIVE
PATCH /skills/:skillId/suspend  -- ACTIVE → SUSPENDED
PATCH /skills/:skillId/deprecate -- → DEPRECATED
POST /skills/:skillId/execute   -- execute skill (record execution, update metrics)
GET /skills/:skillId/executions -- execution history

GET /skills/resolve             -- query: hook_point, product_category → find matching active skills
```

#### 4. Update server.ts

### Flags
- Flag: Add @haggle/skill-core as a dependency to apps/api/package.json
- Flag: Use validateManifest from skill-core in POST /skills
- Flag: Use resolveSkills logic (or just query DB with filters) for GET /skills/resolve
- Flag: Follow exact same patterns as tags.ts route + tag.service.ts
- Flag: No actual skill execution logic (HTTP calls). POST /skills/:skillId/execute just records the execution log.

### Definition of Done
- [ ] 1 schema file + index.ts update
- [ ] 1 service file
- [ ] 1 route file + server.ts update
- [ ] Typecheck passes

---

## Step 10 — USDC Payment Integration Check

### Context
payment-core already exists with x402 + Stripe adapters. We need to verify the integration works and identify what's missing for MVP.

### This is a RESEARCH step, not a build step.

Bob should:
1. Read `packages/payment-core/src/index.ts` to understand what's exported
2. Read `packages/payment-core/src/types.ts` for payment types
3. Read `packages/payment-core/src/real-x402-adapter.ts` for x402 integration
4. Read `packages/payment-core/src/x402-protocol.ts` for protocol details
5. Read `apps/api/src/routes/payments.ts` to see existing payment endpoints
6. Read `apps/api/src/services/payment-record.service.ts` for DB integration
7. Check if there are payment tests: `pnpm --filter @haggle/payment-core test`

### Deliverable
Write a status report to `handoff/ARCHITECT-BRIEF.md` with:
- What's already working
- What's missing for MVP USDC payments
- What needs to be built (specific files, functions)
- Any blockers (missing env vars, missing contracts, etc.)

DO NOT build anything yet. Just report.

---

## Execution Order
1. Step 8 (shipping-core fix) — Bob first, quick fix
2. Step 9 (Skill DB/API) — Bob second, standard pattern
3. Step 10 (USDC research) — Bob third, research only

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
