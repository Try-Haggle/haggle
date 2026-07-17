# Negotiation Start Known Issues

Last verified: 2026-07-16

This document records user-visible issues found while testing the listing agent builder and the transition into a live negotiation. It is a problem record, not evidence that the fixes have been deployed.

## Environment and branch state

- Staging application: `https://app.staging.tryhaggle.ai`
- Staging branch at verification: `origin/staging` at `5dd1808`
- Candidate fix branch: `fix/live-negotiation-rounds`
- The candidate branch has not been merged into `staging` or deployed.

## P0: The listing page appears stuck while negotiation starts

### User-visible behavior

After selecting **Start Negotiation**, the listing page can remain on `Starting the first round...` for several minutes. The user cannot see rounds that have already completed.

### Root cause

The staging client calls `waitForNegotiationReady` before navigating to the negotiation page. It polls up to 120 times at 1.5-second intervals, so the listing page may block for about 180 seconds. Polling errors are swallowed until all attempts are exhausted.

The API returns the durable session with HTTP 202 and then runs the eight-round loop in an unawaited in-process async task. That continuation is not a durable job contract: a process restart, deploy, crash, or hosting freeze after the response can leave a session with no further rounds.

### Verified evidence

- A staging session reached `ACCEPTED` after five rounds, taking about 88 seconds from session creation to terminal status.
- Staging session `0fc9cb53-a828-4ae0-9702-76836c545679` remained `CREATED` with `current_round=0` and no persisted rounds more than ten minutes after creation.
- During that stalled session, `pg_stat_activity` showed a matching transaction `idle in transaction` for 816 seconds with `ClientRead` as its wait event. The last completed statement loaded negotiation rounds, after which application code waited on the external LLM call while keeping the transaction open.
- The staging UI still uses the blocking wait implementation from `origin/staging`.
- `fix/live-negotiation-rounds` removes the pre-navigation wait and renders newly persisted rounds in the existing playback UI.

### Confirmed failure chain

1. `POST /negotiations/start` creates a `CREATED` session and returns HTTP 202.
2. The in-process auto-play continuation changes perspective and enters `executeLLMNegotiationRound`.
3. `executeLLMNegotiationRound` opens a database transaction, locks the session, loads its rounds, and then calls DeepSeek before committing.
4. The DeepSeek client's timeout covers `fetch` only until response headers are returned. The timer is cleared before `response.json()` reads the body, and the round has no outer total deadline. A stalled response body can therefore leave the database transaction open indefinitely.
5. The listing client polls for about 180 seconds, times out, and navigates to the result page.
6. The staging result mapper converts every unrecognized status, including active `CREATED`, to `ESCALATED`, so the zero-round session is incorrectly shown as **Negotiation paused**.

### Required fix

1. Navigate as soon as `POST /negotiations/start` returns `session_id`.
2. Render rounds incrementally through WebSocket updates with polling fallback.
3. Do not hold a database transaction or row lock while calling DeepSeek. Read and version the state, release the transaction, perform the external call, then persist with optimistic concurrency and idempotency checks.
4. Enforce a total deadline around the complete DeepSeek operation, including response-body parsing and retries.
5. Move orchestration to a durable worker or implement a resumable one-round-at-a-time API/state machine. Do not depend on work continuing after an HTTP response has ended.
6. Add explicit no-progress and update-failure states with retry/resume actions.
7. Keep the existing playback presentation; waiting between rounds should use only the existing dots indicator.
8. Render `CREATED` and other active states as in progress. Only render `ESCALATED` when the server has explicitly persisted that terminal state.

### Acceptance criteria

- The listing page transitions to the negotiation page within two seconds of receiving `session_id`.
- Round 1 appears without waiting for a terminal result.
- Refreshing or reconnecting resumes the same session without duplicate rounds.
- A worker restart between rounds does not strand the session.
- No external network request runs while a database transaction or session row lock is held.
- DeepSeek response headers and body parsing are both covered by a bounded total deadline.
- A failed round produces a visible recoverable state instead of an indefinite spinner.
- A zero-round `CREATED` session is never labeled `ESCALATED` or **Negotiation paused**.

### Candidate implementation status

The candidate branch now implements the required P0 behavior:

- `POST /negotiations/start` creates the durable session and returns a hashed-session run token without starting an in-process background loop.
- `POST /negotiations/sessions/:id/auto-play/next` executes exactly one idempotent round per request.
- Guest execution requires the raw run token held in browser `sessionStorage`; only its SHA-256 hash is persisted. Authenticated participants are checked against the session.
- Perspective changes use optimistic version claims, and the next sender is reconstructed from persisted rounds so retries cannot swap buyer and seller.
- DeepSeek has one total deadline covering fetch, response-body parsing, and retries.
- DeepSeek runs outside the transaction. A short transaction locks and revalidates the session only when persisting the prepared round.
- The live page requests rounds sequentially, reloads after every committed round, and shows a retry action without discarding completed rounds.
- `CREATED` and `ACTIVE` map to `IN_PROGRESS`; `STALLED` is the explicit paused outcome.

Automated verification on 2026-07-16:

- API: 250 test files passed, 2 skipped; 2,457 tests passed, 2 live tests skipped.
- Web: 10 test files and 23 tests passed.
- API and Web TypeScript checks passed.
- A local browser render was attempted, but the database configured in `apps/api/.env` does not contain the pre-existing `negotiation_agent_snapshot` column required by the current staging code. No migration was applied because this candidate does not own that schema change. Route-level Fastify tests cover the new endpoint without modifying that database.

## P1: English and Korean are mixed in one advisor reply

### User-visible behavior

The advisor returns an English budget acknowledgement followed by Korean battery-health and carrier-lock questions.

### Root cause

- The budget widget generates an English user message.
- The DeepSeek prompt requires an English reply.
- Tag Garden stores the iPhone requirement questions in `questionKo`.
- The server appends up to three missing hard-requirement questions to the LLM reply after generation.

The final message is therefore assembled from different language sources rather than generated as one coherent response.

### Required fix

Introduce an explicit request locale and use it consistently for generated input, the DeepSeek prompt, deterministic questions, answer options, and bundled-question text. Do not infer locale from a synthetic budget sentence.

### Acceptance criteria

- One response uses one locale throughout.
- Deterministic post-processing cannot append text in a different locale.
- English and Korean locale tests cover budget submission and bundled questions.

## P1: Every iPhone listing is treated as a used phone

### User-visible behavior

The advisor asks for minimum battery health for every listing tagged `electronics/phones/iphone`, even when the listing may be new.

### Root cause

`battery_health` is a hard iPhone requirement and is activated by category alone. Listing condition is not used to decide whether the requirement applies.

### Required fix

1. Apply battery-health requirements only to used or refurbished listings.
2. If condition is unknown, resolve product condition before asking condition-specific questions.
3. Reuse known listing attributes such as battery health and carrier lock instead of asking the buyer for facts already supplied by the seller.

### Acceptance criteria

- New iPhone listings do not trigger a battery-health question.
- Used/refurbished iPhone listings can collect a buyer's minimum battery health.
- Existing listing attributes satisfy matching requirement slots without another question.
