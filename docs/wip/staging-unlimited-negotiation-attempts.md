# Staging negotiation attempt limits

- Task: W2026-08-31-03 (MCP negotiation start/play parity)
- Owner: 정행 / jeonghaeng
- Request: 2026-10-02, remove staging negotiation attempt limits for repeated testing and push quickly.
- Scope: shared API attempt-control service used by web and MCP starts, including the transaction recheck.

When HAGGLE_ENV=staging, buyer/listing window and marketplace daily attempt caps are disabled, including under NODE_ENV=production. The HNP numeric limit fields use Number.MAX_SAFE_INTEGER as a compatibility sentinel; the count checks are explicitly skipped. Staging cooldown metadata is zero so it does not suggest waiting. Concurrent sessions on the same listing and the round limit remain enforced. All other environments retain their existing caps. No DB migration or dependency change.

Verification: 23 tests across attempt-control, concurrent starts, transaction recheck and buyer start gate passed. Regression coverage confirms staging can start after 100 attempts, keeps duplicate-session protection, and production/local/unknown environments retain the daily cap. API typecheck, changed-file Biome and git whitespace checks passed.

Completion condition: local checks and pushed feature PR. Staging integration/deployment requires final CI success at the same SHA; deployed behavior remains unverified until that happens. No negotiation or price proposal was generated during verification.

Existing graph issue: work:me fails because HAGA-88 references missing HAGA-94/HAGA-95. This slice's owner and W2026-08-31-01 dependency were checked directly; unrelated task assignments were preserved.
