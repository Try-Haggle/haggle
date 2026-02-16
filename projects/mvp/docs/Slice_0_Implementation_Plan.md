# Slice 0 — 개발/배포 기반 구현 계획

## 목표
빈 리포에서 시작하여 Turborepo monorepo를 셋업하고, Supabase DB 연결, Railway/Vercel 배포, ChatGPT Developer Mode MCP 커넥터 연결까지 완료하여 **tool 호출이 가능한 최소 골격**을 만든다.

## 상태: ✅ 완료 (에러 트래킹 제외)

---

## 아키텍처

```
haggle/  (Turborepo Monorepo)
│
├── 루트 설정 (6 files) ─── 모든 워크스페이스를 묶는 뼈대
│
├── packages/ (5 packages) ─── 공유 라이브러리 계층
│   ├── shared      실제 구현  (타입, 상수, 유틸)
│   ├── protocol    타입만     (HNP 프로토콜 인터페이스)
│   ├── engine      타입만     (협상 엔진 인터페이스)
│   ├── db          실제 구현  (Drizzle 스키마 + DB 클라이언트)
│   └── contracts   플레이스홀더 (블록체인 — post-MVP)
│
└── apps/ (2 apps) ─── 실제 서비스 계층
    ├── api         Fastify + MCP 서버 (port 3001)
    └── web         Next.js 웹앱 (port 3000)
```

### 핵심 개념

**1) Monorepo = 하나의 Git 리포, 여러 개의 독립 패키지**

| 파일 | 역할 |
|------|------|
| `pnpm-workspace.yaml` | apps/*, packages/* 가 워크스페이스임을 선언 |
| `turbo.json` | build 시 의존성 순서대로 빌드 (DAG 기반) |
| `tsconfig.base.json` | 모든 패키지가 공유하는 TypeScript 설정 |
| `package.json` | turbo로 전체 build/dev/typecheck 명령 실행 |

`pnpm install` 한 번이면 7개 패키지 전부 설치, `pnpm turbo build` 한 번이면 의존 순서대로 전부 빌드.

**2) 의존성 흐름 (아래에서 위로)**

```
apps/api  ←── packages/shared, protocol, engine, db, contracts
apps/web  ←── (아직 의존 없음, Slice 1에서 shared 연결 예정)

packages/engine   ←── shared, protocol
packages/db       ←── (독립)
packages/shared   ←── (독립, 최하위 계층)
packages/protocol ←── (독립)
packages/contracts←── (독립)
```

Turbo가 이 의존 그래프를 보고 shared → protocol → engine → db → api 순서로 빌드.

**3) 배포 구조**

```
Railway  ← apps/api  (Fastify + MCP 서버, Dockerfile 기반)
Vercel   ← apps/web  (Next.js, 자동 감지)
Supabase ← PostgreSQL DB (Transaction mode pooler, port 6543)
```

같은 리포에서 관리하지만 배포는 완전히 별도. `main` 브랜치에 push하면 Railway, Vercel 모두 자동 배포.

---

## 구현 항목

### 1. 루트 monorepo 설정
```
.nvmrc                    — Node 22 고정
.gitignore                — node_modules, dist, .next, .env 등
pnpm-workspace.yaml       — apps/*, packages/* 워크스페이스
package.json              — pnpm 9+, turbo scripts
turbo.json                — build/dev/lint/typecheck 파이프라인
tsconfig.base.json        — ES2022, bundler moduleResolution, strict
.env.example              — DATABASE_URL, PORT 등 템플릿
```

### 2. packages 스켈레톤 (5 packages)

**`packages/shared`** — 실제 구현
- `src/types/listing.ts` — ListingStatus, ListingCategory, ItemCondition
- `src/types/negotiation.ts` — NegotiationStatus, OfferType
- `src/types/api.ts` — ApiResponse, ApiError
- `src/constants.ts` — LISTING_STATUSES, ITEM_CONDITIONS, LISTING_CATEGORIES
- `src/utils/api.ts` — createApiResponse, createApiError
- `src/index.ts` — 전체 re-export

**`packages/protocol`** — 타입만 정의 (TODO: 상태 머신)
- `src/types.ts` — HnpState, HnpTransition, HnpEvent 인터페이스

**`packages/engine`** — 타입만 정의 (TODO: 룰 엔진 Slice 4)
- `src/types.ts` — EngineConfig, EngineDecision, NegotiationStrategy

**`packages/db`** — Drizzle 스키마 + 클라이언트
- `drizzle.config.ts` — PostgreSQL dialect, schema 경로
- `src/client.ts` — createDb(connectionString) 팩토리 (postgres.js + drizzle-orm)
- `src/schema/listing-drafts.ts` — listing_drafts 테이블 스키마
- `src/schema/index.ts` — 테이블 export (나머지 테이블은 TODO)

**`packages/contracts`** — 플레이스홀더 (TODO: Foundry + Solidity post-MVP)
- `src/index.ts` — ContractAddresses 인터페이스 + null placeholder

### 3. API 서버 — `apps/api`

**`src/index.ts`** — dotenv 로드, createServer(), listen(3001)

**`src/server.ts`** — 핵심 와이어링
- Fastify 인스턴스 생성
- @fastify/cors: `chatgpt.com`, `chat.openai.com`, localhost 허용
- `GET /health` — 헬스체크
- MCP 라우트 등록 (`registerMcpRoutes`)

**`src/mcp/router.ts`** — MCP Streamable HTTP 수동 와이어링
- `StreamableHTTPServerTransport` 직접 사용 (fastify-mcp-server 플러그인은 v0.7.2로 너무 초기 단계라 제외)
- POST /mcp — 세션 초기화 및 요청 처리
- GET /mcp — SSE 스트림 (서버 → 클라이언트)
- DELETE /mcp — 세션 종료
- 세션은 `Map<string, Transport>`로 인메모리 관리

**`src/mcp/tools/index.ts`** — Tool 등록
- `haggle_ping` — 연결 테스트용 (실제 구현)
- `haggle_start_draft` — 스텁 (mock 데이터 반환, Slice 1에서 DB 연결)
- TODO 주석으로 나머지 tool 자리 표시 (slice-2 ~ slice-5)

### 4. 웹앱 — `apps/web`
- `next.config.ts` — standalone output
- `src/app/layout.tsx` — HTML 셸 + metadata
- `src/app/page.tsx` — "Haggle — Slice 0 deployed" 플레이스홀더
- Tailwind CSS는 Slice 1에서 추가 (지금은 inline style만)

### 5. 인프라/배포

**Supabase**
- 프로젝트 `haggle` 생성
- Transaction mode pooler (port 6543)
- `drizzle-kit push`로 `listing_drafts` 테이블 반영

**Railway (API 서버)**
- Dockerfile 기반 배포 (`Dockerfile.api`, `.dockerignore`)
- 환경변수: `DATABASE_URL`, `PORT`, `HOST`, `LOG_LEVEL`

**Vercel (웹앱)**
- Root Directory: `apps/web`, Framework: Next.js 자동 감지

**ChatGPT Developer Mode**
- MCP 커넥터 등록 (Authentication: None)
- MCP Server URL: Railway 배포 URL + `/mcp`

### 6. 환경 설정
- `apps/api/.env.example` — API 서버용 템플릿
- 루트 `.env.example` — 전체 프로젝트용 템플릿
- `.env` — 실제 credentials (gitignored)

---

## 배포 URL (staging)

```
API (Railway):  https://haggle-production-7dee.up.railway.app
  /health       → {"status":"ok"}
  /mcp          → MCP Streamable HTTP 엔드포인트
Web (Vercel):   https://haggle-3lutwh2xn-haggles-projects.vercel.app
DB (Supabase):  PostgreSQL — aws-0-us-west-2.pooler.supabase.com:6543
```

## 인프라 계정
- GitHub Organization: `Try-Haggle` (repo: `haggle`)
- Railway / Vercel / Supabase: `tryhaggle@gmail.com`으로 가입
- 비밀번호 관리: Bitwarden

---

## 현재 동작하는 것 vs TODO

| 구분 | 동작함 | TODO (다음 Slice에서 구현) |
|------|--------|--------------------------|
| **shared** | 타입 정의, 상수, API 유틸 | — |
| **protocol** | HNP 타입 인터페이스 | 상태 머신 (slice-4) |
| **engine** | 엔진 타입 인터페이스 | RuleBasedEngine, LlmEngine (slice-4) |
| **db** | 스키마(`listing_drafts`), DB 클라이언트 | 나머지 테이블들 (slice-3~6) |
| **contracts** | `ContractAddresses` 인터페이스 | Solidity, Foundry (post-mvp) |
| **api** | health check, MCP 서버 (ping + start_draft 스텁) | 실제 DB 연결, 나머지 tools (slice-1~5) |
| **web** | "Haggle" 플레이스홀더 페이지 | Tailwind, 실제 UI (slice-1) |

---

## 파일 트리
```
haggle/
├── .gitignore, .nvmrc, .env.example
├── package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json
├── Dockerfile.api, .dockerignore
├── apps/
│   ├── api/
│   │   ├── package.json, tsconfig.json, .env.example
│   │   └── src/
│   │       ├── index.ts, server.ts
│   │       └── mcp/
│   │           ├── router.ts
│   │           └── tools/index.ts
│   └── web/
│       ├── package.json, tsconfig.json, next.config.ts
│       └── src/app/
│           ├── layout.tsx, page.tsx
├── packages/
│   ├── shared/     (types + constants + utils — 실제 구현)
│   ├── protocol/   (HNP 타입만)
│   ├── engine/     (엔진 타입만)
│   ├── db/         (Drizzle 스키마 + 클라이언트 — 실제 구현)
│   └── contracts/  (플레이스홀더)
```

## TODO 태그 규칙
- `TODO(slice-N)`: 해당 Slice에서 구현 예정 — 구체적이고 가까운 미래
- `TODO(post-mvp)`: MVP 이후 — 결제, 블록체인, LLM 엔진, KYC 등

## 주요 의존성
```
Root:           turbo, typescript
API:            fastify, @fastify/cors, @modelcontextprotocol/sdk, zod, dotenv, tsx
Web:            next 15, react 19, react-dom 19
DB:             drizzle-orm, drizzle-kit, postgres (postgres.js)
Shared:         zod
```

## 검증 완료

### 로컬 검증
1. `pnpm install && pnpm build` — 7개 워크스페이스 전부 빌드 성공 ✅
2. `curl localhost:3001/health` → `{"status":"ok"}` ✅
3. MCP initialize → JSON-RPC 응답 + 세션 ID 발급 ✅
4. MCP tools/list → `haggle_ping`, `haggle_start_draft` 포함 ✅
5. MCP tools/call haggle_ping → `{"status":"ok","message":"Haggle MCP server is connected!"}` ✅
6. `curl localhost:3000` → HTML "Haggle" 페이지 ✅

### 배포 검증
1. `https://haggle-production-7dee.up.railway.app/health` → `{"status":"ok"}` ✅
2. Vercel 배포 URL → Haggle 웹 페이지 표시 ✅
3. ChatGPT Developer Mode에서 MCP 커넥터 연결 성공 ✅
4. ChatGPT에서 tool 목록 표시 (`haggle_ping`, `haggle_start_draft`) + 호출 성공 ✅

## 미완료 항목
- ⬜ 에러 트래킹 (Sentry 등) — Fastify 기본 로거만 사용 중
