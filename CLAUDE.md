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

이 저장소는 **MVP 중심 monorepo**입니다. 결제/분쟁 등 MVP에 불필요한 기능은 별도 브랜치에서 개발합니다.

```
haggle/
├── apps/
│   ├── api/                          ← Hono API 서버 (MCP 라우터 포함)
│   └── web/                          ← Next.js 프론트엔드
├── packages/
│   ├── shared/                       ← 공통 타입, 상수, 유틸 (DO NOT TOUCH)
│   ├── db/                           ← Drizzle ORM + PostgreSQL (DO NOT TOUCH)
│   ├── contracts/                    ← 스마트 컨트랙트 (스텁)
│   ├── engine-core/                  ← 순수 수학 엔진 (137 tests, 외부 의존성 0)
│   ├── engine-session/               ← 세션 오케스트레이션 (178 tests)
│   └── ucp-adapter/                  ← UCP 통합 어댑터 (104 tests)
├── docs/
│   ├── engine/                       ← 엔진 아키텍처 v1.0.2 기술 사양서 (17개 문서)
│   └── ...                           ← 사업/구현 계획 문서
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
engine-core ← engine-session ← ucp-adapter
```

> `engine-core`와 `engine-session`은 `shared`/`db`와 의존 관계 없음.
> `ucp-adapter`는 `engine-core` + `engine-session`에 의존.
> apps/api에서 engine-session과 ucp-adapter를 import하여 협상 라운드를 실행.

---

## 패키지: @haggle/engine-core

순수 수학 계산기. DB/API/LLM 호출 없음. 외부 의존성 0.

| 함수 | 설명 |
|------|------|
| `computeUtility(ctx)` | NegotiationContext → UtilityResult (4차원 효용 계산) |
| `makeDecision(utility, thresholds, session)` | U_total → ACCEPT/COUNTER/REJECT/NEAR_DEAL/ESCALATE |
| `computeCounterOffer(params)` | Faratin 양보 곡선으로 역제안 가격 계산 |
| `computeDynamicBeta(params)` | 경쟁자 수 + 상대 양보율 기반 동적 β 계산 |
| `computeUtilitySpaceCounterOffer(params)` | 효용 공간에서 Faratin 곡선 역제안 가격 계산 |
| `shouldAcceptNext(incoming, counter, p_target, p_limit)` | AC_next: 상대 제안 ≥ 역제안이면 즉시 수락 |
| `invertVp(vp_target, p_target, p_limit)` | computeVp의 역함수 — v_p 값에서 가격 복원 |
| `batchEvaluate(request)` | N개 리스팅 일괄 평가 + 순위 |
| `compareSessions(sessions)` | N개 세션 비교 + BATNA 산출 |

## 패키지: @haggle/engine-session

engine-core 위의 오케스트레이션 레이어. 세션 상태 관리, HNP 프로토콜 타입, 라운드 실행 파이프라인.
DB/API/LLM 호출 없음. LLM 에스컬레이션은 `EscalationRequest` 반환.

| 함수/타입 | 설명 |
|-----------|------|
| `executeRound(session, strategy, offer, roundData)` | 한 라운드 실행 파이프라인 (동적β + 효용공간 + AC_next + 상대모델 통합) |
| `assembleContext(strategy, roundData)` | MasterStrategy + RoundData → NegotiationContext |
| `transition(status, event)` | 세션 상태 전이 |
| `trackConcession(prev, current, role)` | 양보 여부 판단 (rounds_no_concession 카운터용) |
| `classifyMove(prev, current, role, range)` | 상대 가격 이동을 CONCESSION/SELFISH/SILENT로 분류 |
| `createOpponentModel()` / `updateOpponentModel(model, move)` | EMA 기반 상대방 양보율 추적 모델 |

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
2. **Cost-Aware**: LLM 호출 최소화, Hot Path(규칙 기반) 비율 극대화
3. **Stateless Engine**: 수평 확장 가능한 설계
4. **Event-Driven**: 모듈 간 직접 의존 금지, 이벤트로 통신
5. **Open Protocol, Closed Engine**: HNP 스펙은 공개, 엔진 로직은 비공개
6. **MVP-First**: main 브랜치는 MVP 전용. 결제/분쟁 등은 별도 브랜치

---

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | MVP 전용 (협상 엔진 + 웹앱 + API) |
| `feature/hnp-proto` | HNP Protobuf wire format (추후) |
| `feature/dispute-system` | 3-Tier 분쟁 해결 시스템 (추후) |
| `feature/settlement` | USDC 결제 연동 (추후) |

---

## 패키지: @haggle/ucp-adapter

UCP(Universal Checkout Protocol) 통합 어댑터. engine-core + engine-session 위에 UCP 호환 레이어 제공.

| 모듈 | 설명 |
|------|------|
| `profile/` | UCP 프로필 관리 (/.well-known/ucp) |
| `checkout/` | 체크아웃 세션 생성 및 관리 |
| `extension/` | UCP Extension 인터페이스 |
| `order/` | 주문 상태 관리 |
| `payment/` | 결제 연동 (USDC) |
| `transport/` | UCP 전송 계층 |
| `createBridgedSession()` | engine-session ↔ UCP 세션 브릿지 |
| `processNegotiationRound()` | UCP 경유 협상 라운드 실행 |

---

## 📄 상세 문서 (`/docs`)

### 엔진 아키텍처 (v1.0.2 기술 사양서)

`docs/engine/` 폴더에 17개 자체 완결형 한국어 문서로 구성. 라우팅 문서: [00_INDEX.md](./docs/engine/00_INDEX.md)

| Part | 문서 | 내용 |
|------|------|------|
| **A: 엔진 코어** | 01~07 | 아키텍처, 효용 함수, 양보 곡선, 상대방 모델, 의사결정, AgentStats, 구현 계획 |
| **B: 운영/인프라** | 08~17 | LLM 정책, 세션 오케스트레이션, 매칭, 토폴로지, HNP, 비용, 데이터/성능, 적합성 테스트, 스킬 마켓, 확장/미결 |

### 기타 문서

| 문서 | 내용 |
|------|------|
| [MVP_Final_Implementation_Plan.md](./docs/MVP_Final_Implementation_Plan.md) | MVP 구현 계획 |
| [Slice_0_Implementation_Plan.md](./docs/Slice_0_Implementation_Plan.md) | Slice 0 구현 계획 |
| [UCP_Integration_Plan.md](./docs/UCP_Integration_Plan.md) | UCP 통합 계획 (Slice 0-7) |

---

*Last Updated: 2026-03-07*
*Version: 2.2*
