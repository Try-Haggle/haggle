# Production Gap Analysis: Payment · Shipping · Dispute

> 2026-04-20 분석. 현재 완성도 ~65-70%.

---

## Phase 1: 없으면 거래 불가 (3-4주)

| # | 항목 | 크기 | 현재 상태 | 직접 필요 |
|---|------|------|----------|-----------|
| 1 | 컨트랙트 배포 (Base Sepolia) | L | ABI만 있음, 주소 = null | ⚠️ 키 관리 |
| 2 | 온체인 settlement 연동 (on-chain-settler.ts) | L | x402 facilitator만 있음 | ⚠️ 서명 키 |
| 3 | 주소 수집 테이블 + API | M | DB에 주소 테이블 없음 | ❌ |
| 4 | 판매자 배송 입력 + 라벨 구매 | M | 라우트 있지만 흐름 미완 | ❌ |
| 5 | 구매자 수령 확인 API endpoint | S | 백엔드 로직 있음, 엔드포인트 없음 | ❌ |
| 6 | 백그라운드 잡 인프라 + auto-release | M | 크론 잡 없음 | ❌ |
| 7 | 리소스 소유권 미들웨어 | S | 남의 주문에 API 호출 가능 | ❌ |

## Phase 2: 운영 안정성 (2-3주)

| # | 항목 | 크기 | 현재 상태 | 직접 필요 |
|---|------|------|----------|-----------|
| 8 | 증거 파일 업로드 (Supabase Storage) | M | supabase-storage.service.ts 있음 | ❌ |
| 9 | Payment Intent 만료 크론 | S | 없음 | ❌ |
| 10 | 배송 SLA 위반 자동 감지 크론 | S | 반응형만 있음 | ❌ |
| 11 | 보증금 실제 결제 연동 | M | DB record만 생성 | ⚠️ 결제 연동 |
| 12 | 온체인 이벤트 리스너 (indexer) | M | 없음 | ❌ |
| 13 | 온체인 분쟁 앵커링 | M | ABI만 있음 | ❌ |
| 14 | 보증금 만료 크론 (deposit expiry) | S | 엔드포인트만 있음 | ❌ |

## Phase 3: 사용자 경험 (1-2주)

| # | 항목 | 크기 | 현재 상태 | 직접 필요 |
|---|------|------|----------|-----------|
| 15 | 트랜잭션 이메일 (Resend/SendGrid) | M | 없음 | ⚠️ 도메인 DNS |
| 16 | 주문 목록 페이지 (orders/page.tsx) | S | 상세만 있음 | ❌ |
| 17 | Buyer/Seller 역할별 라우트 제한 | S | 없음 | ❌ |
| 18 | 실제 환불 실행 (온체인 USDC 반환) | S | mock만 있음 | ❌ |
| 19 | 반품 라벨 흐름 | M | 상태머신만 있음 | ❌ |
| 20 | 에러 트래킹 (Sentry) + 커머스 텔레메트리 | S | LLM 텔레메트리만 있음 | ⚠️ DSN 키 |

---

## 백그라운드 잡 목록

| 잡 | 주기 | 목적 | 의존성 |
|----|------|------|--------|
| settlement-release-auto-release | 5분 | buyer_review_deadline 경과 후 자동 정산 | #6 |
| settlement-buffer-release | 15분 | APV 윈도우 후 무게 버퍼 해제 | #6 |
| payment-intent-expiry | 15분 | CREATED/AUTHORIZED 1h+ 자동 취소 | #6 |
| shipment-sla-check | 15분 | LABEL_PENDING + due_at 경과 → 자동 분쟁 | #6 |
| dispute-deposit-expiry | 1시간 | 미예치 보증금 → DEFAULT_JUDGMENT | #6 |
| on-chain-event-sync | 1분 | SettlementRouter/DisputeRegistry 이벤트 DB 동기화 | #1, #12 |

---

## 핵심 블로커

1. **스마트 컨트랙트 배포 + 온체인 settlement** — 실제 돈 이동의 전제 (직접 필요: 서명 키)
2. **백그라운드 잡 인프라** — 시간 기반 자동화 전부 여기 의존 (직접 불필요)

---

## 직접 필요 vs Claude 위임 가능

### ⚠️ 직접 필요 (키/계정/외부 설정)
- 컨트랙트 배포 서명 키 (Foundry wallet / Ledger)
- EasyPost 프로덕션 API 키
- Stripe 프로덕션 모드 전환
- Resend/SendGrid 도메인 DNS 설정
- Sentry DSN 생성

### ❌ Claude 위임 가능
- DB 마이그레이션 (주소 테이블 등)
- API 엔드포인트 구현
- 백그라운드 잡 코드
- 미들웨어 (소유권 검증, 역할 제한)
- 프론트엔드 페이지 (주문 목록 등)
- 온체인 연동 코드 (viem client, event listener)
- 파일 업로드 엔드포인트
- 크론 잡 스케줄링
- 이메일 템플릿 + 발송 로직

---

*Last Updated: 2026-04-20*
