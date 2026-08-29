# 1:1 메시징 이식 계획 (Bridge Portal → Haggle)

*Status: 구현 완료(로컬 검증까지) · Branch: `feature/messaging-port` · Created: 2026-08-29*

Django 5 + HTMX + Django Channels로 만들어진 Bridge Portal의 1:1 메시징 기능을
Haggle(Fastify + Next.js + Drizzle/Postgres)로 옮긴다. **UI/UX는 최대한 원본을
유지하고 백엔드는 이 저장소의 방식으로 재작성한다.**

---

## 1. 확정된 설계 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 메시징 용도 | 사람 ↔ 사람 순수 채팅 | 협상은 기존 에이전트 파이프라인이 담당. sender는 항상 사람 |
| 대화 ↔ 컨텍스트 | 다형성 `subject_type` + `subject_id` | 리스팅 강결합 제거. 주문·분쟁 스레드로 확장 가능 |
| 대화 시작 조건 | **협상 세션이 먼저 존재해야 함** | 에이전트끼리 협상이 진행된 뒤에 사람이 붙는 제품 흐름 |
| 멀티 인스턴스 팬아웃 | Postgres `LISTEN/NOTIFY` | 신규 인프라 0. Redis 미도입 |
| WS 채널 | **신규 채널 없이 기존 `/ws/notifications` 유저 소켓 재사용** | 1:1 대화는 참여자가 2명이라 룸이 불필요. 티켓 CHECK 제약 변경도 회피 |
| 라우트 | `/messages` 단독 | 기존 `/notifications` 페이지를 건드리지 않음. 탭 통합은 후속 |
| 이번 범위 제외 | All/Selling/Buying 필터, Unread 토글 | 원본 구현이 결함(아래 §5)이라 서버 필터로 재설계 필요 |

## 2. 브랜치 예산 초과에 대한 기록

CLAUDE.md의 "제품 코드 500줄 / 15파일" 예산을 초과한다. 사용자가 **단일
브랜치 + 커밋 단위 분리**를 명시적으로 요청했다.

- **사유**: DB 스키마 → API → 실시간 → UI가 하나의 수직 기능이며, 중간 커밋만
  배포하면 동작하지 않는 기능(예: 스키마만 있고 라우트 없음)이 staging에 남는다.
- **위험**: 리뷰 부담이 커진다. 커밋을 기능 경계로 나누고 커밋 단위 리뷰를 권장한다.
- **검증 범위**: `pnpm test`(api/web), `pnpm typecheck`, 신규 마이그레이션의 빈 DB
  replay, `/messages` 수동 E2E(두 계정 동시 접속).
- **실제 규모**: 제품 코드 3,041줄 / 34파일, 테스트 1,325줄, 문서·env 196줄,
  생성 파일 17,082줄(drizzle 스냅샷). 예산(500줄·15파일)의 6배이므로 커밋 8개를
  기능 경계로 나눴다. 커밋 단위 리뷰를 권장한다.
- **보호 영역**: `packages/db`(additive migration), WS 인증/팬아웃. 이 둘을 판단할
  수 있는 단일 리뷰어가 필요하다.

## 3. 데이터 모델

```
conversations
  id, subject_type ('listing'|'order'|'negotiation_session', nullable),
  subject_id (uuid, nullable, FK 없음 — 저장소 컨벤션),
  participant_key (text, UNIQUE)      ← 정렬된 참여자 uuid + subject 조합
  last_message_at / last_message_id / last_message_preview
  UNIQUE (participant_key)            ← find-or-create 경합을 ON CONFLICT로 해결
  INDEX  (subject_type, subject_id)

conversation_members
  conversation_id, user_id, last_read_at, unread_count, last_message_at
  UNIQUE (conversation_id, user_id)
  INDEX  (user_id, last_message_at DESC, conversation_id)   ← 목록 정렬

messages
  conversation_id, sender_id, body, client_message_id, created_at
  INDEX  (conversation_id, created_at DESC, id DESC)        ← 커서 페이지네이션
  UNIQUE (conversation_id, client_message_id)               ← 재전송/낙관적 UI 중복 방지
```

**원본 대비 변경**

- `Conversation.save()`로 `modified_at`을 흔들어 정렬 → `last_message_at` 명시 컬럼
- 목록 조회마다 `COUNT` 집계 → 멤버 행의 `unread_count` 캐시.
  `last_read_at` 기준 재계산이 진실의 원천이며 읽음 처리 시 재계산한다.
- 마지막 메시지를 두 번째 쿼리로 다시 모으던 로직 → `last_message_preview` 비정규화
- "조회 후 없으면 생성"이 3곳에 중복 + 경합에 열려 있던 것 → `participant_key`
  UNIQUE + `ON CONFLICT DO NOTHING`

## 4. API

```
GET  /api/conversations?cursor=&limit=       목록(커서, 안읽음 포함)
POST /api/conversations                      find-or-create {subject_type, subject_id}
GET  /api/conversations/:id                  메타 + 참여자
GET  /api/conversations/:id/messages?before= 과거 메시지 (created_at+id 튜플 커서)
POST /api/conversations/:id/messages         전송 {body, client_message_id}
POST /api/conversations/:id/read             읽음 처리 (GET 부작용 제거)
GET  /api/conversations/:id/subject          상세 패널 데이터(lazy)
GET  /api/conversations/unread-count         뱃지
```

**참여자는 클라이언트가 지정하지 않는다.** `POST /api/conversations`는
`subject`로부터 서버가 참여자를 도출한다.

- `negotiation_session` → 해당 세션의 `buyer_id` / `seller_id`
- `order` → `commerce_orders`의 `buyer_id` / `seller_id`
- `listing` → 미지원(400). 리스팅만 보고 아무에게나 메시지를 보내는 경로를 막는다.

호출자가 그 subject의 참여자가 아니면 404(존재 노출 방지).

## 5. 원본에서 함께 고치는 결함

| 원본 위치 | 문제 | 이식 후 |
|---|---|---|
| `views.conversation_detail` | GET이 `last_read_at` write + WS 브로드캐스트 | `POST /read`로 분리 |
| `views.load_older_messages` | 커서가 `created_at <` 만 → 동일 타임스탬프 메시지 유실 | `(created_at, id)` 튜플 커서 |
| `services.get_conversations_with_info` | `limit` 슬라이스 **후** 파이썬 루프에서 selling/buying 필터 → 페이지 크기 붕괴 | 필터는 SQL에서(이번 범위 제외, 재설계 예정) |
| `conversations_content.html` | Unread 필터가 로드된 DOM만 `display:none` | 서버 필터로 재설계(범위 제외) |
| `createMessageElement` | `innerHTML` + 수동 이스케이프 | React 자동 이스케이프 |
| `consumers.NotificationConsumer` | 유저당 소켓 1개(마지막이 이전 것을 덮어씀) | 소켓 Set. **Haggle의 `ws-registry.ts`에도 같은 버그가 있어 함께 수정** |
| `message_item.html` + `regroupMessages` | 서버가 tz 쿠키로 그룹핑 계산 → JS가 재계산하는 이중 로직 | 클라이언트에서 ISO 값으로 1회 계산 |
| `CHANNEL_LAYERS` | `InMemoryChannelLayer` | `LISTEN/NOTIFY` 팬아웃 어댑터 |

## 6. 실시간 아키텍처

```
send_message (인스턴스 A)
  └─ tx: INSERT message → UPDATE members → pg_notify('haggle_user_events', {userIds, type, ids})
                                                    ↑ 본문 미포함 (8KB 제한 회피)
모든 인스턴스가 LISTEN
  └─ 이벤트 수신 → 자기 프로세스가 들고 있는 해당 userId 소켓에만 push
```

**배포 제약 (중요)**: `LISTEN`은 세션에 묶이므로 Supabase **transaction 풀러
(6543)에서 동작하지 않는다.** `.env.example`의 기본 연결이 6543이다.

- `NOTIFY`(발행)는 트랜잭션 내부 실행이라 기존 풀 연결로 충분하다.
- `LISTEN`(구독)에만 **session 모드(5432)** 연결이 필요 → `DATABASE_LISTEN_URL` 신설.
- 미설정 시 경고 로그 + 단일 인스턴스 인메모리 모드로 자동 폴백(기능은 동작,
  다중 인스턴스만 미보장). 로컬(54322 직결)은 그대로 동작한다.
- **staging/production 환경변수 추가가 배포 체크리스트 항목이다.**

기존 알림/협상 WS 브로드캐스트도 같은 어댑터를 경유하도록 이번 브랜치에서 전환한다.

## 7. 웹 UI 매핑

| 원본 | 이식 후 |
|---|---|
| `conversations_content.html`(인라인 CSS 900줄) | `MessagesShell` + Tailwind 시맨틱 토큰 |
| `conversation_list.html` | `ConversationList` / `ConversationItem` |
| `chat_panel.html` | `ChatPanel` / `MessageThread` / `Composer` |
| `message_item.html` | `MessageItem` / `DateDivider` |
| `details_panel.html` + `bridge-responsive-modal` | `SubjectPanel` + 기존 `Drawer`(vaul) |
| `empty_state.html` | 기존 `EmptyState` |
| 전역 `bridgeWS` | `UserEventsProvider` (소켓 1개를 알림 + 메시징이 공유) |

유지: 2-pane 레이아웃, 모바일 전체화면 오버레이, 위로 무한 스크롤 + 스크롤 앵커링,
날짜 구분선, 분 단위 타임스탬프 묶음, 카톡식 안읽음 숫자, 읽음 실시간 반영.

## 8. 커밋 순서

1. `docs`: 이 계획 문서
2. `db`: 스키마 + additive migration + 인덱스
3. `api`: 실시간 팬아웃 어댑터 + ws-registry Set 수정 + 기존 WS 전환
4. `api`: 메시징 서비스 계층
5. `api`: 라우트 + 서버 등록
6. `api`: 테스트
7. `web`: API 클라이언트 + 유저 이벤트 provider
8. `web`: 메시징 UI + `/messages`
9. `web`: 협상 세션 진입점 + 네비 뱃지
10. `web`: 테스트

## 9. 검증 결과 (2026-08-29, 로컬 스택)

로컬 Supabase + 실제 계정 2개(testuser1/2)와 이미 존재하는 협상 세션으로 전 구간 확인.

| 항목 | 결과 |
|------|------|
| 양쪽이 같은 스레드에 도달 | 구매자/판매자가 각각 열어도 동일한 conversation id |
| find-or-create 멱등 | 2회차 200 + 같은 id |
| 비참여자 차단 | 세션·대화 모두 404 (403 아님) |
| listing subject 차단 | 400 |
| 전송 멱등 | 같은 client_message_id 재전송 시 200 + 동일 메시지, 상대 안읽음 1 유지 |
| GET이 읽음 처리하지 않음 | GET 후에도 안읽음 1, POST /read 후 0 |
| 읽음 위치 전파 | 상대의 otherLastReadAt 갱신 확인 |
| 커서 페이지네이션 | limit=2로 전 구간 순회 시 6건/중복 0/일괄 조회와 완전 일치 |
| 본문 검증 | 공백만·4001자 모두 400 |
| 실시간 | 티켓 인증 WebSocket으로 message.new 수신 |
| 브라우저 e2e | 두 BrowserContext에서 구매자 전송 → 판매자 스레드에 새로고침 없이 표시 (3/3) |

검증 중 발견해 고친 것: subject 응답의 내부 listing id 노출, 401 시 빈 편지함이
굳던 문제(1회 재시도), 조회 실패를 "메시지 없음"으로 그리던 빈 상태.

테스트: api 2841 + 신규 47, web 117(신규 26), Playwright 1(게이트).
로컬 DB에 만든 검증용 대화·메시지는 삭제했다.

## 10. 배포 체크리스트

- [ ] staging/production에 `DATABASE_LISTEN_URL` 설정 (session 모드 5432).
      미설정 시 기능은 동작하지만 인스턴스 간 실시간이 끊긴다
- [ ] `0145_kind_siren.sql` 적용 (같은 SHA의 CI 성공 이후)
- [ ] 배포 후 기동 로그에서 `realtime_fanout_local_only` 경고가 없는지 확인

## 11. 후속 작업 (이번 범위 밖)

- 대화 필터(구매/판매/안읽음) 서버 구현
- `/inbox` 탭 통합(Messages · Notifications)
- 첨부/이미지, 타이핑 인디케이터
- 대화 보관/차단/신고
- `order` subject 진입점(주문 상세)
- CLAUDE.md에 "실시간 이벤트는 publishRealtime을 거친다(소켓 직접 push 금지)"를
  durable rule로 추가할지 결정 (머지 이후)
