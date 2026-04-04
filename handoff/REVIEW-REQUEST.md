# Review Request — Step 14: "Start Negotiation" Button → Intent API
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

Wired the "Start Negotiation" button on the buyer landing page (`/l/[publicId]`) to the WaitingIntent API. New `negotiation-api.ts` module handles intent creation and match triggering. Button now has full state management: disabled during loading, shows status messages for success/error, redirects unauthenticated users to `/claim`.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `apps/web/src/app/l/[publicId]/negotiation-api.ts` | 1-61 | NEW — `createBuyerIntent()` posts to `/api/intents` with strategy built from preset. `triggerMatch()` posts to `/api/intents/trigger-match`. `buildStrategyFromPreset()` maps agent IDs to strategy params. |
| `apps/web/src/app/l/[publicId]/buyer-landing.tsx` | 14, 144-145, 485-551 | MODIFIED — Added import, negotiation state/message, async onClick handler with auth check, button disabled + text swap during loading, status message divs, fragment wrapper. |

## Key Areas to Scrutinize

1. **Preset ID mapping** (`negotiation-api.ts:48-53`) — Brief used `fox/owl/dolphin/bear` as preset keys but actual `BuyerAgentPreset.id` values are `price-hunter/smart-trader/fast-closer/spec-analyst`. I used the real IDs. Richard should verify these map correctly to the intended strategy params.

2. **Auth redirect flow** (`buyer-landing.tsx:494-502`) — Unauthenticated users get their intent stored in `sessionStorage` before redirect to `/claim`. Nothing currently reads this data after auth completes. This is a placeholder for future pickup logic.

3. **Fragment wrapper** (`buyer-landing.tsx:485, 551`) — Added `<>...</>` around button + status divs in the ternary false branch. Required because JSX ternary needs a single root element. Check the indentation/nesting is clean.

4. **triggerMatch error handling** (`buyer-landing.tsx:524-526`) — Match trigger failure is silently caught and shows a softer success message. Intent still exists server-side. Per brief: "triggerMatch call is best-effort."

5. **Strategy param values** (`negotiation-api.ts:48-53`) — The aggression/patience/risk/style values are hardcoded estimates. Richard should check whether these should match any existing engine-core or engine-session constants.

## Open Questions

1. The `sessionStorage.setItem("pendingIntent", ...)` stores intent data for unauthenticated users, but no code reads it after auth redirect. Should Step 15 handle the post-auth intent pickup?

## Verification

```
pnpm --filter @haggle/web typecheck — 0 errors
```
