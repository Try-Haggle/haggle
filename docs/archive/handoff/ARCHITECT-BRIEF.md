# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 1 — Tag System (`packages/tag-core`)

### Context
Tags categorize listings, disputes, and user expertise. AI generates tags from listing content, usage frequency drives automatic lifecycle promotion. This is a pure logic package — no DB, no API, no external deps.

### Decisions
- Tag lifecycle: CANDIDATE → EMERGING → OFFICIAL → DEPRECATED
- Promotion thresholds: CANDIDATE→EMERGING at 10 uses, EMERGING→OFFICIAL at 50 uses, auto-DEPRECATED after 90 days unused
- Similar tag clustering uses Levenshtein distance (threshold ≤ 2) + optional synonym map
- Tag normalization: lowercase, trim, collapse whitespace, max 50 chars
- Hierarchical tags supported via `/` separator (e.g., `electronics/phones/iphone`)
- Each tag has: id, name, normalizedName, status, category, useCount, createdAt, lastUsedAt, parentId?
- Expert tags: users earn tags after 50+ cases with 85%+ accuracy in that category

### Build Order
1. `src/types.ts` — TagStatus enum, Tag interface, TagConfig, TagCluster, ExpertTag types
2. `src/normalize.ts` — Tag string normalization + validation
3. `src/lifecycle.ts` — Status transitions (promote, deprecate, reactivate) with threshold config
4. `src/cluster.ts` — Similar tag detection (Levenshtein + synonym map), merge suggestions
5. `src/expert.ts` — Expert tag qualification check (caseCount ≥ 50, accuracy ≥ 0.85)
6. `src/index.ts` — Re-export all modules
7. `package.json`, `tsconfig.json`, `vitest.config.ts` — Standard package setup matching arp-core pattern
8. Tests for each module in `src/__tests__/`

### Flags
- Flag: Levenshtein implementation must be pure — NO external libraries (no `fastest-levenshtein`, etc.)
- Flag: Do NOT implement DB persistence. This is pure logic only.
- Flag: Config must be injectable (no hardcoded thresholds). Provide sensible defaults via a `defaultTagConfig()` function.
- Flag: Follow exact same package structure as `packages/arp-core/` (vitest.config.ts, tsconfig.json, package.json patterns)

### Definition of Done
- [ ] All types exported from types.ts
- [ ] normalize.ts: normalization + validation with edge cases (empty, too long, special chars)
- [ ] lifecycle.ts: all 4 transitions + threshold-based auto-promotion logic
- [ ] cluster.ts: Levenshtein distance + synonym map + merge suggestion
- [ ] expert.ts: qualification check with configurable thresholds
- [ ] index.ts re-exports everything
- [ ] Package config matches arp-core pattern
- [ ] ~25+ tests covering all modules
- [ ] `pnpm --filter @haggle/tag-core test` passes
- [ ] `pnpm --filter @haggle/tag-core typecheck` passes

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

[Builder writes plan here]

Architect approval: [ ] Approved / [ ] Redirect — see notes below
