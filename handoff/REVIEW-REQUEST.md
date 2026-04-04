# Review Request — Step 16: Dispute Escalation (T1→T2→T3 + Deposit)
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

Two new dispute endpoints in `disputes.ts`: (1) `POST /disputes/deposits/expire` for cron-based forfeiture of expired deposits, and (2) `POST /disputes/:id/escalate` for tier escalation with auto deposit creation.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `apps/api/src/routes/disputes.ts` | 4-5 | MODIFIED — Added imports: `computeDisputeCost`, `createDepositRequirement` from dispute-core; `DisputeTier` type. |
| `apps/api/src/routes/disputes.ts` | 16-20 | MODIFIED — Added imports: `createDeposit`, `getPendingExpiredDeposits` from deposit service. |
| `apps/api/src/routes/disputes.ts` | 57-60 | NEW — `escalateSchema` zod validator for escalation requests. |
| `apps/api/src/routes/disputes.ts` | 106-116 | NEW — `POST /disputes/deposits/expire`. Queries pending expired deposits, forfeits each, returns count. Registered before /:id routes. |
| `apps/api/src/routes/disputes.ts` | 118-181 | NEW — `POST /disputes/:id/escalate`. Validates tier < 3, computes cost via dispute-core, updates metadata, creates deposit for T2/T3. |

## Key Areas to Scrutinize

1. **Line 132** — Tier extraction from metadata uses `as number ?? 1` fallback. If metadata has `tier: 0` somehow, this would read as falsy and default to 1. Acceptable for current use but worth noting.
2. **Line 137** — `(currentTier + 1) as DisputeTier` cast is safe because we guard `currentTier >= 3` above, so nextTier is always 2 or 3.
3. **Line 164** — `nextTier as 2 | 3` cast for `createDepositRequirement` is safe because the `nextTier >= 2` guard ensures this.
4. **No auth middleware** on either endpoint. The expire endpoint is intended for admin/cron. Auth should be added when the auth layer is wired up (outside current step scope).

## Open Questions

- Should the expire endpoint return the list of forfeited deposit IDs in addition to the count?
- Should escalation fire trust triggers (e.g., penalize the party that caused escalation)?
