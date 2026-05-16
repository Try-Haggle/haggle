# Notification System — 구현 계획 (Source of Truth)

> **상태:** 설계 완료 — ARCHITECT-BRIEF 작성 후 구현 단계 진입
> **시작일:** 2026-05-15
> **목표:** Haggle의 인앱 알림 + 이메일 발송 인프라를 구축
> **이 문서의 역할:** 결정 사항, 열린 질문, 진행 상황을 추적하는 단일 SoT

---

## 1. 프로젝트 목표 & 철학

### 한 줄 요약
**"새 이벤트를 추가할 때 개발자가 작성하는 코드를 (1) 이벤트 정의 + (2) 템플릿 두 개로 끝내는 확장 가능한 알림 인프라."**

### 진짜 목표는 "인프라"이지 "알림 기능"이 아니다
- 1차 릴리스에 알림이 몇 개 붙느냐는 부차적
- 핵심 KPI: **다음 알림을 추가할 때 걸리는 시간 / 코드량**
- 결제·배송·분쟁 등 미래 이벤트는 인프라가 잘 잡혀 있으면 등록 한두 줄로 붙어야 함

### 설계 원칙
1. **Event-Driven** — 도메인 코드에서 알림 모듈을 직접 호출하지 않는다. 이벤트 발행만 한다.
2. **Channel-Agnostic** — 이벤트는 채널을 모른다. 라우팅 레이어가 결정한다.
3. **Type-Safe Templates** — 이벤트 페이로드 변경 시 템플릿이 컴파일 에러로 잡혀야 한다.
4. **Preferences-Aware** — 사용자 환경설정이 항상 라우팅 레이어에서 강제된다.
5. **Idempotent** — 같은 이벤트가 두 번 발행돼도 알림은 한 번만 간다.
6. **MVP-First** — 추측으로 이벤트 정의하지 않는다. 구현된 도메인의 이벤트만 등록한다.

---

## 2. 1차 스코프 (확정)

### 인프라 (전체 구축)
- 이벤트 레지스트리 + 발행/구독 메커니즘 (별도 NotificationBus)
- In-app 알림 저장 + 실시간 전달 (기존 WS 채널 활용)
- 이메일 발송 파이프라인 (SaaS 기반)
- 템플릿 시스템 (타입 안전)
- 사용자 Preferences (채널별 on/off, 카테고리 단위)
- 읽음/안읽음 처리, 알림 센터 UI (벨 + 드롭다운)
- **Toast UI 시스템 (sonner 도입)** — 실시간 푸시 메시지 표면

### 1차에 등록할 이벤트 (최소)

**명명 컨벤션:** Stripe 스타일 — `resource.action_past_tense`, 점(`.`) 구분, snake_case 세그먼트, 과거 시제, 도메인 단수형. 한번 발행된 event_type은 contract처럼 다룸 (변경 시 v2 접미사).

**협상 (in-app + email):**
- `negotiation.offer.received` — 상대방이 새 오퍼/역제안 발송
- `negotiation.offer.accepted` — 내 오퍼가 수락됨

**계정 라이프사이클 (email only):**
- `user.signed_up` — 가입 환영 이메일
- `listing.published` — 판매자가 리스팅을 게시했을 때 확인 이메일

> 위 4개로 in-app + email 양쪽 채널 + transactional 패턴 모두 검증 가능. 협상 도메인은 3레벨(`negotiation.offer.received`)로 확장성 확보, 단순 도메인은 2레벨로 유지.

### 1차 스코프에서 명시적으로 제외
- 결제 관련 이벤트 (도메인 미구현)
- 배송 관련 이벤트 (도메인 미구현)
- 분쟁, 신뢰 점수, 마케팅 알림
- SMS / 푸시 (모바일) 채널
- Quiet hours, daily digest 등 고급 preferences
- 알림 A/B 테스트, 분석

---

## 3. 인프라 결정 사항 (확정)

| 항목 | 결정 | 이유 |
|------|------|------|
| 이메일 발송 | **Resend** (2026-05-16 확정) | 자체 SMTP 운영 부담 회피, React Email native, Next.js 생태계 정렬 |
| In-app 저장 | 자체 DB (PostgreSQL via Drizzle) | 도메인 데이터와 함께 관리 |
| Preferences UI | 1차 포함, 채널 × 카테고리 토글만 | 단순함 우선 |

---

## 3.5 현 상태 (As-Is) — 이미 있는 자산 / 제약

### 백엔드

**API 프레임워크:** Fastify v5 (CLAUDE.md 정정 완료 — 2026-05-16)

**기존 "이벤트 시스템" — 이름은 같지만 우리가 만들 것과 다른 개념**
- 위치: [apps/api/src/lib/event-dispatcher.ts](../../apps/api/src/lib/event-dispatcher.ts), [apps/api/src/lib/action-handlers.ts](../../apps/api/src/lib/action-handlers.ts)
- **무엇인가:** Amplitude 같은 분석 이벤트가 아니라, **Commerce 상태 머신용 Action Router**다. `negotiation.agreed` 같은 이벤트가 들어오면 `commerce-core`의 순수 라우터가 **단일 PipelineAction**을 반환하고, 등록된 핸들러 1개가 그 action을 DB 작업으로 실행하는 구조. (예: `negotiation.agreed → create_settlement → settlement_approvals INSERT`)
- **알림 시스템과 차이:**
  | | 기존 시스템 | 우리가 필요한 것 |
  |--|---|---|
  | 패턴 | 1 event → 1 action (라우터) | 1 event → N subscribers (fan-out) |
  | 목적 | Commerce 상태 전이 | 알림/이메일/추후 분석 |
  | 라우팅 | commerce-core 순수 함수 | preferences + 채널 |
  | 결과 | DB write | 사용자에게 메시지 |
- **활용 방안 (3가지 선택지):**
  1. **(A) 기존 dispatcher 확장** — primary action 실행 후 추가 subscribers에게 fan-out하도록 인터페이스 변경
  2. **(B) 별도 NotificationEventBus 신설** — 도메인 코드에서 두 디스패처를 모두 호출
  3. **(C) Hook-in 패턴** — 기존 dispatcher 호출 사이트에서 NotificationBus도 함께 publish
- **권장:** **(B) 또는 (C)** — 기존 dispatcher의 "1 event → 1 action" 시맨틱을 깨지 않고 관심사 분리. 최종 결정은 4-A에서.
- **참고할 점:**
  - `idempotency_key` 필드는 envelope에 있으나 enforce 안 됨 — 우리는 강제해야 함
  - 이미 `near_deal`, `stalled` 같은 이벤트가 dispatch되지만 commerce action 없이 버려짐 → WS/알림 fan-out 자리로 활용 가능

**프론트엔드 분석 이벤트는 별개:** Amplitude는 [apps/web](../../apps/web)에서 사용자 행동 추적용으로만 사용. 백엔드 이벤트와 무관.

**활용 가능한 인프라:**
- **WebSocket 채널:** `@fastify/websocket` 기반 `/ws/` 엔드포인트 존재 → in-app 실시간 전달에 활용 (SSE vs WS 고민 종료)
- **Cron/Jobs runner:** [apps/api/src/jobs/runner.ts](../../apps/api/src/jobs/runner.ts) — 이메일 재시도, digest 등 주기 작업에 활용 가능
- **Service 패턴:** [apps/api/src/services/](../../apps/api/src/services/) — `notification.service.ts` 추가가 자연스러움
- **Auth 미들웨어:** Supabase JWT 기반, `req.user` 추출 됨

### 데이터 / 모델

- **자체 `users` 테이블 없음** — Supabase `auth.users` 사용. `packages/db/src/schema`에 `// TODO(slice-6): export { users }` 주석만 있음.
- **결정 필요:** 알림 FK를 (1) `auth.users.id` UUID 그대로 vs (2) 자체 user 테이블 신설. 다른 도메인 테이블들이 어떻게 user를 참조하는지 확인 필요.

### 프론트엔드

**현재 보유:**
- Next.js 15 App Router, React 19, Tailwind v4
- React Query v5 (서버 상태)
- `@radix-ui/react-slider` (single primitive — full shadcn 아님)
- `framer-motion` (애니메이션), `vaul` (drawer)
- 상태관리 라이브러리 없음 (Zustand 등 없음)

**없는 것:**
- Toast / 알림 UI 라이브러리 일체 없음
- 알림 벨 아이콘, 알림 센터 자리 없음

### Toast / Notification UI 라이브러리 — 결정 권장

**옵션 비교:**

| 옵션 | 장점 | 단점 |
|------|------|------|
| **sonner** ⭐ | React 19 호환, ~4kb, Next.js 표준, headless 스타일링, 큐잉 내장 | framer-motion과 별도 애니메이션 시스템 (사소함) |
| react-hot-toast | 가벼움 | sonner 대비 활성도 낮음 |
| 자체 구현 | 완전 제어, framer-motion 일관성 | 큐잉/스택/스와이프-디스미스 등 직접 구현 부담 |

**권장: `sonner` 도입**
- 사실상 Next.js 생태계 표준 (vercel/next.js 공식 예제도 사용)
- 알림 토스트는 디테일(쌓임, 자동 사라짐, hover-pause, 스와이프)이 많아 직접 만들면 시간 소모 큼
- 알림 센터(벨 + 드롭다운 리스트)는 별도로 자체 구현 — Radix Popover 추가하면 됨
- 4kb 추가는 무시할 수준

**역할 분담:**
- `sonner`: 실시간 푸시 토스트 (WS 메시지 도착 시)
- 자체 구현: 알림 센터 페이지/드롭다운 (Radix Popover + Tailwind)

---

## 4. 열린 질문 (다음에 결정할 것)

### A. 아키텍처 위치
- [x] **Notification 도메인 위치**: `apps/api/src/notification/` 내부 모듈로 시작 (2026-05-16 결정)
  - 이유: 기존 `*-core` 패키지는 모두 "외부 의존성 0, 순수 로직" 컨벤션이라 DB/SDK/WS를 다루는 알림 모듈과 맞지 않음. 다른 앱과 공유할 일도 아직 없음. 진짜 필요해지면 그때 패키지로 추출.
- [x] **호출 사이트 발행 방식**: **Dual publish** — 호출자가 commerce dispatcher와 notification bus를 각각 명시적으로 호출 (2026-05-16 결정)
  - 이유: 두 시스템은 시점만 겹칠 뿐 의미상 별개. 1차 스코프 4개 이벤트 중 3개는 한쪽만 필요(`user.signed_up`, `listing.published`, `negotiation.offer.received`는 notification only / `intent.matched`는 commerce only). Facade로 묶으면 매 이벤트마다 분기 로직이 Facade에 모여 단일 결합점이 됨. 호출자가 명시적으로 부르는 게 코드 가독성에도 유리("여기서 이 이벤트는 두 흐름을 트리거함"이 드러남).
- [x] **NotificationBus 인터페이스**: **Publish-only** — 채널은 부트스트랩 시점에 주입, subscribe API는 두지 않음 (2026-05-16 결정)
  - 이유: 채널(in-app, email)은 우리가 소유·관리하는 고정 집합이라 pub/sub의 진짜 가치(미지의 구독자, 동적 등록)가 적용되지 않음. Preferences는 중앙(버스)에서 한 번 평가하는 게 정책 일관성/디버깅에 유리하며, 각 채널이 자기 prefs를 체크하면 중복·드리프트 발생. 진짜 외부 구독자가 필요해지면 subscribe 추가는 non-breaking 확장이라 쉬움.
  - 인터페이스 표면:
    ```ts
    createNotificationBus({ channels, preferences, catalog })
    bus.publish({ type, recipients, payload }): Promise<DispatchResult>
    ```

### F-pre. 사전 확정 사항 (2026-05-16)
- [x] **Payload 저장 방식**: **Denormalized snapshot** — 알림 생성 시점의 데이터를 jsonb로 박제. 이후 원본(리스팅 제목 등)이 변경돼도 알림 히스토리는 당시 그대로.
  - 이유: 알림은 "그 시점에 일어난 일"의 기록이므로 사후 변경이 동기화되면 안 됨. 동적 reflect는 오히려 보안/악용 리스크(예: 리스팅 제목 사후 변경으로 알림 내용 조작).
- [x] **User 참조 컨벤션**: **bare `uuid("user_id")` 컬럼, FK constraint 미설정** — Supabase `auth.users.id`를 그대로 저장. 기존 스키마 50+ 테이블 전체 컨벤션과 정렬.
  - 이유: `auth.*` 스키마와 `public.*` 간 cross-schema FK는 깔끔하지 않아 코드베이스 전체가 application-level integrity로 통일. 알림 프로젝트가 이 패턴을 깨면 일관성 손상 + slice-6(자체 users 테이블) 작업 영역 침범.
  - 컬럼명: `user_id` (받는 사람 1명). 인덱스 필수: `(user_id, created_at DESC)`, partial `(user_id) WHERE read_at IS NULL`.
- [x] **카테고리 저장 방식**: **별도 `category` 컬럼 (denormalized)** — `event_type`(canonical) + `category`(group) 둘 다 저장. catalog 코드가 단일 출처로 매핑 강제.
  - 이유: Preferences가 카테고리 단위 UI라 1급 시민화 필요. B-tree 인덱스 활용으로 prefs 조인/필터 효율. 2026 알림 인프라(Knock/Novu 등) 주류 패턴. 1차 카테고리: `negotiation`, `account`, `listing`.
- [x] **Enum 타입 컨벤션**: **Drizzle TS-레벨 enum** (`text("category", { enum: [...] })`) — Postgres `pgEnum` 미사용.
  - 이유: 코드베이스 전체 50+ 테이블 컨벤션. TS 자동완성/타입 안전성 + 새 값 추가 시 마이그레이션 불필요(Postgres ENUM은 `ALTER TYPE` 필요). CHECK constraint도 미사용 — 신뢰 경계는 application/TS 레벨.

### F-1. `notifications` 테이블 스키마 (2026-05-16 확정)

```ts
// packages/db/src/schema/notifications.ts
export const NOTIFICATION_CATEGORIES = ["negotiation", "account", "listing"] as const;

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),                    // auth.users.id (FK 미설정 — 코드베이스 컨벤션)

  eventType: text("event_type").notNull(),              // canonical: "negotiation.offer.received"
  category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),

  payload: jsonb("payload").notNull(),                  // snapshot — title/body/actor/deeplink 힌트 모두 포함

  readAt: timestamp("read_at"),                         // null = unread
  idempotencyKey: text("idempotency_key").notNull(),    // (user_id, key) composite unique

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
  unreadIdx: index("notifications_unread_idx").on(table.userId).where(sql`read_at IS NULL`),
  idempotencyUniq: uniqueIndex("notifications_user_idempotency_uniq").on(table.userId, table.idempotencyKey),
}));
```

**확정된 디테일:**
1. ✅ Title/body는 payload 안에 — 별도 컬럼 없음, i18n/디자인 변경에 유리
2. ✅ 상태 컬럼은 `read_at`만 — dismiss/archive는 YAGNI
3. ✅ Idempotency 범위는 per-user composite — `(user_id, idempotency_key)` unique
4. ✅ Actor는 payload 안에 — 시스템 알림은 actor 없을 수도 있어 1급 시민화 부적합
5. ✅ Deep link는 catalog에서 동적 생성 — `event_type + payload` → URL
6. ✅ 테이블명 복수형 `notifications`
7. ✅ Soft delete 없음 — read 처리로 충분, 영구 삭제는 retention job(추후)

### F-2. `notification_preferences` 테이블 스키마 (2026-05-16 확정)

```ts
// packages/db/src/schema/notification-preferences.ts
export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").notNull(),
  category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),
  channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
  enabled: boolean("enabled").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.category, table.channel] }),
}));
```

**확정된 디테일:**
1. ✅ **구조: Tall rows** — `(user_id, category, channel)` 복합 PK. 매트릭스 셀 하나당 1행. 카테고리/채널 추가 시 마이그레이션 불필요.
2. ✅ **디폴트 정책: 행 없음 = ON (lazy creation)** — 사용자가 OFF 토글할 때만 행 생성. 2026 산업 표준 (Slack/GitHub/Stripe/Knock/Novu 동일).
3. ✅ **Transactional 강제 ON: Application 레벨** — DB 스키마 변경 없음. Catalog의 `transactional: true` 플래그가 있으면 NotificationBus가 prefs를 우회. 1차 4개 이벤트 모두 transactional.
4. ✅ **채널명 컨벤션: `in_app`** (snake_case)
5. ✅ **타임스탬프: `created_at` + `updated_at` 둘 다** — mutable 테이블 컨벤션 정렬
6. ✅ **이메일 unsubscribe: 글로벌** — 푸터 링크 클릭 시 모든 카테고리의 `email` 채널 OFF. 세밀 제어는 preferences UI에서.

**평가 의사코드:**
```ts
function shouldSend(userId, eventType, channel) {
  const meta = catalog[eventType];
  if (meta.transactional) return true;          // 강제 발송 (prefs 무시)
  const pref = await db.query(notificationPreferences, {
    userId, category: meta.category, channel,
  });
  if (!pref) return true;                       // 행 없음 = 디폴트 ON
  return pref.enabled;
}
```

### F-3. `email_deliveries` 테이블 스키마 (2026-05-16 확정)

```ts
// packages/db/src/schema/email-deliveries.ts
export const EMAIL_DELIVERY_STATUSES = [
  "queued",       // API 요청 직전
  "sent",         // Resend API 200 응답
  "delivered",    // webhook: 수신자 서버 수락
  "bounced",      // webhook: 영구 실패 (bad address 등)
  "complained",   // webhook: spam 신고
  "failed",       // 발송 자체 실패 (예: Resend 오류)
] as const;

export const emailDeliveries = pgTable("email_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),                          // auth.users.id (FK 미설정)
  toEmail: text("to_email").notNull(),                        // 발송 시점 박제 (이메일 변경 대비)

  // 트리거한 이벤트 — notifications.event_type과 동일한 catalog 키 (e.g. "user.signed_up")
  eventType: text("event_type").notNull(),

  provider: text("provider", { enum: ["resend"] }).notNull(), // 추후 multi-provider 대비
  providerMessageId: text("provider_message_id"),             // Resend가 반환, async 채워질 수도

  status: text("status", { enum: EMAIL_DELIVERY_STATUSES }).notNull(),
  errorMessage: text("error_message"),                        // 실패 시 사유

  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at"),                     // webhook으로 업데이트

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("email_deliveries_user_created_idx").on(table.userId, table.createdAt.desc()),
  toEmailIdx: index("email_deliveries_to_email_idx").on(table.toEmail),
  providerMessageUniq: uniqueIndex("email_deliveries_provider_message_uniq")
    .on(table.provider, table.providerMessageId)
    .where(sql`provider_message_id IS NOT NULL`),
}));
```

**확정된 디테일:**
1. ✅ **Lean 미러링 채택 (옵션 1)** — Resend 발송 결과를 DB에 가볍게 기록. 디버깅/지원 대응/멀티프로바이더 옵션 보존.
2. ✅ **`notifications`와 완전 분리 (β1)** — FK 없음. 두 테이블은 같은 트리거 이벤트에서 fan-out된 병렬 레코드, 부모-자식 관계 아님. 필요 시 `(user_id, event_type, created_at)`로 join 가능.
3. ✅ **`user_id` + `to_email` 둘 다 보관** — 이메일은 시점에 따라 변하므로 박제 필요. 자체 users 테이블이 없어 cross-schema JOIN 부담 회피. 운영 분석 쿼리(`WHERE to_email LIKE '%gmail.com'`)에 1급 시민화.
4. ✅ **`event_type`은 catalog 단일 출처** — `notifications.event_type`과 동일한 문자열 (e.g. `"negotiation.offer.received"`). 이메일 전용 별도 분류 아님. cross-channel 분석/디버깅을 위해 공통 네임스페이스.
5. ✅ **Webhook 1차 처리 범위: 중간** — `sent`, `delivered`, `bounced`, `complained`, `failed` 처리. `opened`/`clicked`는 product analytics 영역으로 1차 제외.
6. ✅ **Suppression list 자체 관리 안 함** — Resend가 자동 처리. 우리는 status 컬럼으로 디버깅용 확인만.
7. ✅ **이메일-only 이벤트는 `notifications` 행 생성 안 함** — `user.signed_up`, `listing.published`는 벨에 안 뜸. `email_deliveries`에만 기록.

### F-4. Idempotency 패턴 (2026-05-16 확정)

**키 생성 전략: 결정론적 (Deterministic, catalog 기반 자동 생성)**

```
idempotency_key = `${event_type}:${primary_entity_id}:${recipient_user_id}`

예시:
- "negotiation.offer.received:round_xyz:user_buyer"
- "negotiation.offer.accepted:session_abc:user_seller"
- "user.signed_up:user_abc:user_abc"
- "listing.published:listing_xyz:user_seller"
```

**Catalog에 메타 추가:**
```ts
{
  "negotiation.offer.received": {
    category: "negotiation",
    channels: ["in_app", "email"],
    transactional: true,
    primaryEntityKey: "roundId",     // ← payload에서 어떤 필드를 키에 쓸지
  },
  "negotiation.offer.accepted": { primaryEntityKey: "sessionId", ... },
  "user.signed_up":             { primaryEntityKey: "userId", ... },
  "listing.published":          { primaryEntityKey: "listingId", ... },
}
```

**확정된 디테일:**
1. ✅ **결정론적 키** — 호출자가 키 신경 안 씀. catalog의 `primaryEntityKey`로 자동 생성. 같은 입력 = 같은 키.
2. ✅ **`email_deliveries`도 동일 키 공유** — `(user_id, idempotency_key)` unique constraint 추가. in-app/email이 각각 독립적으로 중복 차단.
3. ✅ **Catalog가 단일 출처** — `event_type` 정의 + `primaryEntityKey` 메타가 한곳. 키 생성 규칙도 catalog의 책임.
4. ✅ **충돌 시 `ON CONFLICT DO NOTHING` + 로그** — 호출자 코드 단순화. 중복 감지는 정상 동작.
5. ✅ **Retention 1년 (1차 미구현)** — retention job은 추후. 1년 보존은 분기/반기/연간 회계·지원 사이클을 자연스럽게 커버하며, 데이터 삭제는 되돌릴 수 없으므로 보수적으로 길게 잡음. 코드는 6개월 후 cron으로 구축, 정책 재검토 가능.
6. ✅ **TS 타입 안전성** — `event_type`은 `as const` 배열로 정의, 타입 좁힘으로 컴파일 타임 보호.

**F-3 스키마 최종 보강 (F-4 결정 반영):**
```ts
// F-3에 추가된 컬럼
idempotencyKey: text("idempotency_key").notNull(),
attempts: integer("attempts").notNull().default(0),  // cron retry: WHERE attempts < 3
// + uniqueIndex("email_deliveries_user_idempotency_uniq").on(table.userId, table.idempotencyKey)
```

### B. 실시간 전달 방식 ✅ **그룹 완료** (2026-05-16)
- [x] **In-app 실시간 전달: WebSocket** — 기존 `@fastify/websocket` 인프라 활용
- [x] **WS path: 별도 `/ws/notifications`** — 관심사 분리, 메시지 라우팅 단순
- [x] **WS envelope 포맷**:
  ```ts
  {
    type: "notification.new",         // 확장 가능 (notification.read, notification.deleted 등)
    notification: {
      id: string,
      eventType: string,
      category: string,
      payload: {...},                  // DB 저장 그대로 push
      createdAt: string,
    }
  }
  ```
- [x] **오프라인 백로그: REST fetch, WS replay 안 함** — `notifications` 테이블이 진실의 원천. 알림 센터 컴포넌트가 마운트 시 `GET /notifications?unread=true` 호출. WS는 "지금 접속 중인 사용자에게 push" 채널.
- [x] **Auth**: 기존 Supabase JWT (코드베이스 컨벤션 따름)

### C. 큐 / 비동기 ✅ **그룹 완료** (2026-05-16)
- [x] **publish() = 하이브리드 (in-app 동기 + 이메일 비동기)**
  - 동기: Zod 검증, `notifications` INSERT, `email_deliveries` INSERT (status='queued'), WS push
  - 비동기 fire-and-forget: Resend API 호출
  - publish() 반환은 ~20ms 이내
- [x] **비동기 재시도: 기존 cron runner에 `retry-failed-emails` 잡 추가**
  - 5분 주기, `WHERE status='failed' AND attempts<3 AND created_at > NOW() - INTERVAL '24h'`
  - 좀비 queued 잡 회수: `OR (status='queued' AND created_at < NOW() - INTERVAL '10 minutes')`
- [x] **큐 인프라 미사용** — pg-boss, BullMQ, Cloud Tasks 등 모두 1차 미도입
  - **코드 주석으로 future-migration 명시 필수** — 구현 코드에 명시:
    ```ts
    // TODO(notification-queue): 1차에선 cron-retry 패턴으로 단순화.
    // 볼륨/요구 증가 시 Inngest (무료 50k/월, 큐+cron+workflow 통합) 또는
    // pg-boss (자체호스팅, 인프라 0 추가) 검토.
    // 결정 배경: docs/wip/Notification_System_Plan.md §4-C
    ```
  - 트리거 조건 (큐 도입 검토 시점):
    - 알림 발송이 분당 100건 이상
    - 우선순위/지연 발송 요구 발생
    - 프로세스 죽음으로 인한 잡 손실이 운영 이슈가 됨

### D. 이메일 SaaS 선택
- [x] **Resend 채택** (2026-05-16 결정)
  - 1차 비용 $0 (무료 티어 3k/월, 1차 예상 볼륨 ~3k 정확히 커버)
  - React Email native 통합 — 우리의 "타입 안전 템플릿" 결정과 직선 연결 (같은 팀 제작)
  - Vercel/Next.js 생태계 표준, DX 최고
  - Deliverability 충분 (in-app + email 듀얼 채널이라 단일점 실패 아님)
  - Webhook + suppression list 자동 관리 → 1차 운영 요구 만족
  - 추후 볼륨 확대 시 Postmark/SES 이전 가능 (도메인 인증 옮김, lock-in 약함). `email_deliveries.provider` 컬럼으로 멀티 프로바이더 전환 대비.

### E. 템플릿 ✅ **그룹 완료** (2026-05-16)
- [x] **이메일 템플릿 엔진: React Email** — Resend 같은 팀, 타입 안전, codebase 스택(React 19/TS) 정렬. payload props 그대로 컴파일 타임 안전.
- [x] **In-app 렌더 위치: 프론트엔드** — payload만 박제, 클라이언트가 catalog 매핑으로 텍스트/링크 생성. 텍스트 변경/디자인 수정이 백엔드 배포 없이 가능.
- [x] **템플릿 파일 구조: 이벤트당 분할** — `apps/api/src/notification/templates/{event-name}.tsx`. React Email 컴포넌트는 길어지므로 한 파일에 모으면 비대.
- [x] **공통 `<BaseEmail>` 컴포넌트** — 헤더(로고/브랜드), 푸터(unsubscribe/회사 주소) 통일. 디자인 변경은 한곳 수정.
- [x] **1차 언어: 영어만** — i18n 인프라는 알림 스코프 밖 별도 작업. 추후 도입 시 템플릿 함수 시그니처(locale 인자) 확장.
- [x] **이메일 발신자 셋업**:
  - **From**: `Haggle <notifications@tryhaggle.ai>`
  - **Reply-To**: 미설정 (1차) — `notifications@` 자동 응답으로 사용자 안내 ("자동 발송 메일함입니다. 문의는 앱 내 'Contact Support'를 이용해주세요")
  - support@ Reply-To 도입은 고객 응대 체계 갖춰지는 시점으로 연기

### F. 데이터 모델링 ✅ **그룹 완료** (2026-05-16)
- [x] `notifications` 테이블 스키마 — F-1 참조
- [x] `notification_preferences` 스키마 — F-2 참조
- [x] `email_deliveries` 스키마 — F-3 참조
- [x] Idempotency 키 전략 + 명명 컨벤션 — F-4 참조

### G. 이벤트 페이로드 스키마 ✅ **그룹 완료** (2026-05-16)
- [x] **페이로드 타입 정의 방식: Zod + `z.infer`** (2026-05-16 결정)
  - 이유: codebase 표준 (apps/api 34파일 사용 중, `@haggle/shared`/`commerce-core`도 의존). 런타임 검증으로 jsonb 안전성 확보, 타입은 `z.infer`로 자동 추론 → 중복 정의 없음.
  - Catalog 메타에 `payloadSchema` 필드 추가, NotificationBus가 `publish()` 시점에 `schema.parse(payload)`로 검증 후 DB 저장.
  - 패턴 예시:
    ```ts
    export const OfferReceivedPayloadSchema = z.object({
      sessionId: z.string().uuid(),
      roundId: z.string().uuid(),
      offerPriceMinor: z.number().int().nonnegative(),
      // ...
    });
    export type OfferReceivedPayload = z.infer<typeof OfferReceivedPayloadSchema>;
    ```
- [x] **4개 이벤트별 페이로드 schema 확정** (2026-05-16) — G-1 참조
- [x] **Catalog 파일 구조: 단일 파일 시작 (옵션 X)** (2026-05-16 결정)
  - 위치: `apps/api/src/notification/catalog.ts`
  - 이유: 1차 4개 이벤트엔 단일 파일이 한눈에 보임. 분할은 이벤트 증가 시점에 cut/paste로 저비용 전환 가능. YAGNI.
  - **임계점 가이드라인**: 이벤트 ≥ 10개 또는 catalog.ts ≥ 500줄에 도달하면 카테고리별 분할(옵션 Y, `catalog/{negotiation,account,listing}.ts`)로 이전 검토.

### G-1. 4개 이벤트 Payload Schema (2026-05-16 확정)

```ts
// apps/api/src/notification/catalog.ts (예상)
import { z } from "zod";

export const OfferReceivedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  roundId: z.string().uuid(),                            // idempotency primaryEntityKey
  offerPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  offerType: z.enum(["INITIAL", "COUNTER"]),
  fromUserName: z.string().min(1),
  listingTitle: z.string().min(1),
  listingId: z.string().uuid(),
});

export const OfferAcceptedPayloadSchema = z.object({
  sessionId: z.string().uuid(),                          // primaryEntityKey
  agreedPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  acceptedByUserName: z.string().min(1),
  listingTitle: z.string().min(1),
  listingId: z.string().uuid(),
});

export const UserSignedUpPayloadSchema = z.object({
  userId: z.string().uuid(),                             // primaryEntityKey
  userName: z.string().min(1),
});

export const ListingPublishedPayloadSchema = z.object({
  listingId: z.string().uuid(),                          // primaryEntityKey
  listingTitle: z.string().min(1),
  listingPriceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  sellerName: z.string().min(1),
});
```

**Sub-결정:**
- ✅ `userEmail`은 payload 제외 — `email_deliveries.to_email`에 박제, 중복 회피
- ✅ `currency` 포함 — 다통화 대비, 3바이트 무비용
- ✅ `offerType` 포함 — UX 차별화("오퍼" vs "역제안") + 분석 가치
- ✅ 모든 ID는 `.uuid()`, 문자열은 `.min(1)`로 strict 시작 (변경 비용 최소화)
- ✅ 금액은 `*_minor` 컨벤션 (cent 단위 정수), 코드베이스 정렬

**호출자 책임 (1차 페이로드 영역 외):**
- `fromUserName`/`acceptedByUserName`/`sellerName` 출처 결정 (Supabase auth metadata vs 자체 프로필)
- 이름 부재 시 fallback (예: `"익명 사용자"`) — payload schema에선 항상 required로 강제

### G-2. 표시 렌더링 — 철학 B (Backend Pre-render) (2026-05-16 확정)

**방향:** 백엔드 catalog의 `renderDisplay()` 함수가 publish() 시점에 `displayTitle` + `displayLink`를 생성하여 payload에 박제. 프론트엔드는 이 두 필드만 읽으면 됨. 프론트엔드 renderer 파일 불필요.

```ts
// catalog.ts — 각 이벤트에 renderDisplay 추가
export const EVENT_CATALOG = {
  "negotiation.offer.received": {
    // ...기존 메타...
    renderDisplay: (p: OfferReceivedPayload) => ({
      displayTitle: `${p.fromUserName} sent a ${p.offerType === "COUNTER" ? "counter offer" : "new offer"} on ${p.listingTitle}`,
      displayLink: `/negotiations/${p.sessionId}`,
    }),
  },
  "negotiation.offer.accepted": {
    renderDisplay: (p: OfferAcceptedPayload) => ({
      displayTitle: `${p.acceptedByUserName} accepted your offer on ${p.listingTitle}!`,
      displayLink: `/negotiations/${p.sessionId}`,
    }),
  },
  // user.signed_up / listing.published — in-app 행 없으므로 renderDisplay 불필요
};

// NotificationBus publish() 내부
const { displayTitle, displayLink } = meta.renderDisplay(validatedPayload);
const storedPayload = { ...validatedPayload, displayTitle, displayLink };
```

**프론트엔드 렌더링 — 두 필드만 사용:**
```tsx
function NotificationItem({ notification }) {
  return (
    <a href={notification.payload.displayLink}>
      {notification.payload.displayTitle}
    </a>
  );
}

// sonner 토스트도 동일
toast(payload.displayTitle, {
  action: { label: "View", onClick: () => router.push(payload.displayLink) }
});
```

**트레이드오프 (알고 가는 것):**
- 텍스트 변경 시 기존 저장 행은 옛 텍스트 유지 (snapshot 원칙 상 정상)
- i18n 필요 시 `renderDisplay(payload, locale)` 시그니처 확장으로 대응
- 새 이벤트 추가 시 **백엔드 catalog만** 수정 → 프론트 자동 동작 (단일 변경점)

### H. 프론트엔드 UI ✅ **그룹 완료** (2026-05-16)

**참조 파일:**
- 헤더: [apps/web/src/components/nav.tsx](../../apps/web/src/components/nav.tsx)
- 바텀 탭: [apps/web/src/components/bottom-nav.tsx](../../apps/web/src/components/bottom-nav.tsx)
- WS 참조 구현: [apps/web/src/hooks/use-negotiation-ws.ts](../../apps/web/src/hooks/use-negotiation-ws.ts)
- Settings: [apps/web/src/app/(app)/settings/](../../apps/web/src/app/(app)/settings/)
- Empty state 패턴: [apps/web/src/app/browse/_components/empty-state.tsx](../../apps/web/src/app/browse/_components/empty-state.tsx)

- [x] **알림 벨 위치 (데스크탑)**: `nav.tsx` 우측 모드 스위치 버튼과 유저 메뉴 드롭다운 사이
- [x] **알림 진입점 (모바일)**: bottom-nav Profile 탭 아이콘에 뱃지(빨간 점). 탭 클릭 → Profile 페이지 상단 "알림 N개" 진입 버튼
- [x] **알림 센터 형태**:
  - 데스크탑: 벨 클릭 → 드롭다운 (최근 5~8개 미리보기 + "View all" 링크). nav.tsx 유저 메뉴 패턴 그대로 활용 (Radix 없이 자체 구현).
  - 모바일: `/notifications` 전용 페이지로 이동 (새 화면, vaul drawer 미사용)
  - **공용 라우트 `/notifications`**: 데스크탑 View All + 모바일 진입 공용. 반응형 레이아웃 단일 구현.
- [x] **Toast 정책 (sonner)**:
  - 위치: `bottom-center`
  - 자동 사라짐: 5초 (`duration: 5000`)
  - hover 일시정지: ✅ (sonner 기본)
  - 액션 버튼: catalog의 `actionLabel`/`actionHref` 있으면 표시, 없으면 정보성 토스트
  - 스택: `expand: true` (sonner stacked 모드)
  - 중복 방지: `toast(msg, { id: notification.id })` — 같은 notification.id는 하나만 유지
- [x] **Mark-as-read 트리거**:
  - 개별 알림 클릭 → 그 알림만 읽음 처리 + 페이지 이동
  - 드롭다운 상단 "Mark all read" 버튼 → 전체 읽음 처리
  - **드롭다운 열기 단독 = 읽음 처리 안 함** (뱃지 숫자 유지)
- [x] **WS 연결 관리**: `use-notification-ws.ts` 신설 — 기존 `use-negotiation-ws.ts` 패턴 복사 (Supabase JWT 자동 첨부, max 3회 재연결, polling fallback). `(app)/layout.tsx`에 마운트 (로그인 사용자 진입 시 자동 연결).
- [x] **알림 목록 페이지네이션**: browse `listing-grid.tsx` 패턴 동일 적용 — cursor 기반(`created_at` + `id`), `IntersectionObserver` sentinel div (`rootMargin: "400px"`), `nextCursor: null`이면 종료. SSR 초기 데이터 → client hydration.
- [x] **안읽은 개수(뱃지) 갱신**: 마운트 시 `GET /api/notifications/count`로 초기화 → WS 메시지 도착 시 클라이언트 카운터 +1 → 개별 읽음 시 -1 → Mark all read 시 0.
- [x] **REST API 엔드포인트 목록** (코드베이스 `/api/*` 패턴 준수):
  ```
  GET    /api/notifications              목록 (cursor, limit=20)
  GET    /api/notifications/count        안읽은 개수
  PATCH  /api/notifications/:id/read    개별 읽음
  PATCH  /api/notifications/read-all    전체 읽음
  GET    /api/notifications/preferences prefs 조회
  PUT    /api/notifications/preferences prefs 업데이트
  GET    /api/notifications/unsubscribe 이메일 수신 거부 (token 파라미터)
  POST   /api/webhooks/resend           Resend webhook 수신
  ```
- [x] **`user.signed_up` 트리거**: `/auth/callback` 서버 액션에서 API 호출 (옵션 C). 이메일 인증 완료 후 발행. 첫 로그인 판별(`user.created_at ≈ now()` 또는 `app_metadata`)로 재가입 중복 방지. idempotency key(`user.signed_up:userId:userId`)로 이중 차단.
- [x] **Empty/Loading/Error 상태**: inline 구현, 기존 패턴 준수
  - Loading: `animate-pulse` skeleton (listing-card 패턴)
  - Empty: 아이콘 + "알림이 없어요" (browse empty-state 패턴)
  - Error: 메시지 + retry 버튼
- [x] **Preferences UI 위치**: `/settings` 기존 페이지에 "Notifications" 새 섹션 추가 (1차). 토글 6개 (3카테고리 × 2채널). 추후 항목 증가 시 `/settings/notifications` 별도 라우트로 이전.

### I. 운영 / 관측 ✅ **그룹 완료** (2026-05-16)
- [x] **재시도 정책**: 5분 주기 cron, attempts < 3, 24h 윈도우. 간격 고정 5분 (지수 백오프는 YAGNI — cron 기반에서 `next_retry_at` 컬럼 추가 필요해 과설계).
- [x] **3회 실패 후 처리**: 방치 (status='failed', attempts≥3이면 cron이 WHERE 절로 자연스럽게 건너뜀). 관리자 alert 없음 — 필요 시 `WHERE status='failed' AND attempts >= 3` 쿼리로 확인.
- [x] **발송 로그 보관 기간**: `notifications` + `email_deliveries` 모두 **1년** — 통일 정책, 같은 cron 잡으로 동시 정리 가능. `email_deliveries`는 행이 가벼워 스토리지 부담 없음, 마켓플레이스 지원 케이스 커버 충분.
- [x] **관리자 대시보드**: 없음 (1차). Supabase Studio + 직접 SQL로 운영 충분. 반복적 운영 필요 확인 후 도입 검토.
- [x] **Resend Webhook 서명 검증**: 필수 포함. `Svix-Signature` 헤더 HMAC 검증 — 기존 Stripe webhook 패턴(`rawBody` 캡처 + secret 검증) 그대로 복사. 미검증 시 외부에서 email status 조작 가능.
- [x] **필수 환경변수**:
  ```
  # apps/api/.env
  RESEND_API_KEY=re_...                    # Resend 발송 API 키
  RESEND_WEBHOOK_SECRET=whsec_...          # Resend Svix webhook 서명 검증
  NOTIFICATION_UNSUBSCRIBE_SECRET=...      # HMAC 서명 (unsubscribe 토큰 생성/검증)
  ```
- [x] **알림 목록 정렬**: `GET /api/notifications` 응답은 `created_at DESC` (최신순). cursor는 `created_at:id` 복합 커서.
- [x] **드롭다운 표시 개수**: **5개** (최근 5개만 미리보기, 이후 View all → `/notifications`)
- [x] **BaseEmail 컴포넌트 위치**: `apps/api/src/notification/templates/base-email.tsx` — 헤더(로고/브랜드), 푸터(unsubscribe 링크/회사 주소) 포함. 모든 이메일 템플릿이 wrap.

### J. 보안 / 권한 ✅ **그룹 완료** (2026-05-16)
- [x] **이메일 Unsubscribe**:
  - 방식: **글로벌 one-click** — 모든 이메일 채널 일괄 OFF (4-F-2 글로벌 정책 정렬)
  - 엔드포인트: `GET /api/notifications/unsubscribe?token={signed_token}`
  - 토큰: `user_id`를 HMAC 서명 (서명 없으면 URL로 타인 unsubscribe 가능 — 필수)
  - 처리: `notification_preferences`에 모든 email 채널 OFF INSERT/UPDATE (idempotent)
  - 확인 페이지: "수신 거부 완료. 다시 받으시려면 앱 설정에서 변경하세요"
  - `List-Unsubscribe` 헤더 포함 (Gmail 원클릭 버튼 지원)
  - 토큰 만료 없음 (오래된 이메일에서도 작동해야 함)
- [x] **API 접근 권한**: 기존 Supabase JWT 미들웨어 + `WHERE user_id = req.user.id` 강제. 추가 구현 없음 — 코드베이스 기존 패턴.
- [x] **WS 접근 권한**: `/ws/notifications` 연결 시 JWT 검증. `use-negotiation-ws.ts` 기존 패턴 동일 적용 (연결 시 Supabase token 헤더 첨부 → 서버 검증).
- [x] **Webhook 엔드포인트 보안**: 4-I 결정 (Resend Svix 서명 검증) — 중복 없음.

---

## 5. 구현 계획 — Vertical Slices

> **워크플로우:** Slice 시작 전 파일 목록 + 의도 확인 → 구현 → 너가 테스트 → OK 후 다음 Slice.
> 수동 작업이 필요한 것은 Slice 0으로 분리. AI가 건드릴 수 없는 것은 절대 건너뛰지 않음.

---

### Slice 0 — 수동 셋업 ✅ **완료** (2026-05-16)
**목표:** 코드 작성 전 외부 서비스 + 환경 준비 완료

- [ ] **Resend 계정 + 도메인 verification**
  1. [resend.com](https://resend.com) 가입 → 무료 플랜
  2. Domains → `tryhaggle.ai` 추가
  3. 안내되는 TXT 레코드 3~4개를 DNS provider에 추가 (SPF / DKIM)
  4. Verified 상태 확인
  5. API Keys → 새 키 생성

- [ ] **환경변수 추가** (`apps/api/.env`)
  ```
  RESEND_API_KEY=re_...
  RESEND_WEBHOOK_SECRET=whsec_...   # Resend → Webhooks에서 생성
  NOTIFICATION_UNSUBSCRIBE_SECRET=<랜덤 32자 이상 문자열>
  ```

- [ ] **Resend Webhook 엔드포인트 등록**
  1. Resend → Webhooks → Add Endpoint
  2. URL: `https://api.tryhaggle.ai/api/webhooks/resend` (또는 로컬 dev: ngrok URL)
  3. 이벤트: `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`
  4. Signing Secret 복사 → `RESEND_WEBHOOK_SECRET`에 저장

- [ ] **`notifications@tryhaggle.ai` 발신 테스트** (domain verified 후)
  - Resend 대시보드 → Send Test Email → From: `notifications@tryhaggle.ai`

**✅ 완료 기준:** Resend 대시보드에서 domain Status = Verified, 테스트 이메일 수신 확인

---

### Slice 1 — DB 스키마 ⏳
**목표:** 3개 테이블 마이그레이션 완료, Supabase Studio에서 확인

**만들 파일:**
```
packages/db/src/schema/notifications.ts          (신규)
packages/db/src/schema/notification-preferences.ts (신규)
packages/db/src/schema/email-deliveries.ts       (신규)
packages/db/src/index.ts                          (기존 — export 3개 추가)
```

**작업 내용:**
- F-1 스키마 그대로 구현 (notifications)
- F-2 스키마 그대로 구현 (notification_preferences)
- F-3 + F-4 보강 반영 스키마 구현 (email_deliveries + attempts + idempotencyKey)
- `pnpm --filter @haggle/db db:generate && db:push`

**✅ 완료 기준:** Supabase Studio에서 3개 테이블 + 인덱스 확인

---

### Slice 2 — 백엔드 코어 ⏳
**목표:** `notificationBus.publish()` 한 줄로 in-app 저장 + WS push + 이메일 발송 가능

**만들 파일:**
```
apps/api/src/notification/catalog.ts              (신규 — 이벤트 정의 + Zod + renderDisplay)
apps/api/src/notification/bus.ts                  (신규 — NotificationBus)
apps/api/src/notification/channels/in-app.ts      (신규 — DB INSERT + WS push)
apps/api/src/notification/channels/email.ts       (신규 — Resend SDK 연동)
apps/api/src/notification/ws-registry.ts          (신규 — user_id별 WS 연결 관리)
apps/api/src/notification/templates/base-email.tsx     (신규 — 공통 레이아웃)
apps/api/src/notification/templates/offer-received.tsx (신규)
apps/api/src/notification/templates/offer-accepted.tsx (신규)
apps/api/src/notification/templates/user-signed-up.tsx (신규)
apps/api/src/notification/templates/listing-published.tsx (신규)
apps/api/src/notification/index.ts                (신규 — barrel export)
apps/api/src/server.ts                            (기존 — /ws/notifications WS 라우트 추가)
```

**작업 내용:**
- catalog.ts: 4개 이벤트 정의 (Zod schema + 메타 + renderDisplay)
- bus.ts: `publish({ type, recipientUserId, payload })` → Zod 검증 → prefs 평가 → 채널 fan-out
- in-app.ts: notifications INSERT (ON CONFLICT DO NOTHING) → ws-registry에서 해당 user WS 조회 → push
- email.ts: email_deliveries INSERT (status='queued') → `void resend.emails.send(...)` fire-and-forget
- ws-registry.ts: `Map<userId, WebSocket>` 관리, 연결/해제 시 등록/제거
- /ws/notifications 라우트: JWT 검증 → ws-registry에 등록
- 패키지 설치: `resend`, `@react-email/components`

**✅ 완료 기준:**
```ts
// apps/api/src/scripts/test-notification.ts (임시 스크립트로 테스트)
await notificationBus.publish({
  type: "negotiation.offer.received",
  recipientUserId: "...",
  payload: { sessionId: "...", roundId: "...", ... },
});
// → notifications 테이블 행 생성 확인
// → Resend 대시보드에서 이메일 발송 확인
```

---

### Slice 3 — REST API + Webhook + Cron ⏳
**목표:** 프론트엔드가 알림을 조회/업데이트할 수 있고, Resend webhook 수신 + 재시도 cron 동작

**만들 파일:**
```
apps/api/src/routes/notifications.ts             (신규 — 8개 엔드포인트)
apps/api/src/routes/webhooks/resend.ts           (신규 — Svix 서명 검증 + status 업데이트)
apps/api/src/jobs/retry-failed-emails.ts         (신규 — cron 잡)
apps/api/src/server.ts                           (기존 — 라우트 등록)
apps/api/src/jobs/runner.ts                      (기존 — retry 잡 등록)
```

**작업 내용:**
- notifications.ts 라우트 8개:
  - `GET /api/notifications` (cursor 기반, limit=20, created_at DESC)
  - `GET /api/notifications/count` (unread count)
  - `PATCH /api/notifications/:id/read`
  - `PATCH /api/notifications/read-all`
  - `GET /api/notifications/preferences`
  - `PUT /api/notifications/preferences`
  - `GET /api/notifications/unsubscribe` (HMAC 검증 → email OFF)
- webhooks/resend.ts: rawBody 캡처 → Svix 검증 → email_deliveries status UPDATE + attempts++
- retry-failed-emails.ts: `WHERE status='failed' AND attempts<3 AND created_at > NOW()-'24h'::interval OR (status='queued' AND created_at < NOW()-'10min'::interval)`
- 기존 Stripe webhook 패턴 참조: `apps/api/src/routes/webhooks.ts`

**✅ 완료 기준:**
- `curl GET /api/notifications` → 200 빈 배열
- Resend test webhook → email_deliveries status 업데이트 확인
- cron 잡 등록 확인 (ENABLE_CRON=true 로그)

---

### Slice 4 — 이벤트 연결 (4개) ⏳
**목표:** 실제 도메인 액션 시 알림 자동 발송

**수정할 파일:**
```
apps/web/src/app/auth/callback/route.ts          (기존 — user.signed_up 발행)
apps/api/src/routes/drafts.ts                    (기존 — listing.published 발행)
apps/api/src/routes/negotiations.ts              (기존 — offer.received + offer.accepted 발행)
```

**작업 내용:**
- auth/callback: `supabase.auth.getUser()` → 신규 유저 판별 (`created_at > now() - 30s`) → `POST /api/notifications/internal/signed-up` or 직접 notificationBus.publish()
- drafts.ts: publishDraft() 성공 후 `notificationBus.publish({ type: "listing.published", ... })`
- negotiations.ts: 오퍼 수신 시 `notificationBus.publish({ type: "negotiation.offer.received", ... })`, 수락 시 `negotiation.offer.accepted`
- Dual publish 주의: negotiation.agreed는 기존 commerceDispatcher도 유지

**✅ 완료 기준:**
- 실제 회원가입 → 이메일 수신 확인
- 리스팅 게시 → 이메일 수신 확인
- 오퍼 발송 → 상대방 in-app 알림 DB 행 + 이메일 수신 확인
- 오퍼 수락 → in-app + 이메일 확인

---

### Slice 5 — 프론트엔드 ⏳
**목표:** 벨 아이콘 + 드롭다운 + /notifications 페이지 + 실시간 토스트 동작

**만들/수정할 파일:**
```
apps/web/package.json                            (기존 — sonner 추가)
apps/web/src/app/layout.tsx                      (기존 — <Toaster> 마운트)
apps/web/src/hooks/use-notification-ws.ts        (신규 — WS 연결 + 토스트 트리거)
apps/web/src/app/(app)/layout.tsx                (기존 — useNotificationWs 마운트)
apps/web/src/components/nav.tsx                  (기존 — 벨 아이콘 + 드롭다운 추가)
apps/web/src/components/bottom-nav.tsx           (기존 — Profile 탭 뱃지 추가)
apps/web/src/app/(app)/notifications/page.tsx    (신규 — /notifications 풀 페이지)
apps/web/src/app/(app)/profile/page.tsx          (기존 또는 신규 — 알림 진입 버튼)
apps/web/src/app/(app)/settings/settings-content.tsx (기존 — Notifications 섹션 추가)
apps/web/src/lib/api-client.ts                   (기존 — 알림 API 호출 함수 추가)
```

**작업 내용:**
- use-notification-ws.ts: `use-negotiation-ws.ts` 패턴 복사 → `/ws/notifications` 연결 → 메시지 도착 시 sonner toast + unreadCount +1
- nav.tsx: 벨 아이콘 → 클릭 시 드롭다운 (최근 5개, Mark all read, View all 링크)
- /notifications/page.tsx: cursor 기반 무한스크롤 (browse listing-grid 패턴), 각 알림 클릭 시 읽음 처리 + displayLink 이동
- settings-content.tsx: 카테고리 × 채널 토글 6개 (negotiation/account/listing × in_app/email)

**✅ 완료 기준:**
- 오퍼 발송 시 상대방 화면에 sonner 토스트 실시간 등장
- 벨 뱃지 숫자 정확
- /notifications 무한스크롤 동작
- 설정에서 이메일 토글 OFF → 이후 이메일 미발송 확인

---

### Phase 3 — 검증 & 안정화 ⏳
- [ ] E2E 테스트 (핵심 플로우)
- [ ] 새 이벤트 추가 가이드 문서화 (catalog.ts 수정 → 자동 동작 확인)

---

## 6. 의사결정 로그

| 날짜 | 결정 | 맥락 |
|------|------|------|
| 2026-05-15 | 스코프를 "인프라 + 최소 이벤트"로 한정 | 결제/배송 도메인이 아직 없어 추측 기반 설계는 위험. 단순한 이벤트로 파이프라인을 끝까지 검증하는 게 안전. |
| 2026-05-15 | 이메일은 SaaS, in-app은 자체 구축 | 균형잡힌 선택. 이메일 deliverability는 외주, in-app은 도메인 데이터와 결합도 높아 자체 보유. |
| 2026-05-15 | Preferences UI를 1차에 포함 (단순 토글만) | 알림 끄기는 신뢰의 기본 요소. 단순 토글만이면 구현 비용 낮음. |
| 2026-05-15 | 이메일 대상 이벤트에 가입/리스팅 게시 추가 | Transactional 이메일 패턴(협상 외)을 1차부터 검증해두는 게 인프라 일반성 확인에 유리. |
| 2026-05-16 | 기존 event-dispatcher는 commerce action router로 식별, 알림용 fan-out 버스는 별도/연동으로 신설 방향 | 기존 시스템은 1 event → 1 action 시맨틱이라 알림용 fan-out과 충돌. 관심사 분리 필요. 구체적 통합 방식은 4-A에서 결정. |
| 2026-05-16 | Toast 라이브러리는 sonner 채택 권장, 알림 센터는 자체 구현 | sonner는 Next.js 생태계 표준이고 토스트 디테일을 직접 만드는 비용이 큼. 알림 센터는 단순 리스트라 Radix Popover로 충분. |
| 2026-05-16 | WS 채널은 기존 `@fastify/websocket` `/ws/` 활용 | 이미 구축돼 있어 SSE vs WS 결정 불필요. 별도 path(`/ws/notifications`) 추가 여부만 4-B에서 결정. |
| 2026-05-16 | 토스트 시스템 부재 재확인 → sonner 1차 스코프에 명시 포함 | 검색 결과 web 앱에 토스트/스낵바 UI 0건. 실시간 푸시 메시지 표면은 알림 시스템의 핵심이라 함께 구축. |
| 2026-05-16 | 기존 event-dispatcher 확장(옵션 A)은 배제, 별도 NotificationBus 신설을 디폴트로 | 1→1 commerce action router와 1→N fan-out 알림 버스는 시맨틱이 다름. 강제 통합은 양쪽 모두 오염시킴. 호출 사이트에서 둘 다 publish하는 느슨한 결합 유력. |
| 2026-05-16 | Notification 도메인은 `apps/api/src/notification/` 내부 모듈로 시작 | 기존 `*-core` 패키지는 순수 로직 컨벤션이라 DB/SDK 다루는 알림과 부적합. 다른 앱과 공유 필요 없음. 필요해지면 추후 추출. |
| 2026-05-16 | Commerce dispatcher와 NotificationBus는 호출자가 각각 명시적으로 호출(Dual publish) | 두 시스템은 시점만 겹칠 뿐 별개. 이벤트 대다수가 한쪽만 필요해서 Facade로 묶으면 분기가 한곳에 모여 단일 결합점이 됨. 명시적 호출이 가독성·확장성 모두 유리. |
| 2026-05-16 | NotificationBus는 publish-only, 채널은 부트스트랩 주입 | 채널이 고정 집합이고 우리 소유라 pub/sub 유연성 불필요. Preferences를 중앙에서 평가하는 게 일관성 확보에 유리. subscribe는 추후 non-breaking 확장 가능. |
| 2026-05-16 | Payload는 denormalized snapshot (jsonb) | 알림은 시점 기록. 원본 변경 시 동기화되면 안 되며, 보안/악용 리스크. |
| 2026-05-16 | User 참조는 bare `uuid("user_id")`, FK 미설정 | 50+ 기존 테이블 전체 컨벤션과 정렬. slice-6(자체 users 테이블) 영역 침범 방지. |
| 2026-05-16 | 카테고리는 별도 컬럼 (event_type + category 이중 저장) | Preferences가 카테고리 단위 UI라 1급 시민 필요. 인덱스/쿼리 효율. 2026 알림 인프라 주류 패턴. |
| 2026-05-16 | Enum은 Drizzle TS-레벨(`text` + `enum`), pgEnum/CHECK 미사용 | 코드베이스 50+ 테이블 컨벤션. 값 추가 시 마이그레이션 불필요. |
| 2026-05-16 | `notifications` 본 테이블 스키마 확정 (5 디테일 + 3 보조) | YAGNI 기준으로 컬럼 최소화. title/body/actor/deeplink 모두 payload(jsonb)에 박제. read_at 외 상태 없음. (user_id, idempotency_key) composite unique. |
| 2026-05-16 | `notification_preferences` Tall row 구조 + 디폴트 ON lazy creation + transactional application-level 강제 | 카테고리/채널 추가에 마이그레이션 불필요, 2026 산업 표준 패턴, 사용자가 핵심 알림을 실수로 끄지 못하도록 catalog 플래그로 우회. |
| 2026-05-16 | 이메일 SaaS는 Resend 채택 | 1차 무료 티어 커버, React Email native 통합, Next.js 생태계 표준 DX, in-app 듀얼 채널이라 deliverability 단일점 실패 위험 없음, 추후 provider 이전 옵션 열려 있음. |
| 2026-05-16 | `email_deliveries` Lean 미러링 신설 + `notifications`와 완전 분리(β1) + event_type catalog 공유 | 마켓플레이스 운영 디버깅 필수. FK는 두 테이블이 fan-out 병렬 레코드라 불필요. event_type은 cross-channel 분석을 위해 단일 네임스페이스 유지. |
| 2026-05-16 | Idempotency 키는 결정론적 (`{event_type}:{primary_entity_id}:{recipient_user_id}`), email_deliveries도 동일 키 공유 | 호출자 코드 단순, 모든 중복 시나리오 자동 차단, catalog가 키 규칙의 단일 출처. |
| 2026-05-16 | Retention 1년, 1차에 코드 미구현 (정책만 명시) | 분기/연간 사이클 자연 커버, 데이터 삭제 비가역성 고려해 보수적 선택, 1차 볼륨엔 스토리지 부담 없음. |
| 2026-05-16 | Event_type 명명은 Stripe 컨벤션 (`resource.action_past_tense`, snake_case 세그먼트, contract 취급) | 2026 백엔드 이벤트 사실상 표준. 협상 3레벨(`negotiation.offer.received`)로 도메인 확장 대비. |
| 2026-05-16 | 페이로드 타입은 Zod 정의 + `z.infer` 자동 추론, catalog에 `payloadSchema` 포함 | codebase 표준(34파일), 런타임 검증으로 jsonb 안전, 타입/검증 단일 출처, publish 시점에 잘못된 payload 즉시 차단. |
| 2026-05-16 | 4개 이벤트 payload schema 확정 (G-1) | snapshot 원칙으로 표시·deep link에 필요한 데이터만 박제. userEmail 제외, currency·offerType 포함. strict 시작으로 변경 비용 최소화. |
| 2026-05-16 | Catalog는 단일 파일(`apps/api/src/notification/catalog.ts`)로 시작, 이벤트 10+개 또는 500줄에서 분할 검토 | 1차 4개에 단일이 한눈에 조망 가능. 분할은 저비용 전환이라 YAGNI. |
| 2026-05-16 | publish() 하이브리드 (in-app 동기 + 이메일 비동기) | 사용자 즉시성과 API 응답 속도 양립. 외부 API(Resend)는 백그라운드로 분리. |
| 2026-05-16 | WS 별도 path `/ws/notifications` + `{type, notification}` envelope, 오프라인은 REST fetch | 관심사 분리, 메시지 라우팅 단순, DB가 진실의 원천이라 WS replay 불필요. |
| 2026-05-16 | 큐 인프라 미도입, 기존 cron runner의 재시도 잡으로 처리, 코드 주석으로 future-migration 명시 | 1차 볼륨(3k/월)엔 큐 이득 작음. pg-boss는 워커-API 결합/대시보드 부재 부담, Inngest는 SaaS 의존. 트리거 조건(분당 100+, 지연/우선순위 요구) 충족 시 재검토. |
| 2026-05-16 | 템플릿: React Email + 이벤트당 파일 + 공통 BaseEmail + 영어만 + From `Haggle <notifications@tryhaggle.ai>` + Reply-To 미설정 | 스택/codebase 정렬, 디자인 일관성, 1차 운영 부담 최소화. support@ Reply-To는 응대 체계 갖춰질 때 도입. |
| 2026-05-16 | 프론트엔드: 데스크탑 nav 우측 벨 + 모바일 Profile 뱃지 + 공용 `/notifications` 페이지 + sonner bottom-center stacked + 개별 클릭 읽음 처리 + `use-notification-ws.ts` | 기존 nav/WS/empty-state 패턴 최대 활용. 모바일은 vaul drawer 대신 페이지 이동(Profile 진입 후 의도적 이동이라 페이지가 자연스럽고 desktop View All과 공용 라우트). |
| 2026-05-16 | 운영: 재시도 고정 5분/attempts<3, 3회 후 방치, 로그 1년 통일, 어드민 대시보드 없음, Resend webhook 서명 검증 필수 | YAGNI 기조 유지. 검증은 보안 필수 (status 조작 방지). |
| 2026-05-16 | 보안: Unsubscribe = 글로벌 one-click + HMAC 서명 토큰 + List-Unsubscribe 헤더. API/WS 권한 = 기존 Supabase JWT 패턴 그대로. | CAN-SPAM/GDPR 대비, 타인 unsubscribe 방지. 기존 auth 패턴 재사용으로 추가 구현 최소화. |
| 2026-05-16 | 표시 렌더링 철학 B — catalog `renderDisplay()` → payload에 `displayTitle`/`displayLink` 박제. 프론트 renderer 불필요. | 새 이벤트 추가 시 백엔드 catalog만 수정, 프론트 자동 동작. Snapshot 원칙 일관성. i18n 필요 시 locale 인자 확장. |
| 2026-05-16 | email_deliveries에 `attempts` + `idempotencyKey` 컬럼 추가 | cron retry WHERE attempts<3 조건 필요. idempotency는 F-4 결정 반영. |
| 2026-05-16 | `user.signed_up` 트리거 = `/auth/callback` (옵션 C). 페이지네이션 = browse cursor 패턴. 뱃지 = 마운트 REST + WS +1. REST 엔드포인트 목록 확정. | 기존 인프라 최대 활용, 신규 인프라 0 추가. |
| 2026-05-16 | DNS 셋업(SPF/DKIM/DMARC)은 Phase 1 별도 트래킹 항목 | deliverability에 필수, 미셋업 시 스팸함 직행. 1회성이지만 빌드 전 완료 보장 필요. |

---

*Last Updated: 2026-05-16*
