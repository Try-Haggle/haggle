# ARCHITECT-BRIEF — Payment/Shipping/Dispute Integration

*Written by Arch. 2026-04-15.*
*Branch: feature/payment-shipping-dispute*

---

## Context

payment-core, shipping-core, dispute-core, commerce-core 패키지 로직과 API 라우트는 구현 완료 (843+ tests).
스마트 컨트랙트 ABI + Foundry 테스트 존재. 실제 연결에 필요한 인프라 작업이 남아있음.

**유저가 직접 해야 하는 것** (키 발급, 지갑 생성 등)은 별도. 여기서는 코드 작업만 다룬다.

---

## Step 70 — DB Migration: Payment/Shipping/Commerce 테이블 생성

**Goal**: Drizzle 스키마 존재 → SQL 마이그레이션 없는 테이블들 생성.

**현황**:
- `packages/db/src/schema/payments.ts` — paymentIntents 정의 있음
- `packages/db/src/schema/shipments.ts` — shipments 정의 있음
- `packages/db/src/schema/commerce-orders.ts` — settlementApprovals 정의 있음
- `packages/db/src/schema/settlement-releases.ts` — settlementReleases 정의 있음
- `packages/db/src/schema/disputes.ts` — dispute 관련 (일부는 0002에서 생성됨)
- `packages/db/drizzle/` 마이그레이션 0012까지 존재. payment_intents, shipments 누락.

**작업**:
1. `packages/db/src/schema/` 에서 payments, shipments, commerce-orders, settlement-releases 스키마 전체 읽기
2. `0002_phase3_5_tables.sql` 에서 이미 생성된 테이블 목록 확인 (dispute_deposits, settlement_releases 등)
3. 누락된 테이블만 추출
4. `packages/db/drizzle/0013_payment_shipping_commerce.sql` 작성
5. 기존 테이블과의 FK 관계 확인 (listings_published, users 등)
6. `packages/db/src/schema/index.ts` export 확인

**Constraints**:
- `CREATE TABLE IF NOT EXISTS` 패턴 (기존 마이그레이션 따름)
- UUID primary key, gen_random_uuid() default
- timestamp with time zone, DEFAULT now()
- Drizzle 스키마가 source of truth — SQL은 스키마와 1:1 매칭
- Flag: 0002에서 settlement_releases, dispute_deposits 이미 생성됨. 중복 CREATE 방지 필수.

**Validation**:
- SQL이 문법 오류 없이 실행 가능
- Drizzle 스키마의 모든 컬럼이 SQL에 반영

---

## Step 71 — EIP-712 Settlement Signature Service

**Goal**: `resolve_settlement_signature` 구현 (현재 throw Error("not implemented")).

**현황**:
- `apps/api/src/payments/providers.ts:140-143` — throw Error
- `packages/payment-core/src/x402-protocol.ts` — X402SettlementSignatureContext 타입
- `packages/payment-core/src/real-x402-adapter.ts` — 서명 컨텍스트 사용처
- `packages/contracts/src/index.ts` — HAGGLE_SETTLEMENT_ROUTER_ABI (executeSettlement 함수)

**작업**:
1. X402SettlementSignatureContext 타입 확인
2. 컨트랙트 ABI에서 Settlement struct 추출 → EIP-712 domain + types 정의
3. viem signTypedData로 Relayer private key 기반 서명
4. providers.ts resolve_settlement_signature 구현
5. 단위 테스트 (mock private key 서명 생성 + 복원 주소 검증)

**Constraints**:
- Private key는 HAGGLE_ROUTER_RELAYER_PRIVATE_KEY 환경변수만 사용
- viem/accounts 사용 — ethers.js 금지
- ABI의 Settlement struct과 정확히 매칭

---

## Step 72 — Foundry Deploy Script (Base Sepolia)

**Goal**: SettlementRouter + DisputeRegistry 테스트넷 배포 스크립트.

**현황**:
- `packages/contracts/test/` — Foundry 테스트 + MockUSDC 존재
- `packages/contracts/src/index.ts` — ABI 존재, 주소 null

**작업**:
1. packages/contracts 구조 확인 (src/, script/, test/, foundry.toml)
2. `script/Deploy.s.sol` 작성
3. 배포 순서: SettlementRouter(signer, guardian, USDC) → DisputeRegistry(owner)
4. 배포 후 주소 + 검증 명령어 출력
5. foundry.toml에 Base Sepolia RPC 설정

**Constraints**:
- Base Sepolia only (mainnet은 감사 후)
- Signer = deployer, Guardian = deployer (Phase 1)
- USDC: Base Sepolia 공식 (0x036CbD53842c5426634e7929541eC2318f3dCF7e)

---

## Step 73 — Real Stripe Adapter (Crypto Onramp)

**Goal**: MockStripeAdapter → Real Stripe SDK 연동.

**작업**:
1. Stripe Crypto Onramp API 문서 확인
2. `packages/payment-core/src/real-stripe-adapter.ts` 작성
3. Onramp session 생성 + 상태 조회
4. providers.ts에서 STRIPE_MODE=real/mock 환경변수 기반 전환
5. Webhook signature 검증 (stripe-signature header)
6. 테스트

**Constraints**:
- stripe 패키지 사용
- 실패 시 graceful fallback (x402 only)
- 테스트 모드 키로 동작 가능해야 함

---

## Build Order

```
Step 70 (DB Migration) → Step 71 (Signature) → Step 72 (Deploy) → Step 73 (Stripe)
```

Step 70이 선행 — DB 없으면 API 라우트 persistence 불가.
Step 71, 72는 독립 가능하지만 72 실행에 71 결과(서명) 필요.

**Step 70부터 Bob 스핀업.**
