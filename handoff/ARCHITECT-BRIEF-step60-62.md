# ARCHITECT BRIEF — Steps 60~62: Context Engineering Route 1

**Author**: Arch
**Date**: 2026-04-08
**Builder**: Bob
**Reviewer**: Richard
**Scope**: `apps/api` only. Telemetry infra + tag placement prompt refactor + category-aware embedding input.
**Do NOT touch**: `packages/engine-session/**`, `apps/api/src/lib/negotiation-executor.ts`, anything negotiation-related (Route 2 is in-flight).

---

## Context

Three related problems, one brief:

1. **We are flying blind on LLM cost/latency.** `tag-placement-llm.service.ts` and `embedding.service.ts` call OpenAI with zero structured observability. We cannot answer "how much did tag placement cost yesterday" or "p95 latency of embeddings". This must land FIRST, because Steps 61 and 62 will depend on the telemetry wrapper.
2. **Tag placement prompt is hard-coded and static.** `SYSTEM_PROMPT` and 3 fixed `FEW_SHOT_MESSAGES` live inline. No category-awareness, no semantic pre-ranking of candidates. Prompt iteration requires a code change + typecheck + test run.
3. **Embedding input is category-blind.** A single tagged template serializes every listing the same way, whether it's an iPhone or a leather jacket. The Phase 0 wedge is iPhone Pro — we are leaving retrieval quality on the table.

All three ship into the same surface (LLM call sites in `apps/api/src/services/`) so we sequence them: **60 → 61 → 62**.

---

## Step 60 — LLM Telemetry shim (shared infra)

### Goal
A single `withLLMTelemetry(meta, fn)` helper that wraps any async LLM/embedding/Replicate call, captures usage + latency + error shape, and emits a structured JSON log line. Gated by env flag. **No DB table for MVP** (justified below).

### Decision: DB table — NO, defer.

Arguments for (rejected):
- "Billing audit" — OpenAI dashboard already has this.
- "Per-listing attribution" — premature; we don't have a cost dashboard story yet.

Arguments against (accepted):
- Adds a migration + schema coupling + write I/O on every LLM call.
- Structured console logs are aggregated by whatever log pipeline we attach later (Datadog / Axiom / Vercel logs) — same data, zero migration cost.
- MVP rule: **don't build infra we don't have a consumer for.** We have no dashboard, no alerting, no daily report. A DB table is a solution waiting for a problem.
- If we need it post-MVP, the shim's `meta` shape is already stable — a DB sink is a 30-minute addition (write a second emitter).

**Verdict**: JSON-to-stdout only for Step 60. Design the `meta` shape so a future DB sink is trivial (one new function, no call-site changes).

### Files

**Create**:
- `apps/api/src/lib/llm-telemetry.ts` — the shim (~120 LOC)
- `apps/api/src/__tests__/llm-telemetry.test.ts` — unit tests

**Modify**: none in Step 60. Call-site wiring happens in Steps 61/62 so this lands as a standalone, reversible commit.

### Public API

```ts
// apps/api/src/lib/llm-telemetry.ts

export type LLMService =
  | "openai.chat"
  | "openai.embedding"
  | "replicate.clip"
  | string; // forward-compatible

export interface LLMTelemetryMeta {
  service: LLMService;
  model: string;
  /** Free-form caller tag, e.g. "tag-placement", "listing-embedding". */
  operation: string;
  /** Optional correlation id (listing id, session id, etc). */
  correlationId?: string | null;
}

export interface LLMTelemetryUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMTelemetryRecord extends LLMTelemetryMeta {
  latencyMs: number;
  success: boolean;
  errorType: string | null; // "timeout" | "rate_limit" | "network" | "unknown" | null
  errorMessage: string | null;
  usage: LLMTelemetryUsage | null;
  timestamp: string; // ISO8601
}

/**
 * Extract `{ promptTokens, completionTokens, totalTokens }` from an
 * arbitrary LLM response. Callers supply this when the response shape
 * differs (chat vs embeddings vs replicate).
 */
export type UsageExtractor<T> = (result: T) => LLMTelemetryUsage | null;

export interface WithLLMTelemetryOptions<T> {
  extractUsage?: UsageExtractor<T>;
}

/**
 * Wrap an async LLM call. Always returns whatever `fn` returned (or
 * rethrows whatever `fn` threw) — telemetry is a side effect, never
 * changes behavior.
 *
 * Emission rules:
 *  - Gated by `process.env.LLM_TELEMETRY === "1"`.
 *  - On emit: single line of `console.info(JSON.stringify(record))`
 *    prefixed with `[llm-telemetry] ` for grep-ability.
 *  - Emission failures are swallowed (telemetry must never break prod).
 */
export async function withLLMTelemetry<T>(
  meta: LLMTelemetryMeta,
  fn: () => Promise<T>,
  options?: WithLLMTelemetryOptions<T>,
): Promise<T>;

/**
 * Classify an error into a coarse bucket. Exported for testability and
 * so callers can reuse the same taxonomy downstream.
 */
export function classifyLLMError(err: unknown): {
  errorType: string;
  errorMessage: string;
};

/**
 * Usage extractors for the three known response shapes. Exported so
 * call sites don't reinvent them.
 */
export const usageExtractors: {
  openaiChat: UsageExtractor<{
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }>;
  openaiEmbedding: UsageExtractor<{
    usage?: { prompt_tokens?: number; total_tokens?: number };
  }>;
  replicate: UsageExtractor<unknown>; // returns null — Replicate gives no token counts
};
```

### Error classification taxonomy

Match on `err.message` / `err.name` / `err.status`:
- `"timeout"` — `/timeout|timed out|ETIMEDOUT/i`
- `"rate_limit"` — `status === 429` or `/rate.?limit/i`
- `"auth"` — `status === 401` or `/unauthori[sz]ed|invalid.?api.?key/i`
- `"network"` — `/ECONNREFUSED|ENOTFOUND|fetch failed|socket/i`
- `"invalid_request"` — `status === 400`
- `"server_error"` — `status >= 500`
- `"unknown"` — everything else

### Log line shape (example)

```
[llm-telemetry] {"service":"openai.chat","model":"gpt-4o-mini-2024-07-18","operation":"tag-placement","correlationId":"abc-123","latencyMs":432,"success":true,"errorType":null,"errorMessage":null,"usage":{"promptTokens":812,"completionTokens":64,"totalTokens":876},"timestamp":"2026-04-08T12:34:56.789Z"}
```

### Test plan

File: `apps/api/src/__tests__/llm-telemetry.test.ts` — **8 tests, zero network**.

All tests use `vi.spyOn(console, "info")` + `vi.stubEnv("LLM_TELEMETRY", "1")` (with `afterEach` unstub).

1. `withLLMTelemetry` returns the inner result unchanged on success.
2. On success, emits exactly one log line with `success: true`, measured `latencyMs >= 0`, and extracted usage.
3. Rethrows inner error; emits one log line with `success: false` and the correct `errorType` (use a mock that throws `Error("request timed out")`).
4. When `LLM_TELEMETRY !== "1"`, **no** log line is emitted (but result/throw behavior unchanged).
5. When `console.info` itself throws, `withLLMTelemetry` still returns the inner result (telemetry-swallow test — use `vi.spyOn(console, "info").mockImplementation(() => { throw new Error("boom"); })`).
6. `usageExtractors.openaiChat` — extracts both fields correctly; returns `null` when `usage` absent.
7. `usageExtractors.openaiEmbedding` — same, uses `total_tokens` as completion=0.
8. `classifyLLMError` — parameterized cases: timeout, 429, 401, 500, generic → correct bucket.

**Mocks**: none external. Just `console.info`, `Date.now`, `process.env.LLM_TELEMETRY`.

**Expected final count**: 349 + 8 = **357 tests**.

### Risks + rollback

- **Risk**: shim throws inside `fn`-runner path and breaks production LLM calls. **Mitigation**: try/catch around every telemetry side-effect; the only awaited thing inside the wrapper is the user's `fn`. Test #5 enforces this.
- **Risk**: log noise in CI. **Mitigation**: env flag defaults OFF. CI stays quiet.
- **Rollback**: delete `llm-telemetry.ts` + test file. No call sites touched in Step 60 → zero blast radius.

### Split decision
Single PR. ~2 files, ~8 tests. Under the threshold.

---

## Step 61 — Tag Placement: prompt externalization + dynamic few-shot + (deferred) semantic rerank

### Decisions up front

**Decision 1: TS constants, not JSON.**
Few-shots are structured chat messages (`role`, `content`) + category metadata. TS gives us:
- Compile-time shape checks (no runtime JSON parse errors).
- Grep-ability from call sites.
- No file-reading at cold start (matters for Lambda/Vercel).
- Editing is just as fast as JSON for a dev.
JSON would only win if a non-dev (PM?) were editing prompts. That's not our world yet. **TS.**

**Decision 2: Semantic rerank via tag embeddings — DEFER.**
`tag-graph.ts` has **no `tag_embeddings` table.** Adding one in Step 61 means:
- New SQL migration (raw, since drizzle-kit is broken).
- Backfill script for existing tags.
- New schema module.
- New service to generate + store tag embeddings.
- A cron/trigger to keep it fresh on new tag creation.
That is a standalone step (call it Step 63), not a sub-bullet of 61. **Step 61 ships prompt + dynamic few-shot only; semantic rerank is explicitly deferred with a clear TODO.**

The current BM25-ish order from `gatherTagCandidates` (idf + similar-listing overlap + ngram) is already non-trivial signal. Dynamic few-shot + externalized prompt is the higher-leverage win; semantic rerank of candidates is a second-order polish.

**Decision 3: Backward-compat signature.**
`placeTagsWithLlm(input, openai?)` stays. New behavior is internal. Existing test file (`tag-placement-llm.service.test.ts`) must keep passing without modification.

### Files

**Create**:
- `apps/api/src/prompts/tag-placement/system-prompt.ts` — exported `TAG_PLACEMENT_SYSTEM_PROMPT` string constant (verbatim copy from current inline).
- `apps/api/src/prompts/tag-placement/few-shot-pool.ts` — typed pool of 8 examples with category metadata + selection helper.
- `apps/api/src/prompts/tag-placement/index.ts` — barrel export.
- `apps/api/src/__tests__/tag-placement-few-shot.test.ts` — tests for the selector.

**Modify**:
- `apps/api/src/services/tag-placement-llm.service.ts`:
  - Remove inline `SYSTEM_PROMPT` and `FEW_SHOT_MESSAGES` constants (keep `TAG_PLACEMENT_MODEL_DEFAULT`, `TAG_PLACEMENT_MAX_CANDIDATES`, `buildRefMap`, `resolveLlmOutput`, types).
  - Import from `../prompts/tag-placement/index.js`.
  - In `placeTagsWithLlm`, call `selectFewShots(input.category)` to pick 2–3 examples.
  - Wrap the `client.chat.completions.create` call with `withLLMTelemetry` from Step 60.

**Do NOT modify**:
- `apps/api/src/services/tag-placement.service.ts` (orchestrator) — its signature into `placeTagsWithLlm` is unchanged.
- `apps/api/src/__tests__/tag-placement-llm.service.test.ts` — must pass as-is.

### Public API

```ts
// apps/api/src/prompts/tag-placement/system-prompt.ts
export const TAG_PLACEMENT_SYSTEM_PROMPT: string;

// apps/api/src/prompts/tag-placement/few-shot-pool.ts

export type FewShotCategory =
  | "electronics"
  | "fashion"
  | "gaming"
  | "home"
  | "collectibles"
  | "generic";

export interface FewShotExample {
  /** Primary category this example teaches. */
  category: FewShotCategory;
  /** Matching keywords in the listing's category string (lowercase, substring match). */
  categoryKeywords: readonly string[];
  /** Chat messages — always a [user, assistant] pair. */
  messages: readonly [
    { role: "user"; content: string },
    { role: "assistant"; content: string },
  ];
}

/** The full pool of hand-written examples. Must contain ≥ 8 entries covering all FewShotCategory values. */
export const FEW_SHOT_POOL: readonly FewShotExample[];

/**
 * Pick 2–3 few-shots for a given listing category string.
 *
 * Algorithm (intentionally simple, no ML):
 *  1. If `category` is null/empty → return 3 examples from "generic" + whatever category is
 *     most common in the pool as a diversity fallback.
 *  2. Lowercase the category; find all pool entries where any `categoryKeywords`
 *     entry is a substring of the normalized category. These are "matches".
 *  3. If ≥ 2 matches: return the first 3 (or all if fewer).
 *  4. If 1 match: return that match + 1 generic → 2 examples.
 *  5. If 0 matches: return 3 generic examples. If the pool has fewer than 3 generics,
 *     pad with the first N entries of the pool to always return ≥ 2 and ≤ 3.
 *
 * Determinism: same input → same output. No randomness. Pool order is the tiebreaker.
 */
export function selectFewShots(
  category: string | null,
): ReadonlyArray<FewShotExample>;

/**
 * Flatten selected few-shots into the `messages` array shape consumed by
 * the OpenAI client. Exported separately so the LLM service stays thin.
 */
export function toChatMessages(
  examples: ReadonlyArray<FewShotExample>,
): Array<{ role: "user" | "assistant"; content: string }>;
```

### Few-shot pool content

Bob: seed the pool with **exactly 8 examples**:

| # | Category | Keywords (substring match) | Notes |
|---|----------|----------------------------|-------|
| 1 | `electronics` | `["electronic", "phone", "iphone", "computer", "laptop"]` | iPhone 17 Pro 256GB Navy sealed (existing example 1) |
| 2 | `electronics` | `["electronic", "phone", "android", "galaxy"]` | NEW: Galaxy S24 Ultra 512GB Black unlocked |
| 3 | `fashion` | `["fashion", "clothing", "apparel", "jacket", "shoe"]` | Vintage leather jacket M brown (existing example 2) |
| 4 | `fashion` | `["fashion", "shoe", "sneaker"]` | NEW: Nike Air Jordan 1 High OG Chicago size 10 |
| 5 | `gaming` | `["gaming", "console", "game", "nintendo", "playstation", "xbox"]` | Nintendo Switch OLED white (existing example 3) |
| 6 | `gaming` | `["gaming", "console", "playstation"]` | NEW: PS5 Slim Disc Edition 1TB sealed |
| 7 | `home` | `["home", "kitchen", "furniture", "appliance"]` | NEW: Dyson V15 Detect cordless vacuum like-new |
| 8 | `generic` | `[]` (matches nothing → only surfaces via fallback) | NEW: generic "unbranded wireless earbuds" — teaches missing-tag behavior |

Each NEW example follows the exact format of the existing 3 (LISTING block → CANDIDATES block → assistant JSON). Bob: pattern-match the existing inline examples; do not invent a new format.

### Telemetry wiring

Inside `placeTagsWithLlm`, replace the raw `await client.chat.completions.create(...)` with:

```ts
const resp = await withLLMTelemetry(
  {
    service: "openai.chat",
    model: modelVersion,
    operation: "tag-placement",
    correlationId: null, // orchestrator doesn't pass listing id into LLM service
  },
  () => client.chat.completions.create({ /* existing args */ }),
  { extractUsage: usageExtractors.openaiChat },
);
```

**Important**: wrap ONLY the `.create()` call, not the outer try/catch. The existing try/catch must still catch OpenAI errors and return `LlmPlacementFailure`. Telemetry records the error and rethrows; the existing catch then converts it to the graceful failure shape. This preserves behavior **exactly**.

### Semantic rerank — explicit deferral note

Add a top-of-file comment block in `tag-placement-llm.service.ts`:

```ts
// TODO(step63): Semantic rerank of candidates via tag embeddings.
// Depends on a new `tag_embeddings` table (not yet in schema).
// Current candidate order comes from gatherTagCandidates (idf + similar
// listings + ngram overlap) which is acceptable for MVP. See
// handoff/ARCHITECT-BRIEF-step60-62.md §Step 61 decision 2.
```

### Test plan

**New file**: `apps/api/src/__tests__/tag-placement-few-shot.test.ts` — **9 tests**.

1. `FEW_SHOT_POOL` has exactly 8 entries (locks the contract).
2. Every pool entry has a user+assistant message pair where the assistant content parses as valid JSON with the expected keys.
3. `selectFewShots("consumer electronics / phones / iphone")` returns ≥ 2 electronics examples.
4. `selectFewShots("women's fashion / jackets")` returns ≥ 2 fashion examples.
5. `selectFewShots("gaming / console")` returns ≥ 2 gaming examples.
6. `selectFewShots(null)` returns 2–3 examples (fallback path).
7. `selectFewShots("unknown widget")` → 0 matches → returns 2–3 generics-or-fallback.
8. `selectFewShots` is deterministic: same input called twice returns referentially identical sequence.
9. `toChatMessages` flattens N examples into 2N messages in order.

**Unchanged**: existing `tag-placement-llm.service.test.ts` MUST still pass untouched. Bob must run it after the refactor as the primary regression gate. Specifically, the test that counts tokens / checks the OpenAI `messages` array length will now see `system + 2N + user` instead of `system + 6 + user`. If that test asserts an exact message count, **update the assertion to compute dynamically** from `selectFewShots(input.category).length * 2 + 2`. If it only checks presence of the system message, no change needed. Bob: read the existing test file first and adapt only the assertions that break, one-for-one.

**Expected final count**: 357 + 9 = **366 tests** (assuming no existing test needed deletion — only assertion adjustment).

### Risks + rollback

- **Risk**: prompt behavior drifts because dynamic few-shot selects different examples than the old fixed 3. **Mitigation**: for any category that doesn't match, we fall back to a set that includes the same iPhone + jacket + Switch examples (they're #1, #3, #5 in the pool). Token-0 temperature + same model version means structural regressions should be catchable.
- **Risk**: message ordering changes break the existing LLM test's mock call inspection. **Mitigation**: Bob reads the existing test first, patches only the count assertion if present.
- **Risk**: file-move breaks an import elsewhere. **Mitigation**: grep for `SYSTEM_PROMPT` and `FEW_SHOT_MESSAGES` imports before deleting — current file does not export them, so this risk is theoretical.
- **Rollback**: `git revert` of the single commit restores inline prompt. The `prompts/tag-placement/` directory can remain (dead) or be deleted — no cross-module contract breaks.

### Split decision

**Single PR, but Bob should staged-commit internally**:
- Commit A: create `prompts/tag-placement/**` + tests for the selector (add-only, nothing imports it yet — greenfield).
- Commit B: modify `tag-placement-llm.service.ts` to use it + wire telemetry (behavior change, existing tests must pass).

4 new files + 1 modified + 9 new tests + ~1 adjusted assertion. Under the "5 files OR 8 tests" split threshold when measured by net new, but Bob can split for bisect safety.

---

## Step 62 — Category-aware embedding input template

### Goal
Replace the single `buildEmbeddingInput` template with a per-category registry. Phase 0 wedge is iPhone → electronics MUST have a real implementation. Fashion is the Phase 1.5 retention category → stub it now with decent quality so we don't rebuild later. Default fallback = current template (zero regression for uncategorized listings).

### Decisions up front

**Decision 1: Registry via a plain object, not a class.**
Category lookup is a pure function. A `Map<string, Builder>` + normalization function + default fallback is 15 lines. Don't over-engineer with a registration API.

**Decision 2: Category key is extracted from snapshot, not from a new column.**
`snapshot.category` is already a string (seen in `buildEmbeddingInput` line 102). We match substrings against a keyword list per builder. Same pattern as Step 61's few-shot selector — keeps mental model consistent.

**Decision 3: No schema changes.**
The embedding is still stored in the same `listing_embeddings` table with the same dimensions. Only the **input text** changes. `textHash` already captures any input change → cache invalidation is automatic. No migration needed.

**Decision 4: Telemetry wraps `generateTextEmbedding`, not `generateImageEmbedding`.**
CLIP is through Replicate and provides no token usage. Wrap it with `service: "replicate.clip"` but use the `usageExtractors.replicate` which returns null. This way we still capture latency + success/error even without token counts. Both calls get telemetry.

### Files

**Create**:
- `apps/api/src/prompts/embedding/types.ts` — `EmbeddingInputBuilder` type.
- `apps/api/src/prompts/embedding/default.ts` — the current template, verbatim, exported as `buildDefaultEmbeddingInput`.
- `apps/api/src/prompts/embedding/electronics.ts` — storage/battery/condition/carrier/model emphasis.
- `apps/api/src/prompts/embedding/fashion.ts` — size/material/brand/condition emphasis.
- `apps/api/src/prompts/embedding/registry.ts` — resolver + category matching.
- `apps/api/src/prompts/embedding/index.ts` — barrel export.
- `apps/api/src/__tests__/embedding-builders.test.ts` — unit tests for builders + registry.

**Modify**:
- `apps/api/src/services/embedding.service.ts`:
  - Replace inline `buildEmbeddingInput` body with a call to `resolveEmbeddingBuilder(snapshot)(snapshot)` from the registry.
  - Keep the function **exported with the same signature** (`(snapshot: Record<string, unknown>) => string`) — `generateAndStoreEmbedding` and any external caller stays unchanged.
  - Wrap `generateTextEmbedding` internals with `withLLMTelemetry`.
  - Wrap `generateImageEmbedding` internals with `withLLMTelemetry`.
  - Add an internal `buildDefaultEmbeddingInput` re-export for the test file that currently imports `buildEmbeddingInput` (if any — Bob: grep `buildEmbeddingInput` to confirm).

**Do NOT modify**:
- `packages/db/src/schema/listing-embeddings.ts` — no column changes.
- Any migration file.

### Public API

```ts
// apps/api/src/prompts/embedding/types.ts

export type EmbeddingCategory =
  | "electronics"
  | "fashion"
  | "default";

export type EmbeddingInputBuilder = (
  snapshot: Record<string, unknown>,
) => string;

export interface EmbeddingBuilderEntry {
  category: EmbeddingCategory;
  /** Substring matches against lowercase snapshot.category. Order matters: first match wins. */
  categoryKeywords: readonly string[];
  build: EmbeddingInputBuilder;
}

// apps/api/src/prompts/embedding/registry.ts

/** All registered builders, ordered by specificity. "default" MUST be last. */
export const EMBEDDING_BUILDERS: readonly EmbeddingBuilderEntry[];

/**
 * Given a snapshot, find the right builder.
 * Rules:
 *  1. Read `snapshot.category` as string; if absent → default.
 *  2. Lowercase + trim. For each entry except default, if any keyword is a
 *     substring → return that builder.
 *  3. Fall through → default.
 * Deterministic. Zero allocations on the hot path beyond a lowercase.
 */
export function resolveEmbeddingBuilder(
  snapshot: Record<string, unknown>,
): EmbeddingInputBuilder;

// apps/api/src/prompts/embedding/index.ts — barrel
export { buildDefaultEmbeddingInput } from "./default.js";
export { buildElectronicsEmbeddingInput } from "./electronics.js";
export { buildFashionEmbeddingInput } from "./fashion.js";
export { resolveEmbeddingBuilder, EMBEDDING_BUILDERS } from "./registry.js";
export type {
  EmbeddingCategory,
  EmbeddingInputBuilder,
  EmbeddingBuilderEntry,
} from "./types.js";
```

### Builder details

**`buildDefaultEmbeddingInput`** — verbatim copy of current `buildEmbeddingInput`. Zero behavior change for uncategorized listings. This is the regression safety net.

**`buildElectronicsEmbeddingInput`** — reads additional snapshot fields and emphasizes them with dedicated tags. Template shape:

```
[TITLE] ...
[CATEGORY] ...
[BRAND] ... (if snapshot.brand)
[MODEL] ... (if snapshot.model)
[STORAGE] ... (if snapshot.storage or detected from tags matching /^\d+gb$|^\d+tb$/i)
[CARRIER] ... (if snapshot.carrier or "unlocked" in tags)
[BATTERY_HEALTH] ... (if snapshot.batteryHealth)
[CONDITION] ...
[TAGS] ...
[DESCRIPTION] ...
[PRICE_BAND] ...
```

If an electronics-specific field isn't in the snapshot, skip it — never emit empty bracketed tags. Fall back to tag inspection where noted (tags array already in snapshot).

**`buildFashionEmbeddingInput`** — size/material/brand/condition emphasis:

```
[TITLE] ...
[CATEGORY] ...
[BRAND] ... (if snapshot.brand)
[SIZE] ... (if snapshot.size)
[COLOR] ... (if snapshot.color)
[MATERIAL] ... (if snapshot.material)
[CONDITION] ...
[TAGS] ...
[DESCRIPTION] ...
[PRICE_BAND] ...
```

**Category keyword tables**:
- `electronics`: `["electronic", "phone", "iphone", "android", "galaxy", "laptop", "computer", "tablet", "headphone", "earbud"]`
- `fashion`: `["fashion", "clothing", "apparel", "jacket", "shoe", "sneaker", "shirt", "dress", "pant", "accessory"]`

Order in registry: `electronics, fashion, default`.

### Telemetry wiring

```ts
// generateTextEmbedding — new body
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const model = getEmbeddingModel();
  const response = await withLLMTelemetry(
    {
      service: "openai.embedding",
      model,
      operation: "listing-embedding",
      correlationId: null,
    },
    () =>
      getOpenAI().embeddings.create({
        model,
        input: text,
        dimensions: getEmbeddingDimensions(),
      }),
    { extractUsage: usageExtractors.openaiEmbedding },
  );
  return response.data[0].embedding;
}

// generateImageEmbedding — new body
export async function generateImageEmbedding(imageUrl: string): Promise<number[]> {
  const output = await withLLMTelemetry(
    {
      service: "replicate.clip",
      model: "andreasjansson/clip-features",
      operation: "listing-image-embedding",
      correlationId: null,
    },
    () =>
      getReplicate().run(
        "andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a",
        { input: { inputs: imageUrl } },
      ),
    { extractUsage: usageExtractors.replicate },
  );
  const results = output as Array<{ embedding: number[]; input: string }>;
  if (!results?.[0]?.embedding) {
    throw new Error("CLIP API returned no embedding");
  }
  return results[0].embedding;
}
```

### Test plan

**New file**: `apps/api/src/__tests__/embedding-builders.test.ts` — **12 tests**.

Default builder (3 tests):
1. Empty snapshot → empty string.
2. Full snapshot → output equals current `buildEmbeddingInput` output (regression lock — copy the expected string from a baseline captured in a fixture).
3. Snapshot with no `targetPrice` → no `[PRICE_BAND]` line.

Electronics builder (3 tests):
4. iPhone snapshot with `brand, model, storage, carrier, condition, tags, description, targetPrice` → output contains all bracketed fields in expected order.
5. Electronics snapshot missing `storage` but with tag `"256gb"` → `[STORAGE]` line emitted from tag inspection.
6. Electronics snapshot missing all optional fields → output has only `[TITLE]`, `[CATEGORY]`, `[TAGS]`, `[DESCRIPTION]`, `[PRICE_BAND]` if present (graceful degradation).

Fashion builder (2 tests):
7. Fashion snapshot with `brand, size, color, material` → all lines present in order.
8. Fashion snapshot with only `title + category` → only those lines present.

Registry (4 tests):
9. `resolveEmbeddingBuilder({ category: "Consumer Electronics / Phones" })` → returns electronics builder (verify by sentinel: builder output contains `[STORAGE]` when given storage).
10. `resolveEmbeddingBuilder({ category: "Women's Fashion / Jackets" })` → returns fashion builder.
11. `resolveEmbeddingBuilder({ category: "Books" })` → returns default builder.
12. `resolveEmbeddingBuilder({})` → returns default builder.

**Existing tests**: any test that currently imports `buildEmbeddingInput` and asserts output should continue to pass because:
- Uncategorized fixtures → default builder → byte-for-byte identical.
- Categorized electronics/fashion fixtures → different output → may break.

**Bob: before touching `embedding.service.ts`, grep `buildEmbeddingInput` across `apps/api/src/__tests__/**` and list every caller.** If any existing test asserts a specific output string for a categorized snapshot, decide case-by-case:
- If the test was locking default behavior → rewrite the test's snapshot to `category: null` so it continues to exercise the default path.
- If the test was actually testing category-specific output (unlikely) → update the expected string.

**Expected final count**: 366 + 12 = **378 tests**.

### Risks + rollback

- **Risk**: cache invalidation storm. `textHash` is SHA-256 of the input string. For any already-embedded listing whose category matches `electronics` or `fashion`, the next `generateAndStoreEmbedding` call will compute a different hash → re-embed. **Mitigation**: this is the CORRECT behavior (the old embeddings were less informative). The cost is bounded — embeddings are cheap and only refresh on re-publish. Document in PR description.
- **Risk**: electronics builder extracts the wrong storage from tags (e.g. confuses "256gb" model year). **Mitigation**: strict regex `^\d+(gb|tb)$` on the full tag string.
- **Risk**: telemetry wrapping changes error propagation. **Mitigation**: `withLLMTelemetry` is spec'd to rethrow unchanged. Step 60 test #3 enforces this.
- **Rollback**: `git revert`. `embedding.service.ts` reverts to inline template; `prompts/embedding/**` becomes dead code (delete in follow-up). `textHash` mismatch will cause one more re-embed on rollback — same bounded cost.

### Split decision

**Consider splitting Part A / Part B**:

- **Part A (same PR)**: create `prompts/embedding/**` + `default.ts` (verbatim current) + `registry.ts` with ONLY the default builder registered + migrate `embedding.service.ts` to use the registry + wire telemetry. All existing tests must still pass because default === current behavior. Lowest-risk refactor.
- **Part B (follow-up PR same day)**: add `electronics.ts` + `fashion.ts` + register them + the 8 new category/builder-specific tests.

**Reasoning**: Part A is a pure refactor + telemetry wire. Part B is a semantic change. Splitting lets Richard review the refactor separately from the new content and gives us a clean bisect point if embedding quality regresses.

File count: Part A = 6 files (3 new + registry + index + modified service). Part B = 2 new files + registered entries + 8 tests. Part A is at the threshold; splitting is the right call.

**Bob**: ship Part A first, get Richard's ack, then push Part B. Two commits, one or two PRs at your discretion.

---

## Dependencies & sequencing

```
Step 60 (telemetry shim)           ← must land first, standalone
   │
   ├─► Step 61 (tag placement)     ← depends on 60 for withLLMTelemetry
   │
   └─► Step 62 (embedding input)   ← depends on 60 for withLLMTelemetry
```

**Step 61 and Step 62 are independent of each other** and can be built in parallel or in either order after Step 60 lands. Recommended: 60 → 61 → 62 (tag placement is the higher-visibility change; embedding refactor is cheaper to reason about second).

**Merge gate between steps**: each step must be on its own commit and pass `pnpm --filter @haggle/api test` + `pnpm --filter @haggle/api typecheck` before the next step begins. No stacked uncommitted changes.

**Test count progression**:
- Before Step 60: 349
- After Step 60: 357 (+8)
- After Step 61: 366 (+9)
- After Step 62 Part A: 366 (+0 — refactor only)
- After Step 62 Part B: 378 (+12)

**Final target: 378 passing tests.** If Bob lands fewer tests, Richard blocks the PR.

**Unrelated pre-existing error**: the `apps/web/src/app/(marketing)/negotiate/page.tsx` typecheck error is NOT in scope. Do not touch it. If `pnpm typecheck` at the monorepo root flags it, run the filtered command (`pnpm --filter @haggle/api typecheck`) instead for PR validation.

---

## Open questions for user

1. **LLM_TELEMETRY default**: ship with flag OFF in prod for now. Does someone want this flipped ON in staging the moment Step 60 lands? If yes, name the env file to update — I did not touch any `.env` file in this brief.

2. **Correlation id plumbing**: Steps 61/62 pass `correlationId: null` because the current call sites don't thread a listing id down into `placeTagsWithLlm` / `generateTextEmbedding`. Do you want me to thread it? It's ~3 extra lines per call site (add optional param, pass through from orchestrator). I left it out to keep the blast radius minimal; happy to add it as Step 60.5 if you want per-listing attribution in logs from day one. **My recommendation: defer to a follow-up — structured logs without correlation ids are still 90% of the value.**

3. **Semantic rerank (Step 63)**: I've deferred it out of 61 for the reasons above. Want me to write the Step 63 brief now (tag_embeddings table + backfill + rerank integration), or wait until 60–62 are merged and we see the telemetry data first? **My recommendation: wait. Telemetry from 60 will tell us whether tag placement latency/cost is actually the bottleneck worth optimizing.**

4. **Phase 0 wedge alignment**: the electronics builder I specced emphasizes storage/carrier/battery/condition — all iPhone Pro attestation-relevant fields. Good. But I did not add a specific "iPhone Pro" builder even though the wedge is 3 SKUs. Reason: overfitting for 3 SKUs is premature; the electronics builder already captures the signal. Flag if you disagree.
