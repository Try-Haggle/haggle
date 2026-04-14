# Architect Brief — WebSocket + Gamification UI + Typecheck Fix

*Written by Arch. 2026-04-14.*

---

## Overview

세 가지 독립적인 작업을 순서대로 구현한다:
1. TypeScript 에러 13건 해결 (기반 정리)
2. WebSocket 실시간 업데이트 (폴링 교체)
3. 게이미피케이션 UI 페이지 연결

---

## Task A — TypeScript 에러 수정 (13건)

### Context
`pnpm typecheck`에서 @haggle/api 패키지 13건 에러.

### Known Issues
1. `llm-executor-integration.test.ts:133,318` — 타입 불일치
2. `session-reconstructor.ts:191` — `NEGOTIATING_VERSION` 세션 상태 누락
3. `skill-stack.test.ts` — RoundFact/OpponentPattern/RefereeBriefing 필수 속성 누락

### Approach
- 각 에러 읽고 → 타입 정의 수정 또는 테스트 코드 수정
- 기존 로직 변경 없이 타입만 맞춤
- 수정 후 `pnpm typecheck` 클린 확인

### Quality Gate
- `pnpm typecheck` → 0 errors

---

## Task B — WebSocket 실시간 업데이트

### Context
- `apps/api/src/server.ts:142` — `TODO(post-mvp): Register WebSocket handler`
- `apps/web/src/app/(app)/buy/negotiations/[sessionId]/negotiation-chat.tsx:110-134` — 5초 폴링
- 판매자: `apps/web/src/app/(app)/sell/negotiations/[sessionId]/page.tsx`

### Design Decisions
- **Hono WebSocket**: `hono/ws`의 `upgradeWebSocket` 사용
- **채널 구조**: `/ws/negotiations/:sessionId` — 세션별 1채널
- **메시지 타입**:
  ```typescript
  type WsMessage =
    | { type: 'round_update'; payload: { round: number; status: string; offer?: number } }
    | { type: 'status_change'; payload: { status: string; previousStatus: string } }
    | { type: 'ping' }
    | { type: 'pong' }
  ```
- **인증**: 연결 시 `?token=JWT` 쿼리 파라미터로 인증
- **폴백**: WS 연결 실패 시 기존 5초 폴링 자동 폴백
- **서버 측**: 라운드 저장 후 해당 세션 채널에 broadcast
- **하트비트**: 30초 간격 ping/pong
- **메모리 기반**: 채널 맵은 in-memory Map (MVP 단계, Redis 불필요)

### Files
```
CREATE  apps/api/src/ws/negotiation-ws.ts        — WS 핸들러 + 채널 관리
MODIFY  apps/api/src/server.ts                    — WS 라우트 등록 (TODO 교체)
CREATE  apps/web/src/hooks/use-negotiation-ws.ts  — WS 연결 + 폴백 훅
MODIFY  apps/web/.../negotiation-chat.tsx          — 폴링 → useNegotiationWs 훅
MODIFY  apps/web/.../sell/negotiations/.../page.tsx — 판매자도 WS 훅 사용
```

### Constraints
- Hono Node.js adapter WS 호환 확인 → 안 되면 `ws` 라이브러리 직접 사용
- 연결 해제 시 자동 정리
- 클라이언트: reconnect 3회 시도 → 실패 시 폴링 전환

### Quality Gate
- WS 연결 성공 로그 확인
- 라운드 업데이트 실시간 수신
- 연결 실패 시 폴링 정상 동작

---

## Task C — 게이미피케이션 UI

### Context
- API 완성: 7개 엔드포인트 (`/gamification/me/level`, `/gamification/leaderboard`, `/buddies` 등)
- DB 완성: buddies, agent_levels, buddy_trades 테이블
- Service 완성: gamification.service.ts
- **UI 없음**

### 참고할 API 엔드포인트
```
GET  /gamification/me/level        → { level, xp, next_level_xp, stats }
GET  /gamification/leaderboard     → [{ user_id, level, volume, savings }]
GET  /buddies                      → [{ id, name, species, rarity, level }]
GET  /buddies/:id                  → { ...buddy, trades: [...] }
POST /buddies/:id/reveal           → { buddy, animation_seed }
PATCH /buddies/:id/name            → { buddy }
GET  /buddies/:id/trades           → [{ outcome, saving_pct, rounds }]
```

### Files to Create
```
CREATE  apps/web/src/app/(app)/profile/buddies/page.tsx         — 버디 목록 (그리드)
CREATE  apps/web/src/app/(app)/profile/buddies/[id]/page.tsx    — 버디 상세 + 거래 히스토리
CREATE  apps/web/src/app/(app)/profile/level/page.tsx           — 레벨/XP 프로그레스
CREATE  apps/web/src/app/(app)/leaderboard/page.tsx             — 글로벌 랭킹 테이블
```

### Design
- **버디 카드**: 종(species) 아이콘 + 이름 + 레어리티 뱃지 + 레벨
- **레벨 페이지**: XP 프로그레스 바 + 현재 레벨 + 다음 레벨까지
- **리더보드**: 탭 (level/volume/savings/deals) + 순위 테이블
- 기존 앱 디자인 패턴 따름 (Tailwind, 다크 배경 기반)
- 서버 컴포넌트 기본, 인터랙션 필요한 부분만 client

### Constraints
- 버디 종 아이콘: emoji 사용 (🦊🐰🐻🐱🦉🐉🦅🐺)
- 레어리티 색상: COMMON(gray) UNCOMMON(green) RARE(blue) EPIC(purple) LEGENDARY(orange) MYTHIC(red)
- reveal 애니메이션: CSS transition + scale 변환 (심플)
- 반응형 필수 (모바일 우선)
- `/profile` 네비게이션에 버디/레벨 링크 추가

### Quality Gate
- 4개 페이지 렌더링 확인
- API 호출 → 데이터 표시 정상
- 모바일 레이아웃 확인

---

## Build Order

```
Task A (typecheck) → Task B (WebSocket) → Task C (gamification UI)
```

타입 에러부터 정리해야 이후 작업이 깨끗하게 빌드됨.

---

*끝. Bob은 Task A부터 시작.*
