# Haggle MVP Final 구현 계획서 (Vertical Slices)

## 1) 목적과 방향

### 제품 목표
- **판매자**: ChatGPT에서 `/haggle`로 “대화 + Embedded UI”를 통해 리스팅 생성 → 공유 링크 발급
- **구매자**: 생성된 링크를 통해 웹앱으로 진입 → 협상 플로우 진행
- **전환 전략**
  - 리스팅 생성 및 링크 발급은 **로그인 없이 가능**
  - 리스팅 저장, 협상 현황 확인, 관리 기능은 **24시간 내 가입(Claim)** 시 제공

### 이 방향을 선택한 이유
- GPT Apps는 설치/학습 비용 없이 **즉시 시작 가능한 진입점**
- `/haggle` 커맨드 기반 생성 플로우는 **마케팅 데모 영상에 매우 적합**
- UI / Dashboard는 “관리·반복 사용” 단계에서만 필요 → **가입 유도 명분이 명확**
- “말하면 폼이 채워지는 UX”는 DOM 직접 조작이 아니라  
  **(채팅 → MCP tool 호출 → 서버 state 업데이트 → UI 리렌더)** 구조로 안정적으로 구현 가능

---

## 2) 아키텍처 한 장 요약

### 도메인 구조 (tryhaggle.ai 기반)
- **MCP 서버 (툴 API)**: `https://tryhaggle.ai/mcp`
- **Embedded UI (판매자 위젯)**: MCP App Resource (`ui://widget/listing.html`) — ChatGPT sandboxed iframe 렌더
- **구매자 웹앱 (공유 링크)**: `https://tryhaggle.ai/l/{public_id}`

### 구성 요소 개요

#### MCP 서버 (= 백엔드)
- Listing Draft 생성 / 업데이트 / 검증 / 발행
- 24시간 Claim 처리 (user_id 연결)
- Negotiation Session / Offer 저장
- ChatGPT Apps에서 호출 가능한 MCP Tool 제공

#### ChatGPT Embedded UI (판매자 Listing Creation Flow)
- **MCP App Resource 기반 UI** — HTML/React 번들을 MCP 서버에 리소스로 등록 (`registerAppResource`)
- ChatGPT가 sandboxed iframe 안에서 해당 HTML을 렌더 (외부 URL이 아닌, HTML 코드 자체를 리소스로 전달)
- 위젯 ↔ ChatGPT 통신: `postMessage` (JSON-RPC 2.0) — `tools/call`로 MCP tool 직접 호출
- 서버 state를 **단일 Source of Truth**로 사용
- 대화 입력(`apply_patch` tool)과 UI 입력(`tools/call` via postMessage)이 동일한 state를 업데이트

#### 구매자 웹앱
- 링크 랜딩 페이지
- 협상 세션 생성 및 오퍼 교환
- 협상 결과 저장

### 시스템 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────┐
│                     Client Layer                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  ChatGPT     │  │  구매자 웹앱  │  │  판매자       │  │
│  │  Embedded UI │  │  /l/{id}     │  │  Dashboard   │  │
│  │(MCP Resource)│  │  (SSR)       │  │  /dashboard  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│     postMessage     Next.js (App Router)                │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │
┌─────────┼─────────────────┼─────────────────┼───────────┐
│         ▼                 ▼                 ▼           │
│  ┌─────────────────────────────────────────────────┐    │
│  │           API Gateway (Fastify)                 │    │
│  │     MCP Endpoint + REST API + WebSocket         │    │
│  └──────┬──────────────┬──────────────┬────────────┘    │
│         │              │              │                  │
│  ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼──────┐          │
│  │   Haggle    │ │    HNP    │ │  Payment   │          │
│  │   Engine    │ │  Protocol │ │  Service   │          │
│  │  (협상 AI)  │ │  (표준)   │ │(USDC/에스크로)│         │
│  │             │ │           │ │            │          │
│  │ MVP: 룰기반 │ │ MVP: 타입 │ │ MVP: mock  │          │
│  │ 확장: LLM   │ │ 정의만   │ │ 확장: x402  │          │
│  └─────────────┘ └───────────┘ └────────────┘          │
│                     Service Layer                       │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                         ▼                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Supabase    │  │   Upstash    │  │   Base L2    │  │
│  │  (Postgres)  │  │   (Redis)    │  │  (온체인)    │  │
│  │              │  │              │  │              │  │
│  │ 리스팅/유저  │  │ 세션 캐시    │  │ MVP: 없음    │  │
│  │ 협상/오퍼   │  │ 실시간 상태  │  │ 확장: 에스크로│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                      Data Layer                         │
└─────────────────────────────────────────────────────────┘
```

---

## 3) 기술 스택

### 공통 언어: TypeScript (전체)
- MCP SDK, x402 SDK, viem 모두 **TypeScript-first**
- 프론트엔드/백엔드/프로토콜 간 **타입 공유** 가능 (monorepo)
- 향후 npm 패키지 배포 시 TS 생태계가 개발자 SDK에 최적

### Backend — Fastify + @modelcontextprotocol/sdk
| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | **Fastify** | Express 대비 2-3x 성능, JSON 스키마 검증 내장 |
| MCP | **@modelcontextprotocol/sdk** | 공식 TypeScript SDK, Streamable HTTP 전송 지원 |
| ORM | **Drizzle** | 경량, SQL에 가까운 API, TS 타입 안전 |
| 검증 | **Zod** | 런타임 타입 검증, MCP tool 파라미터 검증에 활용 |

### Frontend — Next.js (App Router)
| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | **Next.js 15 (App Router)** | SSR (구매자 랜딩 SEO), 대시보드 |
| 스타일 | **Tailwind CSS** | 빠른 UI 개발, 일관된 디자인 시스템 (구매자 웹앱, 대시보드) |
| 상태 관리 | **React Query** | 서버 state 폴링/캐싱 (구매자 웹앱, 대시보드) |

### Embedded UI 위젯 — Vite + MCP App Resource
| 항목 | 선택 | 이유 |
|------|------|------|
| 빌드 | **Vite 7 + vite-plugin-singlefile** | React 위젯을 단일 HTML 파일로 빌드 (JS/CSS 인라인), MCP 리소스로 등록 |
| 통신 | **postMessage (JSON-RPC 2.0)** | ChatGPT ↔ 위젯 간 `tools/call`, `ui/notifications` |
| SDK | **@modelcontextprotocol/ext-apps** | `registerAppResource`, `registerAppTool` 헬퍼, React hook (`useApp()`) |
| 스타일 | **CSS (인라인)** | 위젯 HTML에 `<style>` 태그로 포함, 외부 의존성 없음 |

### Database
| 항목 | 선택 | 이유 |
|------|------|------|
| 메인 DB | **Supabase (Postgres)** | Auth(매직링크/소셜) 내장, Realtime 구독, RLS, 표준 Postgres라 탈출 가능 |
| 캐시 | **Upstash Redis** | 서버리스, 협상 세션 실시간 상태 캐싱, pay-per-use |

### Deployment
| 항목 | 선택 | 이유 |
|------|------|------|
| Frontend | **Vercel** | Next.js 최적, git push 자동 배포, 글로벌 CDN |
| Backend | **Railway** | WebSocket 지원, Postgres/Redis 통합 관리 가능, 간편 배포 |
| 도메인 | **tryhaggle.ai** | Vercel/Railway 모두 커스텀 도메인 HTTPS 자동 설정 |

### Blockchain / 결제 (MVP 이후 확장용 — 인터페이스만 선정의)
| 항목 | 선택 | 이유 |
|------|------|------|
| 스마트컨트랙트 | **Foundry (Solidity)** | Rust 기반 빠른 빌드, Base 공식 지원 |
| JS 라이브러리 | **viem + wagmi** | 번들 27KB (ethers.js의 1/5), TS 타입 최강, x402 호환 |
| 결제 프로토콜 | **x402 (@x402sdk/sdk)** | Coinbase 공식, USDC on Base, 수수료 $0 |
| 에스크로 | **Base L2 Smart Contract** | 비수탁형, AgentEscrowProtocol 레퍼런스 활용 |

### AI / LLM
| 항목 | 선택 | 이유 |
|------|------|------|
| SDK | **Vercel AI SDK** | GPT-4 ↔ Claude 모델 스위칭 1줄, 스트리밍 지원 |
| MVP | **룰 기반 엔진** | floor/target 비교 로직, LLM 비용 없음 |
| 확장 | **OpenAI + Anthropic API** | 양방향 AI 협상, 강화학습 기반 전략 |

### Monorepo 구조 — Turborepo
```
haggle/
├── apps/
│   ├── web/              # Next.js 15 — 구매자 웹앱, 대시보드 (스켈레톤)
│   └── api/              # Fastify 5 — MCP 서버 + Embedded UI 위젯 (MCP App Resource)
│       ├── src/           # API 서버 (MCP router, tools, services)
│       └── widget/        # React 19 위젯 (Vite single-file 빌드)
│           └── src/
│               ├── App.tsx              # 3-Step 위자드 메인 컴포넌트
│               ├── agentPresets.ts      # 4개 AI 에이전트 프리셋 데이터
│               ├── styles.css           # 전체 위젯 스타일
│               └── components/
│                   ├── StepIndicator.tsx # 스텝 네비게이션
│                   ├── TagInput.tsx      # 태그 입력
│                   ├── ChipSelector.tsx  # 칩 선택 (condition 등)
│                   └── RadarChart.tsx    # SVG 레이더 차트 (애니메이션)
├── packages/
│   ├── shared/           # 공통 타입, 상수, 유틸리티
│   ├── db/               # Drizzle ORM + Supabase Postgres
│   ├── engine-core/      # 순수 수학 엔진 (외부 의존성 0, 테스트 10개)
│   ├── engine-session/   # 세션 오케스트레이션 (engine-core 기반, 테스트 5개)
│   └── contracts/        # 스마트컨트랙트 스텁 (MVP 이후)
├── turbo.json
├── package.json
└── tsconfig.base.json
```

> **핵심 설계 원칙**: `engine-core`, `engine-session`, `contracts`를 독립 패키지로 분리
> → MVP에서는 내부 모듈로 사용, 확장 시 npm 배포하여 **개발자 SDK**의 기초가 됨
> → "3줄 통합" 개발자 경험의 토대

### 확장 경로 요약
```
MVP (Now)                         →  Production (Later)
──────────────────────────────────────────────────────────
룰 기반 협상 (engine-core/)       →  LLM 기반 멀티에이전트
세션 오케스트레이션 (engine-session/) →  HNP v1.0 표준 프로토콜
mock (Payment Service)            →  x402 + USDC + 에스크로
Supabase Auth                     →  KYC Tier별 인증
Railway                           →  AWS/GCP (필요 시)
```

---

## 4) 데이터 모델 (MVP 최소 + 확장 가능)
> ORM: **Drizzle** — `packages/db/` 에서 스키마 정의, apps/api 와 apps/web 에서 공유

### listing_drafts ✅ 구현됨
- `id` (uuid, PK)
- `status` (`draft` / `published` / `expired`, default: `draft`)
- `user_id` (uuid, nullable — 24h claim 후 연결)
- `claim_token` (text)
- `claim_expires_at` (timestamptz)
- `title` (text)
- `description` (text)
- `tags` (text[]) — 자유 태그 (e.g. "iPhone", "256GB")
- `category` (text) — enum: `electronics`, `clothing`, `furniture`, `collectibles`, `sports`, `vehicles`, `books`, `other`
- `condition` (text) — enum: `new`, `like_new`, `good`, `fair`, `poor`
- `photo_url` (text, nullable) — 이미지 URL (Supabase Storage public URL, Slice 8)
- `target_price` (numeric 12,2) — Asking Price (구매자에게 공개)
- `floor_price` (numeric 12,2) — Minimum Acceptable Price (비공개, AI 에이전트만 사용)
- `selling_deadline` (timestamptz) — 판매 마감일 (에이전트 유연성에 영향)
- `strategy_config` (jsonb) — 에이전트 프리셋 + 전략 파라미터 저장 (`{ preset, priceAggression, patienceLevel, riskTolerance, speedBias, detailFocus }`)
- `created_at` (timestamptz, auto)
- `updated_at` (timestamptz, auto)

> **변경 이력**:
> - Slice 0: 초기 생성
> - Slice 1: `brand`, `model` 컬럼 제거 → Tags로 대체. `tags`, `selling_deadline`, `photo_url` 컬럼 추가
> - Slice 3: `strategy_config` jsonb에 에이전트 프리셋 + 전략 파라미터 통합 저장 (별도 `agent_preset` 컬럼 불필요)
> - Slice 8: `photo_url` — Supabase Storage public URL 연결 (위젯 canvas 압축 → MCP tool 업로드)

### listings_published ✅ 구현됨
- `id` (uuid, PK)
- `public_id` (text, unique) — 8자 URL-safe short ID
- `draft_id` (uuid, FK → listing_drafts.id)
- `snapshot_json` (jsonb) — 발행 시점의 draft 스냅샷
- `published_at` (timestamptz, auto)

### negotiation_sessions
- `id`
- `public_id`
- `buyer_id` (anonymous identifier)
- `status`
- `created_at`
- `updated_at`

### offers
- `session_id`
- `type` (`buyer_offer` / `seller_counter` / `system`)
- `amount`
- `message`
- `created_at`

### users
- Supabase Auth가 `auth.users` 테이블 자동 관리
- 별도 `public.users` 테이블은 Slice 6 (Dashboard)에서 필요 시 도입

---

## 5) MCP Tools (대화 기반 서버 호출 계약)

### 구현된 Tool (Slice 0–3)

#### 리스팅 생성 플로우 (판매자 — ChatGPT Embedded UI)
- ✅ `haggle_ping()` — Health check, 서버 상태 확인 *(data-only tool, core MCP SDK)*
- ✅ `haggle_start_draft() -> { draft_id, draft }` — Draft 생성, Embedded UI 위자드 시작 *(App tool, `registerAppTool`)*
  - `_meta.ui.resourceUri`로 위젯 HTML 연결, `structuredContent`로 draft 데이터 전달
  - ChatGPT가 구체적 정보 포함 시 `apply_patch` 연쇄 호출 허용 (모호한 요청 시 금지)
- ✅ `haggle_get_draft({ draft_id }) -> { draft }` — 현재 Draft 상태 조회 *(data-only tool)*
- ✅ `haggle_apply_patch({ draft_id, patch }) -> { draft }` — 필드 업데이트 *(App tool, model + widget 양방향)*
  - 허용 필드: `title`, `description`, `tags`, `category`, `condition`, `photoUrl`, `targetPrice`, `floorPrice`, `sellingDeadline`, `strategyConfig`
  - `category`, `condition`은 enum 검증 (Zod)
  - `strategyConfig`로 에이전트 프리셋 + 전략 파라미터 통합 저장
  - `visibility: ["model", "app"]` — 모델과 위젯 모두 호출 가능

### 구현된 Tool (Slice 4)

#### 검증 + 발행 플로우
- ✅ `haggle_validate_draft({ draft_id }) -> { ok, errors[] }` — 필수값 검증 *(data-only tool, core MCP SDK)*
  - 필수: `title` (step 1), `targetPrice` (step 2), `sellingDeadline` (step 2)
  - 실패 시 `errors[]`에 `{ field, message, step }` 반환 → 위젯이 해당 step으로 이동
- ✅ `haggle_publish_listing({ draft_id }) -> { public_id, share_url, claim_token }` — 리스팅 발행 *(App tool, `registerAppTool`)*
  - 내부에서 validate 재검증 → `listings_published` 스냅샷 저장 → draft status `"published"` 전환
  - `claim_token` + `claim_expires_at` (24h) 발급
  - `structuredContent`로 위젯에 `public_id`, `share_url` 전달 → Step 4 (Listing Live) 화면 전환
  - `visibility: ["model", "app"]` — 모델과 위젯 모두 호출 가능

### 구현된 Tool (Slice 8)

#### 이미지 업로드 (위젯 → Supabase Storage)
- ✅ `haggle_upload_photo({ draft_id, image_base64, mime_type }) -> { photo_url, draft }` — 사진 업로드 *(App tool, `visibility: ["app"]` — widget-only)*
  - 위젯에서 canvas 압축된 base64 이미지 수신 → Supabase Storage 업로드 → draft.photoUrl 패치
  - MCP 브릿지 payload 제한 대응 (클라이언트 1200px JPEG 80% 압축)

### 미구현 Tool (Slice 10+)
- ⬜ `haggle_create_negotiation_session({ public_id }) -> { session_id }` — 협상 세션 생성 *(Slice 10)*
- ⬜ `haggle_submit_offer({ session_id, amount }) -> { decision, counter_amount?, message }` — 오퍼 제출 *(Slice 10)*

> **설계 결정**: `haggle_set_agent_strategy` 별도 tool 대신 `haggle_apply_patch`의 `strategyConfig` 필드로 통합.
> 위젯에서 프리셋 선택 시 `callServerTool("haggle_apply_patch", { patch: { strategyConfig: { preset, ...stats } } })`로 저장.

> 핵심 포인트
> - "채팅으로 말하면 폼이 채워지는 UX"는 `apply_patch → 서버 state 업데이트 → Embedded UI 리렌더` 구조로 달성
> - UI가 있는 Tool은 `_meta.ui.resourceUri`로 HTML 위젯 템플릿과 연결
> - Tool 응답의 `structuredContent`로 위젯에 데이터 전달
> - 위젯에서 `tools/call` (postMessage)로 MCP tool 직접 호출 가능 (REST API 불필요)
> - Tool description이 ChatGPT 모델 행동을 제어하는 핵심 메커니즘 (모호한 요청 시 자동 채우기 방지 등)

---

## 6) Vertical Slices 로드맵

각 Slice는 **완료 시 데모 가능한 상태**를 목표로 한다.  
(ChatGPT ↔ MCP ↔ DB ↔ UI / Web을 얇게 관통)

---

### Slice 0 — 개발 / 배포 기반 ✅ 완료
**목표**
ChatGPT Developer Mode에서 Haggle 앱이 연결되고 MCP Tool 호출이 가능한 최소 골격

**구현** — 모두 완료
- ✅ Turborepo monorepo 초기화 (`apps/api`, `apps/web`, `packages/*`)
- ✅ Fastify + `@modelcontextprotocol/sdk` 로 MCP 서버 구성 (`/mcp` 엔드포인트, Streamable HTTP)
- ✅ Supabase 프로젝트 생성 + Drizzle ORM 초기 마이그레이션 (`listing_drafts` 테이블)
- ✅ Railway에 API 서버 배포 (Dockerfile 기반, `https://haggle-production-7dee.up.railway.app`)
- ✅ Vercel에 Next.js 앱 배포 (자동 감지)
- ✅ Tool advertise 및 health check (`haggle_ping`, `haggle_start_draft`)
- ⬜ 로깅 / 에러 트래킹 최소 구성 (Sentry 미연동, Fastify 기본 로거만 사용)

**완료 기준** — 모두 충족
- ✅ ChatGPT Developer Mode에서 커넥터 연결 성공
- ✅ MCP 서버가 tool 목록을 반환 (Streamable HTTP)
- ✅ 테스트용 tool 호출이 200 응답
- ✅ `turbo build` / `turbo dev` 로 전체 monorepo 빌드/개발 가능

---

### Slice 1 — Draft 생성 + 위자드 Step 1 (Item Details) ✅ 완료
**목표**
`/haggle` 시작 → Draft DB 생성 → Embedded UI 위자드의 첫 페이지 표시

**구현** — 모두 완료
- ✅ DB: `listing_drafts` 스키마 업데이트 (`brand`/`model` 제거, `tags`/`selling_deadline`/`photo_url` 추가)
- ✅ Tool: `haggle_start_draft` → DB insert + `_meta.ui.resourceUri` + `registerAppTool` (ext-apps SDK)
- ✅ Tool: `haggle_apply_patch` → 필드 업데이트 (`visibility: ["model", "app"]`으로 위젯+모델 양방향)
- ✅ Tool: `haggle_get_draft` → Draft 조회
- ✅ MCP App Resource: 위젯 HTML 번들 등록 (`registerAppResource`, `ui://widget/listing.html`)
- ✅ Embedded UI 위젯 (React 19 + Vite single-file 빌드):
  - 위자드 프레임 (StepIndicator: ① Item Details → ② Pricing → ③ AI Agent)
  - Step 1 폼: Photo (file input), Title*, Description, Tags (TagInput 컴포넌트), Category (dropdown), Condition (ChipSelector)
  - "Next: Set Pricing →" 버튼
  - `useApp()` hook으로 ChatGPT 브릿지 연결, `ontoolresult`로 draft 데이터 수신
  - `callServerTool()`로 patch 호출 (postMessage → JSON-RPC 2.0)
- ✅ Fullscreen 지원: `requestDisplayMode("fullscreen")`, `onhostcontextchanged` 감지
  - 위젯 어디를 클릭하든 fullscreen 요청 (`onPointerDownCapture`)

**완료 기준** — 모두 충족
- ✅ `/haggle` 실행 → DB에 draft row 생성 + ChatGPT iframe에 위젯 렌더
- ✅ Embedded UI에 Step 1 폼 표시
- ✅ UI 입력 → "Next" 클릭 → `callServerTool`로 patch → 서버 저장
- ✅ "Next" 클릭 시 Step 2로 이동

---

### Slice 2 — 위자드 Step 2 (Pricing) + 대화 자동 채우기 (핵심 가치) ✅ 완료
**목표**
위자드 두 번째 페이지 완성 + 채팅 입력으로 UI 필드가 자동 반영되는 핵심 UX

**구현** — 모두 완료
- ✅ Embedded UI Step 2:
  - 아이템 요약 카드 (photo, title, condition, category)
  - Asking Price* (= `target_price`) — "The starting price buyers will see"
  - Minimum Acceptable Price (= `floor_price`) — "private — only your AI agent knows"
  - Selling Deadline* (date input) — "Your AI agent may be more flexible as the deadline approaches"
  - "Next: Set Up AI Agent →" 버튼 (필수값 검증: targetPrice, sellingDeadline)
  - Back 버튼 → Step 1로 이동 (값 유지)
- ✅ 대화 자동 채우기:
  - Tool description으로 모델 행동 제어: 구체적 정보 포함 시 `apply_patch` 호출 허용, 모호한 요청 시 금지
  - `ontoolresult` 핸들러에서 pricing 필드 자동 반영 (`targetPrice`, `floorPrice`, `sellingDeadline`)
  - `category`, `condition` enum 검증 (Zod)
- ✅ `onPointerDownCapture`로 Step 2에서도 fullscreen 자동 요청

**완료 기준** — 모두 충족
- ✅ Step 2 UI에서 가격/마감일 입력 → `callServerTool`로 서버 저장
- ✅ 채팅으로 구체적 정보 입력 시 → `ontoolresult`로 UI 필드 자동 반영
- ✅ Back 버튼으로 Step 1 ↔ Step 2 이동 시 값 유지

---

### Slice 3 — 위자드 Step 3 (AI Agent Setup) 🔄 UI 완료
**목표**
판매자가 AI 협상 에이전트의 성격과 전략을 선택/커스터마이징

**구현**
- ✅ Embedded UI Step 3 (2-column 레이아웃, `widget--wide` max-width: 1100px):
  - ✅ Section heading + description (full-width, 그리드 밖)
  - ✅ **좌측 컬럼**:
    - 4가지 에이전트 프리셋 카드 (2×2 grid, 선택 시 cyan 보더):
      - **The Gatekeeper** — "Holds the line. Rarely budges." (85/90/20/30/75)
      - **The Diplomat** — "Meets buyers halfway. Closes more." (55/70/50/50/60)
      - **The Storyteller** — "Sells the value, not just the price." (60/80/35/25/95)
      - **The Dealmaker** — "Fast deals. Done. Move on." (40/25/75/95/35)
    - 에이전트 채팅 placeholder (Coming soon)
  - ✅ **우측 컬럼** — Agent Profile 패널 (sticky):
    - Header: "AGENT PROFILE" + pill (`No Agent` / `Default` / `Customized`)
    - Pricing 요약 카드 (title, asking price, floor price)
    - 선택된 에이전트 아이콘 + 이름 + tagline (미선택 시 empty state)
    - Stat bars 5개 (CSS transition 애니메이션, 에이전트 변경 시):
      - Price Aggression, Patience Level, Risk Tolerance, Speed Bias, Detail Focus
    - SVG Strategy Matrix 레이더 차트 (`RadarChart` 컴포넌트):
      - `requestAnimationFrame` + cubic ease-out lerp 애니메이션
      - 4단계 그리드 (25/50/75/100)
    - "Save & Get Share Link →" 버튼 (에이전트 미선택 시 disabled)
- ✅ `agentPresets.ts`: `AgentStats`, `AgentPreset` 타입, `DEFAULT_STATS`, `AGENT_PRESETS`, `STAT_META`, `RADAR_LABELS`
- ✅ `strategy_config` jsonb에 `{ preset, priceAggression, patienceLevel, ... }` 통합 저장 (별도 tool 불필요)
- ✅ `isStrategyCustomized` state — 대화로 스탯 변경 시 pill이 "Customized"로 전환 (향후 연동)
- ⬜ 에이전트 채팅으로 전략 미세 조정 (추후 구현)
- ⬜ 추천 프롬프트 칩 (추후 구현)

**완료 기준**
- ✅ 프리셋 카드 클릭 → stat bars 애니메이션 + 레이더 차트 모핑 애니메이션
- ✅ "Save & Get Share Link" 클릭 → `callServerTool("haggle_apply_patch")` 서버 저장
- ⬜ 에이전트 채팅으로 전략 조정 (채팅 기능 구현 후)
- ⬜ Slice 4 (Publish) 플로우 연결

---

### Slice 4 — 검증 + 발행 + Listing Live 화면 ✅ 완료
**목표**
필수값 검증 → 리스팅 발행 → 공유 링크 화면

**구현** — 모두 완료
- ✅ DB: `listings_published` 테이블 생성 (Drizzle 스키마 + 마이그레이션 SQL)
- ✅ Service: `validateDraft()` — 필수값 검증 (title, targetPrice, sellingDeadline) + step 번호 반환
- ✅ Service: `publishDraft()` — 스냅샷 저장, draft status 전환, public_id + claim_token 생성
- ✅ Tool: `haggle_validate_draft` — data-only tool (core MCP SDK)
- ✅ Tool: `haggle_publish_listing` — App tool (`registerAppTool`, `visibility: ["model", "app"]`)
- ✅ Embedded UI — "Your listing is live!" 화면 (StepIndicator 없이 전체 교체):
  - Sparkles 성공 아이콘 (에메랄드 배경 + 보더)
  - 아이템 요약 카드 (photo, title, price, 선택된 에이전트 이름 + 컬러 도트)
  - YOUR HAGGLE LINK — 공유 URL + 복사 버튼 (`execCommand('copy')` fallback for iframe sandbox)
  - Claim CTA 섹션: 24시간 경고 (amber 컬러), 3가지 기능 하이라이트 (Track/Notify/Manage)
  - "Go to Dashboard" 버튼 → `window.open()` 으로 `/claim?token={publicId}` 오픈
- ✅ Step 3 "Save & Get Share Link" → validate → publish 3단계 호출 연결:
  1. `haggle_apply_patch` (strategyConfig 저장)
  2. `haggle_validate_draft` (필수값 검증)
  3. `haggle_publish_listing` (발행 + structuredContent → Listing Live 전환)
- ✅ 검증 실패 시: 해당 Step으로 자동 이동 + 에러 메시지 표시

**완료 기준** — 모두 충족
- ✅ `haggle_validate_draft` → 필수값 누락 시 `{ ok: false, errors[] }` 반환
- ✅ `haggle_publish_listing` → `listings_published` 저장 + `{ public_id, share_url, claim_token }` 반환
- ✅ Publish 성공 → "Listing Live" 화면 표시
- ✅ 공유 링크 복사 가능

---

### Slice 5 — 가입/인증 + 24시간 Claim ✅ 완료
**목표**
판매자가 Listing Live 화면에서 "Go to Dashboard" → 가입 → 리스팅 소유권 연결

**구현** — 모두 완료
- ✅ Next.js `apps/web` 기반 셋업 (Tailwind CSS v4, `@tailwindcss/postcss`)
- ✅ Supabase Auth 인프라 구성:
  - `@supabase/ssr` + `@supabase/supabase-js` 설치
  - 브라우저 클라이언트 (`lib/supabase/client.ts` — `createBrowserClient`)
  - 서버 클라이언트 (`lib/supabase/server.ts` — `createServerClient` + cookies)
- ✅ `/claim?token=...` 페이지 (client component, Suspense boundary):
  - Google OAuth 버튼 → `supabase.auth.signInWithOAuth({ provider: "google" })`
  - Magic Link 폼 → `supabase.auth.signInWithOtp({ email })`
  - 이메일 발송 확인 화면 ("Check your email" + 다른 이메일 사용 옵션)
  - token 유무에 따른 문구 분기 (claim vs 일반 로그인)
  - 에러 처리 (`?error=auth_failed`)
- ✅ `/auth/callback` 라우트 핸들러:
  - `exchangeCodeForSession(code)` → `next` 파라미터로 리다이렉트
  - 실패 시 `/claim?error=auth_failed` 리다이렉트
- ✅ 환경 변수 설정 (`.env.local.example`, `.env.example` 업데이트)
- ✅ Claim 처리 로직:
  - `claimListing(db, claimToken, userId)` 서비스 함수 (`draft.service.ts`)
  - 토큰 매칭 + published 상태 확인 + 만료 체크 + 중복 claim 방지
  - 성공 시 `listing_drafts.user_id` 연결
- ✅ REST API: `POST /api/claim` 엔드포인트 (`routes/claim.ts` → Fastify 등록)
  - 404 (invalid_token), 410 (expired), 409 (already_claimed) 에러 분기
- ✅ `/dashboard` 페이지 (서버 컴포넌트):
  - Supabase auth 체크 (미인증 → `/claim` 리다이렉트, claim token 보존)
  - `?claim=` 파라미터 시 자동 API 호출 → claim 처리
  - 성공/실패 배너 (emerald/red) + empty state UI
- ✅ 위젯 수정: "Go to Dashboard" 버튼이 `claimToken`(비밀 토큰)을 전달 (기존 publicId → claimToken)
- ✅ Supabase 대시보드 설정 (수동):
  - Site URL → `http://localhost:3000`
  - Redirect URLs → `http://localhost:3000/auth/callback`
  - Google OAuth provider (Google Cloud Console → OAuth Client ID + Secret → Supabase에 입력)
  - Email provider "Enable Email" 확인

**Full Claim 플로우**
```
Widget "Go to Dashboard" → /claim?token={claimToken}
→ 가입/로그인 → /auth/callback → /dashboard?claim={claimToken}
→ 서버에서 POST /api/claim → user_id 연결 → 성공 배너
```

**완료 기준**
- ✅ "Go to Dashboard" 클릭 → 가입 페이지 표시
- ✅ 가입 후 claim 성공 → `user_id` 연결 (Google OAuth 테스트 완료)
- ✅ 만료된 claim token → 에러 처리 (410 Gone)
- ✅ Magic Link 플로우 — 구현 완료 (`token_hash` + `type` 처리), Supabase 이메일 rate limit으로 테스트 보류

---

### Slice 6 — 판매자 대시보드 (읽기 중심) ✅ 완료
**목표**
"왜 가입해야 하는지"를 보여주는 최소 관리 화면. 가입 직후 리다이렉트 대상.

**구현** — 모두 완료
- ✅ REST API:
  - `GET /api/listings?userId=` — 내 리스팅 목록 (listing_drafts + listings_published JOIN)
  - `GET /api/listings/:id?userId=` — 리스팅 상세 (소유권 체크)
  - 서비스 함수: `getListingsByUserId()`, `getListingByIdForUser()` (`draft.service.ts`)
- ✅ `/dashboard` — Seller Dashboard 메인:
  - KPI 카드 4개: Active Listings (실제 count), Total Negotiations (placeholder), Deals Closed (placeholder), Revenue (placeholder)
  - 리스팅 카드 목록: 사진, 제목, active 배지, condition · category, 가격, 협상 수
  - Share 버튼 (클립보드 복사 + 체크 아이콘 피드백)
  - "+ New Listing" 버튼 (disabled, ChatGPT에서 생성 안내)
  - 리스팅 없을 때 empty state
- ✅ `/dashboard/[id]` — 리스팅 상세 페이지:
  - ← Dashboard 뒤로가기
  - 제목 + active 배지 + share URL (복사 버튼)
  - Asking price + Agent preset 표시
  - KPI 카드 4개: Total Negotiations, Avg. Offer Price, Best Offer (placeholder), Time Left (실시간 카운트다운)
  - Negotiation History empty state ("No negotiations yet")
- ✅ SSR 호환: `window` 접근을 `useEffect`로 처리

**완료 기준** — 모두 충족
- ✅ 가입 후 대시보드에 claim된 listing 표시
- ✅ 리스팅 카드 클릭 → 상세 정보 확인 가능

---

### Slice 7 — 웹앱 Layout & Navigation ✅ 완료
**목표**
인증된 페이지에 공통 Nav Bar 추가 + Seller/Buyer 모드 전환 기반 마련

**구현** — 모두 완료
- ✅ Next.js Route Group `(app)` 생성 — 인증 필요 페이지 그룹화
  - `(app)/layout.tsx` — 서버 컴포넌트, Supabase Auth 체크 + Nav 렌더링
  - 미인증 시 `/claim`으로 자동 리다이렉트
  - dashboard 파일들을 `(app)/` 하위로 이동 (URL 변경 없음)
- ✅ Nav 컴포넌트 (`components/nav.tsx` — 클라이언트 컴포넌트):
  - 왼쪽: Haggle 로고 (→ /dashboard)
  - 오른쪽: 유저 아바타 (이메일 첫글자) + chevron 드롭다운
  - 드롭다운 메뉴:
    - Signed in as (이메일)
    - Selling / Buying 세그먼트 토글 (pill 스타일, `localStorage` 저장)
    - Sign out (Supabase auth signOut)
  - 바깥 클릭 시 메뉴 자동 닫힘
  - `backdrop-blur-md` 반투명 효과, `fixed top-0 z-50`
- ✅ 모바일 반응형:
  - Nav: 패딩 조정 (`px-4 sm:px-6`)
  - Dashboard header: `flex-col sm:flex-row` 스택
  - ListingCard: 이미지/텍스트 축소, 모바일에선 share 버튼 숨기고 chevron만 표시
  - Detail header: 타이틀/share 버튼 수직 스택, URL truncate 조정
  - 전체 페이지 패딩: `px-4 py-6 sm:p-6`
- ✅ Seller/Buyer 모드 토글:
  - `localStorage`에 `haggle_mode` 저장 (URL prefix 불필요)
  - 모드 전환은 드롭다운 안에 배치 (nav layout shift 방지)
  - Buying 모드 대시보드는 향후 Slice에서 구현 예정

**완료 기준** — 모두 충족
- ✅ 인증 페이지에 공통 Nav 표시
- ✅ 로그아웃 → `/claim` 리다이렉트
- ✅ Selling/Buying 토글 동작 + localStorage 유지
- ✅ 모바일/데스크탑 모두 깨지지 않는 반응형 레이아웃

---

### Slice 8 — 이미지 업로드 (Supabase Storage) ✅ 완료
**목표**
위젯에서 사진 선택 → Supabase Storage 업로드 → draft에 `photoUrl` 저장

**구현** — 모두 완료
- ✅ Supabase Storage `listing-photos` 버킷 생성 (public, 5MB 제한, image/jpeg+png+webp)
- ✅ `supabase-storage.ts` — 서버사이드 업로드 유틸리티:
  - `getSupabaseAdmin()` — `SUPABASE_SERVICE_ROLE_KEY`로 admin 클라이언트 생성
  - `uploadListingPhoto(draftId, base64Data, mimeType)` — MIME 검증 + base64 디코딩 + 5MB 크기 검증 + Storage 업로드 + public URL 반환
- ✅ MCP Tool: `haggle_upload_photo` — widget-only (`visibility: ["app"]`):
  - Input: `draft_id`, `image_base64`, `mime_type`
  - 업로드 후 `patchDraft`로 `photoUrl` 자동 연결
  - `structuredContent`로 위젯에 `photo_url` + `draft` 전달
- ✅ 위젯 `handlePhotoSelect` — canvas 리사이즈 + 압축:
  - 최대 1200px, JPEG 80% 품질로 변환 (MCP 브릿지 payload 제한 대응)
  - base64 → `handleNextStep1`에서 `callServerTool("haggle_upload_photo")` 호출
  - `photoUploaded` flag로 재업로드 방지 (Back→Next 시)
- ✅ `ontoolresult`에서 `draft.photoUrl` 수신 → preview 복원 + `photoUploaded` 설정
- ✅ `isFormValid` — `(!!photoBase64 || photoUploaded) && !!title.trim()`
- ✅ Railway 환경변수 추가: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- ✅ `@supabase/supabase-js` 패키지 추가 (`apps/api/package.json`)

**기술 결정**
- ChatGPT sandboxed iframe에서 직접 HTTP 요청 불가 → MCP tool 경유 base64 전송 방식 채택
- MCP 브릿지 payload 크기 제한 → 클라이언트 canvas 압축 (1200px JPEG 80%, ~200-400KB)
- `SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_` prefix 없음 → 브라우저 노출 방지

**완료 기준** — 모두 충족
- ✅ 위젯에서 사진 선택 → canvas 압축 → Next 클릭 → Supabase Storage 업로드 성공
- ✅ Supabase Storage 버킷에 파일 확인 가능
- ✅ draft.photoUrl에 public URL 저장
- ✅ Step 2 요약 카드 + Listing Live 화면에서 업로드된 사진 표시

---

### Slice 9 — Account Settings + 테마 통일 ✅ 완료
**목표**
유저 프로필 관리 + 비밀번호 설정 + 계정 삭제 기능 제공 + 웹앱 색상 테마를 위젯과 통일

**구현** — 모두 완료
- ✅ `/settings` 페이지 (Nav 드롭다운에서 진입, `(app)` route group 내)
- ✅ **프로필 섹션**:
  - 이름 변경 (`supabase.auth.updateUser({ data: { display_name } })`)
  - 아바타 업로드 (Supabase Storage `avatars` 버킷 → `custom_avatar_url`로 저장)
  - Google OAuth `avatar_url` 덮어쓰기 방지: `custom_avatar_url` 우선 → `avatar_url` fallback
  - Nav 아바타에 즉시 반영 (`referrerPolicy="no-referrer"`, `onError` fallback)
- ✅ **비밀번호 섹션**:
  - Google OAuth 유저: "Set a password to also sign in with email" 안내
  - Magic Link / Email 유저: 비밀번호 변경
  - 8자 최소 + 확인 입력 검증
- ✅ **계정 삭제 섹션**:
  - 이메일 입력 확인 (confirmation prompt)
  - `DELETE /api/account` — Supabase Admin API로 유저 삭제 + listing_drafts unlink
  - 삭제 후 signOut + `/claim` 리다이렉트
- ✅ **테마 통일**:
  - `globals.css` — 위젯 매칭 색상 토큰 (`--color-bg-primary`, `--color-bg-card`, `--color-bg-input`, `--color-border-default`)
  - CTA 버튼 cyan → emerald 통일 (claim, settings, dashboard)
  - 아바타 fallback 색상 emerald 통일

**완료 기준** — 모두 충족
- ✅ Nav 드롭다운 → Settings 진입 가능
- ✅ 이름/아바타 변경 → Nav에 즉시 반영 (새로고침 후에도 유지)
- ✅ 비밀번호 설정/변경 성공
- ✅ 계정 삭제 → 로그아웃 + 데이터 정리
- ✅ 웹앱 전체 색상이 위젯과 일관된 테마

---

### Slice 10 — 구매자 링크 + 협상 1회 왕복
**목표**
구매자가 공유 링크로 진입 → 오퍼 제출 → AI 에이전트가 결정 반환

**구현**
- `/l/{public_id}` 상품 랜딩 페이지 (SSR)
- DB: `negotiation_sessions` + `offers` 테이블
- API: `create_negotiation_session`, `submit_offer`
- 협상 로직 (MVP — 룰 기반, `strategy_config` 활용):
  - `floor_price` 이하 → 거절
  - `target_price` 이상 → 수락
  - 중간 값 → 에이전트 프리셋 + 슬라이더 기반 카운터 제안
  - `selling_deadline` 가까울수록 유연한 대응

**완료 기준**
- 공유 링크 오픈 → 상품 정보 표시 + 세션 생성
- 오퍼 1회 → 에이전트 결정/카운터 표시
- 결과 DB 기록

---

### Slice 11 — 프로덕션 하드닝 + Apps 제출
**목표**
실사용 가능 수준 + OpenAI Apps 제출 준비

**구현**
- rate limit (특히 buyer offer)
- public 페이지 기본 방어
- 이벤트 로깅
  - 생성 / 발행 / 오픈 / 협상 / claim
- Privacy / Terms / Abuse Report
- 제출용 데모 시나리오 문서화
- OpenAI Platform 앱 제출

**완료 기준**
- End-to-end 플로우 3회 이상 안정 재현
- 심사자용 2~3분 데모 문서 완비

---

## 7) 팀 운영 방식 (Vertical Slice 규칙)

### 공통 규칙
각 Slice는 반드시:
1. 구현
2. 테스트 (데모 스크립트 + 최소 자동 테스트)
3. 로그 / 관측 이벤트 추가
4. 짧은 릴리즈 노트

### 테스트 기준
- E2E 핵심 1개
- API 단위 테스트 (핵심 tool 2~3개)
- UI 스모크 테스트
- 가능하면 Slice 종료 시 30초 데모 영상

---

## 8) 실행 계획

### Week 1 ✅ 완료
- Slice 0 ✅ + Slice 1 ✅
- Developer mode에서 `/haggle` → Draft 생성 → 위자드 Step 1 UI
- Fastify + MCP SDK + Supabase + Railway 배포

### Week 2 ✅ 완료
- Slice 2 ✅ + Slice 3 UI ✅
- 위자드 Step 2 (가격) + 대화 자동채우기 + AI Agent Setup UI
- Tool description 최적화 (ChatGPT 모델 행동 제어)
- Fullscreen 모드 안정화

### Week 3 — 현재
- Slice 3 마무리 (에이전트 채팅 연동 — 보류) + Slice 4 ✅ (검증 + 발행 + Listing Live)
- Publish → 공유 링크 발급 완료
- Slice 5 ✅ (Auth + Claim) + Slice 6 ✅ (Dashboard 리스팅 목록/상세) + Slice 7 ✅ (Layout & Nav)
- Slice 8 ✅ (이미지 업로드 — Supabase Storage + canvas 압축)

### Week 4
- Slice 9 ✅ (Account Settings + 테마 통일) + Slice 10 (구매자 협상) + Slice 11 (하드닝 + Apps 제출)
- 구매자 협상 1회 왕복 + E2E 데모 영상 촬영

---

## 9) 한 문장 요약
> “우리는 ChatGPT를 판매자 콘솔로 쓰고, MCP tool 기반 state 동기화로 ‘말하면 폼이 채워지는’ Listing Creation을 만들고, 링크 기반 구매자 협상 웹앱까지를 Vertical Slices로 빠르게 완성한다. 로그인/대시보드는 24시간 claim으로 전환을 만든다.”

---

*Last Updated: 2026-03-14*
*Progress: Slice 0 ✅ → Slice 1 ✅ → Slice 2 ✅ → Slice 3 🔄 (UI 완료, 채팅 보류) → Slice 4 ✅ → Slice 5 🔄 (구현 완료, Magic Link 테스트 보류) → Slice 6 ✅ → Slice 7 ✅ (Layout & Nav) → Slice 8 ✅ (이미지 업로드) → Slice 9 ✅ (Account Settings + 테마 통일) → Slice 10 ⬜ (구매자 협상) → Slice 11 ⬜ (하드닝)*