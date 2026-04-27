# MVP Tech Debt & Future Improvements Tracker

> MVP에서 의도적으로 단순화한 결정들. 런칭 후 순차적으로 개선.
> 각 항목에 **왜 이렇게 했는지 + 언제 바꿔야 하는지** 기록.

---

## DB / Schema

### TD-001: Trust Score — 단일 행 UPSERT (히스토리 없음)
- **현재**: `(actor_id, role)` 당 1행, UPSERT로 덮어씀
- **raw_inputs** JSONB로 마지막 계산 입력값은 보존
- **개선 시점**: 분기별 백테스트 필요 시 → `trust_score_history` append-only 테이블 추가
- **영향도**: 낮음 (기존 테이블 변경 없이 새 테이블 추가만 하면 됨)

### TD-002: ARP Segment NULL 처리 — COALESCE 유니크 인덱스
- **현재**: `UNIQUE(COALESCE(category,'__'), COALESCE(amount_tier,'__'), COALESCE(tag,'__'))`
- **개선 시점**: 세그먼트 키 구조가 복잡해지면 → composite key 테이블 분리 검토
- **영향도**: 중간 (인덱스 변경 = migration 필요)

### TD-003: DS Tag Specialization — 별도 테이블
- **현재**: `ds_tag_specializations` 테이블로 태그별 전문성 저장
- **개선 시점**: 태그 수가 100+ 넘어가면 쿼리 최적화 필요 (materialized view 등)
- **영향도**: 낮음

---

## API / Routes

### TD-004: Trust Score 계산 — 내부 이벤트 전용
- **현재**: `POST /trust/:actorId/compute`는 admin-only. 일반 유저 접근 불가
- **이유**: 스팸 재계산 방지
- **개선 시점**: 이벤트 시스템 구축 시 → settlement/dispute 이벤트가 자동 트리거
- **영향도**: 중간 (이벤트 버스 필요)

### TD-005: API 버전 프리픽스 없음
- **현재**: `/trust`, `/ds-ratings`, `/arp`, `/tags` (버전 없음)
- **이유**: 기존 라우트 패턴 유지, MVP에서 불필요한 변경 방지
- **개선 시점**: 프로토콜 공개 API 출시 시 → `/v1/` 프리픽스 일괄 추가
- **영향도**: 높음 (모든 클라이언트 경로 변경)

### TD-006: Auth 미적용
- **현재**: `x-haggle-actor-id` 헤더 기반, 미인증
- **개선 시점**: 런칭 전 필수 → JWT 또는 세션 기반 인증 미들웨어
- **영향도**: 높음 (모든 라우트 영향)

---

## Tag System

### TD-007: 태그 병합 — 반자동 (admin 승인 필요)
- **현재**: `GET /tags/clusters`로 유사 태그 제안 → `POST /tags/merge`로 admin 수동 병합
- **개선 시점**: 태그 볼륨 커지면 → 신뢰도 높은 케이스(distance=1, use_count<5) 자동 병합
- **영향도**: 낮음

### TD-008: 태그 카테고리 — 하드코딩
- **현재**: 카테고리는 코드에서 enum으로 관리
- **개선 시점**: 카테고리 동적 관리 필요 시 → `tag_categories` 테이블 분리
- **영향도**: 낮음

---

## Dispute

### TD-009: Deposit 라우트 — disputes.ts에 통합
- **현재**: deposit 엔드포인트가 `disputes.ts`에 같이 있음
- **개선 시점**: disputes.ts가 300줄 넘어가면 → `dispute-deposits.ts`로 분리
- **영향도**: 낮음 (라우트 분리만 하면 됨)

---

## Infrastructure

### TD-010: Migration 자동화 없음
- **현재**: Drizzle 스키마 정의만 있고, migration CLI는 수동 실행
- **개선 시점**: CI/CD 구축 시 → `drizzle-kit push` 또는 `migrate` 자동화
- **영향도**: 중간

### TD-011: 테스트 — API 통합 테스트 없음
- **현재**: core 패키지만 단위 테스트. API 라우트는 테스트 없음
- **개선 시점**: MVP 안정화 후 → supertest 기반 API 통합 테스트
- **영향도**: 중간

---

## API Routes (Phase 3)

### TD-012: ARP Segment Lookup 비효율
- **현재**: `getSegment()`이 nullable 3컬럼을 개별 조건으로 비교. 세그먼트 수 많아지면 느림
- **개선 시점**: 세그먼트 100+ 넘어가면 → composite index + 단일 쿼리 최적화
- **영향도**: 낮음

### TD-013: TrustInput Raw Cast
- **현재**: `rawInputs` JSONB를 `as unknown`으로 캐스팅. 런타임 타입 검증 없음
- **개선 시점**: trust score 감사 기능 구현 시 → Zod parse 또는 런타임 validator 추가
- **영향도**: 낮음

### TD-014: Tag Route 순서 의존성
- **현재**: `/tags/clusters`가 `/tags/:id` 전에 등록되어야 함 (Fastify 순서 의존)
- **개선 시점**: 라우트 충돌 발생 시 → prefix 분리 (`/tags/actions/clusters`) 또는 라우트 그룹화
- **영향도**: 낮음

### TD-015: trigger-match currentActiveSessions 하드코딩
- **현재**: `POST /intents/trigger-match`에서 `currentActiveSessions: 0`으로 하드코딩. 실제 active session count 미조회
- **개선 시점**: 매칭 자동화 시 → DB에서 user별 active session count 조회 후 주입
- **영향도**: 중간 (capacity 제한이 사실상 비활성)

### TD-016: trigger-match 동일 context_template
- **현재**: 모든 intent에 동일한 `context_template` 적용. intent별 strategy 차이만 반영
- **개선 시점**: 리스팅 DB 연동 시 → listing data를 context에 주입하여 intent별 맞춤 평가
- **영향도**: 중간

---

## Negotiation Engine — Time & Prediction

### TD-017: predictNextCrossing — confidence는 모델 충실도만
- **현재**: `confidence = 1.0 - (llm_escalation_count / total_rounds_observed)` 단순 비율
- **이유**: MVP는 상대방 엔진 행동 예측 정확도만 추적
- **개선 시점**: 협상 데이터 누적 후 → (a) 파라미터 안정성, (b) 외부 이벤트 확률 추가
- **영향도**: 중간 (스케줄러 정확도 향상)

### TD-018: min_concession_unit — 상대 효용 미러링
- **현재**: 자기 `utility_weights`로 상대방 효용을 추정 (대칭 가정)
- **이유**: 실제 상대 weights 모름. MVP는 정직한 추정으로 시작
- **개선 시점**: 상대 실제 반응 데이터 누적 후 → 베이지안 업데이트로 보정
- **영향도**: 낮음 (정확도 향상)

---

## HOLD Mechanism

### TD-019: Flash HOLD 시간 — 카테고리별 하드코딩
- **현재**: `FLASH_MINUTES` 상수로 카테고리별 고정 (CLOTHING 3분, VEHICLES 10분, REAL_ESTATE 30분)
- **개선 시점**: 데이터 누적 후 → ARP 엔진에 `flash_expiry_rate`, `flash_payment_success_rate` 시그널 추가하여 자동 학습
- **영향도**: 낮음 (UX 미세조정)

### TD-020: Buffer/Flash 통합 ARP 학습
- **현재**: Buffer 기간만 ARP 엔진 시그널 (`ship_confirmation_*` 추가) 활용. Flash는 별도
- **개선 시점**: ARP 메타튜너가 Buffer/Flash 두 채널을 동시 학습하도록 확장
- **영향도**: 중간 (학습 정확도 향상)

### TD-021: Counter-HOLD 판정 조건 — 고정 임계값
- **현재**: `u_seller(offer) >= 0.85 × u_seller(p_limit)` 임계 0.85 하드코딩
- **이유**: MVP는 단순 규칙
- **개선 시점**: 카테고리·판매자별 학습 → 판매자 historical 수락률 기반 동적 조정
- **영향도**: 낮음

---

## Session Quota & Anti-Abuse

### TD-022: 세션 한계 수치 — 추측치
- **현재**: (buyer × listing) 누적 5, (buyer × seller) 동시 10 — 데이터 없이 결정
- **개선 시점**: MVP 런칭 후 1개월 분석 → 정직한 사용자 분포 P95 기준으로 재조정
- **영향도**: 중간 (UX vs 악용 방지 균형)

### TD-023: 판매자 수락 시점 Deposit (방어선 3)
- **현재**: 미구현. Trust + 수수료 가속 페널티만 활용
- **이유**: 스마트 컨트랙트 수정 필요. MVP 범위 외
- **개선 시점**: 미배송 비율이 신규 판매자 1% 초과 시 → 거래액 1% USDC deposit 락 추가
- **영향도**: 높음 (컨트랙트 변경)

### TD-024: Velocity Check (방어선 6)
- **현재**: 미구현. 동시 한계만으로 부분 차단
- **이유**: 모니터링 인프라 필요
- **개선 시점**: 사용자 베이스 10K 도달 시 → 1시간 내 비정상 수락 급증 자동 감지 + review 큐
- **영향도**: 중간 (별도 워커 + 알림 인프라)

### TD-025: 디바이스 핑거프린팅 (방어선 4 강화)
- **현재**: 핸드폰 인증으로 1차 Sybil 방지
- **개선 시점**: 핸드폰 우회 패턴 발견 시 → fingerprintJS 등 디바이스 fingerprinting 추가
- **영향도**: 중간 (privacy 검토 필요)

---

## Subscription & Information Symmetry

### TD-026: 구독 티어 확률·예측 도구
- **현재**: Pro 티어 기능 미구현. MVP는 모두 동일 경험
- **개선 시점**: MVP 런칭 후 사용자 피드백 기반 → "자기 데이터 분석 도구"만 Pro에 추가 (상대 정보 분석은 절대 금지 — 정보 비대칭 원칙)
- **영향도**: 낮음 (점진적 추가 가능)

### TD-027: 능력 비대칭 투명성 표시
- **현재**: 미구현. 모든 사용자 동일 경험이라 불필요
- **개선 시점**: 구독 티어별 차이 도입과 동시 → 세션 메타데이터에 양쪽 tier 노출, UI에 "고급 도구 사용 중" 배지
- **영향도**: 낮음 (UI 추가만)

---

## Scheduler Infrastructure

### TD-028: Wake 스케줄러 — Tier별 진화 전략
- **현재 (Tier 1, MVP)**: Postgres index + 5초 polling, 별도 worker 프로세스
  - `idx_wake ON negotiation_sessions(next_wake_at) WHERE status='ACTIVE'`
  - `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1000`
  - Adaptive interval: 2s (바쁨) ↔ 5s (보통) ↔ 10s (한가)
  - 인터페이스 추상화: `WakeScheduler` 인터페이스로 구현체 교체 가능
- **이유**: Single source of truth (Postgres), 인프라 추가 0, 협상 라운드는 분 단위라 ±5초 무의미
- **개선 시점 (Tier 2)**: active_sessions > 100K OR DB CPU > 30% → Postgres + Redis ZSET 하이브리드 (PG=SoT, Redis=캐시)
- **개선 시점 (Tier 3)**: active_sessions > 1M OR p99 wake latency > 500ms → 시간 기반 파티셔닝 (time-bucket sharding)
- **개선 시점 (Tier 4)**: 1000만+ → 멀티 리전 샤딩
- **영향도**: 높음 (스케일링 핵심), 인터페이스 추상화로 마이그레이션 비용 최소

---

## Auth / Security

### TD-029: Supabase JWT 검증 — Legacy HS256 secret 의존
- **현재**: API와 WebSocket 인증은 `SUPABASE_JWT_SECRET`을 사용한 `jsonwebtoken.verify()` 기반이다. 운영 복구는 Supabase의 Legacy JWT Secret을 Railway `SUPABASE_JWT_SECRET` 변수에 넣어 처리한다.
- **이유**: Supabase 프로젝트는 JWT Signing Keys가 ECC P-256으로 이관되어 있으나, 서버 코드는 아직 JWKS 기반 비대칭 키 검증을 지원하지 않는다.
- **개선 시점**: legacy secret 의존을 제거하기 전 → Supabase Auth JWKS endpoint(`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`) 기반 검증으로 전환하고, HTTP auth와 WebSocket auth가 동일 verifier를 쓰게 통합한다.
- **영향도**: 중간 (인증 미들웨어와 WebSocket 인증 경로 변경, `jose` 등 JOSE/JWKS 라이브러리 추가 필요)

---

## How to Use This Document

1. 새 tech debt 발견 시 `TD-XXX` 번호로 추가
2. 개선 완료 시 항목에 ✅ + 날짜 + PR 링크 기록
3. 분기별 리뷰에서 우선순위 재평가

*Created: 2026-04-03*
*Last Updated: 2026-04-03*
