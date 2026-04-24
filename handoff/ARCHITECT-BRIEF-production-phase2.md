# ARCHITECT-BRIEF — Production Phase 2: On-Chain + Operational

*Written by Arch. 2026-04-21.*
*Branch: feature/payment-shipping-dispute*
*Ref: docs/wip/production-gap-analysis.md (#11, #12, #13)*

---

## Context

Phase 1 완료: 주소 테이블, 수령 확인, 크론 잡 인프라, 소유권 미들웨어, 배송 라벨, 증거 업로드.
Phase 2는 온체인 연동 코드. 컨트랙트 배포 자체는 직접 해야 하지만, 연동 코드는 여기서 만든다.

기존 인프라:
- `settlement-signer.ts` — EIP-712 서명 (viem, 테스트 있음)
- `gas-relayer.ts` — viem wallet client로 트랜잭션 제출
- `@haggle/contracts` — ABI + 이벤트 정의 (주소만 null)

---

## Step 85 — 온체인 이벤트 리스너 (Indexer)

**Goal**: SettlementRouter + DisputeRegistry의 온체인 이벤트를 폴링하여 DB와 동기화.

**보안 고려**:
- 온체인 데이터는 신뢰 가능 (블록체인 = 진실). DB가 온체인과 다르면 DB를 수정.
- 리오그(reorg) 대비: 최소 2 confirmation 후 반영
- 이벤트 누락 방지: 마지막 처리 블록 번호를 DB에 저장하여 재시작 시 이어서 폴링

**작업**:

1. `packages/db/src/schema/chain-sync.ts` — 동기화 상태 테이블
```typescript
// chain_sync_cursors — 체인별 마지막 처리 블록
{
  id: text PK ('settlement_router' | 'dispute_registry'),
  chain_id: integer NOT NULL,
  last_block_number: bigint NOT NULL DEFAULT 0,
  last_synced_at: timestamp DEFAULT now(),
  updated_at: timestamp DEFAULT now()
}
```

2. `packages/db/drizzle/0016_chain_sync.sql` — 마이그레이션

3. `apps/api/src/chain/event-listener.ts` — 핵심 리스너
   - viem `publicClient.getLogs()` 사용 (WebSocket 대신 polling — 서버리스 호환)
   - 폴링 간격: 60초 (크론 잡에서 호출)
   - 최대 블록 범위: 2000 블록/회 (Base L2 속도 기준)
   - 컨펌 수: 2 (Base finality)

4. `apps/api/src/chain/handlers/settlement-handler.ts`
   - `SettlementExecuted` → payment_settlements + commerce_orders 상태 검증
   - `OrderReset` → 관리자 리셋 감지
   - `OrderVoidedEvent` → void 상태 반영

5. `apps/api/src/chain/handlers/dispute-handler.ts`
   - `DisputeAnchored` → dispute_cases에 anchor_id 기록
   - `AnchorSuperseded` → 기존 anchor 무효화
   - `AnchorRevoked` → revoke 반영

6. `apps/api/src/jobs/chain-event-sync.ts` — 크론 잡 (이미 runner.ts 있음)
   - 스케줄: 60초마다
   - settlement-handler + dispute-handler 순차 실행

**보안 Constraints**:
- RPC 엔드포인트: 환경변수 `BASE_RPC_URL` (Alchemy/QuickNode)
- 컨트랙트 주소: 환경변수 `SETTLEMENT_ROUTER_ADDRESS`, `DISPUTE_REGISTRY_ADDRESS`
  → 둘 다 없으면 리스너 비활성화 (graceful skip)
- 이벤트 처리는 idempotent — 같은 tx hash 재처리 시 no-op
- DB 트랜잭션: 이벤트 처리 + 커서 업데이트를 하나의 트랜잭션으로

---

## Step 86 — 온체인 분쟁 앵커링

**Goal**: 분쟁 해결 시 증거 해시 + 결과 해시를 DisputeRegistry에 기록.

**보안 고려**:
- 증거 해시: 모든 evidence의 uri/text를 keccak256으로 머클 루트 생성
- 결과 해시: outcome + refund_amount + summary를 keccak256
- 앵커링은 resolve 이후 자동 실행 (별도 트랜잭션)
- 앵커링 실패 시 분쟁 해결 자체는 롤백하지 않음 (best-effort)

**작업**:

1. `apps/api/src/chain/dispute-anchoring.ts`
   - `computeEvidenceMerkleRoot(evidence[])` → bytes32
     - 각 evidence를 keccak256(abi.encode(type, uri, text, created_at))
     - 홀수면 마지막 복제하여 짝수로
     - pairwise keccak256 반복 → root
   - `computeResolutionHash(resolution)` → bytes32
     - keccak256(abi.encode(outcome, refund_amount, summary))
   - `anchorDisputeOnChain(disputeCase, evidence, resolution)` → tx hash
     - gas-relayer.ts 재사용하여 `anchorDispute` 호출
     - orderId, disputeCaseId를 bytes32 변환 (keccak256(uuid))

2. `apps/api/src/routes/disputes.ts` — resolve 엔드포인트에 앵커링 추가
   - resolve 성공 후 비동기로 anchorDisputeOnChain 호출 (await하지 않음 — fire and forget)
   - 앵커링 결과를 dispute_cases.metadata에 `{ anchor_tx_hash, anchor_id }` 저장

3. dispute_cases 테이블에 anchor 필드 추가 (또는 metadata JSONB 활용 — 기존 패턴 확인)

**보안 Constraints**:
- 앵커링은 admin/system만 호출 가능 (resolver role on-chain)
- Relayer private key = 환경변수 (settlement-signer와 동일 키 재사용 or 별도)
- 컨트랙트 미배포 시 graceful skip (로그만 남기고 continue)

---

## Step 87 — 보증금 결제 연동

**Goal**: T2/T3 에스컬레이션 시 판매자 보증금을 실제로 수금.

**보안 고려**:
- 보증금은 에스크로와 별도 — 판매자 지갑에서 직접 transfer
- USDC approve + transferFrom 패턴 (on-chain)
- 또는: Stripe로 법정화폐 수금 후 USDC로 변환 (Phase 1에서는 이쪽이 현실적)
- 보증금 미납 시 자동 패소는 이미 크론 잡으로 구현됨 (Step 82)

**작업**:

1. `apps/api/src/payments/deposit-collector.ts`
   - `collectDeposit(deposit, paymentRail)` → 결제 실행
   - USDC rail: seller가 approve → 우리가 transferFrom (gas-relayer 사용)
   - Stripe rail: Stripe PaymentIntent 생성 → webhook으로 완료 확인
   - 환경변수 `DEPOSIT_COLLECTION_MODE`: 'usdc' | 'stripe' | 'mock'

2. `apps/api/src/routes/disputes.ts` — deposit 엔드포인트 수정
   - 현재: `POST /disputes/:id/deposit` → DB에 DEPOSITED 마크만 함
   - 수정: 실제 결제 트리거 → 결제 성공 시에만 DEPOSITED로 전이
   - USDC 경로: `{ tx_hash }` 반환 → 판매자가 approve 트랜잭션 완료 후 API 호출
   - Stripe 경로: `{ client_secret }` 반환 → 프론트에서 Stripe Elements로 결제

3. 보증금 환불 로직
   - 판매자 승소 시 보증금 환불: USDC transfer back or Stripe refund
   - `apps/api/src/payments/deposit-refunder.ts`
   - resolve 엔드포인트에서 판매자 승소 시 자동 호출

**보안 Constraints**:
- 보증금 수금 실패 시 → 에스컬레이션 진행하지 않음 (결제 완료가 전제)
- USDC transferFrom에 approval 검증 필수
- Stripe webhook signature 검증 필수 (기존 패턴 재사용)
- 보증금 금액은 서버에서 계산 (클라이언트가 보낸 금액 무시)
- 이중 수금 방지: deposit status가 PENDING일 때만 수금 가능

---

## Build Order

```
Step 85 (온체인 이벤트 리스너) ←── 독립, 바로 시작
  ↓
Step 86 (분쟁 앵커링) ←── gas-relayer + contracts ABI만 필요, 독립
  ↓
Step 87 (보증금 결제) ←── 독립, 결제 인프라 재사용
```

세 개 모두 독립적이지만 보안 리뷰가 중요한 Step이므로 순차 진행 + Richard 리뷰.

**Bob 시작: Step 85부터.**

---

## Richard Checklist (보안 집중)

- [ ] 온체인 이벤트 리스너: reorg 처리 (2 confirmation)
- [ ] 이벤트 핸들러: idempotent (같은 tx hash 재처리 시 no-op)
- [ ] 커서 업데이트: DB 트랜잭션으로 atomic
- [ ] RPC URL: 환경변수만 사용, 하드코딩 금지
- [ ] 머클 루트: 짝수 보장, 빈 배열 처리
- [ ] anchorDispute: resolver 권한 없으면 graceful fail (not crash)
- [ ] 보증금 수금: 금액은 서버 계산, 클라이언트 값 무시
- [ ] USDC transferFrom: approval 사전 검증
- [ ] 보증금 이중 수금 방지: status check before collect
- [ ] Stripe webhook: signature 검증 필수
- [ ] Private key: 환경변수만, 로그에 절대 출력 안 함
- [ ] 컨트랙트 미배포 시 모든 온체인 코드 graceful skip

---

*Arch out. Bob 스핀업.*
