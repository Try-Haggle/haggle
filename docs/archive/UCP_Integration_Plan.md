# Haggle x UCP Integration Plan

**Universal Commerce Protocol 통합 설계 및 Vertical Slice 구현 계획**

> Version: 1.0
> Date: 2026-03-04
> Status: Draft
> UCP Spec Version: 2026-01-23

> 브랜치 운영 기준은 [Main_Branch_Release_Policy.md](./Main_Branch_Release_Policy.md)를 따른다.  
> 이 문서는 Haggle의 장기 표준화 및 상호운용 범위를 다루며, `main` 브랜치의 출시 전 MVP 범위를 제한 기준으로 삼지 않는다.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [UCP 기술 리서치 요약](#2-ucp-기술-리서치-요약)
3. [통합 아키텍처 설계](#3-통합-아키텍처-설계)
4. [Vertical Slice 구현 계획](#4-vertical-slice-구현-계획)
5. [Data Model Mapping](#5-data-model-mapping)
6. [Risk & Open Questions](#6-risk--open-questions)

---

## 1. Executive Summary

### Why UCP?

Google의 Universal Commerce Protocol은 AI 에이전트가 상거래를 수행하는 표준 프로토콜이다.
Haggle은 "AI 협상 프로토콜"이고, UCP는 "AI 상거래 프로토콜"이다.

**핵심 시너지:**
- Haggle의 협상 엔진이 UCP 체크아웃 **앞단**에서 가격을 결정
- 합의된 가격이 UCP Checkout Session으로 흘러가 결제 완료
- Haggle이 UCP Extension으로 협상 capability를 노출하면, 모든 UCP 호환 플랫폼이 Haggle 협상을 사용 가능

**전략적 포지셔닝:**
```
기존 UCP 흐름:  Discovery → Checkout → Payment → Order
Haggle UCP 흐름: Discovery → [Negotiation] → Checkout → Payment → Order
                              ↑ Haggle이 추가하는 레이어
```

### Integration Scope

| Phase | 내용 | 우선순위 |
|-------|------|----------|
| Phase 1 | UCP Profile + Discovery (판매자 등록) | P0 - Foundation |
| Phase 2 | Checkout Session ↔ Negotiation Session 연동 | P0 - Foundation |
| Phase 3 | Haggle Negotiation Extension 정의 | P0 - Foundation |
| Phase 4 | Order Management (웹훅 수신) | P1 |
| Phase 5 | USDC Payment Handler 정의 | P1 |
| Phase 6 | AP2 Mandate 통합 (에이전트 자율 협상) | P2 |
| Phase 7 | Identity Linking (계정 연결) | P2 |

---

## 2. UCP 기술 리서치 요약

### 2.1 프로토콜 아키텍처

UCP는 TCP/IP에서 영감 받은 **레이어드 아키텍처**:

| Layer | 역할 | 예시 |
|-------|------|------|
| Shopping Service | 핵심 거래 primitive | checkout session, line items, totals |
| Capabilities | 주요 기능 영역 (독립 버전) | Checkout, Orders, Catalog |
| Extensions | 도메인별 스키마 확장 (composition) | Discounts, Fulfillment, **Negotiation** |

**핵심 설계 원칙:**
- **Server-selects model**: 판매자(서버)가 양측 지원 기능의 교집합에서 선택
- **Transport-agnostic**: REST, MCP, A2A, Embedded Protocol 모두 지원
- **Reverse-domain naming**: `dev.ucp.shopping.checkout`, `ai.haggle.negotiation`
- **Extension composition via `allOf`**: 기존 스키마를 깨지 않고 확장

### 2.2 Discovery: `/.well-known/ucp`

판매자가 UCP Profile을 게시하면 플랫폼이 자동 발견:

```json
{
  "ucp": {
    "version": "2026-01-23",
    "services": {
      "dev.ucp.shopping": [{
        "version": "2026-01-23",
        "transport": "rest",
        "endpoint": "https://merchant.example.com/ucp/v1",
        "schema": "https://ucp.dev/2026-01-23/services/shopping/rest.openapi.json"
      }]
    },
    "capabilities": {
      "dev.ucp.shopping.checkout": [{"version": "2026-01-23"}],
      "dev.ucp.shopping.discount": [{"version": "2026-01-23", "extends": "dev.ucp.shopping.checkout"}],
      "ai.haggle.negotiation": [{"version": "2026-03-01", "extends": "dev.ucp.shopping.checkout"}]
    },
    "payment_handlers": {
      "com.google.pay": [{ /* ... */ }],
      "ai.haggle.usdc": [{ /* ... */ }]
    }
  }
}
```

### 2.3 Checkout Session (핵심 primitive)

상태 머신:

```
incomplete → requires_escalation → ready_for_complete → completed
     │
     └──────────────→ canceled
```

금액 단위: **minor units (cents)** — 2500 = $25.00

### 2.4 REST API

| Operation | Method | Endpoint | Status |
|-----------|--------|----------|--------|
| Create Checkout | `POST` | `/checkout-sessions` | 201 |
| Get Checkout | `GET` | `/checkout-sessions/{id}` | 200 |
| Update Checkout | `PUT` | `/checkout-sessions/{id}` | 200 |
| Complete Checkout | `POST` | `/checkout-sessions/{id}/complete` | 200 |
| Cancel Checkout | `POST` | `/checkout-sessions/{id}/cancel` | 200 |

**필수 헤더:** `UCP-Agent`, `Request-Signature` (JWS Detached), `Idempotency-Key` (UUID), `Request-Id`

### 2.5 MCP Binding

UCP 기능이 MCP 도구로 1:1 매핑:

| MCP Tool | UCP Operation |
|----------|---------------|
| `create_checkout` | Create checkout session |
| `get_checkout` | Retrieve session state |
| `update_checkout` | Modify session details |
| `complete_checkout` | Place order with payment |
| `cancel_checkout` | Terminate session |

Haggle의 기존 MCP 라우터(`apps/api/src/mcp/router.ts`)에 자연스럽게 통합 가능.

### 2.6 Extension Mechanism

UCP의 Extension은 `allOf` composition으로 부모 capability를 확장:

```json
{
  "ai.haggle.negotiation": [{
    "version": "2026-03-01",
    "extends": "dev.ucp.shopping.checkout",
    "spec": "https://haggle.ai/ucp/negotiation-spec.json",
    "schema": "https://haggle.ai/ucp/negotiation-schema.json"
  }]
}
```

이것이 Haggle이 UCP 생태계에 진입하는 **핵심 메커니즘**.

### 2.7 Order Management (웹훅)

- `POST /webhooks/partners/{partner_id}/events/order`
- 매 업데이트마다 전체 Order 엔티티 전송 (incremental delta 아님)
- `Request-Signature` 헤더로 서명 검증 (Detached JWT, RFC 7797)
- fulfillment events: `processing` → `shipped` → `in_transit` → `delivered`
- adjustments: refunds, returns, credits, price adjustments

### 2.8 AP2 (Agent Payments Protocol)

에이전트 자율 거래를 위한 신뢰 레이어:

| Mandate | 용도 | Haggle 활용 |
|---------|------|-------------|
| Intent Mandate | 제약 조건 내 구매 권한 | 가격 범위 내 자율 협상 |
| Cart Mandate | 특정 장바구니/가격 승인 | 협상 완료 후 합의가 확인 |
| Payment Mandate | 결제 수단 승인 | USDC 결제 승인 |

---

## 3. 통합 아키텍처 설계

### 3.1 High-Level Architecture

```
                    ┌──────────────────────────────┐
                    │     External UCP Platforms    │
                    │  (Google AI Mode, Gemini,     │
                    │   Shopify, etc.)              │
                    └──────────────┬───────────────┘
                                   │
                          UCP REST / MCP / A2A
                                   │
                    ┌──────────────▼───────────────┐
                    │       Haggle API Server       │
                    │       (apps/api)              │
                    │                               │
                    │  ┌─────────────────────────┐  │
                    │  │   UCP Gateway Layer     │  │  ← NEW
                    │  │  - Profile Hosting      │  │
                    │  │  - Capability Negotiation│  │
                    │  │  - Request Signing       │  │
                    │  │  - Transport Adapters    │  │
                    │  └────────────┬────────────┘  │
                    │               │                │
                    │  ┌────────────▼────────────┐  │
                    │  │   Session Bridge        │  │  ← NEW
                    │  │  - UCP ↔ HNP Mapping   │  │
                    │  │  - State Sync           │  │
                    │  │  - Price Resolution     │  │
                    │  └────────────┬────────────┘  │
                    │               │                │
                    │  ┌────────────▼────────────┐  │
                    │  │   Existing MCP Router   │  │
                    │  │  + UCP MCP Tools        │  │
                    │  └────────────┬────────────┘  │
                    └───────────────┼───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │      engine-session           │
                    │  (executeRound, session mgmt) │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │      engine-core              │
                    │  (utility, decision, counter)  │
                    └───────────────────────────────┘
```

### 3.2 New Package: `@haggle/ucp-adapter`

UCP 관련 로직을 별도 패키지로 분리:

```
packages/ucp-adapter/
├── src/
│   ├── index.ts                  ← Public exports
│   ├── profile/
│   │   ├── types.ts              ← UCP Profile types
│   │   ├── builder.ts            ← Profile 생성/관리
│   │   └── negotiator.ts         ← Capability negotiation
│   ├── checkout/
│   │   ├── types.ts              ← Checkout session types
│   │   ├── mapper.ts             ← UCP Checkout ↔ HNP Session 변환
│   │   └── session-bridge.ts     ← 양방향 상태 동기화
│   ├── extension/
│   │   ├── negotiation.ts        ← ai.haggle.negotiation extension
│   │   └── schema.ts             ← Extension JSON Schema
│   ├── transport/
│   │   ├── rest.ts               ← REST binding handlers
│   │   ├── mcp.ts                ← MCP binding handlers
│   │   └── signing.ts            ← Request signature (JWS)
│   ├── order/
│   │   ├── types.ts              ← Order types
│   │   └── webhook.ts            ← Webhook receiver + verification
│   └── payment/
│       ├── types.ts              ← Payment handler types
│       └── usdc-handler.ts       ← USDC payment handler (stub → Phase 5)
├── __tests__/
├── package.json
└── tsconfig.json
```

**의존성:**
```
engine-core ← engine-session ← ucp-adapter
                                    ↑
                              apps/api imports
```

### 3.3 Session Bridge: HNP ↔ UCP 매핑

이것이 통합의 **핵심**. 협상 세션과 체크아웃 세션을 연결.

```typescript
// 개념적 흐름
interface BridgedSession {
  ucp_checkout_id: string;       // UCP checkout session ID
  hnp_session_id: string;        // Haggle negotiation session ID
  status: BridgedSessionStatus;
  listing_price: number;         // 원래 판매가 (minor units)
  negotiated_price: number | null; // 협상 합의가 (minor units)
  buyer_id: string;
  seller_id: string;
}

type BridgedSessionStatus =
  | 'NEGOTIATING'       // HNP active, UCP checkout incomplete
  | 'AGREED'            // HNP accepted, UCP ready_for_complete
  | 'CHECKOUT_PENDING'  // UCP completing payment
  | 'COMPLETED'         // UCP completed, order created
  | 'CANCELLED'         // Either side cancelled
  | 'EXPIRED';          // Timeout
```

**State Mapping:**

| HNP Session Status | UCP Checkout Status | Bridged Status |
|--------------------|---------------------|----------------|
| CREATED / ACTIVE | incomplete | NEGOTIATING |
| NEAR_DEAL | incomplete | NEGOTIATING |
| STALLED | incomplete | NEGOTIATING |
| ACCEPTED | ready_for_complete | AGREED |
| — | completed | COMPLETED |
| REJECTED / EXPIRED | canceled | CANCELLED / EXPIRED |

### 3.4 Haggle Negotiation Extension

UCP Extension으로 협상 데이터를 Checkout에 첨부:

```json
{
  "ai.haggle.negotiation": {
    "session_id": "hnp_abc123",
    "status": "active",
    "original_price": 25000,
    "current_offer": 22000,
    "counter_offer": 23500,
    "round": 3,
    "role": "BUYER",
    "utility_score": 0.72,
    "decision": "COUNTER",
    "negotiation_url": "https://haggle.ai/negotiate/abc123",
    "constraints": {
      "price_floor": 20000,
      "price_ceiling": 25000,
      "deadline": "2026-03-05T12:00:00Z"
    }
  }
}
```

### 3.5 UCP MCP Tools (apps/api 추가)

기존 MCP 라우터에 UCP 도구 추가:

```typescript
// 새로 추가할 MCP Tools
'haggle_ucp_create_checkout'     // 체크아웃 세션 생성 (with negotiation)
'haggle_ucp_get_checkout'        // 체크아웃 상태 조회
'haggle_ucp_update_checkout'     // 구매자 정보, 배송 등 업데이트
'haggle_ucp_complete_checkout'   // 결제 완료
'haggle_ucp_cancel_checkout'     // 취소

// 기존 도구와의 연결
'haggle_submit_offer'            // 협상 오퍼 → 내부적으로 UCP checkout 업데이트
'haggle_create_negotiation_session' // 협상 세션 → UCP checkout 세션 동시 생성
```

### 3.6 Full Transaction Flow

```
1. Buyer Agent → Discovery
   GET /.well-known/ucp → Haggle profile (capabilities incl. negotiation)

2. Buyer Agent → Create Checkout + Negotiation
   POST /checkout-sessions
   Body: { line_items: [...], ai.haggle.negotiation: { intent: "negotiate" } }
   → UCP Checkout (incomplete) + HNP Session (CREATED) 생성

3. Negotiation Rounds (HNP over UCP)
   PUT /checkout-sessions/{id}
   Body: { ai.haggle.negotiation: { offer: 22000 } }
   → engine-session.executeRound() → counter/accept/reject
   → Response includes updated negotiation state

4. Agreement Reached
   HNP ACCEPTED → UCP checkout status: ready_for_complete
   negotiated_price가 line_items.totals에 반영

5. Payment
   POST /checkout-sessions/{id}/complete
   Body: { payment: { instruments: [{ handler_id: "ai.haggle.usdc", ... }] } }
   → 결제 처리

6. Order Created
   → Webhook: POST /webhooks/partners/{id}/events/order
   → 주문 추적 시작
```

---

## 4. Vertical Slice 구현 계획

### Slice 0: UCP Types & Profile Foundation

**목표:** UCP 핵심 타입 정의 + Profile 호스팅 + Capability negotiation

**산출물:**
- `packages/ucp-adapter/` 패키지 scaffolding
- UCP 핵심 타입 (Profile, Capability, CheckoutSession, LineItem, Totals)
- `/.well-known/ucp` 엔드포인트 (apps/api)
- Capability negotiation 로직
- Profile builder (판매자 capability 등록)

**파일:**
```
packages/ucp-adapter/
  src/profile/types.ts          ← UcpProfile, UcpCapability, UcpService
  src/profile/builder.ts        ← buildProfile(), addCapability()
  src/profile/negotiator.ts     ← negotiateCapabilities()
  src/checkout/types.ts         ← CheckoutSession, LineItem, Totals, CheckoutStatus
  src/index.ts                  ← Public exports
  package.json
  tsconfig.json
  __tests__/profile.test.ts
  __tests__/negotiator.test.ts
apps/api/
  src/ucp/well-known.ts         ← GET /.well-known/ucp route
```

**완료 기준:**
- [ ] `pnpm --filter @haggle/ucp-adapter test` 통과
- [ ] `GET /.well-known/ucp` 가 유효한 UCP Profile JSON 반환
- [ ] Capability negotiation: 교집합 알고리즘 정상 작동

**의존성:** 없음 (독립 진행 가능)

---

### Slice 1: Checkout Session CRUD

**목표:** UCP Checkout Session의 생성/조회/수정/취소 REST 엔드포인트

**산출물:**
- Checkout session 상태 머신 (incomplete → ready_for_complete → completed → canceled)
- REST 엔드포인트 5개
- 필수 헤더 처리 (UCP-Agent, Idempotency-Key, Request-Id)
- In-memory 세션 스토어 (MVP)

**파일:**
```
packages/ucp-adapter/
  src/checkout/state-machine.ts   ← CheckoutSession 상태 전이
  src/checkout/store.ts           ← In-memory checkout store (MVP)
  src/checkout/validators.ts      ← Request body validation
  src/transport/rest.ts           ← Header parsing + validation
  src/transport/signing.ts        ← Request-Signature stub (verify only)
  __tests__/checkout-crud.test.ts
  __tests__/checkout-state.test.ts
apps/api/
  src/ucp/routes.ts               ← POST/GET/PUT/POST(complete)/POST(cancel)
```

**완료 기준:**
- [ ] 5개 REST 엔드포인트 작동
- [ ] 상태 전이 정합성 (잘못된 전이 시 409)
- [ ] Idempotency-Key 중복 요청 처리
- [ ] 금액은 minor units (cents) 사용

**의존성:** Slice 0

---

### Slice 2: Haggle Negotiation Extension

**목표:** UCP Extension으로 `ai.haggle.negotiation` 정의 + Checkout에 협상 데이터 첨부

**산출물:**
- Extension JSON Schema 정의
- Checkout Session에 negotiation 필드 추가
- Extension 등록 (Profile에 capability 추가)

**파일:**
```
packages/ucp-adapter/
  src/extension/
    negotiation.ts               ← Extension types + helpers
    schema.ts                    ← JSON Schema for negotiation ext
  src/profile/builder.ts         ← UPDATE: addNegotiationCapability()
  __tests__/negotiation-ext.test.ts
```

**Extension Schema:**
```typescript
interface HaggleNegotiationExtension {
  session_id: string;
  status: 'pending' | 'active' | 'agreed' | 'rejected' | 'expired';
  original_price: number;        // minor units
  current_offer: number | null;
  counter_offer: number | null;
  round: number;
  role: 'BUYER' | 'SELLER';
  utility_score: number | null;
  decision: DecisionAction | null;
  constraints: {
    price_floor: number;         // minor units
    price_ceiling: number;       // minor units
    deadline: string;            // ISO 8601
  };
}
```

**완료 기준:**
- [ ] Extension schema가 UCP allOf composition 규칙 준수
- [ ] Checkout session 생성/조회 시 negotiation 데이터 포함
- [ ] Profile에 `ai.haggle.negotiation` capability 노출

**의존성:** Slice 0, Slice 1

---

### Slice 3: Session Bridge (HNP ↔ UCP)

**목표:** 협상 세션과 체크아웃 세션을 양방향 연결

**산출물:**
- BridgedSession 타입 + 스토어
- UCP Checkout 생성 시 자동 HNP Session 생성
- HNP 라운드 결과가 UCP Checkout의 negotiation extension에 반영
- HNP ACCEPTED → UCP ready_for_complete 자동 전이

**파일:**
```
packages/ucp-adapter/
  src/checkout/
    session-bridge.ts            ← BridgedSession, createBridgedSession()
    mapper.ts                    ← mapRoundResultToExtension(), mapAcceptToCheckout()
  __tests__/session-bridge.test.ts
  __tests__/mapper.test.ts
```

**핵심 로직:**
```typescript
// Checkout 생성 시
function createBridgedSession(
  checkoutRequest: CreateCheckoutRequest,
  strategy: MasterStrategy
): { checkout: CheckoutSession; hnpSession: NegotiationSession; bridge: BridgedSession }

// 오퍼 수신 시
function processNegotiationRound(
  bridge: BridgedSession,
  offer: number,
  roundData: RoundData
): { roundResult: RoundResult; updatedCheckout: CheckoutSession }

// 합의 시
function finalizeAgreement(
  bridge: BridgedSession
): CheckoutSession  // status: ready_for_complete, price updated
```

**완료 기준:**
- [ ] Checkout 생성 → HNP Session 자동 생성
- [ ] 오퍼 → executeRound → Checkout extension 업데이트
- [ ] ACCEPTED → Checkout totals 업데이트 + ready_for_complete
- [ ] REJECTED → Checkout canceled

**의존성:** Slice 1, Slice 2, engine-session

---

### Slice 4: UCP MCP Tools

**목표:** 기존 MCP 라우터에 UCP 체크아웃 + 협상 도구 추가

**산출물:**
- MCP 도구 5개 (create/get/update/complete/cancel checkout)
- 기존 `haggle_submit_offer`를 UCP bridge 경유하도록 연결
- MCP binding 규격 준수 (id 파라미터 분리, JSON-RPC 에러)

**파일:**
```
apps/api/
  src/mcp/tools/
    ucp-checkout.ts              ← UCP checkout MCP tools
  src/mcp/tools/index.ts         ← UPDATE: register UCP tools
packages/ucp-adapter/
  src/transport/mcp.ts           ← MCP-specific adapters
  __tests__/mcp-tools.test.ts
```

**MCP Tool 정의:**
```typescript
// haggle_ucp_create_checkout
{
  name: 'haggle_ucp_create_checkout',
  description: 'Create a UCP checkout session with optional negotiation',
  inputSchema: {
    line_items: LineItem[],
    currency: string,
    negotiate: boolean,        // true면 협상 세션도 생성
    strategy_id?: string       // 사용할 전략 ID
  }
}

// haggle_ucp_submit_offer
{
  name: 'haggle_ucp_submit_offer',
  description: 'Submit a negotiation offer within a UCP checkout session',
  inputSchema: {
    checkout_id: string,
    offer_price: number        // minor units
  }
}
```

**완료 기준:**
- [ ] MCP 도구 5개 등록 + 작동
- [ ] 기존 도구와 충돌 없음
- [ ] JSON-RPC 에러 포맷 준수

**의존성:** Slice 3

---

### Slice 5: Order Webhook Receiver

**목표:** 주문 생성 후 웹훅 수신 + 서명 검증 + 상태 추적

**산출물:**
- Webhook 엔드포인트
- Detached JWT 서명 검증
- Order 상태 추적 (fulfillment events)
- BridgedSession을 COMPLETED로 업데이트

**파일:**
```
packages/ucp-adapter/
  src/order/
    types.ts                     ← Order, FulfillmentEvent, Adjustment
    webhook.ts                   ← verifyWebhookSignature(), processOrderEvent()
  __tests__/webhook.test.ts
apps/api/
  src/ucp/webhooks.ts           ← POST /webhooks/partners/:id/events/order
```

**완료 기준:**
- [ ] Webhook 수신 + 2xx 즉시 응답
- [ ] Detached JWT 서명 검증
- [ ] Order 상태 변경 시 BridgedSession 업데이트
- [ ] fulfillment event 로깅

**의존성:** Slice 1

---

### Slice 6: USDC Payment Handler

**목표:** UCP Payment Handler로 USDC 스테이블코인 결제 정의

**산출물:**
- `ai.haggle.usdc` payment handler 스펙
- Payment instrument 타입 (wallet address, chain, token)
- Payment handler를 UCP Profile에 등록
- Complete checkout 시 USDC 결제 처리 (stub → 실제 온체인은 후속)

**파일:**
```
packages/ucp-adapter/
  src/payment/
    types.ts                     ← UsdcPaymentHandler, UsdcInstrument
    usdc-handler.ts              ← validatePayment(), processPayment() stub
  src/profile/builder.ts         ← UPDATE: addUsdcPaymentHandler()
  __tests__/usdc-handler.test.ts
```

**Payment Handler 정의:**
```json
{
  "ai.haggle.usdc": [{
    "id": "usdc",
    "version": "2026-03-01",
    "config": {
      "supported_chains": ["base", "ethereum", "polygon"],
      "supported_tokens": ["USDC"],
      "settlement_time": "instant"
    }
  }]
}
```

**완료 기준:**
- [ ] Payment handler 스펙 정의
- [ ] Profile에 USDC handler 노출
- [ ] Complete checkout 시 payment validation
- [ ] 실제 온체인 처리는 stub (contracts 패키지 연동은 후속)

**의존성:** Slice 1

---

### Slice 7: E2E Integration Test

**목표:** 전체 흐름 E2E 테스트

**산출물:**
- Discovery → Negotiation → Checkout → Payment → Order 전체 시나리오
- Happy path + Edge cases (timeout, rejection, escalation)

**파일:**
```
packages/ucp-adapter/
  __tests__/e2e/
    full-flow.test.ts            ← 전체 흐름
    negotiation-timeout.test.ts  ← 타임아웃 시나리오
    rejection-flow.test.ts       ← 거부 시나리오
```

**시나리오:**
```
1. Happy Path:
   Discovery → Create Checkout (negotiate=true)
   → Offer $200 → Counter $230 → Offer $220 → Accept $220
   → Complete (USDC) → Order webhook → COMPLETED

2. Rejection:
   Discovery → Create → Offer $100 (too low) → Reject
   → Checkout canceled

3. Timeout:
   Discovery → Create → Offer → Counter → ... → Deadline
   → HNP EXPIRED → Checkout canceled

4. Escalation:
   Discovery → Create → Offer (unusual) → ESCALATE
   → EscalationRequest returned → Checkout requires_escalation
```

**완료 기준:**
- [ ] 4개 시나리오 모두 통과
- [ ] 상태 전이 일관성 검증
- [ ] 금액 정합성 (minor units 전환 포함)

**의존성:** Slice 0-6 전체

---

## 5. Data Model Mapping

### 5.1 Price Mapping (HNP ↔ UCP)

```
HNP (engine-core):  부동소수점 달러 (e.g., 25.00)
UCP:                정수 minor units (e.g., 2500)

변환: ucp_price = Math.round(hnp_price * 100)
역변환: hnp_price = ucp_price / 100
```

**주의:** 모든 변환은 `ucp-adapter` 경계에서 수행. engine-core/session은 변경하지 않음.

### 5.2 Session Status Mapping

| HNP SessionStatus | UCP CheckoutStatus | BridgedStatus |
|--------------------|--------------------|---------------|
| CREATED | incomplete | NEGOTIATING |
| ACTIVE | incomplete | NEGOTIATING |
| NEAR_DEAL | incomplete | NEGOTIATING |
| STALLED | incomplete | NEGOTIATING |
| WAITING (escalate) | requires_escalation | NEGOTIATING |
| ACCEPTED | ready_for_complete | AGREED |
| — (payment done) | completed | COMPLETED |
| REJECTED | canceled | CANCELLED |
| EXPIRED | canceled | EXPIRED |
| SUPERSEDED | canceled | CANCELLED |

### 5.3 Decision ↔ Checkout Action

| DecisionAction | UCP Checkout Effect |
|----------------|---------------------|
| ACCEPT | totals 업데이트 → status: ready_for_complete |
| COUNTER | negotiation extension 업데이트 (counter_offer) |
| REJECT | status: canceled |
| NEAR_DEAL | negotiation extension 업데이트 (NEAR_DEAL status) |
| ESCALATE | status: requires_escalation |

### 5.4 Type Mapping Table

| HNP Type | UCP Type | 변환 위치 |
|----------|----------|-----------|
| `HnpMessage` | `CheckoutSession.negotiation` | `mapper.ts` |
| `NegotiationSession` | `BridgedSession` | `session-bridge.ts` |
| `MasterStrategy` | Profile capabilities config | `builder.ts` |
| `RoundResult` | Checkout update response | `mapper.ts` |
| `EscalationRequest` | `requires_escalation` + `continue_url` | `mapper.ts` |
| `DecisionAction` | Checkout status transition | `mapper.ts` |

---

## 6. Risk & Open Questions

### 6.1 Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| UCP 스펙 변경 (2026-01-23 → 다음 버전) | 타입/API 변경 | Adapter 패턴으로 격리, version negotiation 활용 |
| 협상이 UCP native가 아님 | 플랫폼 호환성 제한 | Extension mechanism 활용, 협상 없이도 기본 checkout 가능 |
| USDC payment handler 비표준 | Google Pay 외 결제 어려움 | Handler 스펙 공개, 커뮤니티 피드백 반영 |
| Minor units 변환 정밀도 | 반올림 오류 | 경계에서만 변환, 내부는 기존 포맷 유지 |
| AP2 mandate 복잡도 | 구현 시간 증가 | Phase 2로 연기, 기본 checkout 먼저 |

### 6.2 Open Questions

1. **Negotiation Extension 표준화**: UCP 커뮤니티에 Negotiation Extension을 제안할 것인가?
   → Google/Shopify와 논의 필요

2. **Multi-item Negotiation**: 단일 아이템 협상만 지원할 것인가, 장바구니 전체를 협상할 것인가?
   → MVP는 단일 아이템, 이후 확장

3. **양방향 협상**: 구매자 AI만 협상하는가, 판매자 AI도 UCP를 통해 응답하는가?
   → MVP는 Haggle이 판매자 측 에이전트, 구매자는 외부 UCP 플랫폼

4. **결제 에스크로**: USDC 결제 시 에스크로 필요 여부?
   → contracts 패키지와 연계, Phase 5에서 결정

5. **테스트 환경**: UCP conformance test suite를 CI에 포함할 것인가?
   → Slice 7에서 판단

---

## Appendix: Slice Dependency Graph

```
Slice 0 (Types + Profile)
    │
    ├── Slice 1 (Checkout CRUD)
    │       │
    │       ├── Slice 3 (Session Bridge) ← engine-session
    │       │       │
    │       │       └── Slice 4 (MCP Tools)
    │       │
    │       ├── Slice 5 (Order Webhooks)
    │       │
    │       └── Slice 6 (USDC Payment)
    │
    └── Slice 2 (Negotiation Extension)
            │
            └── Slice 3 (Session Bridge)

    Slice 7 (E2E Tests) ← All slices
```

## Appendix: Effort Estimate (T-shirt sizing)

| Slice | Size | 설명 |
|-------|------|------|
| Slice 0 | S | 타입 정의 + Profile 엔드포인트 |
| Slice 1 | M | REST CRUD + 상태 머신 + 헤더 처리 |
| Slice 2 | S | Extension 스키마 정의 |
| Slice 3 | L | 핵심 bridge 로직, 양방향 매핑 |
| Slice 4 | M | MCP 도구 등록 + 연결 |
| Slice 5 | M | Webhook + 서명 검증 |
| Slice 6 | M | Payment handler 스펙 + stub |
| Slice 7 | M | E2E 테스트 시나리오 |

**Critical Path:** Slice 0 → Slice 1 → Slice 3 → Slice 4 → Slice 7

**병렬 가능:** Slice 2 | Slice 5 | Slice 6 (Slice 1 이후 동시 진행 가능)

---

*Last Updated: 2026-03-04*
