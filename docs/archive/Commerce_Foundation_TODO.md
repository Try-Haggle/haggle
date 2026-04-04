# Commerce Foundation — 남은 작업 & 필요한 것들

> 이 문서는 commerce foundation 브랜치의 현재 상태와 프로덕션까지 남은 작업을 정리합니다.
> 완료되면 체크 표시하고, 담당자와 날짜를 기록하세요.

---

## 외부 계정/키 (직접 발급 필요)

| 항목 | 용도 | 발급처 | 비용 | 우선순위 |
|------|------|--------|------|----------|
| **EasyPost API Key** | 배송 라벨 생성 + 트래킹 | https://www.easypost.com (가입 후 즉시 발급) | 무료 (테스트 키 EZTK...) | 🔴 필수 |
| **EasyPost Webhook Secret** | 배송 상태 + APV 웹훅 수신 | EasyPost 대시보드 → Webhooks | 무료 | 🔴 필수 |
| **EasyPost 프로덕션 키** | 실제 라벨 구매 | EasyPost 대시보드 → API Keys | 라벨 $0.08/건, 트래킹 무료 | 🟡 런칭 시 |
| **Coinbase CDP API Key** | x402 결제 Facilitator | https://portal.cdp.coinbase.com | 무료 (1,000 tx/월) | 🟡 결제 연동 시 |
| **Base Sepolia ETH** | 테스트넷 가스비 | https://www.coinbase.com/faucets/base-ethereum-sepolia | 무료 | 🟡 컨트랙트 배포 시 |
| **PostgreSQL** | DB 운영 | Supabase / Neon / Railway | 무료 티어 | 🔴 필수 |
| **도메인 + SSL** | tryhaggle.ai | 이미 보유 | - | ✅ 완료 |

### 환경변수 설정 (.env)

```bash
# EasyPost
EASYPOST_API_KEY=EZTK_test_...        # 테스트 키 (가입 즉시)
EASYPOST_WEBHOOK_SECRET=whsec_...     # 웹훅 설정 후

# x402 (결제 연동 시)
HAGGLE_X402_MODE=mock                  # mock|real
HAGGLE_X402_FACILITATOR_URL=           # real 모드에서만
HAGGLE_X402_NETWORK=base-sepolia       # 테스트넷
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
HAGGLE_X402_FEE_BPS=150               # 1.5%

# DB
DATABASE_URL=postgresql://...
```

---

## 코드 완성도 체크리스트

### 패키지 레벨 (순수 로직) — ✅ 거의 완료

- [x] @haggle/commerce-core — 170 tests, 상태 머신 + 신뢰 점수 + 최소 거래 + order lifecycle
- [x] @haggle/payment-core — 231 tests, 결제 서비스 + Settlement Release + Facilitator Client
- [x] @haggle/shipping-core — 265 tests, EasyPost 어댑터 + 웹훅 + 라벨 생성 + Weight Buffer
- [x] @haggle/dispute-core — 99 tests, 분쟁 서비스 + 증거 검증 + reason codes
- [x] @haggle/db — 스키마 완료 (payments, shipments, disputes, trust-ledger, settlement-releases)
- [x] apps/api TypeScript 컴파일 — 0 errors

### API 통합 레벨 — 🟡 진행 중

- [x] 결제 라우트 (11 endpoints)
- [x] 배송 라우트 (7 endpoints) + EasyPost 웹훅
- [x] 분쟁 라우트 (9 endpoints)
- [x] Settlement Release 라우트 (7 endpoints) ✅ 2026-03-24
- [x] Rate Shopping 엔드포인트 (POST /shipments/rates) ✅ 2026-03-24
- [x] APV 웹훅 핸들러 (ShipmentInvoice) ✅ 2026-03-24

### E2E 통합 — 🔴 미완

- [ ] 결제 → Settlement Release 자동 생성 hook
- [ ] 배송 DELIVERED → Settlement Release confirmDelivery 자동 트리거
- [ ] 구매자 확인 기간 만료 → completeBuyerReview 자동 트리거 (cron/worker)
- [ ] 14일 경과 → completeBufferRelease 자동 트리거 (cron/worker)
- [ ] E2E 통합 테스트

---

## 프로덕션 전 필수 작업

### 보안

- [ ] **JWT/세션 인증** — 현재 `x-haggle-actor-id` 헤더 신뢰 (누구나 위조 가능)
- [ ] **Rate limiting** — API 엔드포인트에 속도 제한
- [ ] **입력 검증 강화** — 금액, 주소 등 비즈니스 규칙 검증
- [ ] **웹훅 서명 검증** — Stripe, EasyPost 웹훅 프로덕션 시크릿 설정

### 인프라

- [ ] **DB 마이그레이션** — Drizzle migration 파일 생성 + 실행
- [ ] **Worker/Cron** — 구매자 검토 기간 만료, 버퍼 릴리즈 자동 처리
- [ ] **모니터링** — 결제 실패, 배송 예외, 분쟁 알림
- [ ] **로깅** — 결제/정산 감사 로그 (규제 대응)

### 스마트 컨트랙트

- [ ] **HaggleSettlementRouter** Solidity 구현 + 배포 (현재 scaffold만)
- [ ] **HaggleDisputeRegistry** Solidity 구현 + 배포
- [ ] **Timelock + Multisig** 거버넌스 컨트랙트 배포
- [ ] **Emergency exit** 함수 구현
- [ ] Base Sepolia 테스트넷 배포 + 검증
- [ ] 보안 감사 (프로덕션 전)

### 프론트엔드

- [ ] 결제 플로우 UI (x402 지갑 서명)
- [ ] 배송 라벨 생성 UI (주소/무게 입력 → 요금 비교 → 라벨 구매)
- [ ] 배송 추적 UI
- [ ] 분쟁 제기 UI
- [ ] Settlement Release 상태 표시 (구매자 검토 중, 버퍼 대기 중 등)

---

## 다음 단계 추천 순서

```
1단계: Settlement Release 라우트 + APV 웹훅 ✅ 완료
2단계: 자동 hook (결제→릴리즈 생성, 배송→confirmDelivery) ✅ 완료
3단계: 24시간 구매자 검토 + 즉시 확인 버튼 ✅ 완료
─── 여기까지 완료 (2026-03-24) ───
4단계: Worker/Cron 구현 (24시간 자동 확정, 14일 버퍼 자동 릴리즈) ← 다음
5단계: EasyPost 테스트 키 발급 → 실제 라벨 생성 E2E 테스트 (대기 중)
6단계: JWT 인증 추가
7단계: DB 마이그레이션 실행 → 개발 환경 구동
8단계: 프론트엔드 결제/배송 플로우
9단계: 스마트 컨트랙트 Solidity 구현 + 테스트넷 배포
10단계: 보안 감사 → 프로덕션 배포
```

---

*Last Updated: 2026-03-24*
