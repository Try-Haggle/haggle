# Haggle Commerce Backend 코드 리뷰 보고서

**리뷰 대상**: `commerce-core`, `payment-core`, `shipping-core`, `dispute-core`, `db/schema`, `apps/api/routes`
**리뷰 날짜**: 2026-03-25
**테스트 총합**: 765 tests (170 + 231 + 265 + 99)
**브랜치**: `codex/commerce-foundation`

---

## 1. 코드 품질 평가

### 1.1 State Machine 구현 — 평가: 우수

네 개 모듈 모두 동일한 패턴으로 state machine을 구현했다.

```typescript
// 모든 모듈에서 반복되는 패턴 (payment, shipping, dispute)
const TRANSITIONS: Record<Status, Partial<Record<Event, Status>>> = { ... };

export function transitionXxx(status, event): Status | null {
  return TRANSITIONS[status][event] ?? null;
}
```

**장점:**
- Pure function 기반으로 side effect가 없다
- `null` 반환으로 불가능한 전이를 명시적으로 표현
- Terminal state (`SETTLED`, `DELIVERED`, `CLOSED`)의 빈 transition record로 이동 불가를 보장
- Service layer에서 `transitionOrThrow` wrapper로 런타임 안전성 확보

**문제점:**
- `approval-state-machine.ts`에서 `transitionsForMode()`가 매 호출마다 전체 transition table을 새로 생성한다. Mode가 2개뿐이므로 성능 문제는 아니지만, 정적 상수로 두는 것이 더 명확하다.
- State machine의 transition event type이 모듈별로 다른 이름 규칙을 사용한다: payment는 `"quote"`, shipping은 `"label_create"`, dispute는 `"review"`. 일관성을 위해 `verb_noun` 형식으로 통일할 것을 권장한다.

### 1.2 Type Safety — 평가: 양호

**장점:**
- 모든 상태값이 string literal union type으로 정의됨 (e.g., `PaymentIntentStatus`, `ShipmentStatus`)
- `Omit`, `Pick`, `Partial` 등 utility type을 적절히 활용
- Provider interface가 generic하게 설계되어 mock/real adapter 교체가 용이

**문제점:**
- API route에서 `request.params as { id: string }` 형태의 type assertion이 반복적으로 사용된다. Fastify의 generic parameter (`request.params<{ id: string }>`) 또는 schema-based validation으로 대체해야 한다.
- `x402-protocol.ts`에서 `payload: Record<string, unknown>`은 사실상 `any`와 동일하다. x402 payload의 구체적 schema를 정의할 것을 권장한다.
- `easypost-adapter.ts` line 134의 `(r: any)` — EasyPost SDK type을 명시하거나 internal interface를 정의해야 한다.

### 1.3 Error Handling — 평가: 양호, 일부 취약

**장점:**
- Service layer에서 state transition 실패 시 명시적 Error throw
- API route에서 모든 에러를 `try/catch`로 감싸서 structured error response 반환
- `FacilitatorClient`에서 timeout, network error, HTTP error를 모두 구분하는 커스텀 에러 클래스 사용

**문제점:**
- `settlement-release.ts`의 `applyApvAdjustment()` line 179: `new Date().toISOString()`을 직접 호출한다. 다른 함수들은 `now` parameter를 받는 반면 이 함수만 시스템 시간에 의존한다. 테스트에서 시간 제어가 불가능하다.
- `payments.ts` route의 `autoCreateSettlementRelease()` line 167: `catch {}` — 에러를 silent하게 삼킨다. 최소한 logging은 필요하다.
- Webhook handler에서 `catch {}` (shipments.ts line 435)도 동일하게 에러를 무시한다.

---

## 2. 아키텍처 패턴 분석

### 2.1 Provider/Adapter Pattern — 평가: 우수

```
PaymentProvider interface
├── MockX402Adapter
├── MockStripeAdapter
├── RealX402Adapter (heavy, not barrel-exported)
└── (future: StripeAdapter)

CarrierProvider interface
├── MockCarrierAdapter
└── EasyPostCarrierAdapter

FacilitatorClient interface
├── HttpFacilitatorClient
└── MockFacilitatorClient
```

이 구조는 Dependency Inversion Principle을 잘 따른다. 각 adapter는 interface를 구현하고, Service는 interface에만 의존한다. Heavy module (`viem-contracts.ts`, `real-x402-adapter.ts`)을 barrel export에서 제외한 것은 tree-shaking과 테스트 격리 측면에서 좋은 판단이다.

### 2.2 Module Boundary Design — 평가: 우수

`service-boundary.ts`에서 모듈 경계를 선언적으로 정의한 것은 아키텍처 문서화와 런타임 검증 양쪽에서 유용하다.

```typescript
COMMERCE_MODULE_BOUNDARIES: ModuleBoundary[] = [
  { name: "payment", owns_entities: [...], emits_events: [...], consumes_events: [...] },
  // ...
];
```

각 모듈이 `can_run_as_standalone_service: true`로 선언되어 있어, 향후 마이크로서비스 분리를 고려한 설계다.

### 2.3 Event/Trust Integration Pattern — 평가: 양호

모든 Service operation이 `trust_triggers: TrustTriggerEvent[]`를 반환하는 패턴은 일관되고 효과적이다. 다만 실제 trust trigger 처리가 API route layer에서 inline으로 이루어진다.

```typescript
// 이 패턴이 payments.ts, shipments.ts, disputes.ts 전체에서 반복됨
if (result.trust_triggers.length > 0) {
  await applyTrustTriggers(db, { order_id, buyer_id, seller_id, triggers });
}
```

이것은 middleware 또는 event bus로 추출해야 할 cross-cutting concern이다.

### 2.4 Settlement Release 2-Phase Pattern — 평가: 우수

Product payment과 Weight buffer를 분리한 2-phase release 설계는 Haggle의 핵심 차별점이다. Pure function chain으로 구현되어 테스트가 용이하다:

```
createSettlementRelease → confirmDelivery → completeBuyerReview → [product released]
                                          → applyApvAdjustment → completeBufferRelease → [buffer released]
```

`computeReleasePhase()`로 현재 상태를 5개 phase 중 하나로 환원하는 것도 클라이언트 친화적이다.

### 2.5 주요 아키텍처 문제

**Dispute → Trust trigger에서 buyer_id/seller_id 미해결 (Critical)**

`disputes.ts` route line 211-212:
```typescript
buyer_id: "", // TODO: resolve from order
seller_id: "", // TODO: resolve from order
```

Dispute resolution 시 trust trigger가 빈 actor_id로 전파된다. 이것은 trust ledger 데이터 무결성을 손상시키는 실제 버그다.

---

## 3. 테스트 커버리지 분석

### 3.1 테스트 품질 평가

| 모듈 | 테스트 수 | 패턴 | 강점 | 약점 |
|------|-----------|------|------|------|
| commerce-core | 170 | Unit | State machine 전이 조합 완전 검증, edge case 커버 | Integration test 없음 |
| payment-core | 231 | Unit + Mock | Provider adapter 교체 테스트, execution guard 검증 | Real adapter 테스트 부재 |
| shipping-core | 265 | Unit + Mock | SLA 위반, escalation, webhook parsing 검증 | EasyPost 실제 응답 fixture 부재 |
| dispute-core | 99 | Unit | Vote aggregation 수학적 검증, reason code 완전성 | Service layer 테스트 상대적으로 얕음 |

**공통 강점:**
- Helper factory function (`makeIntent()`, `makeShipment()`, `makeOpenCase()`)으로 테스트 데이터 구성이 깔끔
- `it.each`를 활용한 parameterized test로 state machine 전이표를 완전히 검증
- Edge case (zero votes, max weight, expired hold 등)를 명시적으로 테스트

**공통 약점:**
- **API route 테스트가 전무하다.** 765개 테스트가 모두 core package의 unit test이며, `apps/api/src/routes/`에 대한 integration test가 없다.
- DB service layer (`payment-record.service.ts`, `shipment-record.service.ts` 등)의 테스트도 없다.
- Cross-module integration test (payment settled → auto-create settlement release → shipping delivered → confirm delivery) 부재.

### 3.2 Vote Aggregation Test 특기사항

`vote-aggregation.ts`의 수학적 알고리즘은 가장 복잡한 비즈니스 로직 중 하나다. Small panel (weighted majority)과 Large panel (trimmed mean + agreement zone)의 분리, expertise bonus, 그리고 compensation calculation까지 테스트가 상세하다. 이 부분은 프로덕션 수준에 가깝다.

---

## 4. DB 스키마 평가

### 4.1 Schema 설계 — 평가: 양호, 개선 필요

**장점:**
- Drizzle ORM의 type-safe schema 정의
- `numeric(precision: 18, scale: 0)`으로 금액을 minor unit(정수)으로 저장
- `timestamp with timezone`을 모든 시간 필드에 사용
- `jsonb`로 유연한 메타데이터 저장

**문제점:**

**Foreign Key 미정의 (Critical)**

모든 테이블에서 `orderId`, `paymentIntentId`, `disputeId` 등의 참조가 `.notNull()`만 걸려 있고, `.references()`가 없다.

```typescript
// 현재: FK constraint 없음
orderId: uuid("order_id").notNull(),

// 필요: FK constraint + cascade 정책
orderId: uuid("order_id").notNull().references(() => commerceOrders.id),
```

이것은 데이터 무결성 측면에서 가장 시급한 문제다. orphan record가 생길 수 있다.

**Index 미정의 (Critical)**

- `shipments.tracking_number` — webhook에서 tracking number로 조회하는데 인덱스가 없다. Route 코드에 `// In production, we'd have an index on tracking_number` 주석이 있다.
- `payment_intents.order_id` — order별 결제 조회
- `dispute_cases.order_id` — order별 분쟁 조회
- `trust_penalty_records.actor_id` — actor별 신뢰 이력 조회
- `settlement_releases.order_id` — order별 release 조회

**`AWAITING_BUYER_APPROVAL` enum 누락**

`commerce-orders.ts`의 `settlementApprovals` 테이블에서 `approval_state` enum에 `AWAITING_BUYER_APPROVAL`이 빠져 있다. `approval-policy.ts`의 `ApprovalState` type에는 존재한다.

**Schema와 Core type 간 불일치**

`commerceOrders.status`의 enum 값 (`APPROVED`, `PAYMENT_PENDING`, `PAID` ...)과 `order-lifecycle.ts`의 `OrderPhase` type (`NEGOTIATION`, `APPROVAL`, `PAYMENT` ...)이 다른 용어를 사용한다. 이 두 모델 간의 매핑 전략이 문서화되어야 한다.

### 4.2 Migration 준비도

- Drizzle의 `drizzle-kit` migration generation이 가능한 구조
- 그러나 `drizzle.config.ts`나 migration 폴더가 확인되지 않았다
- FK/Index 추가 시 migration script 필요

---

## 5. API 설계 평가

### 5.1 RESTful Convention — 평가: 양호

| Endpoint Pattern | HTTP Method | 평가 |
|------------------|------------|------|
| `/payments/prepare` | POST | 적절 (intent 생성) |
| `/payments/:id/quote` | POST | 적절 (action trigger) |
| `/payments/:id/authorize` | POST | 적절 |
| `/payments/:id/settle` | POST | 적절 |
| `/payments/:id/refund` | POST | 적절 |
| `/shipments` | POST/GET | 적절 |
| `/shipments/:id/label` | POST | 적절 |
| `/shipments/:id/event` | POST | 적절 |
| `/disputes` | POST/GET | 적절 |
| `/disputes/:id/resolve` | POST | 적절 |
| `/settlement-releases` | POST/GET | 적절 |

Action-oriented endpoint (`/authorize`, `/settle`, `/resolve`)는 RPC 스타일이지만, 금융 도메인에서는 이것이 표준적 접근이다.

### 5.2 Input Validation — 평가: 양호

Zod schema로 모든 request body를 검증한다. `safeParse` 사용으로 validation 실패 시 400 + 구체적 error issues를 반환한다.

```typescript
const parsed = openDisputeSchema.safeParse(request.body);
if (!parsed.success) {
  return reply.code(400).send({ error: "INVALID_DISPUTE_REQUEST", issues: parsed.error.issues });
}
```

**문제점:**
- Path parameter validation이 없다. `(request.params as { id: string }).id`는 UUID format 검증을 하지 않는다.
- Rate limiting이 없다. Webhook endpoint가 public으로 노출될 경우 DoS에 취약하다.

### 5.3 Authentication — 평가: 취약 (Known Issue)

```typescript
// TODO(security): Replace header-based actor with JWT/session auth middleware.
// Currently trusts x-haggle-actor-id header — any caller can impersonate any user.
function actorFromHeaders(headers: Record<string, unknown>) {
  const actorId = headers["x-haggle-actor-id"];
  const actorRole = headers["x-haggle-actor-role"];
  return {
    actor_id: typeof actorId === "string" ? actorId : "",
    actor_role: actorRoleSchema.parse(actorRole),
  };
}
```

이것은 이미 인지된 취약점이다. 현재는 payment route에서만 actor를 사용하지만, 프로덕션 전에 반드시 JWT/OAuth 기반 인증으로 교체해야 한다.

**추가 보안 문제:**
- Webhook signature 검증이 EasyPost에만 구현되어 있다. x402 webhook은 header 존재만 확인하고 실제 서명 검증을 하지 않는다.
- Stripe webhook signature 검증도 미구현 (header 존재만 확인).

### 5.4 Error Response 일관성 — 평가: 양호

모든 에러가 `{ error: "ERROR_CODE", message?: string, issues?: ZodIssue[] }` 형태로 반환된다. Error code가 대문자 snake_case로 일관되며, HTTP status code도 적절하다 (400/404/401).

---

## 6. Integration Points 분석

### 6.1 Payment → Settlement Release

`payments.ts`에서 `settleIntent` 성공 시 `autoCreateSettlementRelease()`를 호출한다. Weight buffer 계산은 기본값 16oz(1lb)를 사용하며, 실제 무게가 알려지면 후속 조정이 가능하다.

**문제:** 이 auto-creation이 실패해도 결제 자체는 성공으로 처리된다. Settlement release가 없는 settled payment가 존재할 수 있으며, 이를 감지하는 메커니즘이 없다.

### 6.2 Shipping → Settlement Release

`shipments.ts`의 `autoConfirmDeliveryIfNeeded()`가 배송 완료 시 settlement release의 buyer review를 자동으로 시작한다. EasyPost webhook에서도 동일한 경로가 동작한다.

**문제:** APV invoice webhook에서 `applyApvAdjustment`가 양수 adjustment만 처리한다 (line 375: `if (invoice.adjustment_minor > 0)`). 음수 adjustment (carrier가 과다 청구한 경우)는 무시된다.

### 6.3 Dispute → Refund

Dispute resolution에서 `buyer_favor`나 `partial_refund` 결과가 나와도 실제 refund를 자동 트리거하지 않는다. 현재는 수동으로 `/payments/:id/refund`를 호출해야 한다. 이 연결이 누락되어 있다.

### 6.4 Trust Ledger 통합

Trust trigger 전파는 모든 모듈에서 일관되게 구현되어 있으나, dispute module에서 buyer_id/seller_id 미해결 문제(섹션 2.5 참조)가 전체 trust 무결성을 손상시킨다.

---

## 7. 프로덕션 준비도 점수

| 모듈 | 점수 (1-10) | 근거 |
|------|:-----------:|------|
| **commerce-core** | 7 | Pure function 설계 우수. Integration 부족 |
| **payment-core** | 6 | Provider pattern 우수. 보안(auth) 미비. Settlement release 연결 취약 |
| **shipping-core** | 7 | EasyPost 통합 완성도 높음. Webhook 보안 양호. Index 부재 |
| **dispute-core** | 5 | Vote aggregation 수학적 완성도 높으나, trust trigger bug + refund 미연결 |
| **db/schema** | 4 | FK/Index 미정의. Migration 미준비. Enum 불일치 |
| **api/routes** | 4 | Auth 미비. Integration test 전무. Rate limiting 없음 |

**전체 평균: 5.5/10** — 핵심 비즈니스 로직의 설계와 구현은 우수하나, DB 무결성과 API 보안이 프로덕션에 부적합하다.

---

## 8. 우선순위별 개선 필요 사항

### P0 (Critical — 프로덕션 전 필수)

1. **DB Foreign Key 추가** — 모든 참조 컬럼에 `.references()` 정의
2. **DB Index 추가** — `tracking_number`, `order_id`, `actor_id` 등 조회 키
3. **Authentication 교체** — `x-haggle-actor-id` header → JWT/session 기반 인증
4. **Dispute trust trigger bug 수정** — `buyer_id`/`seller_id`를 order에서 resolve
5. **Webhook signature 검증 완성** — x402/Stripe webhook에 실제 HMAC 검증 구현

### P1 (Important — Early Production)

6. **API integration test 추가** — Fastify `inject()`로 전체 route 테스트
7. **Cross-module E2E test** — Payment → Settlement Release → Shipping → Dispute 흐름
8. **Dispute → Refund 자동 트리거** — Resolution 후 refund pipeline 연결
9. **Rate limiting** — Public endpoint (webhook)에 rate limiter 적용
10. **`applyApvAdjustment` 시간 주입** — `new Date()` 제거, `now` parameter 추가

### P2 (Recommended — Quality Improvement)

11. **Path parameter validation** — Fastify schema 또는 Zod로 UUID format 검증
12. **Trust trigger 처리 middleware화** — 반복 코드 추출
13. **Settlement release orphan 감지** — SETTLED payment 중 release 없는 건 모니터링
14. **State machine event naming 통일** — `verb_noun` 형식으로 일관화
15. **Schema/Core type 매핑 문서화** — `commerceOrders.status` vs `OrderPhase` 관계 명시
16. **음수 APV adjustment 처리** — 과다 청구 시 buyer 환불 경로

---

## 9. 결론

Haggle의 commerce backend는 **핵심 비즈니스 로직 설계에서 높은 성숙도**를 보인다. Pure function 기반 state machine, Provider/Adapter 분리, 2-phase Settlement Release, Trust Ledger 통합은 P2P 커머스 프로토콜로서 well-architected된 설계다. 765개의 unit test가 수학적 정확성과 state transition 완전성을 검증한다.

그러나 **인프라 레이어(DB, API, Auth)**가 프로토타입 수준에 머물러 있다. FK/Index 미정의, 인증 부재, integration test 전무는 프로덕션 배포 전에 반드시 해결해야 하는 structural gap이다.

**권장 접근:**
1. P0 항목 먼저 해결 (DB 무결성 + Auth)
2. P1 항목으로 integration test layer 구축
3. 이후 P2 항목으로 quality 향상

핵심 엔진의 설계 품질을 고려하면, 인프라 보강에 집중하면 프로덕션 준비도를 빠르게 올릴 수 있다.
