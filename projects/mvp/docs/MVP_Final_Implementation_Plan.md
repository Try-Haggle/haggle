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
- **Embedded UI (판매자 위젯)**: `https://tryhaggle.ai/widgets/listing`
- **구매자 웹앱 (공유 링크)**: `https://tryhaggle.ai/l/{public_id}`

### 구성 요소 개요

#### MCP 서버 (= 백엔드)
- Listing Draft 생성 / 업데이트 / 검증 / 발행
- 24시간 Claim 처리 (user_id 연결)
- Negotiation Session / Offer 저장
- ChatGPT Apps에서 호출 가능한 MCP Tool 제공

#### ChatGPT Embedded UI (판매자 Listing Creation Flow)
- iframe 기반 UI
- 서버 state를 **단일 Source of Truth**로 사용
- 대화 입력과 UI 입력이 동일한 state를 업데이트

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
│  │  ChatGPT     │  │  구매자 웹앱  │  │  판매자       │  │
│  │  Embedded UI │  │  /l/{id}     │  │  Dashboard   │  │
│  │  (iframe)    │  │  (SSR)       │  │  /dashboard  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         │        Next.js (App Router)       │           │
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
| 프레임워크 | **Next.js 15 (App Router)** | SSR (구매자 랜딩 SEO), 대시보드, Widget 통합 |
| 스타일 | **Tailwind CSS** | 빠른 UI 개발, 일관된 디자인 시스템 |
| 상태 관리 | **Supabase Realtime + React Query** | 서버 state 구독으로 Embedded UI 자동 리렌더 |

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
│   ├── web/              # Next.js — 구매자 웹앱, 대시보드, Embedded Widget
│   └── api/              # Fastify — MCP 서버, REST API, WebSocket
├── packages/
│   ├── shared/           # 공유 타입, 상수, 유틸리티
│   ├── protocol/         # HNP 프로토콜 타입 + 상태 머신 정의
│   ├── engine/           # Haggle Engine (협상 로직 — MVP: 룰 기반 → 확장: LLM)
│   ├── db/               # Drizzle ORM 스키마 + 마이그레이션
│   └── contracts/        # Solidity 스마트컨트랙트 (Foundry) — MVP 이후
├── turbo.json
├── package.json
└── tsconfig.base.json
```

> **핵심 설계 원칙**: `engine`, `protocol`, `contracts`를 독립 패키지로 분리
> → MVP에서는 내부 모듈로 사용, 확장 시 npm 배포하여 **개발자 SDK**의 기초가 됨
> → "3줄 통합" 개발자 경험의 토대

### 확장 경로 요약
```
MVP (Now)                    →  Production (Later)
─────────────────────────────────────────────────────
룰 기반 협상 (engine/)       →  LLM 기반 멀티에이전트
타입 정의만 (protocol/)      →  HNP v1.0 표준 프로토콜
mock (Payment Service)       →  x402 + USDC + 에스크로
Supabase Auth               →  KYC Tier별 인증
Railway                     →  AWS/GCP (필요 시)
```

---

## 4) 데이터 모델 (MVP 최소 + 확장 가능)
> ORM: **Drizzle** — `packages/db/` 에서 스키마 정의, apps/api 와 apps/web 에서 공유

### listing_drafts
- `id` (uuid)
- `status` (`draft` / `published` / `expired`)
- `user_id` (nullable)
- `claim_token`
- `claim_expires_at`
- `title`
- `category`
- `brand`
- `model`
- `condition`
- `description`
- `target_price`
- `floor_price`
- `strategy_config` (json)
- `created_at`
- `updated_at`

### listings_published
- `public_id` (short id)
- `draft_id`
- `snapshot_json`
- `published_at`

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
- Slice 6부터 도입

---

## 5) MCP Tools (대화 기반 서버 호출 계약)

### MVP 최소 Tool 세트
- `haggle.start_draft() -> { draft_id, draft }`
- `haggle.apply_patch({ draft_id, patch }) -> { draft }`
- `haggle.get_draft({ draft_id }) -> { draft }`
- `haggle.validate_draft({ draft_id }) -> { ok, errors[] }`
- `haggle.publish_listing({ draft_id }) -> { public_id, share_url, claim_token, claim_expires_at }`
- `haggle.create_negotiation_session({ public_id }) -> { session_id }`
- `haggle.submit_offer({ session_id, amount }) -> { decision, counter_amount?, message }`
- `haggle.claim({ claim_token, user }) -> { success, dashboard_url }`

> 핵심 포인트  
> “채팅으로 말하면 폼이 채워지는 UX”는  
> `apply_patch → 서버 state 업데이트 → Embedded UI 리렌더` 구조로 달성

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

### Slice 1 — Draft 생성 + Embedded UI 1페이지
**목표**  
`/haggle` 시작 → Draft 생성 → Embedded UI가 유지된 채 표시

**구현**
- Tool: `haggle.start_draft`
- DB: `listing_drafts` 최소 컬럼 구성
- Embedded UI:
  - title, category, model, condition
  - target_price, floor_price
  - Save 버튼 (`apply_patch`)

**완료 기준**
- `/haggle` 실행 시 Draft 생성
- UI 입력 → Save → 서버 저장 → UI 값 유지

---

### Slice 2 — 대화로 폼 자동 채우기 (핵심 가치)
**목표**  
채팅 입력만으로 현재 열린 UI의 필드 값이 자동 반영

**구현**
- Tool: `haggle.apply_patch`, `haggle.get_draft`
- 모델 지시:
  - 가격 / 상태 / 모델 언급 시 patch 생성
- 서버 patch 규칙:
  - 허용 필드만 업데이트
  - 가격 정규화, enum 매핑
- UI는 서버 draft를 source-of-truth로 렌더

**데모 시나리오**
1. “갤럭시 S24 팔려고 해”
2. “희망가는 60만원, 상태 거의 새거”
3. UI에 모델 / 가격 / 상태 자동 반영
4. UI 수정도 동일 draft에 반영

---

### Slice 3 — 검증 + 발행 + 공유 링크
**목표**  
필수값 충족 → Publish → 공유 링크 생성

**구현**
- Tool: `haggle.validate_draft`, `haggle.publish_listing`
- `listings_published` 생성 + `public_id` 발급
- 공유 링크: `https://tryhaggle.ai/l/{public_id}`
- UI에 Publish 버튼

**완료 기준**
- 필수값 누락 시 에러 표시
- Publish 성공 시 링크 복사 가능

---

### Slice 4 — 구매자 링크 + 협상 1회 왕복
**목표**  
구매자가 링크로 진입 → 오퍼 제출 → 서버가 결정 반환

**구현**
- `/l/{public_id}` 상품 랜딩 페이지
- Tool: `haggle.create_negotiation_session`
- Tool: `haggle.submit_offer`
- 협상 로직(MVP):
  - floor 이하 거절
  - target 이상 수락
  - 중간 값 카운터 제안

**완료 기준**
- 링크 오픈 → 세션 생성
- 오퍼 1회 → 결정/카운터 표시
- 결과 DB 기록

---

### Slice 5 — 24시간 Claim
**목표**  
로그인 없이 만든 listing을 가입 후 소유권 연결

**구현**
- publish 시 `claim_token`, `claim_expires_at` 발급
- 상태: `user_id = null`
- Claim 페이지: `/claim?token=...`
- Tool: `haggle.claim`

**완료 기준**
- 로그인 없이 publish → claim token 존재
- 가입 후 claim 성공 → user_id 연결

---

### Slice 6 — 판매자 대시보드 (읽기 중심)
**목표**  
“왜 가입해야 하는지”를 보여주는 최소 관리 화면

**구현**
- `/dashboard`
  - 내 listings
  - listing별 협상 수 / 최근 오퍼
- 인증: Supabase Auth (이메일 매직링크 + Google/Apple 소셜 로그인)
- API / Tool:
  - `list_my_listings`
  - `get_listing_activity`

**완료 기준**
- claim된 listing이 대시보드에 표시
- 협상 데이터 확인 가능

---

### Slice 7 — 프로덕션 하드닝 + Apps 제출
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

## 8) 첫 2주 실행 계획

### Week 1
- Slice 0 + Slice 1
- Developer mode에서 `/haggle` → Draft 생성 → UI 저장

### Week 2
- Slice 2 + Slice 3
- 말로 폼 채우기 → Publish → 링크 생성
- 마케팅 데모 영상 촬영 가능

---

## 9) 한 문장 요약
> “우리는 ChatGPT를 판매자 콘솔로 쓰고, MCP tool 기반 state 동기화로 ‘말하면 폼이 채워지는’ Listing Creation을 만들고, 링크 기반 구매자 협상 웹앱까지를 Vertical Slices로 빠르게 완성한다. 로그인/대시보드는 24시간 claim으로 전환을 만든다.”