# MVP Steps 71~82 — 변경사항 오버뷰

**Date**: 2026-04-13
**Branch**: `feature/mvp-integration`
**Author**: Arch (via Claude Code team orchestration)

---

## Phase A: 출시 블로커 (Steps 71~76)

### Step 71 — API Auth Guards 전수 적용 ✅

**변경 파일 (11개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `apps/api/src/routes/disputes.ts` | requireAuth 전 엔드포인트, requireAdmin on resolve/expire. 소유권 검증 추가 (escalate). |
| `apps/api/src/routes/shipments.ts` | requireAuth 전 비-webhook 엔드포인트 |
| `apps/api/src/routes/authentications.ts` | requireAuth + 프로덕션 webhook 시크릿 가드 |
| `apps/api/src/routes/ds-ratings.ts` | requireAdmin on compute |
| `apps/api/src/routes/buyer-listings.ts` | requireAuth, body userId → request.user.id |
| `apps/api/src/routes/claim.ts` | requireAuth, body userId → request.user.id |
| `apps/api/src/routes/drafts.ts` | requireAuth 전 엔드포인트, body userId → request.user.id |
| `apps/api/src/routes/listings.ts` | requireAuth, query userId → request.user.id |
| `apps/api/src/routes/recommendations.ts` | requireAuth, query userId → request.user.id |
| `apps/api/src/routes/trust.ts` | requireAuth on GET 엔드포인트 |
| `apps/api/src/middleware/auth.ts` | 프로덕션 SUPABASE_JWT_SECRET 미설정 시 서버 시작 차단 |

**결과**: Auth-guarded 라우트 13/28 → 26/28.
**의도적 공개 유지**: public-listing, similar-listings, negotiation-demo, negotiation-simulate.

---

### Step 72 — ABI 수정 + Webhook HMAC ✅

**변경 파일 (7개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `packages/payment-core/src/viem-contracts.ts` | execute() → [tupleObject, signatureBytes] 구조. 12개 Solidity 필드 정확 매핑. |
| `packages/payment-core/src/x402-contracts.ts` | deadline: bigint, signer_nonce: bigint, signature: Hex 추가 |
| `packages/payment-core/src/real-x402-adapter.ts` | resolve_settlement_signature config 추가 |
| `packages/payment-core/src/scaffold-contracts.ts` | quote() Omit 타입 업데이트 |
| `apps/api/src/routes/payments.ts` | HMAC-SHA256 webhook 검증 (timingSafeEqual 사용) |
| `apps/api/src/routes/shipments.ts` | EASYPOST_WEBHOOK_SECRET 프로덕션 강제 |
| `apps/api/.env.example` | HAGGLE_X402_WEBHOOK_SECRET, EASYPOST_WEBHOOK_SECRET 추가 |

**신규 테스트**: `packages/payment-core/src/__tests__/viem-contracts.test.ts` — 6 tests

---

### Step 73 — 인메모리 Store → DB 영속화 ✅

**신규 파일 (3개)**:
| 파일 | 설명 |
|------|------|
| `apps/api/src/negotiation/memory/pg-checkpoint-persistence.ts` | CheckpointPersistence 구현, Drizzle ORM |
| `apps/api/src/negotiation/memory/pg-round-fact-sink.ts` | RoundFact flush + SHA-256 해시 체인 |
| `apps/api/src/__tests__/pg-persistence.test.ts` | 15 unit tests |

**수정 파일 (2개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `apps/api/src/negotiation/pipeline/executor.ts` | PgCheckpointPersistence 주입, flush() 호출, 터미널 스냅샷 저장 |
| `apps/api/src/__tests__/setup.ts` | DB mock 스텁 추가 |

**결과**: 서버 재시작 시 협상 상태 소실 0건 (인메모리 6건 → 0건).

---

### Step 74 — trust-core → coach 연결 + LLM Telemetry DB ✅

**변경 파일 (5개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `apps/api/src/negotiation/referee/coach.ts` | computeCoachingAsync() 추가. DB trust_scores 조회 → u_risk = combined/100. 실패 시 0.5 폴백. |
| `apps/api/src/negotiation/pipeline/executor.ts` | computeCoachingAsync() 호출로 변경, tx + counterpartyId 전달 |
| `apps/api/src/lib/llm-telemetry.ts` | setTelemetryDb(), LLM_TELEMETRY=db 모드, non-fatal DB INSERT |
| `apps/api/src/server.ts` | setTelemetryDb(db) 호출 |
| `apps/api/.env.example` | LLM_TELEMETRY 옵션 문서화 |

**신규 테스트**: coach.test.ts 11 tests + llm-telemetry.test.ts 11 tests = 22 tests

---

### Step 75 — 협상 라운드 UI ✅

**신규 파일 (3개)**:
| 파일 | 설명 |
|------|------|
| `apps/web/.../buy/negotiations/[sessionId]/page.tsx` | 구매자 협상 서버 컴포넌트 |
| `apps/web/.../buy/negotiations/[sessionId]/negotiation-chat.tsx` | 채팅 UI (라운드 히스토리, 오퍼 입력, 5초 폴링, ACCEPT/REJECT) |
| `apps/web/.../sell/negotiations/[sessionId]/page.tsx` | 판매자 협상 뷰 |

**수정 파일 (6개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `buy/dashboard/page.tsx` | 실제 세션 fetch |
| `buy/dashboard/dashboard-content.tsx` | Active Negotiations 실데이터 렌더 |
| `sell/listings/[id]/detail-content.tsx` | 협상 KPI (건수/평균/최고 오퍼) |
| `sell/listings/[id]/page.tsx` | sellerId prop 전달 |
| `l/[publicId]/buyer-landing.tsx` | "Start Negotiation" 동작 연결, user.id 수정 |
| `l/[publicId]/negotiation-api.ts` | getBuyerSessions() 헬퍼 |

**리뷰 수정사항**:
- `user.email` → `user.id` (UUID) — buyer-landing.tsx
- `version: number` 타입 추가 — NegotiationSession 인터페이스
- 판매자 dead code auth guard → 서버사이드 소유권 검증 의존

---

### Step 76 — 결제 UI + 지갑 등록 ✅

**신규 파일 (6개)**:
| 파일 | 설명 |
|------|------|
| `packages/db/src/schema/user-wallets.ts` | user_wallets 스키마 (user_id + network + role unique) |
| `packages/db/drizzle/0007_user_wallets.sql` | 마이그레이션 |
| `apps/api/src/routes/wallets.ts` | POST/GET/DELETE /wallets (requireAuth) |
| `apps/web/src/lib/wallet-provider.tsx` | RainbowKit + wagmi (Base + Base Sepolia) |
| `apps/web/.../buy/negotiations/[sessionId]/payment-step.tsx` | 결제 플로우 (지갑연결→USDC잔고→approve→서명→완료) |
| `apps/web/src/app/(app)/settings/wallet-settings.tsx` | 판매자 지갑 설정 |

**수정 파일 (4개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `packages/db/src/schema/index.ts` | userWallets export |
| `apps/api/src/routes/payments.ts` | quote 시 user_wallets 동적 조회 |
| `apps/api/src/server.ts` | wallet 라우트 등록 |
| `apps/web/package.json` | wagmi, viem, rainbowkit 추가 |

**주의**: WalletProvider를 layout에 추가 필요. @tanstack/react-query peer dep 확인 필요.

---

## 리뷰 수정사항 (Arch 직접)

| 이슈 | 심각도 | 파일 | 수정 내용 |
|------|--------|------|-----------|
| user.email → user.id | HIGH | buyer-landing.tsx | UUID로 변경 |
| 판매자 dead auth guard | HIGH | sell/negotiations/page.tsx | 서버사이드 의존으로 변경 |
| NegotiationSession.version 누락 | MEDIUM | buy/negotiations/page.tsx | 타입 필드 추가 |
| disputes 소유권 미검증 | IMPORTANT | disputes.ts | order buyer/seller 검증 추가 |
| authentications webhook 프로덕션 가드 | IMPORTANT | authentications.ts | 시크릿 미설정 시 거부 |
| roundFactSink race condition | IMPORTANT | pg-round-fact-sink.ts | pending 원자적 캡처+클리어 |

---

## Phase B: 핵심 흐름 완성 (Steps 77~80)

### Step 77 — Base Sepolia 배포 ⏳
**상태**: CEO 블로커 (deployer private key 필요)

---

### Step 78 — HFMI 가격 파이프라인 v0 ✅

**신규 파일 (3개)**:
| 파일 | 설명 |
|------|------|
| `apps/api/src/services/hfmi-fitter.ts` | OLS 회귀 (R²≥0.50, n≥30 게이트) |
| `apps/api/src/routes/hfmi.ts` | GET /hfmi/:model/median (공개), POST observations/fit (admin) |
| `apps/api/src/__tests__/hfmi.test.ts` | 10 tests |

**수정 파일 (4개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `apps/api/src/services/hfmi.service.ts` | getMedianPrice(), getHedonicEstimate() |
| `apps/api/src/services/l5-signals.service.ts` | HfmiEnrichedL5SignalsProvider (non-fatal) |
| `apps/web/src/app/l/[publicId]/buyer-landing.tsx` | "Fair Market Price: $XXX (HFMI)" 표시 |
| `apps/api/src/server.ts` | HFMI 라우트 등록 |

---

### Step 79 — 분쟁 UI + Attestation 위저드 ✅

**신규 파일 (4개)**:
| 파일 | 설명 |
|------|------|
| `apps/web/.../disputes/[id]/page.tsx` | 분쟁 상세 서버 컴포넌트 |
| `apps/web/.../disputes/[id]/dispute-detail.tsx` | 증거 리스트 + 제출 폼 |
| `apps/web/.../disputes/new/page.tsx` | 분쟁 생성 폼 (orderId prefill) |
| `apps/web/.../sell/listings/[id]/attestation-wizard.tsx` | 5단계 위저드 (IMEI→배터리→FindMy→사진→확인) |

**수정 파일 (2개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `negotiation-chat.tsx` | "Report Issue" 버튼 (터미널 상태, buyer only) |
| `sell/listings/[id]/detail-content.tsx` | Attestation 상태 + 위저드 CTA |

---

### Step 80 — Webhook 중복 방지 DB + 환불 경로 ✅

**신규 파일 (2개)**:
| 파일 | 설명 |
|------|------|
| `packages/db/src/schema/webhook-idempotency.ts` | webhook_idempotency 테이블 (key UNIQUE, expires_at index) |
| `packages/db/drizzle/0008_webhook_idempotency.sql` | 마이그레이션 |

**수정 파일 (3개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `packages/db/src/schema/index.ts` | webhookIdempotency export |
| `apps/api/src/routes/payments.ts` | in-memory Set → DB INSERT ON CONFLICT DO NOTHING |
| `packages/payment-core/src/viem-contracts.ts` | refund() 메서드 추가 (MVP: admin 수동 환불) |

## Phase C: 프로덕션 하드닝 (Steps 81~82)

### Step 81 — Rate Limiting + ToS/Privacy ✅

**신규 파일 (3개)**:
| 파일 | 설명 |
|------|------|
| `apps/api/src/middleware/rate-limit.ts` | 슬라이딩 윈도우 (전역 100/min, offers 10/min, payments 20/min) |
| `apps/web/src/app/(marketing)/terms/page.tsx` | ToS (AI 면책, USDC 결제, Delaware LLC, AAA 중재) |
| `apps/web/src/app/(marketing)/privacy/page.tsx` | Privacy Policy (지갑 주소, CCPA/GDPR, 쿠키) |

**수정 파일 (2개)**:
| 파일 | 변경 내용 |
|------|-----------|
| `apps/api/src/server.ts` | globalRateLimit 등록 |
| `apps/web/src/app/(marketing)/layout.tsx` | footer Terms/Privacy 링크 |

---

### Step 82 — E2E 통합 테스트 + Production Checklist ✅

**신규 파일 (4개)**:
| 파일 | 설명 |
|------|------|
| `apps/api/src/__tests__/e2e/negotiation-flow.test.ts` | 5 tests: intent→match→session→3rounds→ACCEPT |
| `apps/api/src/__tests__/e2e/payment-flow.test.ts` | 4 tests: prepare→quote→authorize→settle |
| `apps/api/src/__tests__/e2e/dispute-flow.test.ts` | 4 tests: 생성→증거→에스컬레이션→해결 |
| `docs/mvp/PRODUCTION_CHECKLIST.md` | 13섹션 배포 전 체크리스트 |

**버그 수정**: `disputes.ts` — `dispute.orderId` → `dispute.order_id` (snake_case)

---

## 테스트 현황

| 패키지 | 신규 테스트 | 상태 |
|--------|------------|------|
| payment-core | +6 (viem-contracts) | ✅ Pass |
| api (pg-persistence) | +15 | ✅ Pass |
| api (coach) | +11 | ✅ Pass |
| api (llm-telemetry) | +11 | ✅ Pass |
| api (hfmi) | +10 | ✅ Pass |
| api (e2e/negotiation) | +5 | ✅ Pass |
| api (e2e/payment) | +4 | ✅ Pass |
| api (e2e/dispute) | +4 | ✅ Pass |
| **합계** | **+66 tests** | ✅ |
| api (pg-persistence) | +15 | ✅ Pass |
| 기존 843 tests | — | ✅ Pass (기존 pre-existing 에러 3건 유지) |

## Pre-existing 에러 (이번 작업 무관)

- `llm-executor-integration.test.ts` — elapsed_ms 타입, RoundExecutionResult 캐스트
- `session-reconstructor.ts` — SessionStatus 타입 불일치 (NEGOTIATING_VERSION)
- `payment-core/real-x402-adapter.ts` — 기존 타입 이슈

---

*Generated: 2026-04-13 by Arch via Claude Code*
