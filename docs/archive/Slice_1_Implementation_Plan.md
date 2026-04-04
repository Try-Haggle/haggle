# Slice 1 — Draft 생성 + 위자드 Step 1 (Item Details)

## 목표
`/haggle` 실행 → DB에 실제 Draft 생성 → Embedded UI 위자드의 첫 페이지(Item Details)가 ChatGPT iframe으로 표시되고, 폼 입력 값이 서버에 저장되는 **최초의 end-to-end 수직 관통**을 달성한다.

## 상태: ✅ 완료

---

## 아키텍처

### Slice 1 데이터 흐름

```
┌───────────────────────────────────────────────────────────────────┐
│                        ChatGPT                                    │
│                                                                   │
│  사용자: "/haggle"                                                │
│      ↓                                                           │
│  ChatGPT → MCP tool 호출: haggle_start_draft                     │
│      ↓                                                           │
│  Tool 응답:                                                       │
│    structuredContent: { draft_id, draft }     ← 모델 + 위젯 공유  │
│    _meta.ui.resourceUri: "ui://haggle/listing.html"              │
│      ↓                                                           │
│  ChatGPT가 MCP Resource HTML을 sandboxed iframe으로 렌더          │
│                                                                   │
│  ┌─────────────────────────────────────────┐                      │
│  │  Embedded UI (MCP App Resource)         │                      │
│  │  ui://haggle/listing.html               │                      │
│  │                                         │                      │
│  │  ① Item Details ──── ② Pricing          │                      │
│  │                                         │                      │
│  │  [Photo upload/preview]                 │                      │
│  │  [Title *         ]                     │                      │
│  │  [Description     ]                     │                      │
│  │  [Tags: + New  iPhone × 256GB ×]        │                      │
│  │  [Category ▼      ]                     │                      │
│  │  [New|Like New|Good|Fair|Poor]          │                      │
│  │                                         │                      │
│  │  [ Next: Set Pricing → ]               │                      │
│  └────────────┬────────────────────────────┘                      │
│               │ useApp() hook (ext-apps SDK)                      │
│               │ app.callServerTool("haggle_apply_patch", ...)     │
└───────────────┼───────────────────────────────────────────────────┘
                │ MCP protocol (ChatGPT가 중계)
                ↓
┌───────────────────────────────────────────────────────────────────┐
│  Fastify API Server (apps/api)                                    │
│                                                                   │
│  MCP Endpoints (POST /mcp)                                        │
│  ├─ haggle_start_draft  → UI 연결 (resourceUri)                   │
│  ├─ haggle_apply_patch  → 위젯에서 callServerTool로 직접 호출      │
│  └─ haggle_get_draft    → 대화에서 호출                            │
│                                                                   │
│  MCP App Resource                                                 │
│  └─ ui://haggle/listing.html  (Vite singlefile 빌드 — 단일 HTML)  │
│                                                                   │
│  ┌─────────────────────────────────────┐                          │
│  │  Service Layer                      │                          │
│  │  draft.service.ts                   │                          │
│  │  ├─ createDraft(db)                 │                          │
│  │  ├─ getDraftById(db, id)            │                          │
│  │  └─ patchDraft(db, id, patch)       │                          │
│  └──────────────┬──────────────────────┘                          │
│                 │ Drizzle ORM                                     │
└─────────────────┼─────────────────────────────────────────────────┘
                  ↓
┌───────────────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL                                              │
│  listing_drafts 테이블 (스키마 업데이트됨)                         │
│  - brand, model 제거                                              │
│  - tags, photo_url, selling_deadline 추가                         │
└───────────────────────────────────────────────────────────────────┘
```

### 핵심 개념

**1) MCP App Resource 기반 Embedded UI (ChatGPT Apps SDK 패턴)**

ChatGPT의 Embedded UI는 외부 URL을 iframe에 로드하는 방식이 **아니다**.
MCP 서버에 HTML 번들을 리소스로 등록하면, ChatGPT가 해당 HTML을 sandboxed iframe에 직접 렌더한다.

```
우리가 하는 것:
  React 위젯 소스 → Vite + vite-plugin-singlefile → 단일 index.html (JS/CSS 인라인)
  → registerAppResource(server, "listing-widget", "ui://haggle/listing.html", ...)
  → 서버 시작 시 readFileSync로 HTML 읽어서 리소스로 등록

ChatGPT가 하는 것:
  Tool의 _meta.ui.resourceUri를 보고 → 해당 리소스 HTML을 가져와 → iframe에 렌더
```

| 구분 | 설명 |
|------|------|
| 위젯 위치 | MCP 서버에 리소스로 등록 (`apps/api` 내 빌드) |
| 데이터 수신 | `useApp()` hook → `app.ontoolresult` → `structuredContent` |
| 데이터 전송 | `app.callServerTool()` → MCP tool 실행 |
| Next.js 역할 | 위젯과 무관 — 구매자 웹앱 + 대시보드 전용 (Slice 5+) |

**2) Tool ↔ Widget 연결 구조**

- `haggle_start_draft` tool에 `_meta.ui.resourceUri: "ui://haggle/listing.html"` 설정
- Tool이 `structuredContent`로 draft 데이터를 반환하면, ChatGPT가 이를 위젯에 전달
- 위젯이 `app.callServerTool("haggle_apply_patch", {...})`로 서버 tool 호출, ChatGPT가 MCP 서버에 중계
- **REST API 불필요** — 위젯은 MCP tool을 직접 호출

**3) Submit-per-page UX**

- 폼 작성 중에는 로컬 state만 변경 (서버 호출 없음)
- "Next" 버튼 클릭 시 → 필수값 검증 → `app.callServerTool("haggle_apply_patch", ...)` 한 번 호출 → 다음 Step 이동
- Mount 시 `app.ontoolresult`에서 `structuredContent` draft 데이터를 받아 폼 초기화 (대화 자동채우기로 이미 채워진 값 반영)

**4) DB 스키마 변경 (Slice 0 → Slice 1)**

| 변경 | 컬럼 | 이유 |
|------|------|------|
| 제거 | `brand`, `model` | 디자인에서 Tags로 대체 |
| 추가 | `tags` (text[]) | 자유 태그 (e.g. "iPhone", "256GB") |
| 추가 | `photo_url` (text) | 이미지 URL (MVP: 로컬 프리뷰, 클라우드 업로드는 추후) |
| 추가 | `selling_deadline` (timestamptz) | 판매 마감일 |

> `agent_preset` 컬럼은 Slice 3 (AI Agent Setup)에서 추가. `strategy_config`는 Slice 0에서 이미 존재.

---

## 구현 항목

### 1. Shared Types & Constants — `packages/shared` ✅

**`src/types/listing.ts`** (수정)
- `ListingDraft` 인터페이스 추가 (DB 컬럼과 1:1 매핑, camelCase)
  - id, status, userId, title, description, tags, category, condition, photoUrl
  - targetPrice, floorPrice, sellingDeadline, strategyConfig
  - claimToken, claimExpiresAt, createdAt, updatedAt
- `AgentPreset` 타입은 Slice 3에서 추가

**`src/constants.ts`** — 변경 없음 (`AGENT_PRESETS`는 Slice 3에서 추가)

**`src/index.ts`** (수정)
- `ListingDraft` 타입 export 추가

### 2. DB Schema Migration — `packages/db` ✅

**`src/schema/listing-drafts.ts`** (수정)
```
제거: brand: text("brand"), model: text("model")
추가: tags: text("tags").array()
추가: photoUrl: text("photo_url")
추가: sellingDeadline: timestamp("selling_deadline", { withTimezone: true })
```

**`drizzle.config.ts`** (수정)
- `schema`를 명시적 파일 리스트로 변경 (`["./src/schema/listing-drafts.ts"]`) — drizzle-kit CJS/ESM 호환 문제로 barrel file 사용 불가

**Migration 실행**
```bash
cd packages/db && pnpm db:push
```
- `brand`, `model` 컬럼 삭제 (Slice 0 stub 데이터만 있으므로 안전)
- 3개 새 컬럼 추가 (모두 nullable)

### 3. Service Layer — `apps/api/src/services/` ✅

**`draft.service.ts`** (신규) — MCP tools가 사용하는 비즈니스 로직 (향후 REST endpoints와도 공유)

| 함수 | 동작 | 반환 |
|------|------|------|
| `createDraft(db)` | INSERT with `status: "draft"` | 생성된 전체 row |
| `getDraftById(db, id)` | SELECT WHERE id | row 또는 null |
| `patchDraft(db, id, patch)` | 허용 필드만 UPDATE + updatedAt 갱신 | 업데이트된 row 또는 null |

**patchDraft 허용 필드 (allowlist)**
```
title, description, tags, category, condition, photoUrl,
targetPrice, floorPrice, sellingDeadline, strategyConfig
```
- `id`, `status`, `userId`, `claimToken`, `claimExpiresAt`, `createdAt` 등은 직접 수정 불가
- 빈 patch는 무시하고 현재 draft 반환
- Drizzle `.returning()` 사용하여 SELECT 없이 바로 업데이트된 row 반환

### 4. DB Connection Injection — `apps/api/src/` ✅

**`server.ts`** (수정)
- `createDb(process.env.DATABASE_URL!)` 으로 DB 인스턴스 생성 (서버 시작 시 1회)
- `registerMcpRoutes(app, db)` — DB를 MCP 라우터에 전달

**`mcp/router.ts`** (수정)
- `registerMcpRoutes(app, db)` — db 파라미터 수신
- `createMcpServer(db)` → `registerTools(mcp, db)` + `registerResources(mcp)` 호출
- 기존 POST/GET/DELETE 핸들러 로직은 변경 없음

### 5. MCP Tools + App Resource Registration — `apps/api/src/mcp/` ✅

#### 5-1. App Resource 등록 — `resources.ts` (신규)

Vite singlefile 빌드된 단일 HTML을 MCP 리소스로 등록:
```typescript
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export const LISTING_RESOURCE_URI = "ui://haggle/listing.html";

export function registerResources(server: McpServer) {
  const htmlPath = path.join(import.meta.dirname, "../../widget/dist/index.html");
  const html = readFileSync(htmlPath, "utf-8");

  registerAppResource(server, "listing-widget", LISTING_RESOURCE_URI, {
    description: "Listing draft wizard — Item Details and Pricing steps for sellers",
    mimeType: RESOURCE_MIME_TYPE,
  }, async () => ({
    contents: [{
      uri: LISTING_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
    }],
  }));
}
```

#### 5-2. Tools — `tools/index.ts` (수정)

`registerTools(server, db)` — db 파라미터 추가. `@modelcontextprotocol/ext-apps/server`의 `registerAppTool` 사용.

**`haggle_ping`** — 변경 없음 (일반 `server.tool`)

**`haggle_start_draft`** (registerAppTool로 교체)
- 입력: 없음 (빈 스키마)
- `_meta.ui.resourceUri`: `"ui://haggle/listing.html"` — 위젯 연결
- `_meta["openai/outputTemplate"]`: ChatGPT 호환용
- 동작: `createDraft(db)` 호출
- 응답:
  ```typescript
  {
    structuredContent: { draft_id: draft.id, draft },  // 위젯이 ontoolresult로 수신
    content: [{ type: "text", text: "Draft created! Fill in the item details in the form." }],
  }
  ```

**`haggle_apply_patch`** (registerAppTool)
- 입력: `{ draft_id: uuid, patch: { title?, description?, tags?, ... } }` — Zod 스키마
- `_meta.ui.visibility`: `["model", "app"]` — 위젯에서 `callServerTool`로 직접 호출 가능
- 동작: `patchDraft(db, draft_id, patch)` 호출
- 응답: `structuredContent: { draft_id, draft }` (업데이트된 draft)

**`haggle_get_draft`** (일반 `server.tool`)
- 입력: `{ draft_id: uuid }`
- 동작: `getDraftById(db, draft_id)` 호출
- 응답: `content: [{ type: "text", text: JSON.stringify({ draft_id, draft }) }]`

### 6. Widget Build Pipeline + UI — `apps/api/widget/` ✅

위젯은 `apps/api` 내에서 빌드되어 MCP 리소스로 등록된다. Next.js와는 무관.

#### 6-1. 빌드 설정

**빌드 도구**: Vite + `@vitejs/plugin-react` + `vite-plugin-singlefile`
- Vite가 React JSX를 번들링하고, singlefile 플러그인이 JS/CSS를 단일 `index.html`에 인라인

**의존성** (`apps/api/package.json`):
```
dependencies:   react, react-dom, @modelcontextprotocol/ext-apps
devDependencies: vite, @vitejs/plugin-react, vite-plugin-singlefile, @types/react, @types/react-dom
```

**빌드 스크립트** (`apps/api/package.json`):
```json
"build:widget": "vite build -c widget/vite.config.ts",
"build": "pnpm build:widget && tsc --project tsconfig.json"
```

**`widget/vite.config.ts`**:
```typescript
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react(), viteSingleFile()],
  build: { outDir: "dist", minify: true },
});
```

**`widget/tsconfig.json`** — widget 전용 (jsx: react-jsx, DOM lib, 서버 tsconfig과 분리)

**`widget/index.html`** — Vite entry HTML (`<div id="root">` + `<script type="module" src="/src/main.tsx">`)

**`turbo.json`** — `widget/dist/**` output 추가

**`Dockerfile.api`** — `ls -la apps/api/widget/dist/index.html` 빌드 검증 추가

#### 6-2. 위젯 React 컴포넌트

**`widget/src/main.tsx`** — React entry point
- `createRoot` + `<App />` 렌더 + `styles.css` import

**`widget/src/vite-env.d.ts`** — Vite client 타입 선언 (CSS import 등)

**`widget/src/App.tsx`** — 위자드 메인 컴포넌트 (★ 핵심)
- `useApp()` hook으로 MCP 브릿지 연결 (`appInfo: { name: "haggle-listing-widget", version: "0.1.0" }`)
- `app.ontoolresult` → `structuredContent`에서 draft 데이터 추출 → 로컬 state 초기화
- `app.callServerTool("haggle_apply_patch", ...)` → 서버에 patch 전송
- 위자드 Step 관리 (Step 1: Item Details, Step 2: placeholder)
- 사진 업로드: hidden `<input type="file">` + `URL.createObjectURL()` 로컬 프리뷰
- 폼 유효성: `photoFile && title.trim()` → CTA 버튼 disabled/enabled 제어

**`widget/src/components/StepIndicator.tsx`**
- Props: `currentStep`, `steps[]`
- circle + label (active: cyan, complete: emerald 체크, upcoming: gray)
- 스텝 간 연결선 (filled: cyan, unfilled: gray)

**`widget/src/components/TagInput.tsx`**
- Props: `tags[]`, `onChange(tags[])`
- +New 버튼 → 인라인 입력 필드 토글
- Enter/쉼표로 추가, Backspace로 삭제, × 버튼 개별 삭제, Escape로 취소
- 칩 스타일: slate-800 배경(#1e293b), slate-700 보더(#334155), white 텍스트

**`widget/src/components/ChipSelector.tsx`**
- Props: `options[]`, `selected`, `onChange`
- 라디오 스타일 칩 선택 (Condition 필드용)
- 선택 시: cyan 보더 + cyan 텍스트 (transparent 배경)
- hover: subtle gray (#4b5563), 선택된 칩은 hover 변화 없음

**`widget/src/styles.css`** — 다크 테마 (디자인 리뷰 완료)

색상 시스템:
- **Cyan (#06b6d4)**: Interactive/State — 포커스, hover, active step, 선택된 칩
- **Emerald (#10b981)**: Action/Confirmation — CTA 버튼, 완료된 step
- **White (#ffffff)**: Photo preview hover 컨텍스트 (오버레이 아이콘 + 보더)

CSS custom properties:
```
--bg-primary: #0a0e17       (메인 배경)
--bg-card: #111827          (카드/섹션 배경)
--bg-input: #0d1321         (입력 필드 배경)
--border-default: #1e293b   (기본 보더)
--border-focus: #06b6d4     (포커스 보더 — cyan)
--text-primary: #f1f5f9     (주요 텍스트)
--text-secondary: #94a3b8   (보조 텍스트)
--text-label: #cbd5e1       (라벨)
--accent-emerald: #10b981   (CTA 버튼, 완료 스텝)
--accent-cyan: #06b6d4      (아이콘, 포커스, 선택)
```

#### 6-3. Step 1 — Item Details 폼 (App.tsx 내)

- 폼 필드:
  - Photo*: dashed border 영역 → 클릭 시 파일 선택 → 로컬 프리뷰 (200px height, hover 오버레이 + 업로드 아이콘)
  - Title*: text input (required)
  - Description: textarea
  - Tags: TagInput 컴포넌트
  - Category: select dropdown (electronics, clothing, furniture, collectibles, sports, vehicles, books, other)
  - Condition: ChipSelector (New, Like New, Good, Fair, Poor)
- **필수값**: Photo + Title 둘 다 입력되어야 CTA 버튼 활성화
- **Submit per page**: 폼 작성 중에는 로컬 state만 변경, 서버 호출 없음
- "Next: Set Pricing →" 버튼 클릭 시:
  - title 비어있으면 인라인 에러 표시
  - `app.callServerTool({ name: "haggle_apply_patch", arguments: { draft_id, patch } })`
  - 응답 수신 후 Step 2로 전환
- CTA disabled 상태: slate-800 배경(#1e293b) + slate-600 텍스트(#475569) — opacity 아닌 색상으로 구분

#### 6-4. Step 2 — Pricing placeholder

- "Pricing will be available in Slice 2."
- StepIndicator에서 currentStep=2 표시

### 7. Environment & Build 검증 ✅

**`.env.example`** — 변경 없음 (위젯이 MCP 리소스이므로 `WIDGET_BASE_URL` 불필요)

**빌드 순서**:
```bash
pnpm build  # turbo가 의존 순서대로: shared → db → api (widget 포함) → web
```

**로컬 테스트**:
```bash
pnpm dev  # API 서버 시작 → MCP 서버 + 위젯 리소스 등록

# 다른 터미널에서 curl로 MCP 프로토콜 테스트
curl -s -D - -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "test", "version": "0.1.0" } } }'

# 응답 헤더에서 mcp-session-id 복사 후 tool 호출
```

---

## Slice 0 대비 의존성 변경

### 신규 의존성
```
apps/api (dependencies):     @modelcontextprotocol/ext-apps, react, react-dom
apps/api (devDependencies):  vite, @vitejs/plugin-react, vite-plugin-singlefile, @types/react, @types/react-dom
```

### 기존 의존성 (변경 없음)
```
apps/api:  @haggle/db (workspace:*) — 이미 존재했으나 미사용, Slice 1에서 실제 연결
apps/web:  변경 없음 (위젯이 apps/api로 이동했으므로)
```

---

## 파일 트리 (Slice 1 변경분)

```
haggle/
├── docs/
│   └── Slice_1_Implementation_Plan.md     (신규 — 이 문서)
│
├── packages/
│   ├── shared/src/
│   │   ├── types/listing.ts               (수정 — ListingDraft 추가)
│   │   └── index.ts                       (수정 — ListingDraft export 추가)
│   └── db/
│       ├── drizzle.config.ts              (수정 — schema 경로 변경)
│       └── src/schema/listing-drafts.ts   (수정 — brand/model 제거, 3개 컬럼 추가)
│
├── apps/api/
│   ├── package.json                       (수정 — vite, react, ext-apps 추가 + build:widget 스크립트)
│   ├── src/
│   │   ├── server.ts                      (수정 — DB 초기화)
│   │   ├── services/
│   │   │   └── draft.service.ts           (신규 — createDraft, getDraftById, patchDraft)
│   │   └── mcp/
│   │       ├── router.ts                  (수정 — db 파라미터 전달, registerResources 호출)
│   │       ├── resources.ts               (신규 — registerAppResource 위젯 HTML 등록)
│   │       └── tools/index.ts             (수정 — registerAppTool + structuredContent 반환)
│   └── widget/                            ★ 위젯 소스 (Vite singlefile 빌드)
│       ├── index.html                     (신규 — Vite entry HTML)
│       ├── vite.config.ts                 (신규 — Vite + react + singlefile 설정)
│       ├── tsconfig.json                  (신규 — widget 전용 TS 설정)
│       ├── src/
│       │   ├── main.tsx                   (신규 — React entry point)
│       │   ├── vite-env.d.ts              (신규 — Vite client 타입 선언)
│       │   ├── App.tsx                    (신규 — 위자드 메인 컴포넌트 ★핵심)
│       │   ├── styles.css                 (신규 — 다크 테마 CSS)
│       │   └── components/
│       │       ├── StepIndicator.tsx       (신규 — 스텝 인디케이터)
│       │       ├── TagInput.tsx            (신규 — 태그 칩 입력)
│       │       └── ChipSelector.tsx        (신규 — 조건 칩 선택)
│       └── dist/
│           └── index.html                 (빌드 결과물 — 단일 HTML, JS/CSS 인라인)
│
├── turbo.json                             (수정 — widget/dist/** output 추가)
└── Dockerfile.api                         (수정 — widget dist 빌드 검증 추가)
```

**요약: 신규 12개 파일 + 수정 7개 파일 = 총 19개 파일 작업**
(apps/web 변경 없음 — 위젯이 apps/api로 이동)

---

## 구현 순서 (의존성 기반)

```
Phase 1: Shared Types & Constants          ✅ 완료
   ↓
Phase 2: DB Schema Migration               ✅ 완료
   ↓
Phase 3: Service Layer                     ✅ 완료
   ↓
Phase 4: DB Connection Injection           ✅ 완료
   ↓
Phase 5: MCP Tools (registerAppTool)       ✅ 완료
   ↓
Phase 6: Widget Build Pipeline + UI        ✅ 완료 (디자인 리뷰 포함)
   ↓
Phase 7: MCP App Resource Registration     ✅ 완료
   ↓
Phase 8: Build & Local Verification        ✅ 완료
```

---

## 에러 처리 전략

| 레이어 | 패턴 | 예시 |
|--------|------|------|
| Service Layer | null 반환 (not found) | `getDraftById` → null |
| MCP Tools | `{ isError: true, content: [...] }` | draft 미존재 시 |
| Widget UI | 인라인 에러 + console.error | callServerTool 실패 시 non-blocking |

---

## 검증 체크리스트

### MCP Tool 검증 (curl 로컬 테스트)
1. ✅ `haggle_ping` → `{ status: "ok" }` 반환
2. ✅ `haggle_start_draft` → DB에 row 생성 + `structuredContent`로 draft 반환
3. ✅ `haggle_apply_patch` → 필드 업데이트 + `structuredContent`로 업데이트된 draft 반환
4. ✅ `haggle_get_draft` → 현재 draft 상태 반환
5. ✅ MCP Resource 등록 확인 (서버 기동 시 HTML 로드 성공)

### Widget UI 검증 (file:// 로컬 프리뷰)
6. ✅ Step indicator — "① Item Details" active (cyan), "② Pricing" upcoming (gray)
7. ✅ Photo 영역 — 클릭 → 파일 선택 → 프리뷰 표시 (200px, dashed border, hover 오버레이)
8. ✅ Title 입력 — placeholder, 포커스 시 cyan 보더
9. ✅ Description textarea — 리사이즈 가능
10. ✅ Tags — +New 토글, Enter/쉼표 추가, Backspace/× 삭제
11. ✅ Category — select dropdown (8개 옵션)
12. ✅ Condition — 칩 선택 (cyan border + text), hover (subtle gray)
13. ✅ CTA 버튼 disabled 상태 — slate-800 배경 + slate-600 텍스트
14. ✅ CTA 버튼 enabled 상태 — emerald 배경 + white 텍스트

### 빌드 검증
15. ✅ `pnpm build` 전체 빌드 성공 (widget 빌드 + TypeScript 에러 없음)
16. ✅ `widget/dist/index.html` 생성 확인 (단일 HTML, JS/CSS 인라인)

### ChatGPT 통합 검증 (Railway 배포 후)
17. ⬜ ChatGPT에서 `haggle_start_draft` 호출 → iframe에 위젯 렌더
18. ⬜ `structuredContent`에서 받은 draft 데이터로 폼 초기화
19. ⬜ Title 입력 + "Next" 클릭 → `callServerTool`로 patch 성공 → Step 2 전환
20. ⬜ ChatGPT 대화에서 자동채우기 → 위젯 폼에 반영

---

## Slice 1 완료 후 상태

| 구분 | Slice 0 | Slice 1 이후 |
|------|---------|-------------|
| **shared** | 타입, 상수, 유틸 | + ListingDraft 인터페이스 |
| **db** | listing_drafts 스키마 (brand/model) | 스키마 업데이트 (tags/photo_url/selling_deadline) |
| **api** | MCP ping + start_draft 스텁 | 실제 DB 연동 4개 tool + App Resource 위젯 등록 |
| **api/widget** | 없음 | React 위젯 (Vite singlefile) — Step 1 + Step 2 placeholder |
| **web** | placeholder 페이지 | 변경 없음 (위젯이 api로 이동) |

### 다음 Slice (Slice 2) 에서 할 일
- 위자드 Step 2 (Pricing) 실제 구현
- Asking Price, Minimum Price, Selling Deadline 폼
- 사진 클라우드 업로드 (Cloudflare R2)
- 대화 자동 채우기 (채팅 → `apply_patch` → 위젯이 tool result로 업데이트 수신)
