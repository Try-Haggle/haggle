# Haggle

**AI 협상 + 온체인 결제 프로토콜 인프라**
*"The Stripe of Negotiations"*

> 이 문서는 Haggle의 모든 개발자가 참고하는 **Source of Truth**입니다.

---

## Company Overview

Haggle은 AI Agent가 자동으로 가격을 협상하고, 스테이블코인(USDC)으로 즉시 결제하는 **프로토콜 인프라**입니다. Stripe가 온라인 결제를 표준화했듯, Haggle은 AI 시대의 협상을 표준화합니다.

**핵심 가치:**
- 구매자: 10-20% 할인, 수수료 부담 비율도 협상 가능
- 판매자: 기존 플랫폼 대비 더 높은 수령액 (eBay 13% → Haggle 1.5%)
- 플랫폼: 96%+ 마진율

**법인:** Delaware LLC
**도메인:** tryhaggle.ai

---

## Philosophy

### 미션
**"협상의 민주화"** — 모든 사람이 공정하게 협상할 수 있는 세상.

### 비전
**"P2P 거래의 표준"** — 결제의 Stripe, 인증의 OAuth처럼, 협상하면 Haggle.

### 핵심 가치
- **공정함 (Fairness)** — 양쪽에게 동등한 정보와 권한
- **투명함 (Transparency)** — 수수료, 신뢰도, 출처를 항상 공개
- **안전함 (Safety)** — 스마트 컨트랙트 기반 결제
- **편리함 (Convenience)** — 자동화가 기본
- **정직함 (Honesty)** — 틀릴 수 있음을 인정

### 설계 원칙
1. **사용자 보호 우선** — 수익보다 사용자 보호가 먼저
2. **자동화가 기본** — 수동으로 할 일을 최소화
3. **표준이 될 설계** — API 우선, 문서화 강박
4. **양쪽 모두에게 공정** — 구매자 AI ≠ 플랫폼 AI
5. **단순함 > 완벽함** — 기능 100개 < 핵심 기능 10개
6. **데이터는 사용자 것** — 거래 수수료만

### 의사결정 가이드
트레이드오프 상황 시: **안전 > 편리, 공정 > 수익, 단순 > 완벽, 투명 > 효율**

---

## Monorepo 구조

이 저장소는 **MVP 중심 monorepo**입니다. MVP 범위: 협상 엔진 + 웹앱 + API + 결제(USDC) + 배송 + 분쟁 + 스마트 컨트랙트(Base L2).

```
haggle/
├── apps/
│   ├── api/                          ← Fastify v5 API 서버 (MCP 라우터 포함)
│   └── web/                          ← Next.js 프론트엔드
├── packages/
│   ├── shared/                       ← 공통 타입, 상수, 유틸 (보호 경계: 소비자 영향 확인 후 변경)
│   ├── db/                           ← Drizzle ORM + PostgreSQL (보호 경계: migration으로만 변경)
│   ├── contracts/                    ← 스마트 컨트랙트 (Foundry, Base L2)
│   ├── engine-core/                  ← 순수 수학 엔진 (102 tests, 외부 의존성 0)
│   ├── engine-session/               ← 세션 오케스트레이션 (121 tests)
│   ├── trust-core/                   ← 신뢰 점수 엔진 (85 tests)
│   ├── dispute-core/                 ← 분쟁 비용 + DS 패널 (117 tests)
│   ├── arp-core/                     ← 적응형 리뷰 기간 (57 tests)
│   └── tag-core/                     ← 태그 라이프사이클 (71 tests)
├── docs/                             ← 사업/아키텍처 문서
├── CLAUDE.md                         ← 이 파일
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

### 패키지 의존성 그래프

```
shared ← db
       ← contracts
engine-core ← engine-session ← apps/api
```

> `engine-core`와 `engine-session` 자체는 `shared`/`db`와 의존 관계가 없다. `apps/api`가 두 패키지를 사용하면서 DB, LLM, HTTP 경계를 연결한다.
> 현재 프로덕션 라운드는 `apps/api/src/negotiation/pipeline`이 실행하며 DeepSeek V4 Pro가 최종 가격과 메시지를 결정한다. `engine-core`의 Faratin 계산은 코칭에 사용되지만, `engine-session.executeRound`와 `engine-core.makeDecision`은 현재 프로덕션 최종 결정 경로가 아니다. 정확한 현황은 [docs/engine/SOT.md](./docs/engine/SOT.md)를 따른다.

### `shared`와 `db` 보호 규칙

기존 `DO NOT TOUCH`의 뜻은 영구 변경 금지가 아니라 **임의 변경 금지**다.

- `packages/shared`: API, Web, DB, core package가 함께 소비한다. 공개 타입이나 금액/status 계약을 바꾸기 전에 `rg`로 소비자를 찾고 전체 typecheck/test를 실행한다.
- `packages/db`: 이미 적용된 migration은 수정·이름 변경하지 않는다. 스키마 변경은 additive migration으로만 하고 `pnpm verify:migrations`, `pnpm verify:db-schema`, `pnpm verify:db-invariants`, 빈 DB replay를 확인한다.
- 삭제·rename·타입 축소는 호환 migration과 단계적 consumer 전환 없이 한 번에 진행하지 않는다.
- DB 영역과 테이블 의미를 처음 찾을 때는 [docs/mvp/database-catalog.md](./docs/mvp/database-catalog.md), 변경 절차와 호환성 기준은 [docs/mvp/database-structure-and-governance.md](./docs/mvp/database-structure-and-governance.md)를 읽는다.

---

## 패키지: @haggle/engine-core

순수 수학 계산기. DB/API/LLM 호출 없음. 외부 의존성 0.

| 함수 | 설명 |
|------|------|
| `computeUtility(ctx)` | NegotiationContext → UtilityResult (4차원 효용 계산) |
| `makeDecision(utility, thresholds, session)` | U_total → ACCEPT/COUNTER/REJECT/NEAR_DEAL/ESCALATE |
| `computeCounterOffer(params)` | Faratin 양보 곡선으로 역제안 가격 계산 |
| `batchEvaluate(request)` | N개 리스팅 일괄 평가 + 순위 |
| `compareSessions(sessions)` | N개 세션 비교 + BATNA 산출 |

## 패키지: @haggle/engine-session

engine-core 위의 오케스트레이션 레이어. 세션 상태 관리, HNP 프로토콜 타입, 라운드 실행 파이프라인.
DB/API/LLM 호출 없음. LLM 에스컬레이션은 `EscalationRequest` 반환.

| 함수/타입 | 설명 |
|-----------|------|
| `executeRound(session, strategy, offer, roundData)` | 한 라운드 실행 파이프라인 |
| `assembleContext(strategy, roundData)` | MasterStrategy + RoundData → NegotiationContext |
| `transition(status, event)` | 세션 상태 전이 |
| `trackConcession(prev, current, role)` | 양보 여부 판단 |

---

## 개발 명령어

```bash
# 전체
pnpm install
pnpm build           # turbo build (전체)
pnpm test            # turbo test (engine-core + engine-session)
pnpm typecheck       # turbo typecheck (전체)

# 개별 패키지
pnpm --filter @haggle/engine-core test
pnpm --filter @haggle/engine-session test
```

---

## 핵심 규칙 (Development Principles)

1. **Protocol-First**: 모든 기능은 HNP 프로토콜 위에 구축
2. **Cost-Aware**: Codec 압축 + DeepSeek V4 Pro를 사용하고 토큰·비용 telemetry로 LLM 비용을 관리
3. **Stateless Engine**: 수평 확장 가능한 설계
4. **Event-Driven**: 모듈 간 직접 의존 금지, 이벤트로 통신
5. **Open Protocol, Closed Engine**: HNP 스펙은 공개, 엔진 로직은 비공개
6. **MVP-First**: main 브랜치는 MVP 전용. 협상 + 결제 + 배송 + 분쟁 + 스마트 컨트랙트 포함
7. **Non-Custodial**: Haggle 은 사용자 자금에 대한 키를 절대 보유하지 않는다
8. **Governance-Safe**: 컨트랙트 업그레이드 권한과 자금 접근 권한은 완전히 분리. Timelock(48h+) + Multisig 필수

---

## 버저닝

**파일:** `VERSION` (루트) — 단일 소스. 모든 배포/태그는 이 파일 기준.

**형식:** `MAJOR.MINOR.PATCH.BUILD` (예: `1.0.0.0`)

| 세그먼트 | 의미 | 올릴 때 |
|----------|------|---------|
| MAJOR | Phase 변경 | Phase 0→1, 프로토콜 호환 깨짐 |
| MINOR | 기능 추가 | 새 기능 릴리스 (분쟁 시스템, 버디 등) |
| PATCH | 버그 수정 | 핫픽스, 보안 패치 |
| BUILD | 배포 번호 | 매 배포마다 자동 증가 |

**현재:** `1.0.0.0` (Phase 0 최초 릴리스)

**규칙:**
- 배포 전 `VERSION` 파일 업데이트 → git tag `v1.0.0.0` → 배포
- CHANGELOG.md에 변경 내역 기록
- 컨트랙트 배포는 별도 버전 관리 (컨트랙트 주소 = 불변)

---

## 브랜치 전략

3환경(Local·Staging·Production) 워크플로우 — `feature → staging → main`:

| 브랜치 | 용도 | 배포 환경 |
|--------|------|----------|
| `feature/*` | 기능 개발 (`staging`에서 분기) | 로컬만 |
| `staging` | 통합 검증·리허설 (장수 브랜치) | `app.staging.tryhaggle.ai` |
| `main` | 프로덕션 (검증된 것만 진입) | `app.tryhaggle.ai` |

**규칙:**
1. 모든 작업은 `staging`에서 feature 브랜치를 따서 시작
2. feature → `staging` PR 머지 → staging 환경에서 통합 테스트
3. 테스트 통과 후 `staging` → `main` **"Deploy PR"** 머지 → 프로덕션 배포
4. `main`에는 staging을 거치지 않은 코드가 직접 들어가지 않음

상세: [docs/wip/Environment_Separation_Playbook.md](./docs/wip/Environment_Separation_Playbook.md)

---

## Loop-Driven MVP Execution

결제, fulfillment, 분쟁 MVP는 루프 기반으로 진행한다. 기준 문서는
[docs/wip/payment-fulfillment-dispute-loop-engineering-plan.md](./docs/wip/payment-fulfillment-dispute-loop-engineering-plan.md)이다.

핵심 원칙:
- 큰 자동화 하나가 아니라 `Orchestrator`, `Spec`, `Payment Funding`, `Fulfillment`, `Release Gate`, `Dispute`, `Operator Demo`, `Readiness`, `Repo Governance` 루프로 나눈다.
- 각 slice는 시작 전에 branch/dirty files/README/CLAUDE 영향 범위를 확인한다.
- 각 slice는 완료 전에 지정 테스트, `git diff --check`, README/CLAUDE/docs routing 필요 여부를 확인한다.
- README는 개발자가 실행해야 하는 셋업·명령·데모 절차가 바뀔 때만 갱신한다.
- CLAUDE.md는 durable architecture, branch, team workflow, non-negotiable safety rule이 바뀔 때만 갱신한다.
- 커밋, merge, rebase, stash, push, PR 생성은 사람이 명시적으로 요청한 경우에만 한다.
- 배포 승인 게이트: `git push`, PR merge, staging/production 배포처럼 원격 배포를
  유발할 수 있는 작업은 실행 직전에 사용자에게 대상 환경과 변경 범위를 알리고
  명시적 승인을 받은 뒤 실행한다. 로컬 구현과 검증이 끝나도 승인 전에는 멈춘다.

---

## 결제·배송·분쟁 문서 라우팅

MVP 결제, 배송/fulfillment, 분쟁 작업은 아래 문서를 먼저 읽고 시작한다.

| 영역 | 먼저 읽을 문서 | 용도 |
|------|----------------|------|
| 전체 루프 | [docs/wip/payment-fulfillment-dispute-loop-engineering-plan.md](./docs/wip/payment-fulfillment-dispute-loop-engineering-plan.md) | 결제 → fulfillment → release/dispute를 slice 단위로 실행하는 기준 |
| 보안 기준 | [docs/mvp/payment-shipping-dispute-security-controls.md](./docs/mvp/payment-shipping-dispute-security-controls.md) | 구현된 결제·배송·분쟁 보호장치, 운영 설정, 남은 P0/P1 위험 |
| DB 한눈에 보기 | [docs/mvp/database-catalog.md](./docs/mvp/database-catalog.md) | 환경별 DB, 논리 장부, 핵심 테이블, writer, 민감도와 에이전트 라우팅 |
| DB 구조·변경 규칙 | [docs/mvp/database-structure-and-governance.md](./docs/mvp/database-structure-and-governance.md) | 거래 데이터 연결, 실제 사용처, 보호 경계, migration 충돌 방지 기준 |
| 결제 | [docs/wip/payment-production-observability.md](./docs/wip/payment-production-observability.md) | 결제 운영 지표, webhook, reconciliation, safe logging 기준 |
| 배송/fulfillment | [docs/wip/digital-fulfillment-settlement-design.md](./docs/wip/digital-fulfillment-settlement-design.md) | physical shipping과 no-shipping fulfillment를 같은 상위 모델로 묶는 기준 |
| 분쟁 | [docs/features/분쟁_시스템_v2.md](./docs/features/분쟁_시스템_v2.md) | 분쟁 비용, 패널, 인센티브, trust 영향의 제품 기준 |
| 분쟁 Advisor·판례 | [docs/mvp/dispute-advisor-precedent-knowledge.md](./docs/mvp/dispute-advisor-precedent-knowledge.md) | 사전 분석 판례 저장, 승인, Advisor 조회와 DeepSeek/Canary 운영 기준 |
| 판례 콜드스타트·수렴 테스트 | [docs/wip/dispute-precedent-cold-start-and-convergence-test.md](./docs/wip/dispute-precedent-cold-start-and-convergence-test.md) | Seed/Holdout 분리, staging 실제 판정 wave와 통과 기준 |
| 분쟁 API | [docs/wip/dispute-start-api-design.md](./docs/wip/dispute-start-api-design.md) | 분쟁 시작, 증거 업로드, idempotency, money movement freeze 기준 |
| 팀 E2E 리허설 | [docs/wip/fake-money-fake-address-e2e-test-plan.md](./docs/wip/fake-money-fake-address-e2e-test-plan.md) | 가짜 돈 + 가짜 주소로 결제/배송 상태 흐름을 닫는 Stage 1 기준 |

실제 구현 위치는 `apps/api/src/routes/payments.ts`, `apps/api/src/routes/shipments.ts`,
`apps/api/src/routes/disputes.ts`, `packages/payment-core/`, `packages/shipping-core/`,
`packages/dispute-core/`를 함께 확인한다.

---

## 3man Team (Arch / Bob / Richard)

프로젝트 구현은 3man team 워크플로우를 사용합니다.

| 파일 | 역할 |
|------|------|
| `ARCHITECT.md` | Arch — 설계, 의사결정, Bob/Richard 지시 |
| `BUILDER.md` | Bob — 구현, ARCHITECT-BRIEF 기반 빌드 |
| `REVIEWER.md` | Richard — 코드 리뷰, 품질 게이트 |
| `handoff/` | 세션 간 브리프, 빌드 로그, 리뷰 피드백 |

---

## 상세 문서 (`/docs`)

> 문서 라우터: [docs/README.md](./docs/README.md)

| 문서 | 내용 |
|------|------|
| [mvp/](./docs/mvp/00_INDEX.md) | MVP 계획, 기술 부채, 운영 정책 |
| [engine/](./docs/engine/SOT.md) | 협상 엔진 Source of Truth |
| [contracts/](./docs/contracts/00_INDEX.md) | 스마트 컨트랙트 보안 감사 |
| [strategy/](./docs/strategy/00_INDEX.md) | 사업 전략, 해자, 파트너 리서치 |
| [features/](./docs/features/00_INDEX.md) | 기능 설계 (태그, 분쟁, 게이미피케이션) |

**문서 관리 규칙:** 구현 완료 → `docs/archive/` 이동. 임시 작업 → `docs/wip/` (완료 시 삭제).

---

*Last Updated: 2026-07-14*
*Version: 2.3*
