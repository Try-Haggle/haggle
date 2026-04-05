# Haggle Commerce Module Security Audit Report

**Date**: 2026-03-25
**Scope**: Payment, Shipping, Dispute, Smart Contract, Cross-Module
**Branch**: `codex/commerce-foundation`
**Severity Scale**: CRITICAL > HIGH > MEDIUM > LOW > INFO

---

## Executive Summary

Haggle의 Commerce 모듈 전체에 대한 보안 감사를 수행한 결과, **CRITICAL 3건, HIGH 7건, MEDIUM 8건**의 보안 이슈를 식별했다. 가장 긴급한 문제는 (1) 인증 없는 actor impersonation, (2) webhook signature 미검증, (3) settlement/dispute 엔드포인트에 대한 authorization 부재이다. 이 세 가지는 프로덕션 배포 전 반드시 수정해야 한다.

전반적으로 핵심 비즈니스 로직(state machine, utility 계산, vote aggregation)은 견고하게 설계되어 있으나, API 레이어의 access control이 체계적으로 부재하여 모든 엔드포인트가 무방비 상태이다.

---

## 1. CRITICAL -- 프로덕션 배포 전 반드시 수정

### CRIT-01: Actor Impersonation via Unverified Header

**파일**: `apps/api/src/routes/payments.ts:103-114`
**CWE**: CWE-287 (Improper Authentication)

```typescript
// TODO(security): Replace header-based actor with JWT/session auth middleware.
// Currently trusts x-haggle-actor-id header -- any caller can impersonate any user.
function actorFromHeaders(headers: Record<string, unknown>) {
  const actorId = headers["x-haggle-actor-id"];
  const actorRole = headers["x-haggle-actor-role"];
  return {
    actor_id: typeof actorId === "string" ? actorId : "",
    actor_role: actorRoleSchema.parse(actorRole),
  };
}
```

**공격 시나리오**:
- 공격자가 `x-haggle-actor-id: victim_seller_123`과 `x-haggle-actor-role: seller`를 설정하여 임의의 판매자로 결제를 생성/조작
- buyer로 위장하여 다른 사람의 주문에 대해 refund를 요청
- seller로 위장하여 settlement approval을 조작

**영향도**: 플랫폼 전체의 자금 흐름을 공격자가 제어 가능. USDC 직접 탈취 가능성.

**대응 방안**:
1. JWT 기반 인증 미들웨어 도입 (Auth0/Clerk/자체 구현)
2. 모든 금융 라우트에 `requireAuth()` 미들웨어 적용
3. actor_id를 JWT claim에서 추출, header 신뢰 제거
4. actor_role은 DB의 user record에서 조회 (header 불신)

**우선순위**: 즉시 수정 필요. 이 하나의 취약점이 전체 시스템을 무효화한다.

---

### CRIT-02: Webhook Signature 검증 불완전 (x402/Stripe)

**파일**: `apps/api/src/routes/payments.ts:116-125`

```typescript
function requireWebhookSignature(headers: Record<string, unknown>, provider: "x402" | "stripe") {
  const key =
    provider === "x402"
      ? (headers["x-haggle-x402-signature"] as string | undefined)
      : (headers["stripe-signature"] as string | undefined);
  if (!key || typeof key !== "string") {
    throw new Error(`missing ${provider} webhook signature`);
  }
  // NOTE: signature presence만 확인, 실제 cryptographic verification 없음
}
```

**문제점**:
- x402 webhook: header **존재 여부**만 확인하고 실제 HMAC/signature 검증 없음
- Stripe webhook: `stripe-signature` header 존재만 확인, `stripe.webhooks.constructEvent()` 미호출
- 아무 문자열이나 해당 header에 넣으면 통과

**공격 시나리오**:
- 공격자가 가짜 x402 settlement 완료 webhook을 전송하여 실제 결제 없이 SETTLED 상태로 전환
- 가짜 Stripe webhook으로 결제 확인 위조

**영향도**: 결제 없이 상품 수령 가능. 플랫폼 재정적 손실.

**대응 방안**:
1. x402: Coinbase CDP의 webhook signature verification SDK 사용
2. Stripe: `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` 적용
3. EasyPost webhook은 이미 올바르게 HMAC-SHA256 검증 구현됨 -- 같은 패턴을 x402/Stripe에 적용

---

### CRIT-03: Settlement/Dispute 엔드포인트 Authorization 부재

**파일**:
- `apps/api/src/routes/settlement-releases.ts` (전체)
- `apps/api/src/routes/disputes.ts` (전체)
- `apps/api/src/routes/shipments.ts` (전체)

**문제점**: 모든 라우트에 인증/인가 미들웨어가 없다.

| Endpoint | 위험도 | 공격 |
|----------|--------|------|
| `POST /settlement-releases/:id/complete-buyer-review` | 극심 | 아무나 buyer review를 완료하여 자금 조기 릴리스 |
| `POST /settlement-releases/:id/release-buffer` | 극심 | 아무나 weight buffer를 릴리스 |
| `POST /disputes/:id/resolve` | 극심 | 아무나 분쟁을 원하는 방향으로 해결 |
| `POST /payments/:id/settle` | 극심 | 아무나 결제를 SETTLED로 전환 |
| `POST /payments/:id/refund` | 극심 | 아무나 환불 요청 |
| `POST /shipments/:id/event` | 높음 | 가짜 배송 이벤트로 DELIVERED 처리 |

**영향도**: 인증된 사용자가 아니어도 자금 릴리스, 분쟁 조작, 배송 상태 위조 가능.

**대응 방안**:
1. 글로벌 인증 미들웨어 (JWT/session)
2. 라우트별 RBAC (Role-Based Access Control):
   - Settlement release 완료: buyer 본인 또는 system만
   - Dispute resolve: system/admin만 (Reviewer panel 결과 기반)
   - Payment settle: system만 (x402 facilitator callback)
   - Refund: buyer 본인 + 조건 충족 시
3. Resource ownership 검증: `intent.buyer_id === auth.actor_id`

---

## 2. HIGH -- 프로덕션 전 수정 권장

### HIGH-01: Race Condition in Trust Ledger Upsert

**파일**: `apps/api/src/services/trust-ledger.service.ts:72-142`

```typescript
const existing = await db.query.settlementReliabilitySnapshots.findFirst({ ... });
if (existing) {
  // atomic increment -- OK
  await db.update(...).set({ [col]: sql`${sql.identifier(col)} + 1` });
} else {
  // INSERT -- race condition 가능
  await db.insert(settlementReliabilitySnapshots).values({ ... });
}
```

**문제점**: 동시에 두 trigger가 같은 actor에 대해 발생하면, 두 goroutine 모두 `existing = null`을 읽고 두 번 INSERT를 시도한다. unique constraint가 있으면 하나가 실패, 없으면 중복 생성.

**대응 방안**: `INSERT ... ON CONFLICT DO UPDATE` (upsert) 패턴 적용. `ensureCommerceOrderForApproval`에서 이미 이 패턴을 올바르게 사용 중이므로, 같은 접근법을 trust ledger에도 적용.

---

### HIGH-02: ID 생성 시 Cryptographic Randomness Fallback 취약

**파일**: `packages/dispute-core/src/id.ts:1-11`

```typescript
const uuid =
  typeof cryptoApi.crypto?.randomUUID === "function"
    ? cryptoApi.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
```

**문제점**: `crypto.randomUUID`가 없는 환경에서 `Math.random()` fallback 사용. `Math.random()`은 예측 가능하므로, dispute ID/evidence ID를 공격자가 추측 가능.

동일 패턴이 `apps/api/src/routes/payments.ts:490-492`의 refund ID 생성에도 존재.

**대응 방안**:
1. Node.js 환경에서는 항상 `crypto.randomUUID()` 사용 가능 (v19+)
2. Fallback으로 `crypto.randomBytes(16).toString('hex')` 사용
3. `Math.random()` 기반 fallback 완전 제거

---

### HIGH-03: EasyPost Webhook Secret 미설정 시 검증 Skip

**파일**: `apps/api/src/routes/shipments.ts:341-351`

```typescript
if (easypostWebhookSecret) {
  // ... verify ...
  if (!isValid) {
    return reply.code(401).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
  }
}
// secret이 없으면 검증 자체를 건너뜀
```

**문제점**: `EASYPOST_WEBHOOK_SECRET` 환경변수가 설정되지 않으면 webhook 서명 검증이 완전히 건너뛰어진다. 프로덕션에서 실수로 미설정 시 가짜 배송 이벤트 주입 가능.

**대응 방안**:
1. 프로덕션 환경에서 secret 미설정 시 서버 시작 실패 (startup validation)
2. 또는 secret 없으면 webhook 엔드포인트 자체를 비활성화
3. `process.env.NODE_ENV === 'production' && !easypostWebhookSecret` 검사 추가

---

### HIGH-04: API Key Secrets Exposed in HTTP Headers

**파일**: `apps/api/src/payments/facilitator-client.ts:15-26`

```typescript
private buildHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (this.apiKeyId) headers["x-cdp-api-key-id"] = this.apiKeyId;
  if (this.apiKeySecret) headers["x-cdp-api-key-secret"] = this.apiKeySecret;
  return headers;
}
```

**문제점**: CDP API key secret이 매 요청마다 HTTP header로 전송된다. TLS 위에서 동작하지만:
- 로그에 header가 기록될 수 있음 (Fastify logger 설정에 따라)
- 프록시/CDN에서 header가 캐싱/기록될 수 있음
- 서버 메모리 덤프에 노출

**대응 방안**:
1. Fastify logger에서 sensitive headers를 redact 처리
2. Request logging에서 `x-cdp-api-key-secret` 필터링
3. 가능하면 OAuth2 token 교환 방식으로 전환

---

### HIGH-05: Relayer Private Key 환경변수 직접 사용

**파일**: `apps/api/src/payments/providers.ts:74`

```typescript
const relayerPrivateKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
```

**문제점**: Relayer private key가 환경변수에 평문으로 존재. 이 키로 settlement router에 트랜잭션을 서명하므로, 탈취 시 router 컨트랙트의 모든 기능을 공격자가 실행 가능.

**대응 방안**:
1. AWS KMS, GCP Cloud KMS, 또는 HashiCorp Vault에서 key management
2. Turnkey/Privy 같은 MPC wallet 사용
3. 최소 권한 원칙: relayer key는 settlement execution만 가능하도록 컨트랙트에서 role 제한
4. Key rotation 메커니즘 구축

---

### HIGH-06: Dispute Resolution의 Trust Trigger에서 buyer_id/seller_id 미해결

**파일**: `apps/api/src/routes/disputes.ts:207-216`

```typescript
await applyTrustTriggers(db, {
  order_id: fullDispute.order_id,
  buyer_id: "", // TODO: resolve from order
  seller_id: "", // TODO: resolve from order
  triggers: result.trust_triggers,
});
```

**문제점**: dispute 해결 시 trust penalty가 빈 문자열 actor에게 적용된다. 결과적으로:
- 분쟁 패배자의 trust score가 감소하지 않음
- 분쟁 승리자의 trust score가 증가하지 않음
- 빈 문자열 actor_id로 onchain trust profile이 생성될 수 있음

**영향도**: Trust 시스템의 무결성 훼손. 악성 사용자가 분쟁에서 져도 penalty 없음.

**대응 방안**: dispute 생성 시 buyer_id/seller_id를 order에서 조회하여 DisputeCase에 포함하거나, resolution 시점에 commerce_orders 테이블에서 조회.

---

### HIGH-07: Payment State Transition 무제한 호출

**파일**: `apps/api/src/routes/payments.ts:375-455`

`/payments/:id/authorize`, `/payments/:id/settle`, `/payments/:id/fail`, `/payments/:id/cancel` 등의 state transition 엔드포인트가 인증 없이 공개되어 있다.

**공격 시나리오**:
- 공격자가 다른 사용자의 payment intent ID를 알면 (예측 가능하거나 enumeration 가능한 경우):
  - `POST /payments/{id}/settle` -- 실제 결제 없이 settled 처리
  - `POST /payments/{id}/fail` -- 정상 결제를 실패 처리
  - `POST /payments/{id}/cancel` -- 진행 중인 결제를 취소

**대응 방안**: CRIT-03의 인증/인가 해결과 동일. 추가로 state transition은 system-only 또는 해당 actor만 가능하도록 제한.

---

## 3. MEDIUM -- 보안 강화 권장

### MED-01: Rate Limiting 부재

**영향 범위**: 전체 API 서버

Rate limiting이 전혀 구현되지 않았다. 다음 공격이 가능하다:
- Dispute flooding: 대량의 분쟁을 열어 리뷰어 리소스 고갈
- Payment enumeration: payment intent ID 무차별 탐색
- Webhook replay: 같은 webhook을 반복 전송
- Shipment event spam: 가짜 이벤트 대량 주입

**대응 방안**:
1. `@fastify/rate-limit` 플러그인 적용
2. 금융 엔드포인트: 10 req/min per user
3. Webhook 엔드포인트: IP 기반 rate limit + idempotency key
4. Dispute 생성: order당 1개 제한 (이미 논리적으로는 해당하나, DB 제약조건 없음)

---

### MED-02: Webhook Replay Attack 방어 부재

**파일**: `apps/api/src/routes/shipments.ts`, `apps/api/src/routes/payments.ts`

**문제점**: webhook이 idempotency check 없이 처리된다. 같은 webhook을 여러 번 전송하면:
- 같은 shipment event가 반복 기록
- APV adjustment가 중복 적용 (금액 변조)
- Trust trigger가 중복 발생 (trust score 왜곡)

**대응 방안**:
1. Webhook event에 대한 idempotency key 저장 (EasyPost event ID 등)
2. 처리 전 `SELECT` + duplicate 체크
3. Stripe의 경우 event.id 기반 deduplication
4. timestamp 기반 만료 (10분 이상 된 webhook 거부)

---

### MED-03: settlement_approval Inline 전달 허용

**파일**: `apps/api/src/routes/payments.ts:74-83`

```typescript
const preparePaymentSchema = z.object({
  settlement_approval_id: z.string().optional(),
  settlement_approval: settlementApprovalSchema.optional(),  // 클라이언트가 직접 전달 가능
});
```

**문제점**: 클라이언트가 settlement_approval 객체를 직접 전달할 수 있다. 공격자가 조작된 approval을 전달하면:
- `final_amount_minor`를 0으로 설정하여 무료 구매
- `seller_id`를 자신의 ID로 설정하여 자기 결제
- `selected_payment_rail`을 조작

**대응 방안**: `settlement_approval` 인라인 전달을 제거하고, 반드시 `settlement_approval_id`로만 서버 DB에서 조회하도록 변경. 최소한 인라인 전달 시 DB의 승인 기록과 교차 검증 필수.

---

### MED-04: CORS 정책 과도하게 관대

**파일**: `apps/api/src/server.ts:22-33`

```typescript
origin: [
  "https://chatgpt.com",
  "https://chat.openai.com",
  /\.vercel\.app$/,   // 모든 vercel.app 서브도메인 허용
  "https://tryhaggle.ai",
  /^http:\/\/localhost:\d+$/,
],
```

**문제점**:
- `/\.vercel\.app$/` -- 아무나 vercel에 배포한 앱이 API에 접근 가능
- localhost 패턴이 프로덕션에서도 활성화
- `credentials: true`와 함께 broad origin은 CSRF 위험 증가

**대응 방안**:
1. Vercel origin을 구체적 도메인으로 제한 (예: `haggle-*.vercel.app`)
2. 프로덕션에서 localhost 제거
3. `NODE_ENV`에 따른 조건부 CORS 설정

---

### MED-05: Evidence URI 검증 미비

**파일**: `apps/api/src/routes/disputes.ts:20-30`

```typescript
z.object({
  type: z.enum(["text", "image", "tracking_snapshot", "payment_proof", "other"]),
  uri: z.string().optional(),  // 아무 문자열이나 가능
  text: z.string().optional(),
})
```

**문제점**: evidence URI에 대한 검증이 없다.
- SSRF: `uri: "http://169.254.169.254/latest/meta-data/"` 같은 내부 메타데이터 접근
- XSS: `uri: "javascript:alert(1)"` 같은 악성 URI
- 크기 제한 없음: 매우 긴 URI로 DB 과부하

**대응 방안**:
1. URI scheme 검증 (`https://`만 허용)
2. URI 길이 제한 (2048자)
3. 허용된 도메인 화이트리스트 (S3 버킷 등)
4. text 필드 길이 제한

---

### MED-06: Partial Refund에서 PARTIAL_REFUND 항상 buyer_favor 처리

**파일**: `packages/dispute-core/src/trust-events.ts:18-20`

```typescript
case "PARTIAL_REFUND":
  return [
    { module: "dispute", actor_role: "buyer", type: "dispute_win" },
    { module: "dispute", actor_role: "seller", type: "dispute_loss" },
  ];
```

**문제점**: partial refund가 항상 buyer win / seller loss로 기록된다. 실제로는 partial refund의 비율에 따라 판단이 달라야 한다 (예: 90% 환불은 buyer favor, 10% 환불은 seller favor에 가까움).

**대응 방안**: refund 비율에 따른 가중 trust trigger. 50% 이상이면 buyer_favor, 미만이면 nuanced한 처리.

---

### MED-07: autoCreateSettlementRelease 실패 시 Silent Catch

**파일**: `apps/api/src/routes/payments.ts:147-171`

```typescript
try {
  // ... create settlement release ...
} catch {
  // Non-critical: log but don't fail the settlement
  return null;
}
```

**문제점**: Settlement release 생성 실패가 완전히 무시된다. 이 경우:
- 결제는 SETTLED이지만 buyer protection(delivery review, weight buffer)이 없음
- 판매자에게 즉시 전액 지급되어 buyer protection이 무효화

**대응 방안**:
1. 실패 시 structured error logging (Sentry/DataDog)
2. 재시도 큐에 등록 (dead letter queue)
3. 최소한 API 응답에 `settlement_release_warning` 포함

---

### MED-08: Smart Contract ABI에 Emergency Exit / Pause 함수 미포함

**파일**: `packages/contracts/src/index.ts`

ABI에 `executeSettlement`과 `anchorDispute`만 정의되어 있고, 다음이 없다:
- `pause()` / `unpause()`
- `emergencyWithdraw()`
- `setTimelock()`
- `upgradeTo()`

**문제점**: 컨트랙트가 아직 스텁이지만, 설계 단계에서 emergency exit 패턴이 ABI에 반영되지 않으면 실제 구현 시 누락될 수 있다.

**대응 방안**: 최소한 ABI 타입에 governance 함수 stub 추가:
- `pause()`: 새 deposit 차단
- `emergencyWithdraw(address to)`: timelock 기간 중 사용자 자금 인출
- `setTimelockDelay(uint256)`: timelock 기간 조정 (multisig only)

---

## 4. Industry Comparison

### vs eBay

| 영역 | eBay | Haggle | 평가 |
|------|------|--------|------|
| 인증 | OAuth 2.0 + session | Header trust (미구현) | Haggle 심각 열위 |
| 결제 보호 | Managed Payments + 에스크로 | 2-phase settlement (설계 양호) | 설계는 우수, 구현 불완전 |
| 분쟁 해결 | 전문 CS팀 | 3-tier system + vote aggregation | Haggle 더 탈중앙적 |
| Webhook 보안 | HMAC-SHA256 + timestamp | 존재 확인만 (x402/Stripe) | Haggle 열위 |
| 환불 | 자동화된 프로세스 | 인증 없는 엔드포인트 | Haggle 심각 열위 |

### vs Kleros

| 영역 | Kleros | Haggle | 평가 |
|------|--------|--------|------|
| 분쟁 deposit | PNK staking | Fiat deposit (Kleros 모델 참고) | 비슷한 접근 |
| Reviewer 선택 | Random + stake weighted | Tier weighted + expertise match | Haggle 더 정교 |
| Vote aggregation | Schelling point | Small panel majority + large panel trimmed mean | Haggle 우수 |
| On-chain 증거 | Evidence Standard (ERC-1497) | evidenceRootHash anchoring | Haggle 더 간결 |
| Sybil resistance | PNK staking | Trust tier | Haggle 추가 개발 필요 |

### vs OpenSea

| 영역 | OpenSea | Haggle | 평가 |
|------|---------|--------|------|
| 컨트랙트 보안 | Seaport (audited, battle-tested) | 스텁 단계 | Haggle 미완성 |
| Key management | AWS KMS + HSM | 환경변수 평문 | Haggle 열위 |
| Proxy upgrade | UUPS + timelock | 설계 문서에만 존재 | 구현 필요 |
| Rate limiting | 엄격한 API rate limit | 없음 | Haggle 심각 열위 |

---

## 5. Specific Attack Vectors and Mitigations

### Attack Vector 1: Free Purchase Attack

```
1. 공격자가 listing 확인
2. x-haggle-actor-id: attacker, x-haggle-actor-role: buyer로 POST /payments/prepare
3. settlement_approval을 inline으로 조작 (amount_minor: 0)
4. POST /payments/:id/settle 호출
5. settlement 완료 -- 0 USDC로 상품 구매
```

**Mitigation**: CRIT-01 + MED-03 동시 해결 필요.

---

### Attack Vector 2: Fake Delivery Fund Release

```
1. 공격자가 shipment ID를 enumeration으로 확보
2. POST /shipments/:id/event { event_type: "deliver" }
3. autoConfirmDeliveryIfNeeded() 실행 -- buyer review 시작
4. POST /settlement-releases/:id/complete-buyer-review
5. 판매자에게 자금 릴리스 -- 실제 배송 없이
```

**Mitigation**: CRIT-03 (인증) + 배송 이벤트는 webhook 또는 system-only.

---

### Attack Vector 3: Double APV Adjustment

```
1. EasyPost APV webhook 수신
2. 같은 webhook을 수동으로 다시 전송 (replay)
3. apv_adjustment_minor가 두 번 적용
4. buffer 금액이 왜곡 -- 판매자가 초과 청구됨
```

**Mitigation**: MED-02 (idempotency key) 적용.

---

### Attack Vector 4: Dispute Oracle Manipulation

```
1. 공격자가 POST /disputes/:id/resolve { outcome: "buyer_favor" } 호출
2. 실제 reviewer panel 투표 결과와 무관하게 분쟁 해결
3. buyer에게 환불 + seller에게 dispute_loss penalty
```

**Mitigation**: resolve 엔드포인트를 system-only로 제한하고, vote aggregation 결과 hash를 검증한 후에만 resolve 허용. On-chain resolution hash와 교차 검증.

---

### Attack Vector 5: Trust Score Farming

```
1. 공격자가 자신의 buyer/seller 양쪽 계정 생성
2. 소액 거래 반복 실행 (자기자신과 거래)
3. 각 거래마다 successful_settlement trust trigger 발생
4. 인위적으로 높은 trust score 획득
5. 높은 trust score로 피해자 상대 고액 거래 → 사기
```

**Mitigation**:
1. 동일 IP/wallet에서의 self-trading 탐지
2. Trust score 계산에 거래 금액 가중치 추가
3. 최소 거래 금액 threshold ($10 이상)
4. buyer/seller wallet이 동일한 거래 차단

---

## 6. Oracle Pattern (Dispute Resolution) 권고사항

현재 Haggle의 dispute resolution oracle 패턴은 다음과 같다:

```
vote-aggregation.ts (off-chain) → resolve endpoint → DisputeRegistry.anchorDispute (on-chain)
```

### 현재 설계의 문제점

1. **단일 장애점 (Single Point of Failure)**: Haggle 서버가 유일한 oracle. 서버가 해킹되면 모든 분쟁 결과를 조작 가능.

2. **Off-chain 투표 무결성**: 투표가 off-chain에서 집계되므로, Haggle이 투표 결과를 변조해도 검증 불가능.

3. **Resolution Hash 불투명**: `anchorDispute`에 resolutionHash를 기록하지만, 그 hash의 preimage (실제 결과)를 on-chain에서 검증하지 않음.

### 권고 Oracle Architecture

**Phase 1 (MVP -- 현재 적합)**:
- 현재 패턴 유지 (Haggle as trusted oracle)
- Resolution hash + evidence root hash anchoring은 유지
- 추가: Merkle tree로 개별 투표를 evidence root에 포함
- 추가: resolution hash의 preimage 구조를 공개 표준화

**Phase 2 (Post-MVP)**:
- Optimistic Oracle 패턴 도입:
  1. Haggle이 resolution을 on-chain에 제출
  2. 72시간 challenge period
  3. Challenge 시 bond 필요 + UMA/Kleros 같은 외부 oracle로 escalation
  4. Challenge 없으면 resolution 확정

**Phase 3 (장기)**:
- Reviewer 투표를 commit-reveal scheme으로 on-chain화
- Commit phase: `keccak256(vote + salt)` 제출
- Reveal phase: vote + salt 공개, on-chain aggregation
- Incentive: majority opinion = reward, minority = slash

### Concrete Implementation Recommendation

```solidity
// Phase 2: Optimistic Oracle 패턴 pseudo-code
struct Resolution {
    bytes32 disputeId;
    bytes32 evidenceRootHash;
    uint8 outcome; // 0=buyer, 1=seller, 2=partial
    uint256 refundAmount;
    uint256 proposedAt;
    bool finalized;
    bool challenged;
}

function proposeResolution(bytes32 disputeId, bytes32 evidenceRoot, uint8 outcome, uint256 refundAmount) external onlyOracle {
    // 72h challenge window
    resolutions[disputeId] = Resolution({...});
}

function challengeResolution(bytes32 disputeId) external payable {
    require(msg.value >= CHALLENGE_BOND);
    require(block.timestamp < resolution.proposedAt + 72 hours);
    // Escalate to external oracle
}

function finalizeResolution(bytes32 disputeId) external {
    require(block.timestamp >= resolution.proposedAt + 72 hours);
    require(!resolution.challenged);
    // Execute payout
}
```

---

## 7. Remediation Priority Matrix

| 순번 | ID | 내용 | 심각도 | 예상 공수 | 선행 조건 |
|------|-----|------|--------|----------|-----------|
| 1 | CRIT-01 | JWT 인증 미들웨어 | CRITICAL | 3-5일 | 없음 |
| 2 | CRIT-03 | RBAC 인가 미들웨어 | CRITICAL | 2-3일 | CRIT-01 |
| 3 | CRIT-02 | Webhook signature 검증 | CRITICAL | 1-2일 | 없음 |
| 4 | HIGH-05 | Key management (KMS) | HIGH | 3-5일 | 없음 |
| 5 | HIGH-06 | Dispute trust trigger 수정 | HIGH | 0.5일 | 없음 |
| 6 | HIGH-07 | State transition 인가 | HIGH | 1일 | CRIT-01 |
| 7 | MED-01 | Rate limiting | MEDIUM | 1일 | 없음 |
| 8 | MED-03 | Inline approval 제거 | MEDIUM | 0.5일 | 없음 |
| 9 | MED-02 | Webhook idempotency | MEDIUM | 1-2일 | 없음 |
| 10 | MED-04 | CORS 정책 강화 | MEDIUM | 0.5일 | 없음 |

---

## 8. Positive Findings

보안 감사에서 양호한 부분도 반드시 기록한다.

1. **EasyPost webhook HMAC-SHA256 검증** (`packages/shipping-core/src/easypost-webhook.ts`): `timingSafeEqual`을 사용한 timing attack 방지 구현이 모범적이다.

2. **Commerce Order upsert의 TOCTOU 방지** (`payment-record.service.ts:110-142`): `INSERT ... ON CONFLICT DO NOTHING` 패턴으로 race condition을 올바르게 방지했다.

3. **Trust Ledger의 atomic increment** (`trust-ledger.service.ts:80-82`): SQL `INCREMENT` 연산자를 사용하여 last-write-wins 방지. (초기 INSERT에는 race condition 있지만, UPDATE 경로는 안전.)

4. **State Machine 기반 상태 전이**: Dispute와 Shipment 모두 명시적 state machine으로 잘못된 전이를 방지. 유효하지 않은 전이는 throw.

5. **Zod Schema Validation**: 모든 API 입력에 Zod 스키마 검증 적용. Type injection 방지.

6. **Non-custodial 설계 원칙**: Haggle이 사용자 자금의 키를 보유하지 않는 설계는 보안 관점에서 올바른 접근이다. x402 facilitator를 통한 결제는 Haggle이 직접 자금을 다루지 않음을 의미한다.

7. **Approval Snapshot Hash Binding**: Settlement router에 `approvalSnapshotHash`를 포함하여, 협상 결과가 변조되었는지 on-chain에서 검증할 수 있는 기반이 마련되어 있다.

---

*Report generated by Security Audit Agent*
*Auditor: Claude Opus 4.6 (1M context)*
