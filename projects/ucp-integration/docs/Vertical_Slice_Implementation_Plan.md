# UCP Integration — Vertical Slice 구현 계획

**목표:** Haggle HNP를 UCP 생태계에 `ai.haggle.negotiation` Extension + `ai.haggle.escrow` Payment Handler로 통합

**원칙:** 각 Slice는 독립적으로 배포 가능하고, end-to-end로 동작하는 최소 기능 단위

---

## Slice 개요

```
Slice 0: Extension 스펙 정의 + Discovery Endpoint
         "판매자가 협상 가능함을 선언하고, 에이전트가 발견한다"

Slice 1: 협상 브릿지 API
         "에이전트가 UCP를 통해 Haggle 협상을 시작하고 합의에 도달한다"

Slice 2: UCP Checkout 연동
         "합의가로 UCP Checkout 세션을 생성하고 결제까지 완료한다"

Slice 3: Escrow Payment Handler
         "ai.haggle.escrow로 스테이블코인 에스크로 결제를 처리한다"

Slice 4: Agent Adapter (MCP/A2A)
         "Claude/Gemini가 Haggle Extension을 자동으로 인식하고 활용한다"

Slice 5: Merchant SDK (Shopify App)
         "Shopify 판매자가 원클릭으로 Haggle 협상을 활성화한다"
```

---

## Slice 0: Extension 스펙 + Discovery

> **"판매자가 협상 가능함을 선언하고, 에이전트가 발견한다"**

### 목표
- `ai.haggle.negotiation` Extension JSON Schema 확정
- `ai.haggle.escrow` Payment Handler JSON Schema 확정
- `/.well-known/ucp` 프로필에 Haggle Extension을 포함하여 서빙
- 에이전트가 Discovery로 협상 지원 여부를 확인

### 산출물

#### 0-1. Extension JSON Schema 정의
```
packages/ucp-spec/
├── src/
│   ├── schemas/
│   │   ├── negotiation-extension.json    # ai.haggle.negotiation schema
│   │   ├── escrow-handler.json           # ai.haggle.escrow schema
│   │   └── capability-profile.json       # Business Profile with Haggle
│   ├── types/
│   │   ├── extension.ts                  # TypeScript 타입 (Extension)
│   │   ├── handler.ts                    # TypeScript 타입 (Payment Handler)
│   │   └── profile.ts                    # TypeScript 타입 (UCP Profile)
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 0-2. Discovery Endpoint
```
apps/ucp-discovery/
├── src/
│   ├── routes/
│   │   └── well-known.ts                # GET /.well-known/ucp
│   ├── services/
│   │   ├── profile-builder.ts           # UCP 프로필 생성
│   │   └── capability-negotiator.ts     # 교집합 계산
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 0-3. 검증 기준
- [ ] `GET /.well-known/ucp` → `ai.haggle.negotiation` 포함된 유효 JSON 응답
- [ ] Capability Negotiation: 교집합 계산이 정확히 동작
- [ ] UCP 공식 스키마와 호환 (JSON Schema validation 통과)
- [ ] Haggle Extension을 모르는 에이전트 → graceful degradation (정가 거래)

#### 0-4. 커뮤니티 액션
- [ ] UCP GitHub Discussions에 Negotiation Extension RFC 포스팅
- [ ] protocol.tryhaggle.ai에 스펙 문서 호스팅 준비

### 예상 기간: 1-2주

---

## Slice 1: 협상 브릿지 API

> **"에이전트가 UCP Discovery를 통해 Haggle 협상을 시작하고 합의에 도달한다"**

### 목표
- UCP Discovery → HNP 협상 세션 생성 → AI-to-AI 협상 → 합의 도달
- UCP의 흐름 안에서 HNP 프로토콜이 자연스럽게 동작
- 기존 MVP의 engine/protocol 패키지 재사용

### 산출물

#### 1-1. UCP-HNP 브릿지
```
packages/ucp-bridge/
├── src/
│   ├── bridge.ts                  # UCP Extension ↔ HNP 변환
│   ├── session-manager.ts         # 협상 세션 생명주기 관리
│   ├── agreement-resolver.ts      # 합의 도달 → UCP 가격 반영
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 1-2. API 엔드포인트 추가
```
apps/ucp-api/
├── src/
│   ├── routes/
│   │   ├── negotiate.ts           # POST /v1/negotiate/start
│   │   │                          # POST /v1/negotiate/:id/offer
│   │   │                          # GET  /v1/negotiate/:id/status
│   │   │                          # POST /v1/negotiate/:id/accept
│   │   └── health.ts
│   ├── middleware/
│   │   └── ucp-auth.ts            # UCP 인증 미들웨어
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 1-3. 검증 기준
- [ ] 에이전트가 Discovery로 Haggle 발견 → 협상 시작 → 합의 → 합의가 반환
- [ ] HNP 메시지 (OFFER, COUNTER, ACCEPT, REJECT) 정상 동작
- [ ] 협상 실패 시 graceful fallback (정가 거래로 전환)
- [ ] max_rounds 초과 시 자동 종료
- [ ] 협상 세션 timeout 처리

### 의존: Slice 0 (Extension Schema)
### 예상 기간: 2-3주

---

## Slice 2: UCP Checkout 연동

> **"합의가로 UCP Checkout 세션을 생성하고 결제까지 완료한다"**

### 목표
- 협상 합의가를 UCP Checkout 세션의 line_item 가격에 반영
- UCP 표준 체크아웃 흐름 (incomplete → ready_for_complete → completed) 구현
- Track B (하이브리드): 기존 PSP(Stripe)로 결제

### 산출물

#### 2-1. Checkout 어댑터
```
packages/ucp-checkout/
├── src/
│   ├── checkout-session.ts        # UCP Checkout 세션 생성/관리
│   ├── price-injector.ts          # 합의가 → line_item 가격 반영
│   ├── state-machine.ts           # 체크아웃 상태 머신
│   ├── escalation-handler.ts      # Human Handoff (Hold 패턴)
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 2-2. Checkout API
```
apps/ucp-api/src/routes/
├── checkout.ts                    # POST /v1/checkout/sessions
│                                  # PATCH /v1/checkout/sessions/:id
│                                  # POST /v1/checkout/sessions/:id/complete
│                                  # GET /v1/checkout/sessions/:id
└── ...
```

#### 2-3. 검증 기준
- [ ] 협상 합의 → Checkout 세션 생성 (합의가 반영) → 결제 완료
- [ ] 상태 머신: incomplete → ready_for_complete → completed 정상 전이
- [ ] Human Handoff: requires_escalation → continue_url 제공
- [ ] Track B: Stripe 결제 토큰으로 정상 결제
- [ ] 수수료 부담 비율이 합의 내용대로 정확히 적용

### 의존: Slice 1 (협상 브릿지)
### 예상 기간: 2-3주

---

## Slice 3: Escrow Payment Handler

> **"ai.haggle.escrow로 스테이블코인 에스크로 결제를 처리한다"**

### 목표
- UCP Payment Handler로 `ai.haggle.escrow` 등록
- USDC on Base L2 에스크로 결제 구현 (Track A)
- 수수료 부담 비율 협상 결과 적용
- 에스크로 잠금 → 배송 확인 → 해제 플로우

### 산출물

#### 3-1. Escrow Handler
```
packages/ucp-escrow/
├── src/
│   ├── handler.ts                 # UCP Payment Handler 인터페이스 구현
│   ├── escrow-contract.ts         # 스마트 컨트랙트 인터페이스
│   ├── fee-splitter.ts            # 수수료 부담 비율 계산/적용
│   ├── release-manager.ts         # 에스크로 해제 조건 관리
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 3-2. 검증 기준
- [ ] UCP Checkout에서 ai.haggle.escrow 선택 → 에스크로 잠금 → 해제
- [ ] 수수료 부담 비율: buyer_ratio/seller_ratio 정확히 적용
- [ ] USDC on Base L2 실제 트랜잭션 (testnet)
- [ ] 분쟁 발생 시 에스크로 동결
- [ ] Track C: 소비자에게 Google Pay vs Haggle Escrow 선택지 제공

### 의존: Slice 2 (Checkout 연동), MVP contracts 패키지
### 예상 기간: 3-4주

---

## Slice 4: Agent Adapter (MCP/A2A)

> **"Claude/Gemini가 Haggle Extension을 자동으로 인식하고 활용한다"**

### 목표
- MCP 어댑터: Claude가 Haggle Extension을 도구로 인식
- A2A 어댑터: Gemini 에이전트가 Haggle과 통신
- 에이전트 프로필에 `ai.haggle.negotiation` capability 추가

### 산출물

#### 4-1. MCP 어댑터 (Claude용)
```
packages/ucp-mcp-adapter/
├── src/
│   ├── tools/
│   │   ├── discover-negotiation.ts    # UCP Discovery → Haggle 발견
│   │   ├── start-negotiation.ts       # 협상 시작
│   │   ├── check-status.ts            # 협상 상태 확인
│   │   └── complete-checkout.ts       # 체크아웃 완료
│   ├── agent-profile.ts               # 에이전트 UCP 프로필
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 4-2. A2A Agent Card (Gemini용)
```
packages/ucp-a2a-adapter/
├── src/
│   ├── agent-card.ts              # /.well-known/agent-card.json 생성
│   ├── task-handler.ts            # A2A Task 처리
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 4-3. 검증 기준
- [ ] Claude에서 MCP 도구로 Haggle 협상 실행 가능
- [ ] Gemini에서 A2A로 Haggle 에이전트와 통신 가능
- [ ] 에이전트 프로필에 ai.haggle.negotiation 포함
- [ ] 에이전트가 /.well-known/ucp 크롤링 → Haggle Extension 발견 → 자동 협상

### 의존: Slice 1 (브릿지 API)
### 예상 기간: 2-3주

---

## Slice 5: Merchant SDK (Shopify App)

> **"Shopify 판매자가 원클릭으로 Haggle 협상을 활성화한다"**

### 목표
- Shopify 앱: 설치 시 판매자의 `/.well-known/ucp`에 자동 추가
- 판매자 대시보드: 협상 설정 (카테고리, 최소가, max_rounds)
- 판매자 에이전트: 판매자 측 AI 협상 자동 대응

### 산출물

#### 5-1. Shopify App
```
apps/shopify-app/
├── src/
│   ├── routes/
│   │   ├── install.ts             # Shopify OAuth 설치 플로우
│   │   ├── dashboard.ts           # 판매자 설정 대시보드
│   │   └── webhook.ts             # Shopify 웹훅 처리
│   ├── services/
│   │   ├── ucp-registrar.ts       # /.well-known/ucp 자동 등록
│   │   ├── seller-agent.ts        # 판매자 측 AI 에이전트 설정
│   │   └── price-policy.ts        # 가격 정책 (최소가, 할인율)
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### 5-2. 검증 기준
- [ ] Shopify 앱 설치 → /.well-known/ucp에 ai.haggle.negotiation 자동 추가
- [ ] 판매자가 대시보드에서 협상 파라미터 설정
- [ ] 에이전트가 해당 Shopify 스토어 Discovery → 협상 가능 확인
- [ ] 판매자 에이전트가 자동으로 카운터 오퍼 생성

### 의존: Slice 0 (스펙), Slice 1 (브릿지)
### 예상 기간: 3-4주

---

## 타임라인 총괄

```
Week  1-2:   Slice 0  Extension 스펙 + Discovery
Week  3-5:   Slice 1  협상 브릿지 API          ← Slice 4 병렬 시작 가능
Week  5-7:   Slice 2  UCP Checkout 연동
Week  5-7:   Slice 4  Agent Adapter (MCP/A2A)   ← Slice 1 완료 후 병렬
Week  7-10:  Slice 3  Escrow Payment Handler
Week  8-12:  Slice 5  Merchant SDK (Shopify App) ← Slice 0,1 완료 후
```

### 의존성 그래프

```
Slice 0 (스펙/Discovery)
  ├──→ Slice 1 (협상 브릿지)
  │      ├──→ Slice 2 (Checkout 연동)
  │      │      └──→ Slice 3 (Escrow Handler)
  │      └──→ Slice 4 (Agent Adapter) ← 병렬 가능
  └──→ Slice 5 (Shopify App) ← Slice 1 이후 병렬 가능
```

---

## 패키지 구조 총괄

```
projects/ucp-integration/
├── CLAUDE.md
├── docs/
│   ├── UCP_Deep_Dive_Guide.md
│   ├── Haggle_UCP_Integration_Strategy.md
│   └── Vertical_Slice_Implementation_Plan.md   ← 이 문서
├── apps/
│   ├── ucp-api/               # Slice 1,2: UCP API 서버
│   ├── ucp-discovery/         # Slice 0: /.well-known/ucp 서빙
│   └── shopify-app/           # Slice 5: Shopify 앱
└── packages/
    ├── ucp-spec/              # Slice 0: Extension/Handler 스키마
    ├── ucp-bridge/            # Slice 1: UCP ↔ HNP 브릿지
    ├── ucp-checkout/          # Slice 2: Checkout 어댑터
    ├── ucp-escrow/            # Slice 3: Escrow Payment Handler
    ├── ucp-mcp-adapter/       # Slice 4: MCP 어댑터
    └── ucp-a2a-adapter/       # Slice 4: A2A 어댑터
```

---

## 리스크 및 의존성

| 리스크 | 영향 | 대응 |
|--------|------|------|
| UCP 스펙 변경 (아직 초기) | 스키마 호환성 깨짐 | 추상화 레이어로 격리, 버전 고정 |
| Shopify 앱 심사 지연 | Slice 5 지연 | 로컬 개발용 mock 판매자로 먼저 검증 |
| Base L2 가스비 변동 | Track A 비용 예측 불가 | 가스비 모니터링 + 동적 수수료 조정 |
| 에이전트 생태계 파편화 | MCP/A2A 동시 지원 부담 | 공통 브릿지 레이어로 추상화 |
| UCP 커뮤니티 반응 불확실 | Extension 채택 지연 | 독립 동작 가능하게 설계 (UCP 없이도 HNP만으로 동작) |
