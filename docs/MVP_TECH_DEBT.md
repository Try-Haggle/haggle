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

## How to Use This Document

1. 새 tech debt 발견 시 `TD-XXX` 번호로 추가
2. 개선 완료 시 항목에 ✅ + 날짜 + PR 링크 기록
3. 분기별 리뷰에서 우선순위 재평가

*Created: 2026-04-03*
*Last Updated: 2026-04-03*
