# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 7 — Skill System Foundation (`packages/skill-core`)

### Context
Phase 5 builds the Skill/API ecosystem. Skills are pluggable modules that extend negotiation capabilities — strategy generation, data enrichment, authentication, dispute resolution.

This step creates the foundation: types, manifest, registry, hook points. Pure logic package — no DB, no API, no external deps.

Design reference: `docs/engine/16_스킬_마켓플레이스.md`

### Why a new package
Skills are cross-cutting — they touch engine, disputes, and commerce. A separate `packages/skill-core` keeps the dependency graph clean. It depends on nothing (maybe engine-core types only for NegotiationContext).

### Build Order

#### 1. `src/types.ts` — Core skill types

```ts
// Skill categories
export type SkillCategory = "STRATEGY" | "DATA" | "INTERPRETATION" | "AUTHENTICATION" | "DISPUTE_RESOLUTION";

// Skill status in the registry
export type SkillStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "DEPRECATED";

// Who provides the skill
export type SkillProvider = "FIRST_PARTY" | "THIRD_PARTY" | "COMMUNITY";

// When in the negotiation pipeline a skill can be invoked
export type HookPoint =
  | "PRE_SESSION"           // Before negotiation starts (strategy generation)
  | "PRE_ROUND"             // Before each round (data enrichment)
  | "POST_ROUND"            // After each round (interpretation)
  | "POST_SESSION"          // After negotiation ends (settlement)
  | "ON_DISPUTE_OPEN"       // When dispute is opened
  | "ON_DISPUTE_EVIDENCE"   // During evidence collection
  | "ON_LISTING_CREATE"     // When a new listing is created (authentication)
  | "ON_MATCH";             // When a match is found

// Pricing model
export type PricingModel = "FREE" | "PER_USE" | "SUBSCRIPTION" | "REVENUE_SHARE";

export interface SkillPricing {
  model: PricingModel;
  perUseCents?: number;            // for PER_USE
  monthlySubscriptionCents?: number; // for SUBSCRIPTION
  revenueSharePercent?: number;     // for REVENUE_SHARE (platform takes 30%)
}

export interface SkillManifest {
  skillId: string;                  // unique identifier, e.g. "legit-app-auth-v1"
  name: string;                     // display name
  description: string;
  version: string;                  // semver
  category: SkillCategory;
  provider: SkillProvider;
  supportedCategories: string[];    // product categories this skill supports, e.g. ["sneakers", "watches"]
  hookPoints: HookPoint[];          // when this skill can be invoked
  pricing: SkillPricing;
  configSchema?: Record<string, unknown>;  // JSON Schema for skill config
  metadata?: Record<string, unknown>;
}

export interface RegisteredSkill {
  manifest: SkillManifest;
  status: SkillStatus;
  registeredAt: string;             // ISO timestamp
  updatedAt: string;
  usageCount: number;
  averageLatencyMs: number;
  errorRate: number;                // 0-1
}

// Skill execution
export interface SkillInput {
  hookPoint: HookPoint;
  context: Record<string, unknown>;  // varies by hook point
  config?: Record<string, unknown>;  // skill-specific config
}

export interface SkillOutput {
  skillId: string;
  hookPoint: HookPoint;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
}
```

#### 2. `src/manifest.ts` — Manifest validation

```ts
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifest(manifest: SkillManifest): ManifestValidationResult
  // Rules:
  // - skillId: non-empty, lowercase, alphanumeric + hyphens only, max 64 chars
  // - name: non-empty, max 128 chars
  // - version: valid semver (simple regex: /^\d+\.\d+\.\d+$/)
  // - category: must be valid SkillCategory
  // - hookPoints: at least one
  // - supportedCategories: at least one
  // - pricing.model: must be valid PricingModel
  // - if PER_USE: perUseCents must be > 0
  // - if SUBSCRIPTION: monthlySubscriptionCents must be > 0
  // - if REVENUE_SHARE: revenueSharePercent must be 0-100

export function isCompatibleHookPoint(skill: SkillManifest, hookPoint: HookPoint): boolean
  // Check if the skill declares support for this hook point

export function isCompatibleCategory(skill: SkillManifest, productCategory: string): boolean
  // Check if skill supports this product category
  // Support wildcard: "vehicles.*" matches "vehicles.cars"
```

#### 3. `src/registry.ts` — In-memory skill registry

```ts
export class SkillRegistry {
  private skills: Map<string, RegisteredSkill>;

  constructor()

  register(manifest: SkillManifest): RegisteredSkill | { error: string }
    // Validate manifest first
    // Check for duplicate skillId
    // Create RegisteredSkill with DRAFT status

  activate(skillId: string): boolean
    // DRAFT → ACTIVE

  suspend(skillId: string): boolean
    // ACTIVE → SUSPENDED

  deprecate(skillId: string): boolean
    // ACTIVE/SUSPENDED → DEPRECATED

  get(skillId: string): RegisteredSkill | undefined

  findByHookPoint(hookPoint: HookPoint, productCategory?: string): RegisteredSkill[]
    // Find all ACTIVE skills that support this hook point
    // If productCategory provided, also filter by compatible category

  findByCategory(skillCategory: SkillCategory): RegisteredSkill[]
    // Find all ACTIVE skills of this type

  listAll(): RegisteredSkill[]

  recordUsage(skillId: string, latencyMs: number, success: boolean): void
    // Update usageCount, averageLatencyMs (rolling), errorRate
}
```

#### 4. `src/pipeline.ts` — Hook point pipeline executor

```ts
export interface PipelineConfig {
  maxSkillsPerHookPoint: number;    // default 5
  timeoutMs: number;                // default 5000
  failurePolicy: "SKIP" | "ABORT"; // default SKIP — if one skill fails, continue
}

export function defaultPipelineConfig(): PipelineConfig

// Determine which skills should run for a given hook point + category
export function resolveSkills(
  registry: SkillRegistry,
  hookPoint: HookPoint,
  productCategory: string,
): RegisteredSkill[]

// Execute skills in sequence (for MVP — parallel in future)
// This is a pure planning function — it returns the execution plan, not results
// Actual execution happens at the API layer where async calls are possible
export interface SkillExecutionPlan {
  hookPoint: HookPoint;
  skills: RegisteredSkill[];
  config: PipelineConfig;
}

export function createExecutionPlan(
  registry: SkillRegistry,
  hookPoint: HookPoint,
  productCategory: string,
  config?: Partial<PipelineConfig>,
): SkillExecutionPlan
```

#### 5. `src/index.ts` — Re-exports

Export all types and functions.

#### 6. Package setup
- `package.json` — match arp-core/tag-core pattern. No external deps. vitest devDep only.
- `tsconfig.json` — extends base
- `vitest.config.ts` — standard

#### 7. Tests — `__tests__/`

**`manifest.test.ts`** (~15 tests):
- Valid manifest passes
- Invalid skillId (empty, too long, uppercase, special chars)
- Invalid version (not semver)
- Empty hookPoints fails
- Empty supportedCategories fails
- PER_USE without perUseCents fails
- SUBSCRIPTION without monthly fails
- REVENUE_SHARE out of range fails
- isCompatibleHookPoint: matches, doesn't match
- isCompatibleCategory: exact match, wildcard match, no match

**`registry.test.ts`** (~18 tests):
- register: valid manifest creates DRAFT skill
- register: invalid manifest returns error
- register: duplicate skillId returns error
- activate: DRAFT → ACTIVE
- suspend: ACTIVE → SUSPENDED
- deprecate: ACTIVE/SUSPENDED → DEPRECATED
- Invalid transitions fail (e.g., DEPRECATED → ACTIVE)
- get: returns registered skill
- get: returns undefined for unknown
- findByHookPoint: returns matching ACTIVE skills
- findByHookPoint: filters by category
- findByHookPoint: ignores non-ACTIVE skills
- findByCategory: returns matching skills
- listAll: returns all skills
- recordUsage: updates count, latency, error rate

**`pipeline.test.ts`** (~8 tests):
- defaultPipelineConfig returns expected values
- resolveSkills returns ACTIVE skills for hook point + category
- resolveSkills respects maxSkillsPerHookPoint limit
- createExecutionPlan returns correct plan
- Empty registry returns empty plan
- No matching skills returns empty plan

### Flags
- Flag: This package has ZERO external dependencies. Not even engine-core. SkillInput.context is Record<string, unknown> — caller provides the context shape.
- Flag: SkillRegistry is in-memory only. DB persistence happens at the service/API layer (Step 8).
- Flag: Pipeline does NOT execute skills. It creates execution plans. Execution is async and happens in routes.
- Flag: Use the same package structure pattern as tag-core/arp-core.
- Flag: Do NOT implement actual skill execution (HTTP calls, etc.). That's Step 8+.
- Flag: Wildcard matching for categories: "vehicles.*" should match "vehicles.cars" but not "vehicles" or "electronics".

### Definition of Done
- [ ] 5 source files: types.ts, manifest.ts, registry.ts, pipeline.ts, index.ts
- [ ] Package setup: package.json, tsconfig.json, vitest.config.ts
- [ ] ~40 tests across 3 test files
- [ ] `pnpm --filter @haggle/skill-core test` passes
- [ ] `pnpm --filter @haggle/skill-core typecheck` passes
- [ ] No external dependencies

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
