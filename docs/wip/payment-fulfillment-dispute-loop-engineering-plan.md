# Payment, Fulfillment, Dispute MVP Loop Engineering Plan

Date: 2026-06-22
Source: https://discuss.pytorch.kr/t/loop-engineering/10796

## Purpose

Haggle의 결제, fulfillment, 분쟁 MVP를 하나의 큰 자동화로 밀어붙이지 않는다. 돈 이동과 분쟁 경계는 실패 비용이 크기 때문에 여러 개의 닫힌 루프(closed loop)로 쪼개고, 각 루프가 `Discover -> Plan -> Execute -> Verify -> Iterate`를 자체적으로 돌게 한다.

이 문서는 루프가 무엇을 읽고, 어디까지 고치고, 어떤 검증을 통과해야 완료인지 정의한다. 구현 agent는 이 문서를 작업 계약으로 사용한다.

## Loop Engineering Principles For Haggle

PyTorchKR 글의 요지는 프롬프트를 잘 쓰는 것이 아니라 검증 가능한 작업 사이클을 설계하는 것이다. Haggle에는 다음 해석을 적용한다.

| Concept | Haggle interpretation |
| --- | --- |
| Automations | 루프 실행 cadence. MVP 단계에서는 사람이 수동 실행하거나 작은 slice 단위로 실행한다. |
| Worktrees | payment, fulfillment, dispute loop가 같은 파일을 건드리지 않도록 slice별 worktree를 쓴다. |
| Skills | Haggle 결제/fulfillment/분쟁 규칙을 `VISION`, `ARCHITECTURE`, `RULES` 형태로 축적한다. |
| Connectors | ClickUp, GitHub, local test server, payment test console, DB/API 검증으로 연결한다. |
| Subagents | 작성 agent와 검증 agent를 분리한다. 돈 이동 코드는 자기검증만으로 완료하지 않는다. |
| Memory | 시도한 slice, 실패한 테스트, 보류된 사람 결정, 다음 입력을 누적한다. |

Haggle에서는 오픈 루프보다 닫힌 루프가 우선이다. 에이전트가 자유 탐색으로 결제 정책을 바꾸면 안 된다. 각 루프는 허용 파일, 금지 행동, 검증 명령, 사람에게 반환할 조건을 가진다.

## Non-Negotiable Rules

- `escrow`, `custody`, `deposit`, `guaranteed safe` 같은 규제 리스크가 큰 카피를 새로 추가하지 않는다.
- Smart contract는 MVP에서 asset type을 알 필요가 없다. fulfillment type은 agreement, approval, fulfillment record, release policy 입력에 둔다.
- Digital fulfillment는 shipment를 만들지 않는다.
- Physical shipping은 기존 shipment path를 유지하되 상위 fulfillment model 아래에 둔다.
- Physical negotiation start requires delivery address + shipping quote (D1/D2); digital is exempt. PR #120 “address is checkout-only / must not block start” is superseded for physical — see [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md).
- T1 AI assess COMPLETED does not resolve/refund/release without human review; `auto_applied: false` (B5); later auto-release is not default-on.
- Payment state 변경은 tx hash만 보고 하지 않는다. expected contract, event, settlement id, wallet, amount를 확인한 뒤 DB 상태를 바꾼다.
- Refunded, disputed, released 같은 terminal state는 active intent로 다시 노출하지 않는다.
- Dispute creation은 money movement를 먼저 멈추고, duplicate active dispute를 허용하지 않는다.
- 구현 루프는 테스트가 없으면 완료가 아니다.

## MVP Target Flow

```text
Negotiation accepted
-> settlement approval created
-> payment intent prepared and funded
-> fulfillment started
-> fulfillment proof or confirmation accepted
-> buyer review window
-> release, refund, or dispute
-> dispute resolution instruction
-> final payment state reconciled
```

The MVP must support:

- `physical_shipping`: shipment-backed fulfillment
- `digital_delivery`: no-shipment fulfillment with proof or buyer confirmation
- optional dispute path from funded/review states

`external_platform_transfer` and `onchain_transfer` are later loops after the digital path is stable.

## Loop 0: Orchestrator Loop

### Goal

Pick the next safest slice, assign it to the correct loop, and prevent broad accidental rewrites.

### Discover

- Read this plan.
- Read `docs/wip/digital-fulfillment-settlement-design.md`.
- Read `docs/wip/dispute-start-api-design.md`.
- Read `README.md` for local setup, migration, and test entry points.
- Read `CLAUDE.md` for source-of-truth product, architecture, branch, and team rules.
- Check `git status --short --branch`.
- Check current branch against the repo branch strategy.
- Check the latest failed tests or incomplete slice notes.

### Plan

Choose exactly one slice:

- payment funding
- fulfillment abstraction
- release gate
- dispute start/evidence
- demo/operator verification
- production readiness/observability

### Execute

Create or update a small implementation brief for that slice. Do not edit code in this loop unless the user explicitly asks the orchestrator to implement too.

### Verify

- The selected slice has a clear owner loop.
- The acceptance criteria fit in one PR.
- The slice has explicit test commands.
- The slice does not depend on two unfinished slices unless marked blocked.
- README/CLAUDE impact is classified as `none`, `README`, `CLAUDE`, or `both`.
- Branch action is classified as `stay`, `create-slice-branch`, `sync-staging`, or `blocked`.

### Stop And Ask Human

- Existing worktree contains unrelated dirty changes in the same files.
- The slice requires changing smart contract semantics.
- A regulatory naming or money custody question appears.
- The loop cannot define a deterministic verification command.
- The current branch does not match the intended slice and moving work would risk losing uncommitted changes.

## Loop 1: Spec Contract Loop

### Goal

Keep implementation slices aligned around a single state model before code changes.

### Inputs

- Current DB schema under `packages/db/src/schema`.
- `packages/commerce-core/src/approval-policy.ts`
- `packages/payment-core/src/settlement-release.ts`
- `packages/shipping-core/src/state-machine.ts`
- `packages/dispute-core/src/state-machine.ts`
- Existing API route contracts under `apps/api/src/routes`.

### Execute Scope

- Update docs/specs only.
- Define state transitions and API contracts.
- Add acceptance criteria for tests.

### Done Criteria

- State table covers `physical_shipping` and `digital_delivery`.
- Compatibility mapping exists for legacy `shipped` and `PENDING_DELIVERY`.
- API contract says which actor is server-derived.
- Release/refund/dispute transition conflicts are explicit.

### Verify Commands

Documentation-only loop. Verification is review against source files, not test execution.

### Output

One short design update in `docs/wip/` and a slice backlog entry.

## Loop 2: Payment Funding Loop

### Goal

Make `Negotiation accepted -> settlement approval -> payment intent -> funded settlement` reliable for MVP rails.

### Allowed Surfaces

- `packages/payment-core/src`
- `packages/commerce-core/src`
- `apps/api/src/routes/payments.ts`
- `apps/api/src/routes/settlement-approvals.ts`
- `apps/api/src/services/payment-record.service.ts`
- `apps/api/src/payments`
- `packages/contracts/sol/HaggleConditionalSettlement.sol`
- matching tests only

### Required Invariants

- Amount, seller wallet, fee wallet, settlement id, buyer wallet, and nonce are stable across prepare, quote, authorize, and fund.
- Seller wallet mismatch is terminal or blocked, not silently corrected.
- Idempotent retries return the existing intent when safe.
- Canonical terminal states are not treated as active.

### Verify Commands

```bash
pnpm --filter @haggle/payment-core test
pnpm --filter @haggle/api typecheck
pnpm --filter @haggle/api test -- apps/api/src/__tests__/payments.test.ts
pnpm --filter @haggle/api test -- apps/api/src/__tests__/payment-record.service.test.ts
cd packages/contracts && forge test
```

### Stop And Ask Human

- Contract storage layout or public event semantics need to change.
- The implementation would use custody/escrow/deposit language.
- Payment rail behavior differs between x402 and Stripe in seller payout amount.

## Loop 3: Fulfillment Abstraction Loop

### Goal

Add the app-layer no-shipping fulfillment path while preserving physical shipping.

### Allowed Surfaces

- `packages/commerce-core/src/approval-policy.ts`
- `packages/shipping-core/src`
- `packages/payment-core/src/settlement-release.ts`
- `apps/api/src/routes/settlement-releases.ts`
- `apps/api/src/services/settlement-release.service.ts`
- `apps/api/src/services/payment-record.service.ts`
- DB schema/migrations only if the slice explicitly requires persistence
- matching tests

### Target Behavior

| Fulfillment type | Shipment required | Completion signal |
| --- | --- | --- |
| `physical_shipping` | Yes | carrier delivered or buyer confirm |
| `digital_delivery` | No | seller proof, buyer access confirm, or policy timeout |

### Required Invariants

- Digital fulfillment never creates a shipment record.
- Physical shipping keeps existing carrier/SLA behavior.
- Release windows are driven by fulfillment confirmation, not only delivery confirmation.
- Missing `fulfillment_type` remains backward compatible with physical shipping.

### Verify Commands

```bash
pnpm --filter @haggle/shipping-core test
pnpm --filter @haggle/payment-core test -- settlement-release
pnpm --filter @haggle/api test -- apps/api/src/__tests__/shipping-production-readiness.test.ts
pnpm --filter @haggle/api test -- apps/api/src/__tests__/payment-test-tools.test.ts
```

### Stop And Ask Human

- A digital asset requires platform-specific legal transfer semantics.
- New persistence is needed but migration ordering is unclear.
- Shipping-only UI copy would misrepresent a digital transaction.

## Loop 4: Release Gate Loop

### Goal

Ensure money only moves after the correct verified condition, and that release, refund, and dispute cannot race each other into inconsistent state.

### Allowed Surfaces

- `packages/payment-core/src/settlement-release.ts`
- `apps/api/src/routes/settlement-releases.ts`
- `apps/api/src/services/settlement-release.service.ts`
- `apps/api/src/chain/handlers/conditional-settlement-handler.ts`
- `apps/api/src/payments/settlement-signer.ts`
- matching tests

### Required Invariants

- `release()` pays only the originally funded seller wallet.
- Refund and release signatures are bound to the correct settlement id and amount.
- DB updates after chain calls require event verification.
- Dispute freezes release/refund until resolution.
- Operation idempotency prevents double execution.

### Verify Commands

```bash
pnpm --filter @haggle/payment-core test -- settlement-release
pnpm --filter @haggle/api test -- apps/api/src/__tests__/chain-event-sync.test.ts
pnpm --filter @haggle/api test -- apps/api/src/payments/__tests__/settlement-signer.test.ts
cd packages/contracts && forge test --match-contract HaggleConditionalSettlement
```

### Stop And Ask Human

- A release policy needs to override buyer review for a new category.
- Event verification cannot be deterministic in local tests.
- Existing terminal payment state must be migrated.

## Loop 5: Dispute Intake And Evidence Loop

### Goal

Open disputes safely against existing orders and attach controlled evidence without allowing duplicate active cases.

### Allowed Surfaces

- `packages/dispute-core/src`
- `apps/api/src/routes/disputes.ts`
- `apps/api/src/services/dispute-record.service.ts`
- `apps/api/src/services/dispute-storage.service.ts`
- `apps/api/src/services/dispute-resolution-finalizer.ts`
- DB dispute/evidence migrations
- matching tests

### Required Invariants

- Server derives buyer/seller role from auth and order.
- Public body cannot set `opened_by` or `submitted_by`.
- Accepted dispute and order state freeze happen in one transaction.
- Active dispute unique constraint prevents race duplicates.
- File evidence uses Haggle-controlled upload intent and commit.

### Verify Commands

```bash
pnpm --filter @haggle/dispute-core test
pnpm --filter @haggle/api test -- apps/api/src/__tests__/disputes.test.ts
pnpm --filter @haggle/api test -- apps/api/src/__tests__/dispute-resolution-finalizer.test.ts
pnpm --filter @haggle/api test -- apps/api/src/__tests__/e2e/dispute-flow.test.ts
```

### Stop And Ask Human

- A new reason code changes refund policy.
- Evidence storage provider or retention policy is not configured.
- A dispute outcome requires manual adjudication policy.

## Loop 6: Operator Demo Loop

### Goal

Make the MVP flow repeatedly testable by a human without reading raw API responses.

### Truth Surface

- `docs/tools/payment-fulfillment-test-console.html`

### Required Flows

- One-click unit/mock happy path:
  `Create Approval -> Prepare -> Quote -> Authorize -> Pending -> Settle -> Refresh`
- Physical shipping path with shipment output.
- Digital delivery path with no shipment output.
- Dispute path that freezes release.
- Last result and recent requests visible in the main UI.

### Verify Commands

```bash
pnpm --filter @haggle/api test -- apps/api/src/__tests__/payment-test-tools.test.ts
pnpm --filter @haggle/api test -- apps/api/src/__tests__/e2e/payment-flow.test.ts
pnpm --filter @haggle/api test -- apps/api/src/__tests__/e2e/dispute-flow.test.ts
```

Browser verification is required when the console UI changes.

### Stop And Ask Human

- The console needs real provider credentials.
- A demo shortcut would bypass production money-state rules.
- The UI hides important money movement evidence.

## Loop 7: Readiness And Memory Loop

### Goal

Keep long-running loop work resumable and prevent the same failure from reappearing.

### Execute Scope

- Update implementation notes.
- Update README/CLAUDE decision notes only when a slice changes durable setup, command, architecture, branch, or operating rules.
- Record failed commands and exact error strings.
- Record blocked human decisions.
- Record which loop owns the next action.

### Memory Record Shape

```text
date:
branch:
loop:
slice:
changed_files:
verified_commands:
failed_commands:
blocked_on:
docs_updated:
next_loop:
```

### Done Criteria

- Every completed slice has a command transcript summary.
- Every failed slice has a concrete next action.
- Every blocked slice names the human decision needed.
- README/CLAUDE impact has been handled or explicitly marked `none`.

## Loop 8: Repo Governance Loop

### Goal

Keep branch, git history, README, and CLAUDE.md aligned with the implementation loops so the MVP can be resumed, reviewed, and merged without losing context.

This loop wraps every implementation loop. It runs before a slice starts and after a slice reaches a stopping point.

### Inputs

- `git status --short --branch`
- `git branch --show-current`
- `git log --oneline --decorate -12`
- `README.md`
- `CLAUDE.md`
- `docs/README.md`
- This plan

### Branch Policy

- Work should happen on a descriptive feature branch.
- Branch names should be functional and avoid person/tool identity.
- Use names like `feature/payment-fulfillment-loop-slice-a` or `feature/digital-fulfillment-proof`.
- Do not start a new branch if the current branch already contains uncommitted relevant work.
- Do not merge, rebase, stash, or discard dirty work unless the user explicitly asks.
- If a slice needs a separate branch but current dirty files overlap, stop and report the exact blocking files.

### Git Hygiene

Before implementation:

- Record current branch and dirty files.
- Identify files expected to change.
- Classify unrelated dirty files and avoid touching them.

After implementation:

- Show changed files grouped by loop.
- Confirm generated artifacts are intentional.
- Keep commits slice-sized.
- Do not commit unless the user asks.
- If committing, include only files owned by the slice and its governance docs.

### README Policy

Update `README.md` when a slice changes:

- local setup commands
- dev/test commands
- migration workflow
- service ports
- operator/demo instructions that a developer must know

Do not update `README.md` for internal implementation details that only belong in `docs/wip/`.

### CLAUDE.md Policy

Update `CLAUDE.md` when a slice changes:

- project source-of-truth architecture
- durable product or protocol rules
- branch/team workflow
- package ownership or monorepo structure
- non-negotiable safety principles

Do not use `CLAUDE.md` as a changelog. Keep it durable and concise.

### Docs Index Policy

Update `docs/README.md` when a new document becomes a routing target rather than a temporary scratch note.

The loop plan should be linked from docs routing once the user accepts it as the operating model for the MVP work.

### Verify Commands

```bash
git status --short --branch
git diff --name-only
git diff --check
```

If README or CLAUDE changes:

```bash
rg -n "payment|fulfillment|dispute|branch|loop" README.md CLAUDE.md docs/README.md
```

### Stop And Ask Human

- Branch target is ambiguous.
- Dirty files include unrelated work in the same files this slice needs.
- README or CLAUDE would need to contradict current source-of-truth docs.
- A commit, merge, rebase, stash, push, or PR is needed but not explicitly requested.

## Latest Completed Loop

### Cycle 92: Conditional settlement finality alert receiver

- Plan: finality backlog sender 뒤에 raw-body 서명 검증과 공용 DB claim 기반 수신 경계를 추가한다.
- Implement: 현재·이전 secret rotation, 5분 freshness, strict aggregate schema, replay/conflict 분리, 관리자 receiver health와 대시보드 카드를 구현했다.
- Review: 서명된 body 내부의 reason/count/status 모순을 허용하던 문제와 finality health에서 receiver 상태가 보이지 않던 문제를 발견했다.
- Revise: aggregate 의미 불변식을 강제하고 receiver health 실패를 본체 health와 격리했으며 실제 PostgreSQL fixture를 sender+receiver lifecycle로 확장했다.
- Verify: 실제 대시보드 9/9, API 1,901, dispute-core 152, shipping-core 214, 집중 53, 복구 12+22, 타입 검사와 390px overflow 0을 통과했다.

Cycle 92에서 남긴 다중 API 인스턴스 경쟁 후보는 Cycle 93에서 완료했다.

### Cycle 93: Finality receiver multi-instance race

- Plan: 한 delivery를 여러 API 인스턴스가 동시에 받는 상황에서 수신 claim의 단일 처리권을 검증한다.
- Implement: 유효한 warning payload 하나로 20개 receiver claim을 실제 PostgreSQL에서 동시에 실행하고 단일 승자만 완료했다.
- Review: 순차 replay가 아니라 승자 claim이 PROCESSING인 동안 경쟁자가 settle하도록 `Promise.all` 경계를 유지했고 프로세스 내부 lock 의존이 없음을 확인했다.
- Revise: 대시보드 receiver 방어 카드에 replay, payload conflict와 함께 `race 1/20 won`을 표시하고 cleanup 범위를 경쟁 row까지 확장했다.
- Verify: 실제 대시보드 10/10, winner 1, blocked 19, completion 1, cleanup 5/0과 집중 53개를 통과했다.

### Cycle 94: Finality receiver stale-owner fencing

- Plan: receiver owner가 멈춰 lease가 만료된 뒤 takeover와 이전 owner의 늦은 완료를 실제 DB에서 검증한다.
- Implement: fixture 고유 source·event·claim에 한정해 attempt 1 lease를 만료시키고 attempt 2가 같은 payload를 takeover하도록 했다.
- Review: stale owner 완료와 새 owner 완료 순서를 의도적으로 뒤집어 claim ID fencing이 실제로 동작하는지 확인했다.
- Revise: receiver 방어 카드에 takeover fencing 결과와 attempt count를 표시하고 cleanup 범위를 takeover row까지 확장했다.
- Verify: 실제 대시보드 11/11, stale owner fenced, attempt 2 completed, cleanup 6/0과 집중 53개를 통과했다.

Cycle 94에서 남긴 receiver 실패·backoff 후보는 Cycle 95에서 완료했다.

### Cycle 95: Finality receiver failure and backoff recovery

- Plan: receiver의 미완료 상태가 sender에게 성공으로 보이지 않게 하고 실패 claim의 재시도 복구를 실제 DB에서 검증한다.
- Implement: completed replay, in-progress와 retry-backoff를 분리하고 후자의 두 상태는 bounded Retry-After가 있는 503으로 반환한다. 완료 실패는 claim token으로 FAILED 전환한다.
- Review: 기존 `replay_or_in_progress` 통합 응답이 PROCESSING과 FAILED까지 200으로 반환해 경보 유실을 만들 수 있음을 발견했다.
- Revise: 공용 claim 결과에 1~300초 retry delay를 추가하고 fixture에서 실패, 즉시 차단, 정확한 row 해제, attempt 2 완료를 실행했다.
- Verify: 실제 대시보드 12/12, retry recovered/2, cleanup 7/0, 집중 64개와 전체 회귀를 통과했다.

Cycle 95에서 남긴 secret rotation 제한 후보는 Cycle 96에서 완료했다.

### Cycle 96: Finality receiver bounded secret rotation

- Plan: receiver HMAC 검증 키 목록의 설정 오류와 무제한 검증 비용을 제한하고 rotation 종료를 검증한다.
- Implement: current 필수, 총 4개, 각 16~128자와 중복 금지를 강제하고 runtime과 route를 fail-closed로 연결했다.
- Review: invalid 설정이 health에서 not configured처럼 보이는 문제를 발견해 configuration state를 별도로 표시했다.
- Revise: fixture에 previous overlap 허용과 retired secret 거부를 추가하고 rotation 카드에 `2 → 1 KEYS`를 표시했다.
- Verify: 실제 대시보드 13/13, retired blocked, cleanup 7/0, 집중 105개와 전체 회귀를 통과했다.

Cycle 96에서 남긴 receiver health 경보·복구 후보는 Cycle 97에서 공용 claim 경보를 재사용해 완료했다.

### Cycle 97: Shared receiver health alert and recovery

- Plan: finality receiver FAILED/stale를 운영 경보로 연결하되 기존 공용 claim 경보와 중복하지 않는다.
- Implement: 공용 health alert에 firing/recovered state, delivered incident 기반 recovery claim과 delivery history를 추가했다.
- Review: 별도 finality receiver 경보는 같은 DB row를 두 번 알리므로 공용 job 재사용으로 결정했다. 기존 공용 job에 recovery가 없던 실제 누락을 수정했다.
- Revise: finality fixture가 실제 receiver source health로 warning firing, attempt 2 완료 후 recovery와 중복 차단을 실행하도록 확장했다.
- Verify: 실제 대시보드 16/16, delivered→recovered, HMAC 2/2, cleanup 9/0, 집중 63개와 전체 회귀를 통과했다.

Cycle 97에서 남긴 공용 health alert receiver 후보는 Cycle 98에서 완료했다.

### Cycle 98: Webhook claim health alert receiver

- Plan: Cycle 97 sender/recovery가 실제 검증 가능한 receiver에 도달하도록 raw-body 인증과 idempotency 경계를 추가한다.
- Implement: strict aggregate schema, HMAC/freshness/rotation, completed replay와 in-progress/backoff/conflict 분리, 관리자 receiver health를 구현했다.
- Review: fixture fetch가 서명만 로컬 비교하고 실제 receiver claim을 만들지 않던 경계를 찾아 firing/recovery 각각 receiver DB lifecycle로 교체했다.
- Revise: 같은 delivery ID의 aggregate를 변경해 재서명해도 payload digest conflict로 격리하고 sender/receiver cleanup 범위를 확장했다.
- Verify: 실제 대시보드 19/19, receiver verify/replay 2/2, conflict isolated, cleanup 11/0, 집중 111개와 전체 회귀를 통과했다.

Cycle 98에서 남긴 공용 health receiver 경쟁·takeover 후보는 Cycle 99에서 완료했다.

### Cycle 99: Webhook claim health receiver race and stale takeover

- Plan: 동일 공용 health delivery의 다중 인스턴스 경쟁과 중단된 owner 복구를 실제 DB에서 검증한다.
- Implement: 20개 동시 claim, 단일 winner completion, 정확한 claim lease 만료와 attempt 2 takeover를 fixture에 추가했다.
- Review: 순차 replay가 아닌 PROCESSING 경쟁을 유지하고 stale owner 완료를 새 owner보다 먼저 시도해 fencing을 직접 증명했다.
- Revise: 대시보드 receiver 요약에 race 1/20과 takeover fenced/2를 표시하고 cleanup을 두 추가 row까지 확장했다.
- Verify: 실제 대시보드 21/21, cleanup 13/0, 집중 55개와 전체 회귀를 통과했다.

다음 자동 구현 후보는 공용 health alert receiver 실패·backoff attempt 2 복구 검증이다.

### Cycle 100: Webhook claim health receiver failure and backoff recovery

- Plan: 공용 health receiver의 처리 실패가 즉시 중복 실행되지 않고 backoff 뒤에만 재획득되는지 실제 DB에서 검증한다.
- Implement: 별도 서명 delivery의 attempt 1을 FAILED로 전환하고 즉시 retry_backoff, 정확한 failed row 해제, attempt 2 완료를 fixture에 추가했다.
- Review: finality 전용 receiver에는 같은 계약이 있었지만 공용 health receiver에는 실제 실패 복구 검증이 빠져 있었다.
- Revise: 대시보드 receiver 요약에 health retry recovered/2를 추가하고 fixture cleanup이 실패 복구 row까지 포함하도록 했다.
- Verify: 실제 대시보드 22/22, retry recovered/2, cleanup 14/0, 모바일 390px overflow 0과 집중 55개를 통과했다. 전체 회귀도 통과했다.

다음 자동 구현 후보는 공용 health receiver 완료 단계 실패가 FAILED/backoff로 전환되는 route 수준의 실제 HTTP 검증이다.

Cycle 101 계획 리뷰에서 live route fault injection은 인증된 내부 endpoint라도 운영 공격면을 늘려 제외했다. Route 단위 테스트의 완료 실패 검증과 Cycle 100 실제 DB lifecycle 검증을 결합해 같은 계약을 유지한다.

### Cycle 101: Webhook claim health receiver unique delivery burst

- Plan: 같은 ID 경쟁 방어뿐 아니라 서로 다른 정상 delivery가 동시에 유실 없이 처리되는지 실제 DB에서 검증한다.
- Implement: 고유 ID와 HMAC body 100개를 생성해 동시에 claim하고 모든 accepted claim을 완료하는 fixture를 추가했다.
- Review: 처리 시간 임계값은 개발 장비와 DB pool에 따라 흔들리므로 보안·정확성 조건인 accepted/completed 수만 판정한다.
- Revise: 대시보드 receiver 요약에 burst completed/requests를 추가하고 cleanup 범위를 100개 row까지 자동 확장했다.
- Verify: 실제 대시보드 23/23, burst 100/100, cleanup 114/0, 모바일 390px overflow 0과 집중 55개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 100개 burst 중 일부 완료가 실패할 때 성공 delivery는 보존하고 실패 delivery만 독립 backoff로 남는 부분 실패 격리 검증이다.

### Cycle 102: Webhook claim health receiver partial failure isolation

- Plan: 고유 delivery 묶음의 일부 실패가 성공 delivery 상태를 훼손하지 않고 실패 건만 재시도되는지 검증한다.
- Implement: 20개 actual DB claim 중 16개는 완료하고 4개는 실패시킨 뒤 replay/backoff 상태를 분리했다.
- Review: 성공 건은 completed replay여야 하며 실패 건만 정확한 source와 delivery ID 조건으로 backoff를 만료해야 한다.
- Revise: 실패 4개만 attempt 2로 재획득·완료하고 대시보드에 partial 16+4/20을 표시한다.
- Verify: 실제 대시보드 24/24, partial 16+4/20, cleanup 134/0, 모바일 390px overflow 0과 집중 55개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 실패 delivery 4개를 동시에 재획득하려는 다중 인스턴스 경쟁에서 각 delivery마다 승자가 정확히 하나인지 검증하는 부분 실패 복구 경쟁이다.

### Cycle 103: Partial failure recovery race

- Plan: 실패 delivery별 backoff 만료 직후 여러 인스턴스가 동시에 재시도해도 attempt 2가 중복 실행되지 않아야 한다.
- Implement: 실패 4개 각각에 10개 claim을 동시에 보내 총 40개 실제 PostgreSQL 경쟁을 추가했다.
- Review: 전체 승자 수뿐 아니라 delivery별 한 승자를 보장하도록 각 그룹을 독립 실행하고 공용 unique claim을 사용한다.
- Revise: 승자 4개, PROCESSING 차단 36개, attempt 2 네 건만 완료하고 대시보드에 recovery race 4/40을 표시한다.
- Verify: 실제 대시보드 25/25, recovery race 4/40, cleanup 134/0, 모바일 390px overflow 0과 집중 55개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 부분 실패 복구 승자 완료 전에 lease가 만료될 때 이전 attempt 2 owner를 fencing하고 attempt 3만 완료하는 복구 중단 검증이다.

### Cycle 104: Interrupted retry owner fencing

- Plan: FAILED delivery의 attempt 2 복구 worker가 중단되어도 다음 owner가 안전하게 이어받아야 한다.
- Implement: 별도 delivery를 attempt 1 FAILED, attempt 2 PROCESSING으로 만든 뒤 정확한 claim lease를 만료해 attempt 3 takeover를 실행한다.
- Review: 이전 owner 완료를 새 owner보다 먼저 시도해 claim token fencing이 실제로 덮어쓰기를 막는지 확인한다.
- Revise: attempt 2는 `WEBHOOK_CLAIM_LOST`, attempt 3만 완료하고 대시보드에 interrupted fenced/3을 표시한다.
- Verify: 실제 대시보드 26/26, interrupted fenced/3, cleanup 135/0, 모바일 390px overflow 0과 집중 55개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 attempt 3 완료 뒤 attempt 1·2 payload replay가 모두 기존 완료 결과로 수렴하고 추가 attempt를 만들지 않는 terminal convergence 검증이다.

### Cycle 105: Completed delivery terminal convergence

- Plan: 여러 이전 sender가 완료된 delivery를 다시 보내도 새 owner나 attempt를 생성하지 않아야 한다.
- Implement: attempt 3 완료 직후 같은 검증 payload를 20개 동시에 claim해 모두 completed replay로 처리한다.
- Review: 응답 outcome뿐 아니라 정확한 DB row의 status와 attempt count를 조회해 상태 불변성을 확인한다.
- Revise: `COMPLETED`, attempt count 3, replay 20/20을 대시보드 terminal 요약에 표시한다.
- Verify: 실제 대시보드 27/27, terminal 20/20@3, cleanup 135/0, 모바일 390px overflow 0과 집중 55개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 이 공용 receiver fixture가 커진 만큼 단계별 소요 시간과 실패 단계 이름을 구조화해, 운영자가 timeout과 실패 위치를 대시보드에서 바로 구분하게 하는 진단성 보강이다.

### Cycle 106: Finality fixture stage diagnostics

- Plan: fixture가 커져 단일 PASS/FAIL만으로는 느린 단계와 실패 위치를 찾기 어렵다.
- Implement: sender, receiver resilience, alert, burst, partial failure, terminal, assertions, cleanup을 이름 있는 단계로 측정한다.
- Review: 원본 예외 메시지를 route로 전달하면 DB 주소나 비밀이 노출될 수 있어 code와 bounded stage만 반환한다.
- Revise: 성공 응답은 total/slowest/stage durations를, 실패 응답은 redacted 500과 failure stage를 제공하고 대시보드에 timing을 표시한다.
- Verify: 실제 대시보드 28/28, 9개 단계, total/slowest 표시, cleanup 135/0, 모바일 390px overflow 0과 집중 56개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 단계별 진단값에 고정된 최대 실행 시간 예산을 적용하되 환경 변동에 취약한 개별 단계 latency가 아니라 전체 fixture timeout을 서버에서 강제하는 실행 취소 경계다.

전체 미완성 항목 재감사 결과 실제 계정·기기·외부 endpoint가 필요한 항목을 제외하고, 내부에서 독립적으로 강화할 수 있는 1천 event burst를 먼저 수행한다.

### Cycle 107: Webhook claim health receiver 1,000-event burst

- Plan: 100개 fixture를 출시 전 위험 목록에 적힌 1천 event 규모로 확장해 내부 DB 경계를 검증한다.
- Implement: 고유 delivery ID와 독립 HMAC body 1,000개를 동시에 claim하고 모든 accepted claim을 완료한다.
- Review: 개발 장비 latency는 합격 조건에서 제외하고 accepted/completed 정확성, 기존 same-ID 방어와 cleanup만 강제한다.
- Revise: 대시보드 burst 요약과 결제 완성도 목록에 1천 event 실제 PostgreSQL 검증을 표시한다.
- Verify: 실제 대시보드 28/28, accepted/completed 1,000/1,000, cleanup 1,035/0, total/slowest 진단, 모바일 390px overflow 0과 집중 56개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 1천 event fixture를 같은 source에서 겹쳐 실행하지 못하도록 전역 DB operation lease를 추가해 대시보드 중복 클릭과 여러 관리자 동시 실행의 DB 부하 폭증을 막는 실행 잠금이다.

### Cycle 108: Global DB execution lease for heavy fixture

- Plan: 1천 event fixture의 중복 클릭과 여러 API 인스턴스 동시 실행이 DB 부하를 배가하지 않아야 한다.
- Implement: 전용 operation lease 테이블, stable key, UUID token, 300초 expiry takeover와 token-scoped release를 추가했다.
- Review: webhook health 원장이나 dispute lease를 재사용하면 운영 집계·도메인을 오염하므로 전용 테이블로 분리했다.
- Revise: route가 잠금 실패 시 fixture를 시작하지 않고 Retry-After 5가 있는 409를 반환하며 성공·실패 모두 finally에서 release한다.
- Verify: 실제 동시 HTTP는 200 + 409였고 첫 실행은 burst 1,000/1,000과 cleanup 1,035/0을 유지했다. 대시보드는 lock global_db 300s와 모바일 overflow 0을 표시했고 집중 62개와 전체 회귀를 통과했다.

다음 자동 구현 후보는 전역 fixture lease의 만료 takeover와 이전 lease token release가 새 owner 잠금을 삭제하지 못하는 fencing을 실제 PostgreSQL fixture로 검증하는 잠금 자체의 통합 테스트다.

### Cycle 109: Global fixture lease stale takeover verification

- Plan: route 경쟁 차단뿐 아니라 만료 takeover와 이전 owner fencing을 실제 DB lifecycle로 증명한다.
- Implement: UUID-suffixed verification key에서 owner 1 획득, owner 2 차단, +301초 takeover를 수행한다.
- Review: 이전 token delete를 새 owner보다 먼저 시도해 0건이어야 하고 새 token만 정확히 1건을 삭제해야 한다.
- Revise: self-test key를 finally에서 정리하고 main result check와 대시보드 lease fenced/released에 반영한다.
- Verify: 실제 대시보드 29/29, lease fenced/released, self-test cleanup 0, main cleanup 1,035/0, 모바일 390px overflow 0과 집중 63개, 전체 회귀를 통과했다.

다음 자동 구현 후보는 300초 lease보다 fixture가 오래 걸릴 때 active owner가 heartbeat로 lease를 갱신해 중간 takeover를 막고, heartbeat 중단 뒤에만 takeover를 허용하는 장시간 실행 보호다.

### Cycle 110: Long-running fixture lease heartbeat

- Plan: fixture가 300초를 넘더라도 active owner가 살아 있는 동안 stale takeover가 발생하지 않아야 한다.
- Implement: stable key와 lease token에 한정된 renew API와 100초 heartbeat handle을 route lifecycle에 추가했다.
- Review: self-test에서 +240초 갱신 뒤 원래 +301초 takeover를 먼저 시도해 차단을 직접 증명한다.
- Revise: 갱신 expiry +541초에만 새 owner takeover를 허용하고 heartbeat owner 상실은 bounded 500으로 처리한다.
- Verify: 실제 대시보드 30/30, heartbeat 100s, lease renewed/fenced, cleanup 1,035/0, 모바일 390px overflow 0과 집중 65개, 전체 회귀를 통과했다.

### Cycle 111: APV invoice source document ingestion

- Plan: revision evidence에 hash만 있고 실제 carrier invoice bytes를 수집·보존하는 endpoint가 없는 공백을 닫는다.
- Implement: migration 0069 원장, 관리자 PDF/CSV/JSON base64 upload, 5MiB·magic/parse·evidence binding·generated path 저장을 추가했다.
- Review: service 내부 호출의 path traversal을 UUID 재검증으로 차단하고 DB transaction 실패 시 새 파일도 rollback 삭제한다.
- Revise: Shipping APV Chaos에 actual file stored/replay/content-type conflict/readback hash/DB+file cleanup을 추가하고 evidence 카드에 표시한다.
- Verify: 실제 모바일 대시보드 Shipping APV Chaos 75/75, invoice stored/duplicate/document_conflict, bytes verified, cleanup true, overflow 0과 집중 43개를 통과했다. 전체 회귀도 통과했다.

다음 자동 구현 후보는 invoice 원문 저장 health와 orphan file/DB row reconciliation dry-run을 추가해 파일 시스템 장애나 수동 삭제를 운영자가 식별할 수 있게 하는 보존 무결성 점검이다.

### Cycle 112: APV invoice storage integrity health and reconciliation dry-run

- Plan: APV invoice DB 원장과 파일 저장소가 어긋나도 운영자가 원문 경로나 revision 식별자 노출 없이 상태를 확인해야 한다.
- Implement: 관리자 전용 health와 명시적 `dry_run: true` reconciliation API를 추가하고 존재·크기·SHA-256·orphan·비정상 entry를 bounded scan으로 집계한다.
- Review: 1,000개 DB row 상한 때문에 미조회 정상 파일을 orphan으로 오판하는 문제와 revision 범위 점검이 다른 디렉터리를 세는 문제를 발견했다.
- Revise: DB scan이 잘리면 orphan 판정을 보류하고 `scanTruncated`만 경고하며, revision 점검은 해당 UUID 디렉터리만 검사하고 service 경계 UUID 검증을 추가했다.
- Verify: 실제 대시보드 Shipping APV Chaos 79/79에서 `HEALTHY → WARNING → HEALTHY`, orphan 1, dry-run no mutation을 확인했다. 관리자 GET/POST도 HTTP 200, 모바일 390px overflow 0, 집중 45개와 전체 API 1,936개·분쟁 152개·배송 214개·타입·복구·DOM·HTML 검증을 통과했다.

다음 자동 구현 후보는 invoice storage health의 warning/critical 전환을 기존 서명 ops 경보 파이프라인에 연결해, 누락·hash 변조는 critical로 즉시 전달하고 orphan·scan truncation은 warning으로 중복 억제하는 운영 경보다.

### Cycle 113: APV invoice storage signed operations alert

- Plan: 저장 무결성 warning·critical이 관리자 수동 조회에만 머물지 않고 기존 APV 운영 경보로 전달되어야 한다.
- Implement: APV payout alert payload에 비식별 invoice storage health를 포함하고 누락·hash 변조는 critical, 크기·orphan·invalid·truncated는 warning으로 평가한다.
- Review: 정상화 시 매 분 recovery를 만들거나 여러 서버가 같은 recovery를 전송할 수 있는 위험을 확인했다.
- Revise: 최신 completed incident ID에서 stable recovery ID를 만들고 공용 PostgreSQL claim으로 한 owner만 전송하며, 완료된 recovery가 최신 incident보다 뒤면 더 보내지 않는다.
- Verify: 실제 대시보드 Shipping APV Chaos 81/81에서 `HEALTHY → WARNING → HEALTHY`, `alert warning → clear`, orphan 1, dry-run no mutation과 모바일 overflow 0을 확인했다. 집중 15개, 전체 API 1,939개·분쟁 152개·배송 214개·타입·복구·DOM·HTML·diff 검증을 통과했다.

다음 자동 구현 후보는 현재 dry-run이 제시하는 orphan quarantine와 missing/corrupt DB 상태 표식을 승인형 복구 작업으로 분리하고, maker-checker·감사 이벤트·재시도 가능 상태를 갖춘 실제 정합성 조치 workflow를 설계하는 것이다. 자동 삭제는 하지 않는다.

### Cycle 114: APV invoice maker-checker reconciliation action

- Plan: 운영자가 storage path를 직접 입력하거나 한 명이 즉시 파일을 삭제하지 못하게 하고, 서버가 실제 이상 상태에서 만든 opaque 후보만 승인 workflow로 처리한다.
- Implement: migration 0070에 document integrity 상태, reconciliation request·event 원장을 추가하고 candidates/request/pending/timeline/decision API를 구현했다. Orphan·손상 파일은 `.quarantine/<request UUID>/`로 이동하고 누락 파일은 원장에 표식한다.
- Review: 파일 이동과 DB commit은 하나의 원자 transaction이 아니며, 단순 rollback 이동은 commit 결과가 불명확한 장애에서 더 위험하다. 같은 millisecond event를 UUID로 정렬하면 lifecycle 순서도 뒤집혔다.
- Revise: checker 결정을 먼저 `APPLYING`으로 고정하고 동일 decision ID만 재개하도록 2단계 적용을 도입했다. 승인 직전 후보·누락 상태와 document update 1건을 재검증하고, bounded apply error만 저장하며 event는 request version 순으로 정렬한다.
- Verify: 실제 대시보드 Shipping APV Chaos 88/88에서 opaque 후보 1, self approval 차단, checker 승인, replay duplicate, quarantine bytes, REQUESTED→APPLYING→APPROVED, cleanup 1/3을 확인했다. Fixture request/event/audit 잔존은 0/0/0이고 모바일 overflow 0, 집중 49개와 전체 API 1,943개·분쟁 152개·배송 214개·타입·복구·DOM·HTML·diff 검증을 통과했다.

### Cycle 115: APV invoice verified re-collection and restoration

- Plan: MISSING/QUARANTINED 원장을 운영자가 임의 파일로 덮어쓰지 못하게 하고, 원래 carrier evidence와 정확히 같은 재수집본만 별도 checker가 복원 또는 보존하도록 한다.
- Implement: migration 0071에 restoration request·event 원장을 추가하고 opaque candidates/request/pending/timeline/decision API를 구현했다. 재수집 bytes는 원래 SHA-256·크기·MIME·format이 모두 일치할 때만 `.restoration/<request UUID>/`에 mode 0600으로 staging한다.
- Review: active 문서 수만 세면 quarantine 상태가 health에서 사라졌고, DB request 생성과 staging write 사이 중단 시 재실행 경로가 필요했다. PRESERVE 경로도 RESTORE만큼 실제 bytes 검증이 필요했다.
- Revise: health에 ACTIVE/MISSING/QUARANTINED 집계를 추가하고 deterministic client/request UUID와 동일 staging path를 사용해 같은 bytes 재실행만 허용했다. RESTORE와 PRESERVE 모두 APPLYING 2단계와 동일 decision ID resume, mode 0700 디렉터리, 실제 readback 검증을 적용했다.
- Verify: 실제 대시보드 Shipping APV Chaos 104/104에서 critical→warning→healthy, mismatch 차단, preserve/restore replay, bytes 검증, cleanup 2/6과 fixture 잔존 0/0/0을 확인했다. 집중 53개, 전체 API 1,947개·분쟁 152개·배송 214개·타입·복구·DOM·HTML·diff 및 모바일 overflow 0을 통과했다.

### Cycle 116: APV restoration staging non-destructive retention

- Plan: REJECTED·EXPIRED 요청의 검증된 재수집본을 자동 삭제하지 않고 운영자가 먼저 dry-run한 뒤 별도 quarantine에 보존하도록 한다.
- Implement: migration 0072에 `STAGED/MOVING/MOVED/CONSUMED` 상태와 `STAGING_PRESERVED` event를 추가하고 admin-only staging maintenance dry-run/apply API를 구현했다. 거절·만료본은 `.quarantine/<request UUID>/staged-<hash>`로 이동하고 SHA·크기를 다시 검증한다.
- Review: 단순 `MOVING` 재개는 두 인스턴스가 방금 시작된 같은 파일을 동시에 옮길 수 있었고, DB의 잘못된 storage key가 유지보수 전체를 중단시킬 수 있었다.
- Revise: `MOVING`은 5분 이상 정체된 항목만 resume하고 lock 뒤 updated_at을 다시 검사한다. 루트 밖 경로는 fail-closed conflict 집계로 격리하고, source/destination 중복이나 hash 불일치도 이동하지 않는다. 실제 fixture에서 stale MOVING takeover와 PENDING expiry를 각각 검증했다.
- Verify: 실제 대시보드 Shipping APV Chaos 112/112에서 `REJECTED + EXPIRED → 2 PRESERVED`, dry-run 1+1, stale resume 1, replay eligible 0, 두 원문 bytes와 lifecycle 3+3, 최종 RESTORED/duplicate, cleanup 4/12를 확인했다. Fixture request/reconciliation/audit 잔존은 0/0/0이다.

### Cycle 117: APV restoration staging health and signed alert

- Plan: 운영자가 maintenance 화면을 열기 전에도 미처리 staging, 장기 MOVING, source 누락·변조를 알 수 있게 하되 request ID와 경로는 경보에 넣지 않는다.
- Implement: admin-only staging health API가 STAGED/MOVING 최대 1,000건과 최대 100MiB를 검사해 tracked/pending/stale/missing/hash/invalid/truncated 집계만 반환한다. 기존 APV payout HMAC alert job과 payload에 이 집계를 추가했다.
- Review: 예상 byte size만으로 budget을 선검사하면 실제 파일이 비정상적으로 커진 경우 read 전에 차단하지 못하고, 한 invalid file이 maintenance batch 전체를 500으로 중단시킬 수 있었다. 같은 version의 EXPIRED와 STAGING_PRESERVED event도 같은 시각에 순서가 뒤집혔다.
- Revise: 실제 lstat size를 byte budget과 5MiB 파일 상한에 적용하고 symlink/non-regular를 읽지 않는다. Invalid/oversized source는 conflict로 격리해 다음 항목을 계속 처리한다. STAGING_PRESERVED finalize는 version을 증가시켜 lifecycle 순서를 결정적으로 고정했다.
- Verify: 실제 대시보드 Shipping APV Chaos 116/116에서 `warning → healthy`, APV alert `warning → clear`, HTTP 200 health `HEALTHY · 0 TRACKED`, cleanup 4/12와 fixture 잔존 0/0/0을 확인했다. Missing·hash mismatch·path escape·byte truncation과 shared signed-alert job을 포함한 집중 65개, 전체 API 1,954개·분쟁 152개·배송 214개·타입·복구·DOM·HTML·diff 검증을 통과했다.

### Cycle 118: terminal staging automatic preservation worker

- Plan: 정확히 검증된 REJECTED/EXPIRED staging 보존은 돈·문서 판정을 바꾸지 않으므로 반복 수동 작업을 worker로 옮기되 conflict·missing은 자동 처리하지 않는다.
- Implement: 1분 주기의 opt-in worker가 기존 bounded maintenance apply를 system actor UUID와 1~1,000 limit으로 실행한다. Runner 등록, 환경 예시, job status를 staging health 응답과 대시보드에 추가했다.
- Review: job flag만 켜고 actor가 없으면 매분 조용히 skip할 수 있었고, health 응답의 job 정책과 수동 maintenance 결과가 같은 response key를 써 dashboard renderer가 혼동할 수 있었다.
- Revise: startup config가 `ENABLE_CRON=true`, 유효한 actor UUID, bounded limit을 fail-fast로 강제한다. Dashboard는 `mode`가 있는 실행 결과와 `jobEnabled/configured` 정책을 구분한다. 다중 인스턴스는 row lock과 fresh MOVING fence로 한 worker만 claim한다.
- Verify: 실제 대시보드 Shipping APV Chaos 118/118에서 worker `completed → healthy`, stale resume 1, 보존 2건, warning→healthy와 alert warning→clear, cleanup 4/12와 잔존 0/0/0을 확인했다. 실제 health API는 HTTP 200, worker disabled, limit 100을 명시했다. Job·runner·runtime fail-fast를 포함한 집중 123개와 전체 API 1,960개·분쟁 152개·배송 214개·타입·복구·DOM·HTML·diff 검증을 통과했다.

### Cycle 119: terminal staging remediation maker-checker

- Plan: 자동 보존이 처리하지 않는 source 누락, staging hash 변조, 기존 보존 목적지 충돌을 운영자가 경로 없이 선택해 종결할 수 있게 하되 자동 삭제와 자동 덮어쓰기는 금지한다.
- Implement: migration 0073으로 restoration staging 최종 상태 `MISSING/CONFLICT_QUARANTINED`, `STAGING_REMEDIATED` 원 이벤트, 별도 remediation request/event 원장을 추가했다. 관리자 전용 후보·요청·대기열·타임라인·결정 API와 대시보드 카드를 연결했다.
- Review: 최초 구현은 승인 JOIN 행의 remediation ID를 원 restoration ID로 해석해 첫 승인을 `candidate_changed`로 막고 같은 결정 재시도에서만 완료됐다. 또한 기존 restoration REJECT 결정은 lifecycle event는 남겼지만 관리자 감사로그를 누락했다.
- Revise: 승인 전 fingerprint 재검증은 명시적 `restoration_request_id`를 사용하며, fresh claim과 resume를 분리했다. Restoration과 remediation의 REJECT 모두 결정 감사로그를 남긴다. 응답에서는 path, 원 restoration ID, observed SHA를 숨긴다.
- Verify: 실제 대시보드 Shipping APV Chaos 129/129에서 변조 탐지 `critical`, opaque HASH_MISMATCH 후보, self approval 차단, 첫 checker 승인 `approved`, replay `duplicate`, 변조 bytes 비파괴 격리, health `critical → healthy`, remediation lifecycle 3개와 원 restoration lifecycle 3개, cleanup restoration 5/15·remediation 1/3·audit 25를 확인했다. 빈 실제 후보 API도 HTTP 200, fixture DB 잔존은 0/0/0/0이었다. 집중 라우트 53개와 전체 API 1,963개·분쟁 152개·배송 214개·API/DB/payment-core 타입·복구 12/12·DOM 22/22·HTML·diff 검증을 통과했다.

다음 자동 구현 후보는 승인 없이 만료된 remediation 요청을 별도 worker가 상태만 EXPIRED로 수렴시키고, 누락·충돌 bytes에는 손대지 않은 채 queue health와 signed alert에 연결하는 것이다.

### Cycle 120: remediation expiry convergence and queue health

- Plan: 승인 기한이 지난 remediation 요청이 결정 API 호출에 의존하지 않도록 자동 수렴시키되, worker는 원 staging·quarantine·문서·금액을 읽거나 변경하지 않는다.
- Implement: 1분 opt-in worker가 최대 1~1,000개의 overdue PENDING을 `FOR UPDATE SKIP LOCKED`로 claim해 EXPIRED와 immutable event만 기록한다. 관리자 staging health 응답에 pending/applying/expiring/overdue/stale 집계와 worker 정책을 추가하고 기존 APV HMAC alert에 aggregate를 연결했다.
- Review: 정상 PENDING 자체를 warning으로 만들면 승인 대기 중인 모든 요청이 경보가 되므로, 5분 이내 만료만 warning, overdue 또는 5분 초과 APPLYING만 critical로 제한했다. 만료 worker는 별도 system actor나 파일 경로를 받을 이유가 없어 설정면에서 제거했다.
- Revise: startup은 worker 활성화 시 `ENABLE_CRON=true`와 bounded limit만 fail-fast한다. Worker replay는 queue가 비면 healthy no-op이며, expired 요청 뒤 동일 원 대상의 새 maker-checker 요청이 안전 종결할 수 있음을 실제 시나리오에 추가했다.
- Verify: 실제 대시보드 Shipping APV Chaos 138/138에서 overdue `critical`, signed alert critical, worker expired 1, replay healthy, EXPIRED lifecycle 2, 후속 checker의 SOURCE_MISSING 종결 lifecycle 3+3, health와 alert 정상화를 확인했다. Cleanup은 restoration 6/18, remediation 3/8, audit 30이었다.

다음 자동 구현 후보는 5분 이상 APPLYING에 머문 remediation을 자동 변경하지 않고, 동일 decision ID 재개가 필요한 항목만 opaque 운영 큐로 분리해 checker가 재개 또는 조사할 수 있게 하는 것이다.

### Cycle 121: checker-scoped stale APPLYING recovery queue

- Plan: 5분 이상 APPLYING인 remediation을 자동 변경하거나 다른 운영자가 인수하지 않고, 이미 결정을 시작한 checker에게만 재개 대상을 보여준다.
- Implement: 관리자 전용 recovery queue는 현재 인증된 checker의 `approver_id`와 일치하는 stale APPLYING만 최대 100건 반환한다. 응답은 request/decision ID, issue type, version, stalled seconds, allowlisted apply error와 updated time만 포함한다.
- Review: 전역 관리자 큐는 다른 checker의 decision ID를 노출할 수 있어 approver-scoped로 제한했다. DB의 raw `apply_error`도 임의 문자열이 될 수 있으므로 두 고정 오류 코드만 SQL allowlist로 통과시키고 나머지는 null로 가린다. Queue는 관측 전용이며 파일·문서·금액·상태를 변경하지 않는다.
- Revise: `limit + 1` 조회로 truncation을 정확히 표시하고 1~100 범위를 강제했다. 실제 fixture는 같은 요청을 stale APPLYING으로 만든 뒤 다른 checker 재개를 먼저 차단하고, 원 checker와 원 decision ID로만 기존 결정 API를 재개한다.
- Verify: 실제 대시보드 Shipping APV Chaos 142/142에서 원 checker queue 1, foreign checker queue 0, opaque 응답, wrong checker `invalid_state`, same decision resume `approved`, REQUESTED→APPLYING→APPROVED를 확인했다. 종료 후 전용 Staging Recovery 버튼은 `0 STALE APPLYING`을 반환했고 cleanup은 remediation 3/8, DB 잔존은 0이었다. 집중 63개, 전체 API 1,969개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입 검사, 복구 12/12+22/22와 HTML parse를 통과했다.

다음 자동 구현 후보는 stale recovery queue의 항목이 장시간 확인되지 않을 때 request/decision ID 없이 aggregate age bucket만 기존 signed APV alert에 추가해, 개별 checker의 미처리 적체를 운영자가 알 수 있게 하는 것이다.

### Cycle 122: stale recovery aggregate age escalation

- Plan: 기존 stale APPLYING critical 경보를 유지하면서, 개별 request·decision·checker ID를 노출하지 않고 15분·60분 장기화가 별도 경보 사건으로 승격되게 한다.
- Implement: remediation health에 oldest applying seconds, 5m/15m/60m age bucket과 15m·60m 초과 건수를 추가했다. 기존 signed APV payload, HMAC, PostgreSQL cooldown claim과 recovery lifecycle을 그대로 사용하고 누적 reason을 cooldown key에 포함한다.
- Review: 장기화 count가 있는데 기본 stale count가 0인 비정상 입력도 warning으로 낮아지지 않도록 15m·60m count 자체를 critical 조건에 포함했다. Signed payload와 dashboard에는 aggregate만 표시하고 request/decision/checker/path/hash는 포함하지 않는다.
- Revise: 299/300초, 899/900초, 3599/3600초 경계를 단위 테스트로 고정했다. 실제 fixture는 요청 생성 70분 전, APPLYING 시작 61분 전으로 정상 시간 순서를 유지하며 60m bucket과 세 누적 reason을 검증한다.
- Verify: 실제 대시보드 Shipping APV Chaos 144/144에서 checker-scoped queue 1건의 oldest applying이 60분 이상, bucket `60m`, alert critical과 5m·15m·60m 누적 reason임을 확인했다. 원 decision 재개 뒤 직접 health는 stale 0/15m 0/60m 0, bucket none으로 정상화됐고 fixture DB 잔존은 0이었다. 집중 77개, 전체 API 1,979개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입 검사, 복구 12/12+22/22와 HTML parse를 통과했다.

다음 자동 구현 후보는 60분 초과 stale APPLYING이 계속 남을 때 자동 인수 없이 checker acknowledgment와 운영 incident 연결 상태만 기록하는 별도 비식별 확인 원장이다.

### Cycle 123: checker acknowledgment and incident binding ledger

- Plan: 60분 이상 stale APPLYING을 다른 관리자가 인수하거나 자동 변경하지 않고, 원 checker가 확인·incident 연결 사실만 append-only로 기록한다.
- Implement: migration 0074의 전용 원장은 remediation request, checker, 기존 decision, version과 action을 묶는다. `ACKNOWLEDGED`는 incident 값이 없어야 하고 `INCIDENT_LINKED`는 4~128자 printable reference의 SHA-256만 저장한다. Recovery queue는 같은 checker/version의 acknowledged·incident connected boolean과 시각만 보여준다.
- Review: client request replay는 remediation이 이미 종료된 뒤에도 같은 응답을 반환하도록 상태 검사보다 먼저 처리한다. 동일 action에 새 client ID와 같은 incident는 already-recorded, 다른 incident는 conflict다. PostgreSQL `jsonb_build_object`의 version parameter 타입 추론 실패를 실제 fixture에서 발견해 explicit integer cast로 수정했다.
- Revise: 60분 미만, 다른 checker, 다른 decision/version은 쓰기 전에 차단한다. 응답은 checker, decision, incident hash를 숨기고 admin audit도 action/version/reference-bound boolean만 남긴다. Acknowledgment 두 건 뒤 remediation이 APPLYING/version 1로 유지되는지 직접 확인한다.
- Verify: 실제 대시보드 Shipping APV Chaos 153/153에서 초기 미확인, wrong checker 차단, ACK recorded/duplicate, incident recorded/duplicate/already-recorded, 다른 reference conflict, queue 상태 true/true, decision 무변경, 원 decision resume와 cleanup acknowledgment 2를 확인했다. DB의 incident hash는 원문의 SHA-256과 일치했고 audit 2건에는 원문과 hash가 없었다. 집중 78개, 전체 API 1,980개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입 검사, 복구 12/12+22/22와 HTML parse를 통과했다.

다음 자동 구현 후보는 60분 stale 중 acknowledgment 또는 incident 연결이 없는 건수만 aggregate health와 기존 signed APV alert에 연결하는 것이다.

### Cycle 124: unacknowledged and incident-unlinked stale health

- Plan: 60분 이상 stale APPLYING 중 현재 checker의 확인 또는 incident 연결이 없는 건을 식별자 없이 각각 집계하고 기존 서명 경보에 연결한다.
- Implement: remediation health SQL은 현재 remediation의 checker, decision ID, version과 action이 모두 일치하는 acknowledgment가 없는 건만 `unacknowledgedStaleOver60Minutes`, `incidentUnlinkedStaleOver60Minutes`로 계산한다. 두 count는 기존 HMAC APV alert에 별도 critical reason으로 포함되고 대시보드는 확인 전후 `1/1→0/0`을 표시한다.
- Review: 비정상 aggregate 입력에서는 새 handling count만 존재해도 health와 alert가 healthy/warning으로 낮아질 수 있었고, 모바일의 전역 status-pill grid 규칙이 Readiness 사이클 설명을 한 글자 폭으로 압축했다.
- Revise: handling count 자체를 health·alert critical 조건으로 추가했다. 확인 원장이 생겨도 기존 5분·15분·60분 stale reason은 복구 결정이 실제 완료될 때까지 유지되는 테스트를 고정했다. 모바일 grid-column 규칙은 call-item 자식으로 범위를 제한했다.
- Verify: 실제 대시보드 Shipping APV Chaos 155/155에서 61분 정체의 handling `1/1`, ACK·incident 기록 뒤 `0/0`, 기본 stale critical 유지와 원 decision resume 뒤 전체 recovery를 확인했다. 집중 80개, 전체 API 1,982개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 22/22·HTML·diff를 통과했다. Fixture DB의 restoration request/event, remediation request/event, acknowledgment는 모두 0이고 390px 화면은 overflow 0과 정상 문장 폭을 확인했다.

다음 자동 구현 후보는 확인·incident 연결이 기록된 뒤에도 APPLYING이 계속 장기 정체될 때 acknowledgment 자체의 경과 시간을 집계해 재경보하는 것이다.

### Cycle 125: post-acknowledgment stale re-escalation

- Plan: acknowledgment와 incident 연결이 운영 대응의 끝으로 오인되지 않도록, 기록 후에도 APPLYING이 30분 이상 지속되는 건을 다시 집계한다.
- Implement: health SQL은 현재 checker, decision ID, version에 묶인 `ACKNOWLEDGED`와 `INCIDENT_LINKED`의 created_at이 30분 이상 지난 APPLYING을 각각 계산한다. 기존 signed APV alert에 post-ack와 post-incident critical reason을 추가하고 대시보드는 fresh `0/0`에서 31분 경과 `1/1` 전이를 표시한다.
- Review: 재경보가 새 상태나 원장 갱신을 만들면 append-only 증거와 checker 소유권을 훼손할 수 있다. 집계형 입력이 비정상적으로 기본 stale count 없이 들어와도 warning으로 낮아져서는 안 된다.
- Revise: 조회 시점만 주입하는 read-only 집계로 구현하고 acknowledgment row와 remediation은 변경하지 않는다. 두 post-ack count 자체를 health·alert critical 조건에 넣고, 현재 version의 기록만 인정하며 request·decision·checker 식별자를 payload에 포함하지 않는다.
- Verify: 실제 대시보드 Shipping APV Chaos 157/157에서 기록 직후 follow-up `0/0`, 31분 경과 시 `1/1`과 두 재경보 reason, 기본 stale critical 유지, 원 decision resume 뒤 healthy 수렴을 확인했다. 집중 82개, 전체 API 1,984개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 22/22·HTML·diff를 통과했다. Fixture DB 원장 5종은 모두 0이며 390px 요약 폭 274px, overflow 0을 확인했다.

다음 자동 구현 후보는 acknowledgment와 incident 연결의 순서·최대 응답 시간 정책을 health에 추가해, 확인은 했지만 incident 연결이 지연되는 중간 상태를 15분 SLA로 경보하는 것이다.

### Cycle 126: acknowledgment-first incident SLA

- Plan: incident 연결을 acknowledgment 뒤에만 허용하고, ACK 뒤 15분 내 incident가 연결되지 않는 중간 상태를 별도 경보한다.
- Implement: recovery action transaction은 현재 remediation의 checker, decision ID, version에 묶인 ACK가 없으면 `INCIDENT_LINKED`를 `acknowledgment_required`로 거부한다. Health는 ACK created_at이 15분 이상이고 같은 현재 binding의 incident가 없는 APPLYING만 집계하며 기존 signed APV alert에 critical reason을 추가한다.
- Review: ACK prerequisite를 client replay보다 먼저 검사하면 이미 기록된 incident의 terminal-safe idempotency가 상태 변화 뒤 깨질 수 있다. SLA 경보도 과거 version이나 다른 decision의 원장을 현재 대응으로 인정해서는 안 된다.
- Revise: exact client replay는 기존처럼 상태·순서 검사 전에 처리하고 신규 action에만 ACK prerequisite를 적용했다. SLA의 EXISTS/NOT EXISTS 양쪽 모두 checker, decision ID, version을 일치시키고 count 자체를 fail-safe critical 조건에 넣었다.
- Verify: 실제 대시보드 Shipping APV Chaos 160/160에서 ACK 전 incident가 `acknowledgment_required`, ACK 직후 SLA 0, 16분 경과 시 SLA 1과 aggregate critical reason, 이후 incident 기록·동일 decision resume·healthy 수렴을 확인했다. 집중 84개, 전체 API 1,986개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 22/22·HTML·diff를 통과했다. Fixture DB 원장 5종은 0이고 390px 요약 폭 274px, overflow 0이다.

다음 자동 구현 후보는 checker별 recovery queue가 100건을 넘을 때도 누락 없이 bounded 탐색할 수 있도록 정렬이 고정된 opaque cursor pagination을 추가하는 것이다.

### Cycle 127: checker recovery queue cursor pagination

- Plan: 100건 상한 뒤의 stale APPLYING도 같은 checker가 누락 없이 탐색하도록 stable keyset cursor를 추가한다.
- Implement: 첫 페이지의 as-of 시각, 마지막 updated_at과 request UUID를 strict base64url cursor에 넣고 다음 페이지는 동일 as-of의 5분 stale 기준과 `(updated_at, id)` 오름차순 조건을 사용한다. 응답은 기존 truncated와 함께 nextCursor·recordedAt을 반환하며 대시보드 Staging Recovery 버튼은 다음 cursor가 있으면 다음 클릭에서 이어서 조회한다.
- Review: 다음 호출의 현재 시각을 다시 쓰면 페이지마다 stale 기준과 stalled seconds가 달라질 수 있다. Cursor의 추가 필드, 비정상 길이, 잘못된 UUID·시각과 updated_at이 as-of보다 미래인 역전 payload도 DB 전에 차단해야 한다.
- Revise: cursor는 512자, decoded payload 256 bytes, 정확한 `asOf,updatedAt,id` 키와 canonical ISO·UUID를 강제한다. Cursor의 as-of가 input now보다 우선하며 모든 페이지에서 approver 조건을 다시 적용한다. Invalid cursor는 서비스 예외와 route 400으로 fail-closed한다.
- Verify: 실제 대시보드 Shipping APV Chaos 164/164에서 같은 checker의 두 stale row를 `limit=1`로 1건→1건 조회하고 동일 recordedAt, nextCursor 종료, malformed cursor 차단과 synthetic request/event 1/2 즉시 정리를 확인했다. 전용 Staging Recovery 버튼은 종료 뒤 `0 STALE APPLYING`이었다. 집중 90개, 전체 API 1,992개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 22/22·HTML·diff를 통과했다. Fixture DB 원장 5종은 0이고 390px 요약 폭 274px, overflow 0이다.

다음 자동 구현 후보는 recovery cursor가 오래된 snapshot을 무기한 재사용하지 못하도록 bounded freshness를 적용하고, 만료 cursor를 명확한 400으로 재시작시키는 것이다.

### Cycle 128: recovery cursor bounded freshness

- Plan: 오래된 recovery queue snapshot의 무기한 재사용과 서버보다 지나치게 미래인 cursor 시각을 차단하고, 운영자가 만료 오류에 갇히지 않게 첫 페이지로 복구한다.
- Implement: cursor의 `asOf`는 요청 시각 기준 15분까지만 허용하고 30초를 넘는 미래 시각은 invalid로 처리한다. 서비스는 DB 조회 전에 전용 expired 오류를 내고 route는 invalid와 expired를 각각 400으로 반환한다.
- Review: 최초 대시보드 패치에서 cursor 초기화 코드가 무관한 분쟁 이미지 함수에 삽입된 결함을 발견했다. Cursor만 비우고 끝내면 운영자가 버튼을 다시 눌러야 하며, 무제한 자동 재시도는 장애 시 request loop가 될 수 있다.
- Revise: 잘못 삽입된 코드를 제거하고 recovery queue 함수가 expired 응답을 받았을 때 cursor를 지운 뒤 첫 페이지를 정확히 한 번만 다시 요청하도록 수정했다. DOM 통합 테스트로 첫 요청에 cursor가 있고 두 번째 요청에는 없으며 최종 큐가 0건으로 렌더링되는 것을 고정했다.
- Verify: 실제 대시보드 Shipping APV Chaos 165/165에서 16분 된 cursor의 expired 차단, malformed 차단과 1건→1건 pagination을 확인했고 전용 Staging Recovery 버튼은 종료 뒤 `0 STALE APPLYING`이었다. 집중 91개, 전체 API 1,993개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했다. Fixture DB 원장 5종은 0이고 390px 요약 폭 274px, overflow 0이다.

다음 자동 구현 후보는 cursor 만료·재시작 횟수를 식별자 없는 aggregate 운영 지표로 남겨 반복 만료나 비정상 client clock을 관찰 가능하게 만드는 것이다.

### Cycle 129: cursor rejection aggregate observability

- Plan: recovery cursor의 expired·invalid 거부가 반복되는지 확인하되 사용자, checker, cursor payload나 request ID를 저장하지 않는 bounded 지표를 제공한다.
- Implement: migration 0075는 `EXPIRED/INVALID`와 시간 단위 bucket, count, 마지막 관측 시각만 가진 aggregate table을 추가한다. 인증된 admin recovery route에서 서비스 cursor 검증이 실패한 경우 해당 bucket을 upsert하고, 성공 응답에는 최근 24개 시간 bucket의 expired·invalid 합계와 마지막 시각만 포함한다. 대시보드는 Staging Recovery 설명에 두 count를 표시한다.
- Review: 최초 테이블명은 PostgreSQL 63자 식별자 제한으로 암묵적으로 잘렸고, API가 migration보다 먼저 배포되면 관측성 오류가 핵심 recovery queue를 막을 수 있었다. 장기간 누적 count를 JSON number로 그대로 내보내는 것도 정밀도 위험이 있었다.
- Revise: 아직 배포 전 migration과 서비스의 테이블·constraint·index 이름을 명시적으로 짧게 바꾸고 로컬 DB도 같은 이름으로 정렬했다. Metric 읽기 실패는 health를 null로 격리하고 쓰기 실패는 기존 400 contract를 유지하며, 반환 합계는 32-bit 정수 상한으로 제한했다. Route 테스트가 migration 미적용 상태의 queue 200과 invalid cursor 400을 고정한다.
- Verify: 실제 대시보드 Staging Recovery는 `0 STALE APPLYING · cursor rejects 24h 0 expired / 0 invalid`를 표시했고 Shipping APV Chaos는 165/165 PASS였다. 집중 93개, 전체 API 1,995개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했다. Fixture DB 원장 5종과 metric bucket은 0이고 390px 요약 폭 274px, overflow 0이다.

다음 자동 구현 후보는 aggregate metric table의 보존 기간을 bounded maintenance로 제한하고, 삭제 실패가 recovery queue에 영향을 주지 않도록 별도 maintenance 경계를 두는 것이다.

### Cycle 130: cursor metric bounded retention maintenance

- Plan: aggregate cursor metric도 무기한 보존하지 않고 admin이 bounded dry-run·apply로 오래된 시간 bucket만 정리하며, recovery queue 조회와 별도 실패 경계를 유지한다.
- Implement: admin-only strict POST는 보존 기간 7~365일, batch 1~1,000개와 dry-run boolean만 받는다. Dry-run은 oldest-first로 limit+1을 읽어 잔여 여부를 확인하고, apply는 `(bucket_start, reason)` 후보를 `FOR UPDATE SKIP LOCKED`로 잠근 뒤 같은 statement에서 삭제한다. 응답은 eligible/deleted 및 EXPIRED/INVALID bucket 수, cutoff와 truncation만 반환한다. 대시보드에는 실제 30일 정리를 실행하는 Cursor Cleanup 버튼과 결과 요약을 추가했다.
- Review: 서비스가 route 외부에서 호출될 때도 retention·limit을 방어해야 하고, exactly-limit 삭제는 잔여가 없더라도 보수적으로 재실행 신호를 낼 수 있다. 집계 정리가 recovery queue의 성공·실패 경로에 결합되면 안 된다.
- Revise: 서비스 내부에서도 7~365일과 1~1,000 범위를 다시 정규화했다. Apply가 limit에 도달하면 보수적으로 `truncated=true`를 반환하고 다음 bounded 실행이 안전한 no-op으로 수렴하게 했다. Maintenance는 별도 POST와 별도 대시보드 버튼에만 연결했다.
- Verify: 실제 로컬 DB에 식별자 없는 40일 전 EXPIRED 1개·INVALID 1개 bucket을 넣고 대시보드 Cursor Cleanup을 실행해 `2 CURSOR BUCKETS DELETED`, expired 1/invalid 1, complete를 확인한 뒤 DB 0을 재확인했다. Shipping APV Chaos 165/165, 집중 96개, 전체 API 1,998개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했고 390px 요약 폭 274px, overflow 0이다.

다음 자동 구현 후보는 수동 정리 API를 재사용하는 opt-in 일일 maintenance job과 startup 설정 검증을 추가해 운영자 클릭 없이 보존 정책을 지속 적용하는 것이다.

### Cycle 131: opt-in daily cursor retention job

- Plan: Cycle 130의 bounded apply 서비스를 운영자 클릭 없이 실행하되 명시적으로 opt-in하고, cron·보존일·batch 설정 오류는 startup에서 차단한다.
- Implement: 새 job은 30일·1,000 bucket 기본값을 사용해 apply maintenance를 호출하며 job registry에 24시간 간격으로 등록한다. 활성화에는 `ENABLE_CRON=true`가 필요하고 retention 7~365일, limit 1~1,000을 runtime config가 fail-fast한다. 두 env example에 안전한 비활성 기본값을 추가했다. Recovery queue와 Cursor Cleanup 응답은 enabled/configured/interval/retention/limit만 반환하고 대시보드가 현재 상태를 표시한다.
- Review: 최초 구현이 24시간 `setInterval`만 사용하면 API 인스턴스가 그보다 자주 재시작되는 환경에서 job이 영원히 실행되지 않을 수 있었다. Status가 설정을 보여주는 것만으로 실제 첫 실행을 증명하지도 못했다.
- Revise: 공용 runner에 optional `runOnStart`를 추가하고 cursor retention job에만 활성화했다. 기존 overlap guard와 고정 오류 격리를 startup 실행에도 재사용하며, 테스트가 cron 초기화 직후 maintenance가 정확히 한 번 호출되는 것을 검증한다.
- Verify: 실제 로컬 DB에 40일 전 EXPIRED/INVALID bucket 2개를 넣고 job wrapper를 실행해 `completed`, deleted 2, expired 1/invalid 1, remaining 0을 확인했다. 대시보드는 현재 로컬 설정을 `retention job disabled / cron off · 30d / 1000`으로 표시했고 Shipping APV Chaos 165/165 PASS였다. 집중 130개, 전체 API 2,005개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했으며 fixture DB 원장과 metric bucket은 0, 390px overflow 0이다.

다음 자동 구현 후보는 config 상태뿐 아니라 마지막 job 시작·성공·실패 시각과 aggregate 삭제 수를 식별자 없이 보존해, scheduler가 실제로 실행 중인지 대시보드에서 판별하게 만드는 것이다.

### Cycle 132: cursor retention singleton lease and execution health

- Plan: 여러 API 인스턴스가 startup job을 동시에 실행해 같은 보존 작업을 중복 수행하지 않게 하고, 설정값이 아니라 실제 마지막 실행 결과를 운영 화면에서 확인한다.
- Implement: migration 0076의 singleton state는 15분 DB lease와 내부 claim ID, 마지막 시작·성공·실패 시각, 삭제·EXPIRED·INVALID bucket 수, truncation과 고정 실패 code만 저장한다. Job은 atomic upsert로 live owner가 없을 때만 claim하고 claim ID가 일치할 때만 성공·실패를 확정한다. Admin recovery 응답과 대시보드는 claim·lease 값 없이 aggregate health만 제공한다.
- Review: 공용 runner의 프로세스 내부 overlap guard만으로는 여러 인스턴스의 동시 startup을 막지 못했다. 최초 구현은 성공·실패 시각에도 claim 시작 시각을 재사용해 실제 완료 시각을 왜곡했고, 기존 route 테스트의 exact response 계약은 새 health 필드 때문에 실패했다.
- Revise: DB singleton lease와 claim fencing을 추가하고 완료·실패 시각을 실행 시작 시각과 분리했다. Route 테스트는 공개 health shape를 포함하되 내부 claim ID와 lease expiry가 응답에 없음을 검증한다. Job 테스트는 live lease skip, failure 기록, stale health와 startup 실행을 고정한다.
- Verify: 실제 PostgreSQL에서 40일 전 EXPIRED/INVALID bucket 2개와 live lease를 만들었을 때 두 번째 실행은 `in_progress`로 중단되고 bucket 2개가 유지됐다. Lease를 만료시킨 뒤 takeover 실행은 두 bucket을 삭제하고 `SUCCEEDED`, deleted 2, expired 1, invalid 1과 시작보다 2초 뒤 성공 시각을 기록했으며 claim과 lease는 null로 수렴했다. 대시보드는 `last SUCCEEDED · deleted 2`를 실제 API로 표시했다. Shipping APV Chaos 165/165, 집중 123개, 전체 API 2,008개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했다. Metric·remediation fixture 원장은 0, singleton state는 1이고 390px 카드 폭 274/274px, overflow 0이다.

다음 자동 구현 후보는 job이 활성화된 환경에서 `FAILED`, `STALE_RUNNING`, 장시간 성공 이력 부재를 기존 서명된 APV 운영 경보에 식별자 없는 reason으로 연결하는 것이다.

### Cycle 133: cursor retention signed operational alert

- Plan: 활성화된 cursor retention scheduler가 실패하거나 멈추고 일일 성공이 지연될 때 운영자가 대시보드를 계속 보고 있지 않아도 기존 APV 경보 채널로 알린다.
- Implement: 서버 공용 판정은 활성 job의 `FAILED`와 `STALE_RUNNING`을 critical, 마지막 성공이 24시간 주기와 2시간 grace를 넘긴 `SUCCEEDED`를 warning으로 분류한다. APV alert job은 retention health를 조회해 기존 HMAC payload, cooldown event ID, PostgreSQL claim fencing과 recovery lifecycle에 포함한다. Admin recovery 응답도 같은 판정 결과를 반환하고 대시보드는 `alert healthy/warning/critical`과 allowlisted reason을 표시한다.
- Review: migration 직후 APV alert job이 retention startup job보다 먼저 돌면 `NEVER`를 장애로 오인할 수 있다. 별도 alert sender를 만들면 기존 서명·중복 억제·recovery 경계를 복제하게 된다. Route의 비밀 누출 테스트는 공개 allowlist 배열 이름 `reasons`까지 광범위한 `/reason/` 정규식으로 거부했다.
- Revise: disabled, cron-off와 `NEVER`는 경보하지 않고 실패·stale lease·26시간 성공 지연처럼 근거가 있는 상태만 경보한다. 새 sender 대신 기존 APV sender를 재사용하고 payload에는 공개 aggregate health만 넣는다. 비밀 누출 검사는 requester/운영 사유/claim/lease의 정확한 필드명으로 좁혔다.
- Verify: 실제 PostgreSQL singleton을 일시적으로 FAILED로 전환하자 기존 APV job이 `invoice_restoration_cursor_retention_failed` critical firing을 HMAC 서명해 202 전달했고, SUCCEEDED 복원 뒤 recovery를 정확히 한 번 전달했다. 두 payload 모두 claim/lease를 포함하지 않았고 생성 claim은 0으로 정리됐으며 원 singleton은 SUCCEEDED, deleted 2로 복원됐다. 대시보드는 `last SUCCEEDED · deleted 2 · alert healthy`, Shipping APV Chaos 165/165를 표시했다. 집중 83개, 전체 API 2,010개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했다. Metric·remediation·alert claim fixture는 0, singleton은 1이고 390px 카드 폭 274/274px, overflow 0이다.

다음 자동 구현 후보는 `NEVER`를 영구 무경보로 두지 않으면서도 배포 직후 startup 순서 오탐을 막도록 DB에 최초 관측 시각을 두고 26시간 grace 뒤 warning으로 승격하는 것이다.

### Cycle 134: persisted NEVER observation and grace alert

- Plan: retention scheduler가 한 번도 실행되지 않은 상태를 영구 무경보로 남기지 않되 배포 직후 APV alert와 retention startup 실행 순서 차이는 장애로 오인하지 않는다.
- Implement: migration 0077은 singleton status에 `NEVER`, `first_observed_at`과 nullable `last_started_at`을 추가하고 행이 없을 때만 NEVER를 삽입한다. NEVER는 시작·성공·실패·failure code·claim·lease가 모두 없어야 한다. 활성 job의 first observation이 26시간을 넘긴 경우만 `invoice_restoration_cursor_retention_never_started` warning을 만들고 실제 첫 실행 성공 뒤 기존 recovery lifecycle로 수렴한다. 대시보드는 최초 관측 시각을 표시한다.
- Review: 단순히 모든 NEVER를 warning으로 만들면 migration과 startup job 사이의 짧은 순서 차이도 경보가 된다. 최초 schema 수정만으로는 NEVER 행에 과거 성공 시각이 남는 모순 상태도 DB가 허용했다.
- Revise: 일일 주기 24시간에 2시간 grace를 더한 경계 뒤에만 경보하고, 별도 DB constraint로 NEVER의 시작·성공·실패·failure code와 lease 필드를 모두 비우도록 강제했다. 기존 SUCCEEDED/FAILED/RUNNING 행의 실행 이력은 migration에서 변경하지 않는다.
- Verify: 실제 PostgreSQL singleton을 first observation 27시간 전 NEVER로 만들자 warning firing이 유효한 HMAC으로 한 번 전달됐다. 실제 retention job은 삭제할 bucket이 없는 healthy no-op이었지만 상태를 SUCCEEDED로 완료했고 이어 recovery가 한 번 전달됐다. 두 payload의 first observation은 같고 claim/lease는 없었다. Fixture claim은 0으로 정리되고 원 singleton은 SUCCEEDED, deleted 2로 복원됐다. 대시보드는 observed 시각과 alert healthy, Shipping APV Chaos 165/165를 표시했다. 집중 84개, 전체 API 2,011개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26·HTML·diff를 통과했다. Metric·remediation·alert claim fixture는 0, singleton은 1이고 390px 카드 폭 274/274px, overflow 0이다.

다음 자동 구현 후보는 NEVER/FAILED/recovery 경보 fixture를 기존 `Run APV + Review`에 안전한 non-production 단계로 포함해 운영자가 대시보드 한 번으로 signed alert lifecycle을 재검증하게 만드는 것이다.

### Cycle 135: dashboard retention signed-alert lifecycle fixture

- Plan: 운영자가 기존 `Run APV + Review` 한 번으로 26시간 grace를 넘긴 NEVER 경고, 첫 보존 실행, 복구 경보를 재현하되 운영 scheduler와 원 singleton 상태를 훼손하지 않게 한다.
- Implement: 비운영 전용 fixture가 5분 DB 실행 lease와 heartbeat를 얻고, 실제 보존 job과 cron이 비활성인 경우에만 singleton을 27시간 NEVER로 잠시 전환한다. 고유 allowlisted alert source로 기존 APV HMAC sender와 PostgreSQL claim lifecycle을 호출하고 실제 retention job을 실행한 뒤 recovery를 전송한다. 마지막에는 singleton 전 필드 복원, fixture claim 삭제·잔존 0 확인과 lease 해제를 수행한다. 대시보드에는 `Retention Alert Fixture` 카드로 경고→복구, 서명, claim 정리, 상태 복원과 lease 해제를 표시한다.
- Review: 최초 정리 블록은 상태 복원이나 claim 삭제가 실패하면 heartbeat 중지와 lease 해제를 건너뛸 수 있었다. 최초 서명 검증은 형식만 확인했고, 실제 대시보드 첫 실행에서 signer가 timestamp와 body를 함께 서명하는 계약을 수신 검증이 반영하지 않아 173/174로 실패했다. 내부 경보 작업의 production guard도 `NODE_ENV`만 보면 `VERCEL_ENV=production`을 놓칠 수 있었다.
- Revise: 복원, claim 삭제·잔존 조회, heartbeat 중지와 lease 해제를 독립된 cleanup 단계로 만들어 앞 단계 실패에도 잠금 해제를 시도하고 외부에는 고정 cleanup 오류만 낸다. 수신 fixture는 기존 signer 함수로 timestamp와 원문 body의 정확한 HMAC을 다시 계산한다. 내부·외부 fixture 방어선 모두 공용 `isProductionRuntime()`을 사용해 NODE_ENV와 Vercel production을 fail-closed한다.
- Verify: 실제 대시보드 재실행은 Shipping APV Chaos 174/174 PASS, `WARNING → RECOVERY`, HMAC 2/2, completed claim 2→remaining 0, retention healthy no-op→SUCCEEDED, singleton 전 필드 restored와 lease released를 표시했다. DB는 metric bucket 0, remediation 0, fixture alert claim 0, fixture lease 0, singleton SUCCEEDED·claim 0이다. 집중 136개, 전체 API 2,013개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입 검사, 복구 12/12·DOM 26/26과 HTML 파싱을 통과했다. 390px에서 Cycle 요약 298/298px, 새 배송 카드 268/268px와 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 fixture 중간 실패를 주입해 singleton 복원·claim 삭제 중 오류가 나도 heartbeat와 DB lease가 해제되는지 단위·대시보드에서 명시적으로 증명하는 것이다.

### Cycle 136: fixture cleanup failure isolation

- Plan: 실제 singleton을 복구 불능 상태로 만들지 않고 Cycle 135의 동일 cleanup 경로에 실패를 주입해 앞 단계 오류가 뒤의 보안 정리를 중단하지 않는지 검증한다.
- Implement: 공용 cleanup coordinator가 상태 복원, fixture claim 삭제·잔존 조회, heartbeat 중지, lease 해제를 독립된 단계로 실행한다. 같은 coordinator에 복원 예외, claim 정리 예외와 release false를 주입하는 비운영 검증을 APV checks에 포함하고 새 단위 테스트와 대시보드 카드에 `cleanup isolation 4/4`를 표시한다.
- Review: release callback이 `false`를 반환하면 바깥 fixture는 전용 lease 오류로 실패했지만 coordinator의 `cleanupFailed` 자체는 false일 수 있었다. 이는 성공 위장은 아니지만 단계별 진단 계약이 일관되지 않았다.
- Revise: release가 예외를 던지는 경우뿐 아니라 false를 반환하는 경우도 coordinator에서 cleanup failure로 기록한다. 실패 주입 검사는 복원 실패 뒤 claim·release 호출, claim 실패 뒤 release 호출과 release false의 비은폐를 모두 요구하며 주입한 원문 오류는 결과에 포함하지 않는다.
- Verify: 실제 대시보드 `Run APV + Review`는 178/178 PASS, `WARNING → RECOVERY`, HMAC 2/2, claim 2→0, singleton 전 필드 restored, lease released와 cleanup isolation 4/4를 표시했다. 집중 137개와 전체 API 2,014개, dispute-core 152개, shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26을 통과했다. DB metric/remediation/fixture claim/fixture lease는 0이고 singleton은 SUCCEEDED·claim 0이다. 실제 APV 결과가 채워진 390px 화면도 Cycle 요약 298/298px, 카드 268/268px와 문서 overflow 0이다.

다음 자동 구현 후보는 fixture가 실행 불가능한 production, active cron, busy singleton과 global lease 충돌 사유를 mutation 없이 사전 점검해 대시보드에서 실행 전에 명확히 표시하는 것이다.

### Cycle 137: mutation-free APV fixture preflight

- Plan: 무거운 APV fixture가 실행 불가능한 환경을 상태 변경 전에 판별하고, 운영자가 generic 500 대신 정확한 allowlisted 차단 사유를 대시보드에서 확인한다.
- Implement: admin-only GET preflight는 production 여부와 retention scheduler 설정을 평가하고 singleton status와 활성 global fixture lease를 정확히 두 SELECT로 읽는다. 응답은 5개 boolean check, READY/BLOCKED, allowlisted reason, scheduler boolean, singleton aggregate status와 lease available boolean만 제공한다. 실제 retention alert fixture도 같은 preflight를 통과한 뒤에만 원자적 lease를 획득한다. 대시보드 `Run APV + Review`는 GET이 READY일 때만 POST하고 `APV Health`도 preflight를 갱신하며 별도 카드를 표시한다.
- Review: 최초 preflight가 실제 lease key 문자열을 중복해 공용 key 변경 시 검사와 획득이 어긋날 수 있었고, singleton missing을 idle=true로 표시했다. 대시보드 차단을 일반 FAIL로 표시하면 실행된 테스트 실패로 오해할 수 있었다. 공용 API test setup이 SQL tag를 빈 문자열로 대체해 무변경성 검사도 처음에는 실제 statement를 검증하지 못했다.
- Revise: 공용 `SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY`를 재사용하고 missing이면 present와 idle을 모두 false로 만든다. 차단 UI는 `BLOCKED`, `POST not sent`, retention `NOT STARTED`로 분리한다. Readiness 서비스 테스트만 실제 `@haggle/db` SQL builder를 사용해 생성된 두 statement가 SELECT로 시작하고 mutation verb가 없음을 컴파일 결과로 고정했다. GET 응답과 dashboard fetch는 `no-store`를 강제하고 preflight 뒤 경쟁은 기존 atomic lease 획득이 최종 차단한다.
- Verify: 실제 대시보드는 정상 상태에서 GET readiness 200을 POST chaos 200보다 먼저 기록하고 READY 5/5 뒤 APV 183/183 PASS를 표시했다. APV Health는 기존 health GET 뒤 readiness GET을 호출했다. 5분 live test lease를 넣은 실제 차단 검증은 BLOCKED 4/5 `fixture_lease_active`, POST count 0→0, NOT STARTED를 표시했고 정확한 token cleanup은 deleted 1, remaining 0이었다. 집중 142개, 전체 API 2,019개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26을 통과했다. 390px에서 Cycle 요약 298/298px, 실제 READY 카드 268/268px와 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 readiness 결과가 빠르게 바뀌는 상황에서 operator가 최신 상태를 구분하도록 짧은 TTL과 상태 fingerprint를 제공하되 내부 시각·식별자를 노출하지 않고, POST 응답에도 실제 획득 시점 readiness를 남기는 것이다.

### Cycle 138: readiness state fingerprint and execution recheck evidence

- Plan: GET에서 본 READY와 실제 POST 직전 서버 재점검 상태를 운영자가 구분하되, 진단 지문을 권한이나 동시성 보장으로 오용하지 않는다.
- Implement: readiness v1의 SHA-256 지문은 production boolean, scheduler boolean, singleton aggregate status와 fixture lease available만 정규 순서로 해시한다. 응답은 schema version, 5초 진단 TTL, 관찰 시각과 지문을 제공한다. 실제 fixture 결과에 이미 포함되는 서버 재점검 preflight를 대시보드가 직전 GET 지문과 비교해 `same state` 또는 `state changed`로 표시한다.
- Review: 지문에 관찰 시각을 넣으면 같은 상태도 매번 달라지고, TTL을 권한 유효기간처럼 보이면 원자적 lease를 대체한다고 오해할 수 있다. 또한 local scheduler 비활성 확인만으로 다른 API 인스턴스의 retention job과 singleton 경쟁까지 제거되지는 않는다.
- Revise: 지문 입력에서 모든 시각과 claim·owner·token·expiry를 제외하고 같은 공개 상태에서 결정적으로 동일함과 RUNNING 전환 시 변경됨을 테스트한다. API와 fetch의 `no-store`, UI의 명시적 `TTL 5s`를 적용하되 POST는 항상 서버에서 다시 preflight하고 기존 atomic fixture lease를 최종 차단으로 유지한다. 다중 인스턴스 retention job 조정은 다음 DB 원자성 사이클로 승격한다.
- Verify: 실제 대시보드 `Run APV + Review`는 GET→POST 뒤 READY 5/5, `same state d9bc110c5b96`, `TTL 5s`, APV 183/183 PASS와 warning→recovery를 표시했다. 집중 143개, 전체 API 2,020개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26, HTML·diff를 통과했다. 390px에서 Cycle 요약 274/298px, 실제 readiness 카드 268/270px와 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 fixture global lease 획득과 retention singleton claim을 DB에서 공통 조건으로 조정해, 다른 API 인스턴스의 retention job이 preflight와 fixture mutation 사이에 진입할 수 없도록 하는 것이다.

### Cycle 139: cross-instance retention job and fixture coordination

- Plan: local scheduler가 비활성이어도 다른 API 인스턴스의 retention job이 실행될 수 있으므로, preflight와 fixture 상태 변경 사이 경쟁을 DB에서 제거한다.
- Implement: fixture는 한 transaction에서 global fixture lease를 획득하고 singleton row를 `FOR UPDATE`로 잠근 뒤 고유 claim으로 RUNNING 예약한다. Busy·missing이면 transaction 전체가 rollback된다. 일반 retention claim의 singleton INSERT SELECT와 ON CONFLICT UPDATE 양쪽은 활성 fixture lease가 있으면 실행되지 않는다. Fixture 내부 실제 job 호출만 일치하는 live lease ID를 제공해 통과한다. 예약 상태를 NEVER로 바꿀 때도 claim ID 일치를 강제한다.
- Review: job claim에 `NOT EXISTS fixture lease`만 추가하면 job statement가 fixture lease commit 전에 snapshot을 잡고 singleton update를 기다리는 순서에서 오래된 판단으로 진입할 가능성이 남았다. Fixture의 기존 SELECT 뒤 unconditional UPDATE도 동시 RUNNING을 덮어쓸 수 있었다.
- Revise: global lease insert와 singleton row lock·RUNNING 예약을 동일 transaction으로 묶어 commit 순서와 무관하게 먼저 온 실행만 상태 변경권을 갖게 했다. Fixture가 NEVER를 만든 직후 일반 peer job을 실제 호출해 maintenance 전에 차단되는지 확인하고, 동일 fixture owner 호출만 실행해 SUCCEEDED로 수렴시킨다. SQL 컴파일 테스트는 INSERT와 conflict UPDATE gate 두 곳, null 일반 호출과 정확한 owner lease binding을 고정한다.
- Verify: 실제 PostgreSQL dashboard `Run APV + Review`는 APV 184/184 PASS, `peer job blocked`, warning→recovery, claim 2→0, singleton restored와 lease released를 표시했다. 집중 145개, 전체 API 2,022개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26, HTML·diff를 통과했다. 390px에서 Cycle 요약 274/298px, 실제 retention 카드 268/270px와 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 fixture transaction 예약이 busy/missing 또는 lease collision으로 rollback될 때 global lease와 singleton이 실제로 원상태를 유지하는 실패 경로를 별도 실제 DB self-test로 고정하는 것이다.

### Cycle 140: reservation failure rollback self-test

- Plan: 정상 경쟁 차단뿐 아니라 singleton busy·missing과 lease collision 실패에서 transaction이 부분 상태를 남기지 않는지 실제 PostgreSQL로 증명한다.
- Implement: 실행마다 고유 verification lease key를 만들고 production reservation core를 그대로 호출한다. Busy와 missing은 각각 외부에 commit되지 않는 transaction 안에서만 singleton을 RUNNING으로 바꾸거나 삭제한다. 예상 오류가 transaction 전체를 rollback한 뒤 `row_to_json` singleton snapshot과 verification lease count를 baseline과 비교한다. Collision은 기존 verification owner를 먼저 만들고 경쟁 reservation이 차단된 뒤 owner·singleton 보존을 확인한다.
- Review: 최초 finally가 blocker의 exact lease ID만 삭제해 예상하지 못한 중간 실패가 다른 verification lease를 남길 가능성이 있었다. Dashboard가 차단·요청 실패 뒤 이전 rollback PASS를 계속 표시할 가능성도 있었다.
- Revise: UUID-suffixed verification key는 실행 전용이므로 finally에서 해당 key 전체를 제거하고 잔존 0을 다시 조회한다. Preflight blocked는 `NOT STARTED`, 요청 실패는 `-`로 rollback 카드를 초기화한다. 응답에는 10개 boolean과 잔존 개수만 포함하고 key·UUID·원본 DB 오류는 제외한다.
- Verify: standalone 실제 PostgreSQL은 busy 3/3, missing 3/3, collision 4/4와 verification lease 0을 반환했다. 실제 dashboard는 Shipping APV Chaos 194/194 PASS, Reservation Rollback PASS, `busy 3/3 · missing 3/3 · collision 4/4 · leases 0`을 표시했다. 집중 145개, 전체 API 2,022개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26, HTML·diff를 통과했다. 390px에서 Cycle 요약 274/298px, 실제 rollback 카드 268/270px와 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 rollback self-test 자체가 중간 DB 오류를 만났을 때 원 singleton을 변경하지 않고 고정 오류로 fail-closed하며, dashboard call log에도 단계만 남기고 원문을 숨기는 실패 주입 검증이다.

### Cycle 141: rollback verifier failure isolation and redaction

- Plan: rollback self-test의 case 실행, cleanup DELETE 또는 잔존 조회 자체가 실패해도 cleanup을 끝까지 시도하고 성공으로 오판하거나 원본 오류를 노출하지 않는다.
- Implement: production verifier와 실패 주입 검증이 같은 execution+cleanup envelope를 사용한다. Case 오류는 cleanup으로 진행하고, cleanup DELETE 오류 뒤에도 잔존 조회를 시도한다. 잔존 조회 오류는 `-1`로 남아 0으로 간주되지 않는다. Envelope는 case·delete·read 중 하나라도 실패하면 pass false이며 production 서비스는 고정 오류 하나로 fail-closed한다.
- Review: 정상 rollback 10/10만 dashboard PASS 조건으로 사용하면 failure-isolation 6개 회귀를 숨길 수 있었다. Cleanup 오류 원문을 evidence에 보존하면 테스트 응답을 통해 내부 DB 정보가 새어 나갈 수 있었다.
- Revise: injected error 객체와 message는 모두 버리고 boolean·bounded count만 유지한다. Reservation Rollback 카드는 rollback과 failure isolation이 모두 pass일 때만 PASS이며 `fault x/6`을 별도 표시한다. Preflight 차단과 요청 실패의 stale PASS 초기화는 유지한다.
- Verify: standalone 실제 PostgreSQL은 rollback 10/10, 오류 주입은 cleanup-after-case, delete-failure read, read-failure fail-closed와 redaction을 포함해 6/6이었다. 실제 dashboard는 Shipping APV Chaos 200/200 PASS와 `busy 3/3 · missing 3/3 · collision 4/4 · fault 6/6 · leases 0`을 표시했다. 집중 146개, 전체 API 2,023개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 26/26, HTML·diff를 통과했다. 390px에서 Cycle 요약 274/298px, 실제 rollback 카드 268/270px와 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 rollback verifier 실패를 실제 admin route에서 redacted 500과 bounded failure stage로 반환하고 dashboard가 FAIL과 NOT STARTED를 구분하는 route-level 계약을 고정하는 것이다.

### Cycle 142: bounded APV route failure contract

- Plan: rollback verifier 실패가 Fastify 기본 오류 응답이나 브라우저 로그를 통해 내부 DB 오류를 노출하지 않게 하고, 운영자가 실패 위치와 미실행 단계를 구분할 수 있게 한다.
- Implement: APV chaos admin route는 성공·실패 모두 `no-store`이며 전체 fixture 호출을 catch한다. 알려진 rollback verifier 오류 2개는 `rollback_verification`과 `rollback_failure_isolation`, 나머지는 `fixture_execution`으로 축약하고 응답 code는 `SHIPMENT_APV_CHAOS_FAILED` 하나만 사용한다. Dashboard는 중첩된 `result.error`만 읽고 세 stage를 다시 allowlist해 APV·Reservation Rollback·Retention Alert 카드와 call log를 갱신한다.
- Review: 기존 route는 service 예외를 Fastify 기본 처리에 맡겨 원본 message 노출 가능성이 있었고, dashboard는 top-level error만 읽어 500이 어느 단계인지 표현하지 못했다. 실패 재현을 위해 운영 route에 query나 test-only switch를 넣으면 실제 HTTP 공격 표면이 늘어난다.
- Revise: route 테스트가 알려진 두 오류와 secret·password·내부 host·table을 포함한 예상 밖 오류를 직접 주입해 정확한 bounded body와 원문 부재를 고정한다. Dashboard DOM 테스트는 실제 버튼 함수의 readiness GET 뒤 bounded APV POST 500을 실행하고 `FAIL`, redacted fail-closed, rollback 단계의 `NOT STARTED`, code+stage 로그를 검증한다. 런타임 실패 backdoor는 추가하지 않았다.
- Verify: 실제 dashboard 정상 회귀는 readiness GET 200 뒤 APV POST 200, 200/200 PASS, rollback busy 3/3·missing 3/3·collision 4/4·fault 6/6·leases 0, warning→recovery였다. Route 48개와 집중 148개, 전체 API 2,025개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 codec 12/12·dashboard DOM 실패 흐름 36/36, HTML·diff를 통과했다. 실제 DB는 fixture lease 0, fixture claim 0, cursor metric 0이며 singleton은 SUCCEEDED·claim/lease null이다. 390px 모바일에서 Cycle 카드 전체가 카드 안에 줄바꿈되고 가로 잘림이 없음을 직접 확인했다.

다음 자동 구현 후보는 실패 원문을 저장하지 않으면서 여러 500을 서버 로그와 운영 관측에서 묶을 수 있는 비가역·단기 진단 correlation ID와 bounded stage별 카운터를 설계하는 것이다.

### Cycle 143: opaque APV failure correlation ID

- Plan: route가 원본 오류를 숨긴 뒤에도 운영자가 dashboard의 500을 정확한 서버 로그 사건과 연결하되, correlation 값에 사용자·요청·DB 정보를 넣지 않는다.
- Implement: 각 APV 실패마다 cryptographic UUID v4를 만들고 `result.error.failure_id`와 `X-Haggle-Failure-Id` 응답 헤더에 같은 값을 넣는다. 서버 logger에는 고정 event, failure ID, allowlisted stage만 기록하고 예외 객체나 message는 전달하지 않는다. Dashboard는 strict UUID v4 함수 하나로 카드와 call log 값을 정규화하며 전체 ID를 보여준다.
- Review: 최초 dashboard call log 검사는 카드보다 느슨한 36자 hex/hyphen 패턴이어서 비정상 형식도 통과할 수 있었다. 서버 로그의 실제 인자를 검사하지 않으면 나중에 원본 `error`가 추가돼도 route body 테스트가 놓친다. 네트워크 catch는 APV route redaction 밖에서 원본 브라우저 error message와 URL을 response/log에 남기고 있었다.
- Revise: 공용 strict UUID v4 정규화 함수를 카드와 call log가 함께 쓰게 했다. Fastify request logger를 테스트에서 캡처해 event·ID·stage만 기록되고 secret/password/내부 host/table이 없는지 고정했다. APV 네트워크 실패는 `REQUEST_FAILED`, generic stage, `failure unavailable`만 표시하며 원문 message와 URL을 버린다. 실제 실패를 유도하는 runtime backdoor는 추가하지 않았다.
- Verify: 연속 route 실패는 서로 다른 UUID를 만들고 body/header가 각각 일치했으며 route 48/48, DOM의 server 500·network exception 흐름 41/41을 통과했다. 실제 dashboard 정상 회귀는 readiness GET 200 뒤 APV POST 200, 200/200 PASS, rollback busy 3/3·missing 3/3·collision 4/4·fault 6/6·leases 0, warning→recovery였다. 집중 148개, 전체 API 2,025개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·HTML·diff를 통과했다. 실제 DB는 fixture lease·claim·cursor metric 0, singleton SUCCEEDED·claim/lease null이다. 390px 모바일에서도 Cycle 카드 전체가 경계 안에 표시되고 가로 잘림이 없다.

다음 자동 구현 후보는 개별 failure ID를 영구 저장하지 않고도 stage별 실패 증가를 탐지할 수 있는 낮은 cardinality의 bounded 운영 계측과 대시보드 health를 설계하는 것이다.

### Cycle 144: bounded APV failure stage metrics

- Plan: 다중 API 서버에서 APV fixture 실패 증가를 공통으로 보되 failure ID·사용자·request·원본 오류를 영구 저장하지 않고, 계측 장애가 원래 실패 응답을 가리지 않게 한다.
- Implement: migration 0078은 시간 bucket과 세 allowlisted stage를 복합 PK로 하고 count·마지막 실패 시각만 저장한다. Record는 원자 upsert로 32-bit count를 상한 처리하고 새 실패 때 30일 이전 bucket을 정리한다. Admin/test-only no-store GET은 최근 24시간의 고정 세 stage count, total, latest timestamp와 30일 보존만 반환한다. APV route의 metric write는 best-effort이며 server bounded log에는 `metric_recorded` boolean만 추가한다.
- Review: metric DB 오류를 fixture 오류보다 우선하면 원래 500 계약을 잃고, 개별 failure ID를 저장하면 불필요한 high-cardinality 추적 원장이 된다. Dashboard health 조회 실패가 이전 `HEALTHY`를 남기면 운영자가 stale 결과를 현재로 오인한다. UI가 API 숫자와 status를 그대로 쓰면 비정상 응답이 긴 text나 NaN 상태를 만들 수 있다.
- Revise: metric 예외를 별도 catch하고 원본 오류를 버리며 route body/header는 그대로 유지한다. DB schema에는 ID·사용자·request·error/payload 컬럼이 없다. Health는 unknown stage를 무시하고 service write는 unknown stage를 DB 전 차단한다. Dashboard count는 32-bit 정수로, status는 healthy/attention으로 제한하며 health HTTP/network 오류는 `UNAVAILABLE · previous value cleared`로 명시한다.
- Verify: 실제 PostgreSQL에 격리된 isolation stage를 1회 기록해 stage 1·total 1·identifier field 0을 확인하고 finally 삭제 후 rows 0으로 수렴했다. 실제 dashboard `APV Health`는 HEALTHY/0과 0/0/0, 30d를 읽었고 정상 APV 뒤에도 200/200 PASS와 failure 0을 유지했다. Route 50개·metric service 3개, 집중 153개, 전체 API 2,030개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 48/48·HTML·journal·diff를 통과했다. DB failure metric·fixture lease·claim·cursor metric은 0, singleton은 SUCCEEDED·claim/lease null이다. 390px에서 Cycle 요약과 실제 HEALTHY/0 카드가 모두 경계 안에 표시되고 가로 잘림이 없었다.

다음 자동 구현 후보는 최근 24시간 count가 단순히 1 이상인 것과 반복 장애를 구분하도록 stage별 warning/critical threshold를 bounded policy로 정의하고, 실제 자금 경보와 섞이지 않는 test-tool 전용 상태를 제공하는 것이다.

### Cycle 145: fixed APV failure severity policy

- Plan: 단발성 fixture execution과 rollback 보호장치의 반복 실패를 동일한 attention으로 취급하지 않고 운영 우선순위를 구분하되, 환경 설정 차이로 인스턴스마다 기준이 달라지지 않게 한다.
- Implement: policy v1은 rollback verification과 failure isolation을 1건 warning·3건 critical, 일반 fixture execution을 3건 warning·10건 critical로 고정한다. Critical reason이 warning보다 우선하고 응답은 version, 고정 threshold와 allowlisted stage/severity reason만 포함한다. Dashboard는 healthy/warning/critical과 알려진 reason만 표시한다.
- Review: total이 1 이상이라는 이유만으로 모두 attention이면 실제 cleanup 보호장치 회귀와 일시적인 fixture 실행 오류의 긴급도를 구분할 수 없다. 반대로 env threshold는 다중 서버 결과를 비결정적으로 만든다. Policy가 version 없이 바뀌면 과거 dashboard 기록의 의미도 모호해진다.
- Revise: threshold를 소스 상수로 고정하고 `shipment-apv-chaos-failure-policy-v1`을 응답에 포함했다. UI는 version을 다시 allowlist해 v1 또는 unknown으로만 표시하고 reason도 6개 고정 값 외에는 버린다. 이 severity는 payment·dispute·production 경보와 연결하지 않은 test-tool 전용 상태다.
- Verify: 실제 PostgreSQL rollback verification count 1은 dashboard `WARNING / 1 · policy v1 rollback_verification_warning`, count 3은 `CRITICAL / 3 · rollback_verification_critical`이었고 exact cleanup 뒤 `HEALTHY / 0 · policy v1 clear`로 수렴했다. Metric service 4개·route 50개, 집중 154개, 전체 API 2,031개·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 48/48·HTML·journal·diff를 통과했다. 최종 DB failure metric·fixture lease·claim·cursor metric은 0, singleton은 SUCCEEDED·claim/lease null이다. 390px에서 Cycle 요약 전체가 카드 안에 표시되고 가로 잘림이 없었다.

다음 자동 구현 후보는 warning/critical이 언제 처음 관찰됐고 현재 회복됐는지 개별 failure ID 없이 bounded lifecycle로 구분하되, 실제 외부 경보 전송은 추가하지 않는 것이다.

### Cycle 146: identifier-free APV failure lifecycle

- Plan: stage별 warning·critical 최초 관측과 최근 24시간 정상화 여부를 개별 failure ID나 외부 경보 없이 보여주고, health GET은 상태를 변경하지 않게 한다.
- Implement: migration 0079는 hourly stage bucket에 first, warning, critical timestamp를 추가하고 legacy row를 고정 policy v1 기준으로 backfill한다. 기존 원자 upsert가 count 증가와 threshold crossing timestamp를 한 statement에서 기록한다. Health는 최근 24시간 bucket이면 active, 30일 retained bucket만 남으면 recovered, 이력도 없으면 clear를 반환하고 recoveredAt은 마지막 retained bucket 종료 시각으로 계산한다. Dashboard에는 별도 APV Failure Lifecycle 카드와 다섯 시각을 추가했다.
- Review: 최초 recovered 구현은 최근 24시간 aggregate alias만 읽어 retained row의 first·warning·critical을 모두 잃었다. 실제 synthetic recovery 검증 중 bucket만 과거로 옮기면 관측 시각보다 recoveredAt이 앞서는 모순도 발견됐다. GET에서 recovered 상태를 저장하는 방식은 조회 부작용과 다중 인스턴스 경쟁을 만들 수 있다.
- Revise: retained first·warning·critical·last alias를 별도로 조회해 recovered lifecycle에 사용했다. DB CHECK를 강화해 first와 last가 hourly bucket 안에 있고 `first <= warning <= critical <= last` 순서가 유지되도록 했다. 복구는 row 변경 없이 retained bucket의 종료 시각에서만 유도한다. SQL 컴파일 테스트는 health가 정확히 한 SELECT이고 변경문을 포함하지 않음을 고정한다.
- Verify: 실제 PostgreSQL에서 rollback verification 3건은 dashboard `ACTIVE / CRITICAL`과 first·warning·critical을 표시했다. 같은 row와 시각을 25시간 이전의 유효한 bucket으로 옮기면 `RECOVERED / HEALTHY`, exact delete 뒤에는 `CLEAR / HEALTHY`와 모든 시각 none으로 수렴했다. Bucket 밖 timestamp insert는 DB constraint `23514`로 거절됐고 최종 metric row는 0이다. Metric service 7개·route 50개, 집중 157개, 전체 API 2,034개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 51/51·HTML·journal·diff를 통과했다. Fixture lease·cursor metric은 0이고 singleton은 SUCCEEDED·claim/lease null이다. 390px에서 lifecycle 카드가 가로 넘침 없이 표시됐다.

다음 자동 구현 후보는 이 identifier-free lifecycle을 실제 production alert sender에 바로 연결하지 않고, 먼저 운영자가 승인할 수 있는 명시적 escalation preview와 cooldown·recovery 계약을 설계하는 것이다.

### Cycle 147: preview-only APV failure escalation

- Plan: lifecycle을 외부 경보로 바로 보내지 않고, 운영자가 현재 공개 상태에서 필요한 조치를 먼저 확인할 수 있는 식별자 없는 미리보기를 만든다.
- Implement: preview v1은 `none`, `review_warning`, `escalate_critical`, `review_recovery` 네 action과 고정 reason만 반환한다. 공개 stage count·lifecycle·action으로 SHA-256 상태 지문을 만들고 5초 TTL, 명시적 승인 필요 여부, 15분 state-fingerprint cooldown 계약을 표시한다. Delivery는 항상 enabled false·attempted false이며 cooldown도 enforced false인 preview-only다. Admin/test-only no-store GET과 dashboard 전용 버튼·카드를 추가했다.
- Review: 단순 렌더러는 actionable 응답이 `approval.required=false`라고 주장하거나 unknown reason, action과 severity 불일치, TTL/cooldown 변조가 있어도 일부 문구만 축약해 표시할 수 있었다. 서비스도 미래 policy version이나 unknown reason을 걸러내지 않으면 잘못된 운영 권고를 만들 수 있었다.
- Revise: 서비스는 policy v1과 전체 allowlisted reason 일치를 요구하고 불일치 시 고정 오류로 fail-closed한다. Dashboard는 schema, mode, action/severity 조합, reasons 전체, approval state, delivery false, fingerprint, TTL 5초와 cooldown 계약을 다시 검증하고 모순이면 과거 값을 `UNAVAILABLE`로 지운다. 네트워크·저장소 오류 원문도 버린다.
- Verify: 실제 PostgreSQL의 격리 metric으로 dashboard는 `조치 없음 / HEALTHY → 경고 검토 / WARNING → 임계 에스컬레이션 / CRITICAL → 복구 확인 / CRITICAL → 조치 없음 / HEALTHY`를 표시했고 각 상태 지문이 바뀌었다. 모든 단계에서 delivery disabled·attempted false였고 approval row나 outbound call은 만들지 않았다. Exact cleanup 뒤 metric row는 0이다. Preview service 7개·route 52개, 집중 166개, 전체 API 2,043개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 66/66·HTML·diff를 통과했다. Fixture lease·cursor metric은 0이고 singleton은 SUCCEEDED·claim/lease null이다.

다음 자동 구현 후보는 preview 상태 지문과 TTL에 묶인 관리자 승인 요청을 append-only로 기록하되, 승인만으로 외부 전송하지 않고 maker-checker와 만료·replay·상태 변경 충돌을 먼저 검증하는 것이다.

### Cycle 148: state-bound immutable APV approval request

- Plan: 운영자가 확인한 actionable preview에 대해서만 maker 승인 요청을 남기고, 상태가 바뀌거나 같은 client request가 다른 내용으로 재사용되는 경우를 외부 전송 전에 차단한다.
- Implement: migration 0080은 client request UUID, 공개 상태 지문, allowlisted action·severity·reasons, 요청 관리자와 15분 만료 시각만 저장한다. migration 0081의 trigger는 UPDATE와 일반 DELETE를 막고 transaction-local test cleanup switch가 있는 검증 정리만 허용한다. Admin/test-only no-store POST와 dashboard `Request Alert Approval` 버튼·카드를 추가했으며 응답의 decision과 delivery는 항상 none/disabled다.
- Review: 최초 실제 PostgreSQL 실행에서 JavaScript 배열을 `text[]`로 직접 bind해 malformed array literal이 발생했고, 이미 수동 적용된 0079 제약 때문에 migration 재실행도 충돌했다. 또한 현재 preview를 먼저 조회하면 상태 변화 뒤 동일 요청의 불변 영수증 재생까지 잘못 차단한다.
- Revise: reasons는 개별 parameter로 만든 `ARRAY[...]::text[]`로 저장한다. 0079는 동일 제약을 다시 만들기 전에 `DROP CONSTRAINT IF EXISTS`를 수행해 migration 기록과 실제 schema drift를 수렴시킨다. Service는 client request 기존 row를 먼저 조회해 actor·fingerprint가 같으면 현재 preview와 무관하게 원래 영수증을 반환하고, 다른 binding은 고정 replay conflict로 거절한다.
- Verify: 실제 dashboard에서 WARNING preview로 요청을 만든 뒤 같은 client request가 idempotent replay를 반환했고, metric을 제거해 현재 preview가 clear가 된 뒤에도 원래 요청을 재생했다. UPDATE와 일반 DELETE는 PostgreSQL `P0001`로 거부됐고, transaction-local test cleanup만 한 row를 삭제해 approval·metric 잔존이 각각 0이었다. Approval service 5개·route 54개, 집중 173개, 전체 API 2,050개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 78/78·HTML·journal·diff를 통과했다.

다음 자동 구현 후보는 maker와 다른 관리자만 승인·거절할 수 있는 checker 결정을 별도 append-only 원장에 기록하고, 만료·상태 변화·중복 결정을 원자적으로 차단하되 아직 외부 전송은 하지 않는 것이다.

### Cycle 149: non-executable APV maker-checker decision

- Plan: maker 요청과 별도 불변 원장에 checker 승인·거절을 기록한다. 자기결정, 만료, 상태가 달라진 승인, 동일 요청의 반대 결정과 client decision ID 재사용을 막고 외부 전송 권한은 만들지 않는다.
- Implement: migrations 0082·0083은 request당 하나의 결정, 고유 client decision ID, 고정 approved/rejected reason과 append-only trigger를 추가했다. Service는 기존 decision replay를 먼저 처리하고 maker와 checker를 비교하며, 승인에는 current preview fingerprint 일치를 요구하고 거절은 불변 snapshot에 대한 판단으로 기록한다. Admin/test-only no-store route와 dashboard Approve·Reject 버튼 및 Checker Decision 카드를 추가했다.
- Review: service INSERT SELECT만으로 maker·fingerprint·expiry를 지키면 DB 직접 쓰기 경로가 같은 불변식을 우회할 수 있었다. Dashboard도 승인 뒤 반대 결정을 시도하면 단일 client ID 변수가 덮여 원래 승인 영수증을 다시 replay할 수 없었다. Preview 확인과 decision insert 사이에는 상태 변경 경쟁이 남지만 decision을 executable grant로 사용하지 않으므로 이 단계에서 외부 부작용은 없다.
- Revise: migration 0084의 BEFORE INSERT guard가 원 request를 읽어 self-decision, fingerprint 불일치와 DB 현재 시각 기준 만료를 차단한다. Dashboard는 APPROVED·REJECTED별 client decision ID를 따로 보존해 반대 결정 409 뒤에도 원래 terminal decision을 정확히 재생한다. 응답은 actor ID를 노출하지 않고 makerCheckerSeparated true, executable false와 delivery disabled를 함께 요구한다.
- Verify: 실제 dashboard는 WARNING preview에서 maker 요청을 만든 뒤 별도 checker로 승인, 동일 승인 replay, 반대 거절 409를 표시했다. DB에는 fingerprint가 요청과 같은 separated APPROVED 한 건만 있었고 UPDATE·일반 DELETE는 차단됐다. DB 직접 self-decision, 다른 fingerprint와 만료 요청도 모두 `P0001`로 거부됐으며 controlled cleanup 뒤 decision·request·metric은 0이다. Decision service 7개·route 56개, 집중 68개, 전체 API 2,059개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 91/91·HTML·journal·diff를 통과했다.

다음 자동 구현 후보는 승인된 snapshot을 보내기 직전에 현재 상태를 다시 검증하고 state fingerprint별 15분 cooldown claim을 DB에서 원자적으로 선점하되, 첫 단계에서는 signed payload 생성과 실제 HTTP 전송을 분리한 dry-run delivery grant까지만 만드는 것이다.

### Cycle 150: cooldown-bound dry-run delivery grant

- Plan: 승인 decision을 외부 전송으로 바로 사용하지 않고 current preview를 다시 확인한 뒤 fingerprint별 15분 cooldown을 선점한다. 선점 결과는 payload·signature·HTTP가 없는 dry-run grant로만 저장한다.
- Implement: migration 0085는 현재 cooldown claim과 append-only grant history를 분리하고, 0086은 만료된 claim 교체만 허용하며 grant의 approved decision·원 checker·fingerprint·request expiry binding을 DB trigger로 강제한다. Service는 client grant replay를 먼저 처리하고, 승인·actor·expiry·current fingerprint 검증 뒤 claim upsert와 grant insert를 한 CTE statement로 실행한다. Dashboard에는 Prepare Alert Grant 버튼과 strict side-effect-free grant 카드를 추가했다.
- Review: 실제 PostgreSQL 호출에서 JOIN alias `grant`가 예약어라 503으로 fail-closed됐지만 unit mock은 SQL을 실행하지 않아 발견하지 못했다. 또 UI가 구조적으로 invalid한 성공 응답을 거부하면서 client-generated grant ID까지 지우면 다음 요청이 원래 영수증 replay가 아니라 새 ID conflict가 된다. Preview 검증과 CTE 사이의 상태 변화 경쟁은 여전히 존재한다.
- Revise: alias를 `delivery_grant`로 바꾸고 실제 service와 dashboard를 재실행했다. Invalid 응답에서도 안전한 client grant ID는 유지해 다음 retry가 같은 immutable receipt를 회수한다. Grant는 dryRun true, payload/signature false, delivery disabled로만 반환되므로 남은 상태 경쟁이 외부 부작용을 만들지 않으며 실제 sender는 다시 상태를 검증해야 한다.
- Verify: 실제 dashboard는 WARNING→maker request→checker APPROVED→DRY-RUN GRANTED/COOLDOWN→idempotent replay를 표시했다. 같은 fingerprint의 두 번째 approved decision은 active cooldown에서 차단됐고, synthetic expired claim은 한 grant로 원자 reclaim됐다. Active claim update/delete와 grant update/delete는 모두 `P0001`로 차단됐고 controlled cleanup 뒤 claim·grant·decision·request·metric은 0이다. Grant service 7개·route 58개, 집중 77개, 전체 API 2,068개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 104/104·HTML·journal·diff를 통과했다.

다음 자동 구현 후보는 dry-run grant에서 결정적이고 비식별인 경보 payload를 만들고 payload hash를 append-only outbox에 저장하되, 서명과 HTTP 전송은 계속 비활성으로 두어 payload 계약·replay·변조 차단을 먼저 검증하는 것이다.

### Cycle 151: identifier-free unsigned payload outbox

- Plan: dry-run grant의 공개 snapshot만 canonical payload로 만들고 hash와 함께 append-only outbox에 보관한다. Payload에는 user·request·DB ID·timestamp를 넣지 않고 서명과 전송은 비활성으로 둔다.
- Implement: migration 0087은 grant당 하나의 unsigned outbox를 만들고 0088 trigger는 원 checker, active cooldown, grant fingerprint와 request action·severity·reasons를 payload에 다시 결합한다. Service는 exact replay, actor·cooldown·current fingerprint를 검증한 뒤 여섯 필드 payload와 SHA-256을 저장한다. Admin route와 dashboard Build Alert Payload 버튼·카드를 추가했다.
- Review: 첫 실제 호출은 DB `digest` 함수가 없어 503으로 rollback됐다. `pgcrypto`를 활성화한 뒤에는 PostgreSQL `jsonb::text`가 JavaScript object 삽입 순서와 다른 키 순서를 사용해 hash가 달랐다. UI도 단순 allowlist만으로 action·severity·reason의 의미 조합을 충분히 검증하지 않았다.
- Revise: migration 0089로 pgcrypto를 명시하고 0090은 service와 DB가 같은 정해진 key order의 `canonical_payload` text를 저장·재구성·해시한다. JSONB 자체도 expected payload와 같아야 한다. Dashboard는 warning·critical·recovery action별 severity와 reason 조합, 생성 시각, 정확한 여섯 key를 추가 검증한다.
- Verify: 실제 dashboard는 WARNING→request→APPROVED→grant→UNSIGNED PAYLOAD/READY→replay를 표시했다. DB에서 canonical text의 JSON 변환과 payload가 같고 SHA-256 재계산도 일치했으며 payload key는 여섯 개뿐이었다. `requested_by`를 넣은 변조 INSERT, UPDATE와 일반 DELETE는 모두 `P0001`로 거부됐고 controlled cleanup 뒤 outbox·grant·claim·decision·request·metric은 0이다. Payload service 6개·route 60개, 집중 85개, 전체 API 2,076개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 114/114·HTML·journal·diff를 통과했다.

다음 자동 구현 후보는 unsigned payload hash만 도메인 분리해 테스트용 Ed25519 키로 서명하고 별도 append-only 영수증에 공개키와 signature를 보관하는 것이다. Private key와 실제 HTTP sender는 계속 분리한다.

### Cycle 152: ephemeral-test Ed25519 signature receipt

- Plan: unsigned outbox의 SHA-256만 고정 domain과 결합해 Ed25519로 서명한다. Signature는 별도 append-only 원장에 한 번만 기록하고 private key는 DB·API·dashboard에 저장하거나 반환하지 않는다. 공개키와 key ID로 독립 검증하되 운영 trust anchor로 오인하지 않게 한다.
- Implement: migration 0091은 outbox당 하나의 signature receipt를 만들고 0092 trigger는 payload hash, original checker actor, active cooldown과 public-key-derived key ID를 다시 결합한다. Service는 process-local ephemeral test signer, client UUID exact replay, current actionable fingerprint, 서명 전·replay 후 공개 검증을 구현했다. Admin route와 dashboard Sign Alert Payload 버튼·카드를 추가했다.
- Review: 최초 UI는 공통 renderer가 비동기 WebCrypto 검증 완료를 기다리지 않아 버튼 완료와 카드 상태가 어긋날 수 있었다. 또한 공개키 검증 성공만 표시하면 프로세스 임시 키를 운영 신뢰키처럼 오해할 수 있었다. PostgreSQL 자체는 Ed25519를 검증하지 않으므로 DB privileged direct insert에 대한 cryptographic trust anchor도 아직 아니다.
- Revise: 서명 버튼이 WebCrypto 공개 검증을 직접 await한 뒤에만 `SIGNED / VERIFIED`를 표시한다. 응답과 UI는 `EPHEMERAL_PROCESS_TEST_KEY`, `trustAnchored false`를 필수로 검증한다. Service는 INSERT 전과 모든 replay에서 signature를 다시 검증하고 DB trigger는 actor, hash, cooldown과 key ID 재바인딩을 막는다.
- Verify: 실제 dashboard는 WARNING→request→APPROVED→grant→unsigned payload→SIGNED/VERIFIED→idempotent replay를 표시했다. 저장된 공개키로 DB signature 검증과 key ID 재계산이 일치했고 private-key 컬럼은 0이었다. UPDATE·일반 DELETE·actor 재바인딩·key ID 재바인딩은 모두 차단됐으며 controlled cleanup은 signature·outbox·grant·claim·decision·request·metric 각 1건을 제거해 잔존 0으로 수렴했다. Signature service 8개·route 62개, 집중 95개, 전체 API 2,086개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 126/126·HTML·journal·diff를 통과했다.

다음 자동 구현 후보는 테스트 signer를 운영 signer interface 뒤에 유지한 채 trust registry와 key lifecycle 모델을 먼저 추가하는 것이다. 실제 KMS/HSM credential과 outbound HTTP endpoint는 사용자·운영 설정 없이는 연결하지 않는다.

### Cycle 153: append-only test public-key registry and lifecycle

- Plan: process-local ephemeral signer의 공개키만 DB test registry에 등록하고 첫 `REGISTERED` 뒤 `RETIRED` 또는 `REVOKED` 한 번만 허용한다. 신규 signature는 서명 시점의 active registration과 공개키가 일치해야 한다. 이 registry는 독립 trust anchor가 아님을 응답과 UI에 유지한다.
- Implement: migration 0093은 immutable key body와 append-only lifecycle event를 분리하고 0094 trigger는 key ID, actor, 첫 event와 terminal 전이를 강제한다. 0095는 signature trigger가 `signed_at` 기준 최신 event의 REGISTERED 상태와 공개키를 검사하게 한다. Registry register/transition service와 admin routes, dashboard Register·Retire·Revoke controls/card를 추가했고 signature service도 신규 서명 전 current REGISTERED를 확인한다.
- Review: RETIRED 뒤 과거 registration client ID를 exact replay하면 과거 event status만 반환해 dashboard가 다시 active처럼 보일 수 있었다. 또한 동시 register/transition에서 `ON CONFLICT DO NOTHING` 패자는 winner가 존재해도 빈 결과를 503으로 반환할 수 있었다. Hot reload는 의도대로 새 ephemeral key ID를 만들었고 과거 client ID 재바인딩은 409로 차단했다.
- Revise: registry 응답을 immutable `eventType/eventReason`과 최신 `status/lifecycleReason`으로 분리해 과거 REGISTERED replay도 현재 RETIRED를 표시한다. INSERT 빈 결과는 client event와 current key winner를 다시 읽어 exact replay 또는 bounded terminal conflict로 수렴한다. Dashboard와 DOM 계약도 현재 status를 기준으로 sign을 차단한다.
- Verify: 실제 dashboard에서 REGISTERED→registration replay→registry-bound SIGNED/VERIFIED→RETIRED→sign local block을 확인했다. 실제 DB는 hot reload 전후 두 key, `REGISTERED→RETIRED`와 새 `REGISTERED` event 3개였고 key ID, signature의 signing-time REGISTERED와 공개 검증이 일치했다. Key update/delete, event update, 두 번째 terminal event와 retired-key signature direct INSERT는 차단됐다. Controlled cleanup은 signature·outbox·grant·claim·decision·request·metric 각 1, key events 3, keys 2를 삭제해 잔존 0으로 수렴했다. Registry service 10개·signature service 9개·route 65개, 집중 109개, 전체 API 2,100개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 139/139·HTML·journal·diff를 통과했다.

다음 자동 구현 후보는 active test registry signer가 만든 signed receipt를 실제 네트워크 없이 append-only delivery attempt queue에 넣고, receiver URL·credential 없이도 READY/BLOCKED와 replay 계약을 먼저 검증하는 것이다.

### Cycle 154: signed receipt-bound blocked delivery intent

- Plan: 검증된 signed receipt를 실제 HTTP sender와 분리된 append-only delivery intent로 한 번만 계획한다. 독립 trust anchor, receiver endpoint와 credential이 없으면 세 blocker를 명시하고 실행 가능한 요청은 만들지 않는다.
- Implement: migrations 0096·0097은 signature당 하나의 intent, 고유 client intent UUID, signature/outbox/hash/key/original checker binding과 고정 `BLOCKED_CONFIGURATION_DRY_RUN` 상태를 추가했다. Table에는 URL·endpoint·credential·token·header·body 컬럼이 없고 HTTP request와 delivery attempted는 false만 허용한다. Service는 exact replay를 live check보다 먼저 처리하고 current actionable fingerprint, active cooldown과 current REGISTERED key를 확인한다. Admin/test-only no-store route와 dashboard `Queue Delivery Intent` 버튼·카드를 추가했다.
- Review: 실제 DB와 dashboard에서 최초 저장·replay·변조 차단을 확인한 뒤, DB trigger가 key lifecycle을 caller의 `created_at` 시점까지만 조회한다는 경쟁 조건을 찾았다. 키가 service check 직후 RETIRED되면 과거 timestamp를 가진 insert가 이전 REGISTERED event를 볼 수 있었다. 현재 단계는 전송 부작용이 없지만 이후 sender가 이 원장을 신뢰하면 폐기 키 intent가 남을 수 있다.
- Revise: migration 0098은 delivery intent INSERT 때 key registry의 최신 event 전체를 조회해 현재 상태가 REGISTERED인 경우만 허용한다. Service의 현재 상태 검사와 DB 최종 guard가 같은 규칙을 갖게 했고, 외부 HTTP·retry worker는 계속 존재하지 않는다.
- Verify: 실제 dashboard는 WARNING→request→APPROVED→grant→unsigned payload→REGISTERED key→SIGNED/VERIFIED→`BLOCKED CONFIGURATION / DRY-RUN` 저장→idempotent replay를 표시했다. DB row는 고정 blocker 3개, HTTP false, delivery false였고 URL·credential 계열 컬럼은 0이었다. 공개키 서명 검증은 true였으며 UPDATE·일반 DELETE·actor/hash rebinding·HTTP-created·blocker 변조를 차단했다. 키를 RETIRED한 뒤 원 intent를 controlled cleanup하고 과거 createdAt으로 재삽입한 공격도 migration 0098 guard가 `P0001`로 거부했다. 최종 cleanup 뒤 intent/signature/outbox/grant/claim/decision/request/metric/key event/key는 모두 0이다. Delivery-intent service 6개·route 67개, 집중 117개, 전체 API 2,108개(+ live 2 skipped)·dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 149/149·migration 104개를 통과했다.

다음 자동 구현 후보는 실제 외부 전송에 앞서 receiver contract와 독립 trust-anchor adapter를 interface로 고정하고, credential 없이 실행되는 로컬 수신 검증 fixture로 freshness·signature·replay·conflict 계약을 먼저 검증하는 것이다.

### Cycle 155: local receiver contract verification

- Plan: 외부 endpoint 없이 수신자 계약이 payload·signature·key·freshness를 재검증하되 실제 수신 성공으로 기록하지 않는다.
- Implement: read-only admin/test route와 `Verify Receiver Contract` dashboard card를 추가했다. 여섯 필드 schema·의미 조합, canonical bytes, SHA-256, Ed25519, 현재 REGISTERED DB test key와 300초 freshness를 검증한다.
- Review: 최초 구현은 payload 의미를 송신 DB 제약에 의존했다. Receiver-side schema 검증 뒤 실제 DB에서 migration 0090 canonical key order와 unit fixture 순서가 달라 409로 닫히는 문제를 찾았다.
- Revise: 실제 canonical order `action/event_type/reasons/schema_version/severity/state_fingerprint`를 receiver 계약과 fixture에 고정했다.
- Verify: 실제 dashboard는 수정 후 `VERIFIED LOCAL CONTRACT / DRY-RUN`이며 network·production·persistence·replay·delivery는 모두 false다. Receiver service 7개·route 69개, 집중 76개, API 2,117개(+ live 2 skipped)·dispute 152개·shipping 214개, 타입·복구 12/12·DOM 157/157을 통과했고 fixture 원장 10종은 0이다.

다음 자동 구현 후보는 receiver delivery ID와 payload digest를 persistent claim에 저장해 first accept, exact replay, payload conflict와 동시 단일 승자를 검증하되 외부 HTTP는 계속 비활성으로 두는 것이다.

### Cycle 156: persistent local receiver claim

- Plan: 검증된 로컬 receiver 결과를 delivery intent당 하나의 append-only claim으로 저장한다. 실제 endpoint나 credential 없이 first record, exact replay, binding conflict와 다중 서버 경쟁을 검증하되 네트워크 수신이나 운영 승인을 주장하지 않는다.
- Implement: migrations 0099·0100은 intent·signature·payload SHA-256·key ID에 결합된 deterministic delivery ID와 고정 `VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN` 상태를 추가했다. Network received와 production accepted는 false만 허용하고 URL·endpoint·credential·secret·token·header·body·user·actor 컬럼은 두지 않았다. Service는 기존 claim을 live key 검사보다 먼저 반환하고, 신규 claim은 Cycle 155 receiver contract를 통과한 뒤 `INSERT ... ON CONFLICT`와 exact winner 비교로 저장한다. Admin/test-only no-store route와 dashboard `Record Receiver Claim` 버튼·카드를 추가했다.
- Review: unit·route 검증 뒤 실제 PostgreSQL에서 같은 intent를 20개 동시 요청했다. 최초 구현의 data-modifying CTE는 다른 transaction이 unique conflict에서 먼저 저장한 winner를 같은 statement snapshot에서 보지 못해 일부 loser가 unavailable로 끝났다. 이는 동일 요청이 일시적으로 replay 영수증을 받지 못하는 동시성 결함이었다.
- Revise: INSERT CTE가 행을 반환하지 않으면 별도 SELECT statement로 committed winner를 다시 읽고, intent·signature·hash·key·delivery ID가 모두 정확히 같을 때만 replay로 반환하도록 수정했다. 기존 불변 claim은 이후 key가 RETIRED되어도 역사적 영수증으로 재생하지만, retired key로 새 claim을 만드는 것은 service와 DB guard가 모두 차단한다.
- Verify: 실제 dashboard는 최초 `PERSISTED LOCAL CLAIM / DRY-RUN`과 동일 delivery ID의 idempotent replay를 표시했다. 20-way 경쟁은 inserted 1, replayed 19, claim ID 1, delivery ID 1로 수렴했다. DB delivery ID 재계산이 일치했고 UPDATE·일반 DELETE·hash와 delivery ID 재바인딩·network received true가 차단됐다. Controlled cleanup 후 관련 11개 fixture table이 모두 0이었다. Receiver-claim service 7개·route 71개, 집중 135개, 전체 API 2,126개(+ live 2 skipped), API/DB/payment-core 타입, 복구 12/12·DOM 166/166·migration 106개·diff check를 통과했다.

다음 자동 구현 후보는 외부 HTTP를 열기 전에 local receiver claim의 health·retention·export 계약을 추가해 오래된 claim, orphan binding과 감사 영수증 추출을 비식별 집계로 검증하는 것이다. 독립 trust anchor와 실제 receiver credential은 사용자가 운영 경계를 제공할 때까지 명시적 blocker로 유지한다.

### Cycle 157: identifier-free receiver claim health

- Plan: 외부 수신자를 열기 전에 local receiver claim 원장의 binding·delivery ID·freshness·금지 side effect를 실제 DB에서 다시 계산한다. API와 dashboard에는 개별 intent, signature, key, delivery, 사용자 식별자를 반환하지 않고 집계와 보존 상태만 보여준다.
- Implement: read-only health service는 claim·intent·signature 결합, domain-separated delivery ID, signedAt 대비 -5초/+300초 수신 구간, 고정 dry-run 상태, 차단형 no-HTTP intent와 network/production false를 한 SQL에서 검사한다. Admin/test-only no-store GET route는 claims 전체·24시간·30일 초과 건수와 네 종류 위반 수, `UNSET_PRESERVE`/자동 삭제 false만 반환한다. Dashboard에 `Receiver Claim Health` 버튼과 strict nested-schema card를 추가했다.
- Review: focused test 첫 실행에서 새 test helper의 object-literal TypeScript assertion 줄바꿈이 esbuild 문법 오류를 냈다. API route 73개와 dashboard 176개는 통과했지만 전체 타입 검사를 막았으므로 테스트 코드도 완료 조건에서 제외하지 않았다. Health 응답 변조에서 network receipt true가 들어오면 dashboard가 fail-closed되는 것도 확인했다.
- Revise: helper에 별도 `execute` mock을 만들고 명시적으로 타입 변환해 parser-sensitive 문법을 제거했다. Health는 오래된 claim을 자동 삭제하거나 현재 retired key를 오류로 취급하지 않고, 불변 저장 당시 binding과 안전 속성만 점검한다. 보존 기간은 아직 정하지 않았으므로 30일 초과 건수는 관찰값이고 정책은 `UNSET_PRESERVE`로 명시한다.
- Verify: 실제 PostgreSQL과 dashboard에서 빈 원장 `HEALTHY/0`, 전체 9단계 receiver flow 후 claims 1·24h 1·binding/delivery ID/freshness/unsafe 0, 통제 cleanup으로 관련 11개 table 0, 다시 `HEALTHY/0`을 확인했다. Health service 3개·route 73개, 집중 140개, 전체 API 2,131개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 176/176·migration 106개를 통과했다.

다음 자동 구현 후보는 receiver claim의 식별자 없는 append-only export manifest를 만들고, export digest와 행 수를 브라우저에서 독립 재검증하는 것이다. 실제 외부 archive 전달과 삭제는 endpoint·credential·retention 승인이 없으므로 계속 비활성으로 둔다.

### Cycle 158: opaque local receiver claim manifest

- Plan: healthy receiver claim 원장을 raw 식별자 없이 감사 가능한 형태로 추출한다. 각 claim의 canonical receipt digest와 정렬된 전체 manifest digest만 반환하고, 브라우저가 manifest SHA-256을 독립 계산한다. 외부 archive 전달과 영구 저장은 하지 않는다.
- Implement: export service는 Cycle 157 health가 healthy/0일 때만 실제 DB claim을 고정 receipt domain으로 SHA-256하고, 정렬된 digest 최대 1,000개를 manifest domain·entry count와 결합해 전체 SHA-256을 만든다. 1,001건이면 incomplete 결과를 내지 않고 fixed conflict로 닫는다. Admin/test-only no-store GET route와 dashboard `Export Claim Manifest` 버튼·카드는 raw identifiers false, persistence·external archive·network·production false를 강제한다.
- Review: 첫 focused review에서 PostgreSQL 배열을 `unknown`으로 검사한 뒤 원본 값을 다시 참조해 TypeScript narrowing이 풀리는 오류를 찾았다. DOM에서는 앞선 Ed25519 검증 test가 `crypto.subtle`을 importKey/verify만으로 교체해 새 digest 기능을 누락했고, 유효 manifest도 `UNAVAILABLE`로 닫혔다. 실제 브라우저 기능 문제가 아니라 테스트 환경의 capability replacement가 새 보안 검증을 가린 문제였다.
- Revise: 검증된 digest 배열을 지역 변수로 고정해 이후 로직이 unknown 값을 재참조하지 않도록 했다. DOM crypto mock은 기존 Ed25519 import/verify와 SHA-256 digest를 함께 제공하도록 수정했다. Dashboard는 manifest digest, raw identifier flag, external/network/production flag가 하나라도 바뀌면 fail-closed한다.
- Verify: 실제 dashboard에서 빈 manifest digest `1c09a92d14a70378…`, 전체 receiver claim flow 뒤 one-entry manifest digest `889de63067bd0b64…`를 확인했고 둘 다 browser SHA-256 yes였다. Raw identifiers·external archive·network·production은 모두 false였고 controlled cleanup 후 관련 11개 table은 0이다. Export service 4개·route 75개, 집중 146개, 전체 API 2,137개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 188/188·migration 106개를 통과했다.

다음 자동 구현 후보는 이 로컬 manifest 자체를 append-only export receipt로 한 번 저장해 동일 snapshot replay와 원장 변경 뒤 새 revision을 구분하는 것이다. 외부 WORM 전송과 credential은 계속 비활성으로 유지한다.

### Cycle 159: append-only local manifest receipt revisions

- Plan: healthy local manifest를 append-only receipt로 저장한다. 같은 manifest digest는 기존 revision을 replay하고, claim 원장이 바뀌면 latest revision+1과 previous manifest digest를 원자적으로 결합한다. 외부 archive 전달·서명·운영 수신은 주장하지 않는다.
- Implement: migrations 0101·0102는 unique revision과 manifest digest, previous digest, opaque receipt digest 배열, 고정 dry-run/no-external flags를 저장한다. PostgreSQL trigger는 advisory transaction lock을 얻고 현재 receiver claim 원장의 receipt digest 배열과 manifest SHA-256을 다시 계산하며 revision 1/후속 chain, 30초 generatedAt와 DB-clock recordedAt를 검증한다. Service transaction도 같은 lock을 먼저 얻고 health/export·exact replay·latest revision·insert를 직렬화한다. Admin/test-only strict empty-body POST와 dashboard `Record Manifest Receipt` 카드가 브라우저 SHA-256을 다시 검증한다.
- Review: test fixture에서 parser-sensitive multiline assertion이 재발해 공용 `ManifestResult` 상수로 제거했다. Unit SQL mock은 통과했지만 실제 dashboard의 빈 manifest revision 1이 redacted 503으로 닫혔다. 직접 service 실행으로 빈 JavaScript digest 배열이 SQL에서 유효하지 않게 확장된 것을 찾았다. 보안 공격 점검의 첫 shell SQL도 작은따옴표 경계가 제거되어 42703을 냈으므로 parameter binding으로 고쳐 guard 자체의 차단 코드를 재검증했다.
- Revise: digest 배열은 빈 경우 `ARRAY[]::text[]`, 값이 있으면 parameterized `ARRAY[...]::text[]`로 명시한다. 테스트 fixture는 실제 advisory lock→existing→latest→insert 네 단계 결과를 반영했다. 공격 SQL도 값 전체를 parameter binding해 UPDATE·일반 DELETE·wrong digest·revision gap이 모두 DB guard `P0001`인지 확인했다.
- Verify: 실제 빈 manifest는 revision 1, digest `1c09a92d14a70378…`, previous null로 저장되고 dashboard에서 exact replay됐다. Claim 1건 뒤 manifest `ad66f56c99e7d26a…`는 revision 2, previous `1c09a92d14a70378…`로 연결됐다. 20-way 경쟁은 inserted 1·replayed 19, revision/digest/previous 각각 하나로 수렴했다. Controlled cleanup 후 manifest receipt를 포함한 관련 12개 table이 0이다. Receipt service 6개·route 77개, 집중 154개, 전체 API 2,145개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 200/200·migration 108개를 통과했다.

다음 자동 구현 후보는 manifest receipt chain의 read-only health를 추가해 revision gap, previous mismatch, source manifest coverage와 최근 receipt age를 식별자 없이 집계하는 것이다. 외부 WORM endpoint와 credential은 계속 명시적 blocker로 둔다.

### Cycle 160: identifier-free manifest receipt chain health

- Plan: manifest receipt revision 전체와 현재 receiver claim source를 한 DB snapshot에서 다시 계산한다. Revision gap, previous digest 단절, manifest hash와 receipt set 변조는 critical, 현재 source 미기록과 24시간 초과는 warning으로 분리하며 raw 식별자는 반환하지 않는다.
- Implement: read-only service는 `row_number`와 `lag`로 chain을 재구성하고 각 receipt의 domain-separated manifest SHA-256, digest cardinality·64-hex·정렬, 고정 status/no-side-effect, timestamp를 검사한다. 현재 claim source digest와 최신 receipt를 비교하고 최대 1,000건, coverage와 age를 집계한다. Admin/test-only no-store GET route와 dashboard `Manifest Receipt Health` 버튼·strict schema 카드를 추가했다.
- Review: unit·route·DOM 통과 뒤 실제 PostgreSQL에서 빈 원장 warning, 빈 receipt 기록 후 healthy, trigger를 transaction 안에서 끈 revision/previous/manifest 변조 critical 3, rollback 후 healthy를 확인했다. 실제 브라우저의 빈 age 표시가 `nones`로 붙는 UI 결함도 발견했다.
- Revise: dashboard는 critical 합계와 status 전이 규칙, source-limit, coverage inverse, stale 계산, raw/external/network/production false를 독립 검증한다. Age는 null이면 `none`, 값이 있을 때만 `s`를 붙이고 warning DOM fixture를 추가했다. DB 변조 검사는 transaction rollback으로 실제 원장을 복구했다.
- Verify: 실제 dashboard는 receipt 1개에서 `HEALTHY/0`, controlled cleanup 후 `WARNING/0`, source covered no, age none을 표시했다. Manifest health service 4개·route 79개, 집중 160개, 전체 API 2,151개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 214/214·migration 108개·diff check를 통과했다. 모바일 390px에서 버튼 251px, 상태 카드 270px, Cycle 카드 300px, 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 최신 healthy local receipt를 외부 전송과 분리된 append-only archive intent에 결합하고, 독립 WORM endpoint·credential이 없을 때 고정 blocker를 기록하는 것이다. 실제 URL·secret·HTTP sender는 사용자 운영 설정 전까지 추가하지 않는다.

### Cycle 161: latest receipt-bound blocked archive intent

- Plan: 현재 receiver claim source를 덮는 최신 healthy manifest receipt를 외부 전송과 분리된 append-only archive intent에 한 번만 결합한다. WORM endpoint·credential·운영 signing key·delivery worker가 없으면 실행하지 않고 blocker를 명시한다.
- Implement: migrations 0103·0104는 receipt당 하나의 intent, 고유 client UUID, revision·manifest digest, 네 blocker와 no-side-effect flags를 저장한다. DB trigger는 최신 receipt와 현재 claim digest source를 다시 계산해 source coverage를 강제한다. Table에는 URL·endpoint·credential·secret·token·header·body·payload 컬럼이 없다. Service는 exact client replay, health gate, concurrent winner 별도 reload를 구현했고 admin/test-only POST와 dashboard `Queue Manifest Archive` 카드가 응답을 재검증한다.
- Review: 실제 migration에서 PostgreSQL 63-byte 식별자 자동 절단 notice를 발견했다. DOM redaction 테스트는 정상 route 문자열 `archive-intents`까지 secret leak로 오인했다. 기능 검증에서는 receipt 없는 409, receipt 기록 뒤 최초 intent와 replay가 정상이고, 20-way 경쟁도 한 winner로 수렴했다.
- Revise: migration의 constraint·index·function·trigger 이름을 명시적 짧은 이름으로 변경했다. DOM redaction 검사는 route 이름이 아니라 secret, password와 내부 DB host만 차단하도록 좁혔다. Dashboard는 strict UUID, blocker 순서, no-HTTP/no-delivery/no-external-receipt 플래그를 모두 검증한다.
- Verify: 실제 dashboard는 receipt absent 409 → revision 1 → `BLOCKED ARCHIVE CONFIG / REV 1` → idempotent replay를 표시했다. 20-way 경쟁은 insert 1·replay 19, intent/receipt binding 각 1이었다. UPDATE·일반 DELETE·manifest rebinding은 모두 `P0001`, 민감 컬럼은 0이었고 cleanup 뒤 intent·receipt 모두 0이다. Service 6개·route 81개, 집중 168개, 전체 API 2,159개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 226/226·migration 110개·diff check를 통과했다. 모바일 390px에서 버튼 251px, 상태 카드 270px, Cycle 카드 300px, 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 blocked archive intent 자체의 identifier-free health를 추가해 source receipt coverage, 중복·binding·금지 side effect와 intent age를 관찰하는 것이다. 실제 외부 URL·credential·HTTP는 계속 비활성으로 유지한다.

### Cycle 162: identifier-free archive intent health

- Plan: archive intent 전체의 receipt revision/digest binding, blocker, 금지 side effect와 현재 source를 덮는 최신 receipt의 intent coverage·24시간 age를 식별자 없이 관찰한다.
- Implement: read-only SQL은 현재 claim source manifest, 최신 receipt와 intent를 한 snapshot에서 결합하고 binding·네 blocker·고정 status/no-side-effect·future timestamp·source limit을 집계한다. Admin no-store GET과 dashboard `Manifest Archive Health` strict card를 추가했다.
- Review: 실제 빈 DB warning, receipt+intent 뒤 healthy, transaction 안 trigger를 끈 manifest digest 변조에서 critical 1, rollback 후 healthy를 확인했다. UI는 서버 status뿐 아니라 violation 합계, coverage inverse와 stale 계산을 다시 검증한다.
- Revise: null age는 `none`, 값이 있을 때만 초 단위를 표시하고 raw identifier·HTTP·network·external receipt·production flag 변조는 fail-closed한다.
- Verify: cleanup 후 실제 dashboard는 `WARNING/0`, current covered no, age none이다. Health service 4개·route 83개, 집중 174개, 전체 API 2,165개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 238/238·migration 110개·diff check를 통과했다. 모바일 390px에서 버튼 251px, 카드 270px, Cycle 카드 300px, overflow 0을 확인했다.

다음 자동 구현 후보는 archive health의 warning/critical을 외부 전송 없이 approval 가능한 alert preview로 만드는 것이다. 실제 ops endpoint와 credential은 계속 사용자 입력 전까지 비활성으로 둔다.

### Cycle 163: receiver manifest archive health alert preview

- Plan: archive intent health의 healthy·warning·critical을 식별자 없는 결정적 경보 프리뷰로 바꾸되 승인 요청, payload, 서명과 외부 전송은 만들지 않는다. 현재 intent 누락·24시간 stale과 다섯 불변식 위반 이유를 분리한다.
- Implement: read-only service는 기존 archive health 단일 SQL을 재사용하고 source schema, violation 합계, status, coverage, freshness, revision binding과 모든 no-side-effect flag를 다시 검증한다. `none`, `review_warning`, `escalate_critical` action과 고정 순서 이유, 5초 TTL, 공개 상태 SHA-256을 반환한다. Admin-only no-store GET, 별도 `Archive Alert Preview` 버튼과 한국어 이유 카드를 추가했다.
- Review: 초 단위 age와 `observedAt`을 지문에 넣으면 상태가 그대로인데도 매 호출이 새 경보처럼 보이는 문제를 설계 리뷰에서 제거했다. 기존 일반 APV 승인 버튼과도 연결하지 않아 다른 schema 지문이 잘못 승인되는 것을 막았다. Dashboard는 exact nested keys와 action·severity·reason·approval 규칙을 독립 검증한다.
- Revise: 지문은 totals·revision·violations·coverage와 stale 전환만 포함한다. Actionable 프리뷰는 `approval required / not_requested`만 표시하고 endpoint configured, payload created/signed, HTTP, network receipt와 production acceptance는 모두 false로 고정했다. 모순된 health, revision, status와 side-effect 주장은 fail-closed한다.
- Verify: 실제 dashboard는 clean DB `WARNING / 현재 보관 의도 없음` → receipt·blocked intent 뒤 `HEALTHY / 이유 없음` → trigger를 통제한 manifest digest 결합 훼손 뒤 `CRITICAL / 영수증 결합 오류` → 복구 뒤 같은 healthy fingerprint → cleanup 뒤 warning으로 전환했다. Intent·receipt는 모두 0건으로 정리됐다. Preview service 7개·route 85개, 집중 183개, 전체 API 2,174개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 252/252·migration 110개·diff check를 통과했다. 모바일 390px에서 버튼 251px, 상태 카드 270px, Cycle 카드 300px, 문서 overflow 0을 확인했다.

다음 자동 구현 후보는 archive alert preview 전용 append-only maker approval request를 추가해 공개 상태 지문과 TTL에 결합하는 것이다. 기존 일반 APV approval과 schema를 섞지 않고, checker 결정·payload·외부 전송은 각각 후속 경계로 둔다.

### Cycle 164: archive alert preview maker approval request

- Plan: archive alert preview 전용 maker 승인 요청을 별도 append-only 원장으로 만들고 현재 공개 상태 지문·action·severity·reason·15분 만료에 결합한다. 기존 일반 APV approval schema, checker 결정, payload와 전송은 섞지 않는다.
- Implement: migrations 0105~0107은 전용 request UUID, preview schema와 fingerprint, 고정 action·severity·순서화된 이유, 내부 maker와 15분 window만 저장한다. URL·endpoint·credential·secret·token·header·body·payload·signature·receipt·archive intent 식별자 컬럼은 없다. Service는 source manifest lock과 approval lock을 같은 transaction에서 잡고 exact replay를 live health보다 먼저 반환한다. Admin strict POST와 dashboard `Request Archive Alert Approval` 버튼·maker 카드를 추가했다.
- Review: 최초 테스트의 hardcoded fingerprint가 evaluator canonical hash와 어긋나 evaluator 기반 fixture로 고쳤고, SQL 검사는 줄바꿈에 독립적으로 수정했다. 1차 보안 리뷰에서 approval 전용 lock만으로 receipt/intent TOCTOU를 막지 못하는 점과 DB가 `critical + stale-only reason`을 허용할 수 있는 점을 발견했다.
- Revise: 서비스가 receipt/intent insert와 같은 source advisory lock을 먼저 잡도록 했고, migration 0107은 warning action은 missing/stale 이유만, critical action은 다섯 critical reason 중 하나 이상을 요구한다. Dashboard는 UUID, 현재 preview fingerprint, fixed reason order, action-severity binding, 15분 expiry, append-only와 모든 no-side-effect flag를 재검증하며 fingerprint 변경 시 client UUID와 maker 카드를 초기화한다.
- Verify: 실제 dashboard는 clean warning preview에서 `PENDING MAKER REQUEST / WARNING`과 같은 request의 idempotent replay를 표시했다. DB UPDATE·일반 DELETE·중복 이유·critical/stale-only 직접 INSERT는 모두 `P0001`, 민감 컬럼은 0개였다. 실제 HTTP 20개 동시 요청은 insert 1·replay 19·request ID 1로 수렴했고, archive 상태를 healthy로 바꾼 뒤 과거 client replay는 200 immutable receipt, 새 요청은 409 not actionable이었다. Dashboard는 상태 변경 시 maker 카드를 초기화했다. Cleanup은 approval 2·intent 1·receipt 1을 삭제해 모두 0건이다. Service 6개·route 88개, 집중 192개, 전체 API 2,183개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 266/266·migration 113개·diff check를 통과했다. 모바일 390px에서 새 승인 요청 버튼과 maker 결과 카드의 표시를 확인한 뒤 viewport override를 복구했다.

다음 자동 구현 후보는 archive alert approval request 전용 checker decision을 추가하는 것이다. Maker와 다른 admin, 현재 상태·미만료 request 재검증, request당 단일 append-only 결정과 exact replay를 강제하고 payload·서명·외부 전송은 계속 만들지 않는다.

### Cycle 165: archive alert approval checker decision

- Plan: archive alert maker 요청 전용 checker 결정 원장을 별도로 만들고 maker와 다른 admin, 미만료 request, 현재 공개 상태와 전체 snapshot 재검증, request당 단일 승인·거절과 exact replay를 강제한다. 결정은 payload·서명·외부 전송을 만들지 않는다.
- Implement: migrations 0108~0110은 client decision UUID, approval request FK, request fingerprint, APPROVED/REJECTED, 고정 결정 사유, 내부 checker와 결정 시각만 저장한다. Service는 source manifest·approval·decision advisory lock을 한 transaction에서 순서대로 잡고 exact replay를 먼저 처리한다. Admin strict POST와 dashboard 승인·거절 버튼, checker 결정 카드를 추가했다.
- Review: 첫 실제 결정은 SQL `RETURNING`에서 text array를 단일 문자열로 cast해 503이 됐다. 보안 리뷰에서는 DB 직접 INSERT가 요청 생성 전 또는 미래 시각을 기록할 수 있고 exact replay가 DB trigger를 전제로 snapshot binding을 덜 검증하는 문제도 발견했다.
- Revise: INSERT CTE 결과를 immutable maker 요청과 다시 JOIN해 배열을 DB 타입 그대로 반환하고 concurrent loser를 already-decided와 replay-conflict로 구분했다. Migration 0110은 `request.created_at <= decision.created_at < request.expires_at`와 1분 미래 상한을 추가했다. Service는 exact replay와 insert 결과 모두 schema·fingerprint·action·severity·ordered reasons·decision reason을 독립 검증하고 승인과 거절 모두 현재 preview를 다시 계산한다.
- Verify: 실제 dashboard는 clean warning에서 maker 요청 → `APPROVED CHECKER DECISION / WARNING` → 동일 결정 idempotent replay를 표시했다. 실제 HTTP 20개 동시 REJECTED 결정은 insert 1·replay 19·decision ID 1로 수렴했고 maker 자기승인은 409였다. DB UPDATE·일반 DELETE·maker 직접 INSERT·fingerprint 변조·요청 전 시각·2분 미래 시각은 모두 `P0001`, 민감 컬럼은 0개였다. 실제 manifest receipt와 archive intent API로 preview를 healthy로 바꾸자 미결정 request의 REJECTED도 409 state changed로 차단됐다. 최종 decision·request·intent·receipt는 모두 0건이다. Decision service 8개·route 91개, 집중 99개, 전체 API 2,194개(+ live 2 skipped), dispute-core 152개·shipping-core 214개, API/DB/payment-core 타입, 복구 12/12·DOM 266/266·migration 116개·diff check를 통과했다. 모바일 390px에서 승인·거절 버튼, checker 결과 카드와 Cycle 165 요약 표시를 확인한 뒤 viewport override를 복구했다.

다음 자동 구현 후보는 승인된 archive alert checker 결정 전용 non-executable delivery grant를 추가하는 것이다. 현재 상태와 결정 snapshot을 다시 결합하고 cooldown·만료·단일 grant를 강제하되 payload·서명·외부 전송은 계속 별도 후속 경계로 둔다.

## Slice Backlog

### Slice A: Normalize fulfillment type

Owner loop: Fulfillment Abstraction Loop

Goal: expand fulfillment type handling so `digital_delivery` can pass through approval, payment, and release code without shipment creation.

Acceptance criteria:

- Legacy `shipped` maps to `physical_shipping`.
- `digital_delivery` rejects shipping-only required fields.
- Test proves no shipment is created for digital path.

### Slice B: Digital fulfillment proof MVP

Owner loop: Fulfillment Abstraction Loop

Goal: allow seller proof or buyer confirmation to mark digital fulfillment as fulfilled.

Acceptance criteria:

- Proof record or equivalent normalized signal exists.
- Buyer review window starts from fulfillment confirmation.
- Release remains blocked while proof is pending or rejected.

### Slice C: Release event verification hardening

Owner loop: Release Gate Loop

Goal: ensure release/refund follow-through mutates DB only after exact on-chain event verification.

Acceptance criteria:

- Wrong contract address is rejected.
- Wrong settlement id is rejected.
- Wrong seller wallet or amount is rejected.
- Idempotent replay returns existing terminal result.

### Slice D: Dispute freezes settlement

Owner loop: Dispute Intake And Evidence Loop

Goal: opening a dispute moves order/settlement into a state where auto-release cannot execute.

Acceptance criteria:

- Active dispute unique constraint is covered.
- Release endpoint refuses disputed settlement.
- Dispute finalizer emits release/refund instruction only after resolution.

### Slice E: Console full-flow validation

Owner loop: Operator Demo Loop

Goal: make one local surface prove the MVP happy path and dispute path.

Acceptance criteria:

- Full-flow button runs physical and digital modes.
- Last result displays money state, fulfillment state, and dispute state.
- Recent requests make retries/idempotency visible.

### Slice F: Governance bootstrap

Owner loop: Repo Governance Loop

Goal: make README, CLAUDE, docs routing, and branch state reflect that payment/fulfillment/dispute MVP work is now loop-driven.

Acceptance criteria:

- Current branch is classified as the right branch or blocked with exact files.
- README impact is decided and updated only if developer commands or demo instructions changed.
- CLAUDE impact is decided and updated only if durable source-of-truth rules changed.
- `docs/README.md` links this plan if the plan becomes the accepted operating model.
- `git diff --check` passes.

## Recommended Execution Order

0. Run Loop 8 before every slice and after every slice.
1. Slice F: Governance bootstrap.
2. Slice A: Normalize fulfillment type.
3. Slice B: Digital fulfillment proof MVP.
4. Slice C: Release event verification hardening.
5. Slice D: Dispute freezes settlement.
6. Slice E: Console full-flow validation.

This order keeps the contract stable, removes shipping bias in the app layer first, then hardens money movement and dispute blocking.

## Final Completion Bar

The MVP loop set is complete when:

- Physical shipping happy path passes.
- Digital delivery happy path passes without shipment.
- Dispute path blocks release and resolves to release/refund.
- Payment test console demonstrates both paths.
- README/CLAUDE/docs routing reflects the durable operating model.
- Git branch and changed-file ownership are clear enough for review.
- Targeted payment, shipping, dispute, API, and contract tests pass.
- Remaining gaps are documented as post-MVP category-specific loops, not hidden TODOs.
