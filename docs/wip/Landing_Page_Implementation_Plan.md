# Landing Page Implementation Plan

> **목표**: `tryhaggle.ai` 도메인에 Haggle 랜딩페이지를 배포한다. 웹 앱은 `app.tryhaggle.ai` 서브도메인으로 분리한다.
>
> **방식**: monorepo 안에 `apps/landing` 신규 Next.js 앱을 추가하고, `apps/web` 과 별도 Vercel 프로젝트로 배포한다.
>
> **작성일**: 2026-05-26
> **상태**: WIP

---

## 1. 결정 사항 요약

### 1.1 아키텍처 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 앱 분리 방식 | **별도 앱** (`apps/landing` + `apps/web`) | 번들/배포 주기 분리, 마케팅 페이지의 SEO/성능 최적화 독립 |
| 도메인 구조 | `tryhaggle.ai` = landing, `app.tryhaggle.ai` = web | 명확한 역할 분리, 서브도메인 표준 패턴 |
| 인증 공유 | **Pattern A** — 공유 안 함 | 랜딩은 "로그인" 버튼 → `app.tryhaggle.ai/login` 단순 이동. 보안 면적 최소화. 필요 시 Pattern B 로 전환 가능 |
| 로컬 환경 | **로컬에서도 분리** | 도메인 간 링크/배포 환경 차이 버그 방지 |

### 1.2 기술 스택 결정

| 항목 | 값 | 비고 |
|------|-----|------|
| 프레임워크 | **Next.js 15.1.0** | `apps/web` 와 동일 버전 핀 |
| React | **19.0.0** | `apps/web` 와 동일 |
| 라우터 | **App Router** (`src/app/`) | `apps/web` 패턴 |
| 언어 | **TypeScript strict** | `tsconfig.base.json` extends |
| 스타일링 | **Tailwind v4** (`@import "tailwindcss"` + `@theme`) | `apps/web` 와 동일. `tailwind.config.ts` 파일 없음 |
| 폰트 | **`next/font/google`** | Lora / Plus Jakarta Sans / IBM Plex Mono 셀프호스팅 |
| 테스트 | **Vitest** (jsdom + globals) | `apps/web` 와 동일. 랜딩 MVP 에는 테스트 거의 없음 |
| 컴포넌트 구조 | **섹션별 분리** (`components/sections/*`) | Topbar, Hero, HowItWorks, Comparison, FAQ, FinalCTA, Footer |
| 애니메이션 포팅 방식 | **vanilla JS → `useEffect`** | 기존 HTML 의 setTimeout/classList 로직 그대로 이동. React state 로 재작성 안 함 |
| Confetti | **`canvas-confetti` npm** + `@types/canvas-confetti` | CDN 대신 npm 패키지 |
| 빌드 출력 | `output: "standalone"` | `apps/web` 와 동일 |
| 로컬 포트 | **3001** | web=3000 과 충돌 회피 |
| 배포 | **Vercel 별도 프로젝트** | landing / web 각각 |
| ESLint/Prettier | **설정 안 함** | 팀 전체가 미설정 — 일관성 유지 |

### 1.3 워크플로우

- **3man Team (Arch/Bob/Richard) 미사용** — 본 작업은 도메인 코어 로직이 없고 디자인 결정이 완료된 상태라 오버킬.
- **본 md 문서가 단일 계획서.** Phase 별 vertical slice 로 진행.
- **사용자 (Jongwoo) 가 manual 로 처리할 부분**:
  - `pnpm install` 실행
  - `pnpm dev` 로 로컬 확인
  - Vercel 프로젝트 생성 + 환경변수 입력
  - DNS 레코드 등록 (도메인 등록처)
- **나머지 (스캐폴딩, 컴포넌트 작성, 애니메이션 포팅, 환경변수 정의)** 는 에이전트가 작성.

---

## 2. 최종 디렉토리 구조 (목표 상태)

```
haggle/
├── apps/
│   ├── api/
│   ├── web/                              # 기존 (수정 없음)
│   └── landing/                          # ★ 신규
│       ├── public/
│       │   └── favicon.ico
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx            # 폰트 + 메타데이터 + globals.css import
│       │   │   ├── page.tsx              # 섹션 컴포넌트 조합 (얇음)
│       │   │   ├── globals.css           # @import "tailwindcss" + @theme + 전역 keyframes
│       │   │   └── favicon.ico
│       │   ├── components/
│       │   │   ├── sections/
│       │   │   │   ├── Topbar.tsx
│       │   │   │   ├── Hero.tsx
│       │   │   │   ├── HowItWorks.tsx    # 3 step zigzag wrapper
│       │   │   │   ├── Comparison.tsx
│       │   │   │   ├── Faq.tsx
│       │   │   │   ├── FinalCta.tsx
│       │   │   │   └── Footer.tsx
│       │   │   ├── viz/
│       │   │   │   ├── RadarPanel.tsx    # Step 01 viz (radar + chat/settings panel)
│       │   │   │   ├── ChatPanel.tsx     # Step 02 viz (agent chat + confetti)
│       │   │   │   ├── Timeline.tsx      # Step 03 viz (progress timeline)
│       │   │   │   └── ListingCard.tsx   # Hero masonry card
│       │   │   └── ui/
│       │   │       └── AgentIcon.tsx     # 5 mascot SVG renderer
│       │   ├── lib/
│       │   │   ├── data/
│       │   │   │   ├── listings.ts       # LISTINGS array
│       │   │   │   ├── agents.ts         # AGENTS mascot SVGs
│       │   │   │   ├── icons.ts          # ICONS product SVGs
│       │   │   │   └── faq.ts            # FAQ Q&A
│       │   │   └── env.ts                # NEXT_PUBLIC_APP_URL 등
│       │   └── hooks/
│       │       └── useScrollSpy.ts       # 네비 active 상태 IntersectionObserver
│       ├── next.config.ts
│       ├── postcss.config.mjs
│       ├── tsconfig.json
│       ├── package.json
│       ├── .env.local.example
│       └── README.md
├── packages/ ...                         # 변경 없음
├── pnpm-workspace.yaml                   # 변경 없음 (apps/* 이미 포함)
├── turbo.json                            # 변경 없음 (자동 감지)
└── ...
```

### 2.1 명명 규칙

- 파일명: 컴포넌트는 `PascalCase.tsx`, 유틸/데이터/훅은 `camelCase.ts`
- 경로 alias: `@/*` → `./src/*` (apps/web 과 동일)
- 데이터는 `lib/data/` 에 집중. 컴포넌트는 데이터를 import 만 함 (인라인 X)

---

## 3. Phase 분해 (Vertical Slice)

각 Phase 가 끝났을 때 "**눈에 보이는 결과물**" 이 무엇인지 명확히 한다. Phase 간 의존 관계는 위 → 아래.

---

### Phase 1 · 빈 Next.js 앱 띄우기

**목표**: `localhost:3001` 에 "Haggle Landing — coming soon" 같은 한 줄이 뜬다. Tailwind 동작 확인.

**작업 내역**:
1. `apps/landing/` 디렉토리 생성
2. `package.json` 작성 (web 의 deps 미러링, 단 web3/supabase/amplitude 등 불필요한 거 제외)
3. `tsconfig.json` (base extends, paths)
4. `next.config.ts` (`output: "standalone"`, transpilePackages 비움)
5. `postcss.config.mjs` (@tailwindcss/postcss)
6. `src/app/globals.css` — `@import "tailwindcss";` 한 줄만
7. `src/app/layout.tsx` — 최소 HTML 골격
8. `src/app/page.tsx` — `<h1 className="text-3xl">Haggle Landing</h1>`
9. `.gitignore`, `next-env.d.ts`

**사용자가 manual 로 할 일**:
- `pnpm install` (루트에서)
- `pnpm --filter @haggle/landing dev` 또는 `cd apps/landing && pnpm dev`
- 브라우저에서 `http://localhost:3001` 열어서 Tailwind 클래스 적용 확인

**완료 조건**:
- [x] `localhost:3001` 에서 페이지가 뜬다
- [x] `text-3xl` 같은 Tailwind 유틸 클래스가 작동한다
- [x] `pnpm --filter @haggle/landing typecheck` 통과
- [x] `pnpm --filter @haggle/landing build` 성공 (First Load JS 102kB)
- [x] `pnpm --filter @haggle/web dev` 도 여전히 정상 작동 (포트 충돌 없음)

**전제조건**: 없음 (시작점)

**메모**: 로컬 Node 가 v20.18.0 인데 루트 engines 는 ≥22 요구 → Vercel 빌드(Phase 6) 전에 `nvm use 22` 로 맞춰야 함.

---

### Phase 2 · 디자인 토큰 + 폰트 + Topbar + Hero (정적)

**목표**: 페이지 상단 1 화면 (Topbar + Hero) 이 디자인대로 보인다. 단, masonry 자동 스크롤 애니메이션은 아직 없음 (정적 그리드).

**작업 내역**:
1. `globals.css` 에 `@theme` 블록으로 디자인 토큰 이전:
   - Navy 50–900, Gold 50–700, Surface, Neutral, Semantic 색상
   - 그라데이션은 CSS 변수로
2. `next/font/google` 에 Lora / Plus Jakarta Sans / IBM Plex Mono 등록 → `layout.tsx` 에서 `<html>` 에 적용
3. `lib/data/listings.ts`, `lib/data/agents.ts`, `lib/data/icons.ts` 작성 (HTML 의 데이터 그대로 이전)
4. `components/ui/AgentIcon.tsx`, `components/viz/ListingCard.tsx` 작성
5. `components/sections/Topbar.tsx` — sticky, backdrop-blur, nav links (anchor)
6. `components/sections/Hero.tsx` — grid 2 col, 좌측 masonry (정적 — `col-track` 에 카드 펼침), 우측 카피+CTA
7. `app/page.tsx` 에서 Topbar + Hero 조합
8. SEO 메타데이터 (`layout.tsx` 에 `metadata` export)

**사용자가 manual 로 할 일**:
- 로컬에서 새로고침해서 시각적으로 확인
- 모바일 viewport 도 확인 (반응형 깨짐 여부)

**완료 조건**:
- [x] Topbar (로고, 네비, Sign in 버튼) 가 디자인과 동일
- [x] Hero 좌측에 listing 카드들이 3 컬럼으로 보임 (정적 OK)
- [x] Hero 우측 카피, "Get Started" CTA 가 디자인과 동일
- [x] 폰트가 Lora (heading), Plus Jakarta (body), IBM Plex Mono (mono) 로 적용
- [x] 색상 토큰 (gold, navy) 가 정확히 일치
- [x] 모바일 (≤640px) 에서 1 컬럼 + 적절히 리플로우

**전제조건**: Phase 1 완료

**메모**:
- CTA 화살표는 폰트 글리프 (`→`) baseline 정렬 문제로 inline SVG 로 통일 (Topbar Sign in, Hero Get Started 모두). 이후 CTA 들도 같은 패턴 사용.
- Tailwind 진단이 임의값 (`h-[68px]`, `max-w-[1280px]`, `backdrop-saturate-[140%]`) 의 canonical 변환 (`h-17`, `max-w-7xl`, `backdrop-saturate-140`) 제안. Phase 4 종료 후 일괄 sweep 으로 처리 예정.
- 디자인 fidelity: HTML 마크업에 없는 요소는 추가 안 함 (예: CSS 에만 정의된 logo dot 제거).

---

### Phase 3 · HowItWorks 3 Steps (정적)

**목표**: How it works 섹션의 3 step zigzag 가 마크업만 완성. viz 영역은 placeholder 또는 정적 SVG (애니메이션 없음).

**작업 내역**:
1. `components/sections/HowItWorks.tsx` — head + 3 step row wrapper
2. `components/viz/RadarPanel.tsx` — 정적 radar SVG + chat panel + settings panel 마크업 (전환 애니메이션 X, chat 만 표시)
3. `components/viz/ChatPanel.tsx` — 4개 메시지 정적 표시 + DEAL banner 정적
4. `components/viz/Timeline.tsx` — 4 stage 마커 + progress bar 정적
5. zigzag 레이아웃 (Step 01/03: text-left, Step 02: text-right)
6. tinted 배경 (Step 01, 03) vs 투명 (Step 02)

**완료 조건**:
- [x] 3 step 섹션이 디자인대로 zigzag 로 보임
- [x] 각 viz 가 정적이지만 모양은 최종 결과물과 일치
- [x] 반응형: 모바일에서 항상 text 위, viz 아래

**전제조건**: Phase 2 완료

**메모**:
- Step 02 reverse 초기 구현 시 `order-*` 클래스로 swap 시도했으나 의도와 반대로 동작. JSX 작성 순서 = 좌→우 배치 패턴으로 단순화 (mobile 에서는 `max-lg:order-*` 로 text 우선).
- Step 01 의 settings panel 은 Phase 3 에서 미렌더 (chat 만 표시). Phase 5 에서 panel 전환 로직 추가.
- Step 03 summary ("$785 · released") 는 `opacity-0` 로 숨김 (마지막 stage 완료 시 등장 — Phase 5 에서 활성화).

---

### Phase 4 · Comparison Table + FAQ + Final CTA + Footer (정적)

**목표**: 페이지 전체 마크업 완성. Comparison table 의 가격 선택, FAQ 의 아코디언 토글 인터랙션 동작.

**작업 내역**:
1. `components/sections/Comparison.tsx`:
   - Price preset 버튼 ($100/$500/$1000/$2000)
   - 4 columns (Poshmark, eBay, StockX, Haggle)
   - 가격 선택 시 React state 로 계산 (vanilla JS 그대로 옮기지 말고 React state 로 — 단순함)
   - Footnote + sources + savings
2. `lib/data/faq.ts` — Q&A array
3. `components/sections/Faq.tsx`:
   - Accordion (단일 open, click 토글)
   - React state (`openIndex`) 로 관리
   - chevron rotation
4. `components/sections/FinalCta.tsx` — Navy gradient + grid bg + CTA buttons
5. `components/sections/Footer.tsx` — wordmark + columns + socials + 거대 wordmark 데코
6. `app/page.tsx` 최종 조합

**완료 조건**:
- [x] 페이지 끝까지 스크롤 가능, 모든 섹션 보임
- [x] Comparison: 가격 버튼 클릭 시 숫자 즉시 업데이트
- [x] FAQ: 클릭 시 아코디언 부드럽게 열림/닫힘
- [x] Footer 소셜 아이콘 hover 효과
- [x] 모바일에서 모든 섹션 정상 reflow

**전제조건**: Phase 3 완료

**메모**:
- `apps/landing/package.json` 의 `test`/`test:watch` 스크립트 제거 — vitest 가 devDeps 에 없는데 스크립트만 있어 CI `pnpm test` 가 실패. 랜딩 MVP 에 테스트 surface 없음.
- `lib/data/faq.ts` 는 JSX 를 포함해 `.tsx` 로 작성 (`faq.tsx`).
- Comparison 테이블 모바일 반응형: 처음엔 행 분해 시도 → 깨짐. label 컬럼 폭 축소 (180→52px), cents 모바일 숨김, "You keep $X" CTA 가 모바일에선 테이블 바로 밑으로 이동 (sources 위). label 도 "Lost to fees" → "Lost", "You receive" → "Get" 으로 축약.
- Comparison row 정렬 문제: 초기 "label column + 4 platform column" 구조에서 row 높이 불균형 발생. flat 5×4 grid 로 리팩 — 모든 셀이 grid 의 직접 자식이라 row 정렬 자동 보장. Haggle 컬럼 navy 배경/골드 strip 은 absolute overlay 로 처리.
- 데스크탑 폰트 강조: 셀 폰트 16→19px, You receive 24→30px, "You keep $X" 15→20px (가격은 26px) 로 키워 비교 메시지 강조.
- Tailwind canonical 진단 (`max-md:min-h-[52px]` → `min-h-13` 등) 누적 중. Phase 4 종료 후 일괄 sweep 예정 — 다음 작업으로 진행.

---

### Phase 5 · 애니메이션 포팅

**목표**: 모든 자동 애니메이션이 디자인 HTML 과 동일하게 동작.

**작업 내역** (각 viz 별로 useEffect 안에 vanilla JS 로직 이식):

1. **Hero masonry** (`Hero.tsx` 또는 `MasonryFeed.tsx`):
   - CSS keyframes (`scrollUp`) + 3 컬럼 다른 속도/딜레이
   - 카드 배열 2회 복제 (seamless loop)
   - hover 시 pause
   - `prefers-reduced-motion` 처리

2. **Step 01 RadarPanel**:
   - `STATES` (initial / afterChat / afterSettings) 보간 애니메이션
   - 9 초 주기 cycle (chat 표시 → 응답 → settings 패널 전환 → 슬라이더 조정)
   - chat bubble 타이핑 → 답변 페이드 전환 (CSS animation-delay 그대로)

3. **Step 02 ChatPanel**:
   - 4 메시지 timeline (appear/reveal 시점 배열)
   - typing → text 전환
   - 5.5 초 시점에 panel dim + banner 등장 + confetti 발사 (3 burst)
   - `canvas-confetti` 인스턴스를 scoped canvas 에 생성
   - 10 초 주기 reset + replay

4. **Step 03 Timeline**:
   - 4 stage 순차 active → done
   - bar fill width 0% → 33% → 66% → 100%
   - 마지막에 summary 등장
   - 8.5 초 주기

5. **FAQ accordion** — 이미 Phase 4 에서 완료

6. **Comparison table** — 이미 Phase 4 에서 완료

7. **Scroll-spy** (`hooks/useScrollSpy.ts`):
   - IntersectionObserver 로 active section 추적
   - Topbar 의 nav link 에 `is-active` 클래스

**구현 가이드라인**:
- 모든 setInterval/setTimeout 은 useEffect cleanup 에서 clear
- DOM 직접 조작 (`document.querySelector`) 대신 `useRef` 사용
- `prefers-reduced-motion` 미디어쿼리 존중

**완료 조건**:
- [ ] Hero masonry 가 무한 스크롤
- [ ] Radar polygon 이 morph 하며 panel 이 chat ↔ settings 전환
- [ ] Step 02 채팅 4 턴 → DEAL banner + confetti
- [ ] Step 03 timeline 4 단계 순차 진행 + summary
- [ ] Topbar 네비가 스크롤 위치에 따라 active highlight
- [ ] `prefers-reduced-motion: reduce` 시 애니메이션 정지
- [ ] 페이지 idle CPU 가 합리적 (브라우저 탭 백그라운드 시 부하 X — 가능하면 IntersectionObserver 로 viewport 진입 시만 실행)

**전제조건**: Phase 4 완료

---

### Phase 6 · Vercel 배포 (landing) + 도메인 연결

**목표**: `https://tryhaggle.ai` 에 실제 랜딩페이지 라이브.

**작업 내역**:
1. (코드) `apps/landing/README.md` 에 로컬 실행 + 배포 가이드
2. (코드) `.env.local.example` 에 `NEXT_PUBLIC_APP_URL=https://app.tryhaggle.ai` 정의

**사용자가 manual 로 할 일**:
1. Vercel 에서 새 프로젝트 생성:
   - Repository 연결
   - **Root Directory**: `apps/landing`
   - **Framework Preset**: Next.js
   - **Build Command**: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @haggle/landing build`
   - **Output Directory**: `apps/landing/.next` (자동 감지)
   - **Install Command**: `pnpm install` (이미 build 에서 처리하면 비워도 됨)
   - **환경변수**: `NEXT_PUBLIC_APP_URL=https://app.tryhaggle.ai`
2. 도메인 연결:
   - Vercel Project → Settings → Domains → `tryhaggle.ai` 추가
   - 도메인 등록처 (Cloudflare/Namecheap/GoDaddy 등) 에서:
     - `tryhaggle.ai` A 레코드 → `76.76.21.21` (Vercel)
     - 또는 nameserver 를 Vercel/Cloudflare 로 위임
3. 배포 후 `https://tryhaggle.ai` 접속 확인
4. SSL 인증서 자동 발급 대기 (보통 수 분)

**완료 조건**:
- [ ] `https://tryhaggle.ai` 가 HTTPS 로 정상 로드
- [ ] Lighthouse Performance ≥ 90 (모바일)
- [ ] SEO 메타데이터 확인 (Open Graph, Twitter card)

**전제조건**: Phase 5 완료

---

### Phase 7 · `apps/web` 을 `app.tryhaggle.ai` 로 분리

**목표**: `https://app.tryhaggle.ai` 가 웹 앱을 가리킨다.

**작업 내역**:
1. (코드) `apps/web/.env.local.example` 에 `NEXT_PUBLIC_LANDING_URL=https://tryhaggle.ai` 추가
2. (코드 — 선택) `apps/web` 내부에서 "← Back to homepage" 같은 링크가 landing URL 을 가리키도록

**사용자가 manual 로 할 일**:
1. Vercel 에 `apps/web` 용 **별도 프로젝트** 생성 (Root Directory: `apps/web`)
   - 이미 web 이 배포되어 있다면 그 프로젝트 활용
2. 도메인 연결:
   - Vercel Project → Settings → Domains → `app.tryhaggle.ai` 추가
   - DNS: `app.tryhaggle.ai` CNAME → `cname.vercel-dns.com`
3. 환경변수 정리 (web 의 기존 환경변수 + `NEXT_PUBLIC_LANDING_URL`)

**완료 조건**:
- [ ] `https://app.tryhaggle.ai` 가 웹 앱 로드
- [ ] 두 도메인이 독립적으로 동작
- [ ] 랜딩페이지의 "Sign in" 버튼이 `https://app.tryhaggle.ai/login` 으로 이동

**전제조건**: Phase 6 완료

---

## 4. 환경변수 (Cross-Domain Links)

| 변수 | 값 (prod) | 값 (로컬) | 사용처 |
|------|-----------|-----------|--------|
| `NEXT_PUBLIC_APP_URL` | `https://app.tryhaggle.ai` | `http://localhost:3000` | landing → web 링크 |
| `NEXT_PUBLIC_LANDING_URL` | `https://tryhaggle.ai` | `http://localhost:3001` | web → landing 링크 |

로컬 개발 시 `.env.local` 에 위 값 설정. 두 앱 모두 동시에 띄울 수 있음 (`pnpm dev` from root → turbo 가 병렬 실행).

---

## 5. 위험 & 의사결정 노트

### 5.1 Tailwind v4 ↔ HTML 의 CSS 변수 변환
HTML 의 CSS 변수 (`--navy-500: #1B2A4A` 등) 가 Tailwind v4 의 `@theme` 블록과 자연스럽게 매핑됨. `--navy-500` → `--color-navy-500` 로 prefix 만 추가하면 `bg-navy-500` 같은 유틸 자동 생성. 별도 config 파일 불필요.

### 5.2 canvas-confetti 의 useWorker 옵션
원본은 `useWorker: true` 사용. Next.js SSR 환경에서 worker 생성 타이밍 이슈 가능 — `useEffect` 안에서만 인스턴스 생성하면 안전.

### 5.3 SVG 인라인 vs 컴포넌트
mascot SVG (5종), product icon (15종) 가 많음. 옵션:
- (선택됨) 데이터 객체에 SVG 문자열 보관 → `dangerouslySetInnerHTML` 로 렌더 (원본 HTML 방식)
- (대안) 각각을 React 컴포넌트로 — 보일러플레이트 많음

원본 방식 유지. XSS 위험 없음 (정적 데이터).

### 5.4 애니메이션 성능
모든 viz 가 `setInterval` 로 무한 루프. 페이지 idle 시 CPU 낭비.
→ **개선안 (Phase 5 후반)**: IntersectionObserver 로 viewport 진입 시에만 cycle 실행.

### 5.5 인증 공유 (미래)
Pattern A 로 시작. 나중에 Pattern B 필요 시:
- Supabase auth 쿠키 도메인을 `.tryhaggle.ai` 로 변경
- 랜딩페이지에 Supabase client 추가
- 헤더에서 세션 체크 → 로그인 상태에 따라 다른 버튼 표시

---

## 6. 작업 시작 전 확인 (Pre-Flight Checklist)

- [x] `apps/web` 가 main 브랜치에서 정상 빌드되는지 확인
- [x] 브랜치 생성: `feat/landing-page`
- [x] `docs/wip/Landing_Page_Implementation_Plan.md` (본 문서) 커밋
- [x] Phase 1 부터 시작

---

## 7. 진행 로그

| 날짜 | Phase | 상태 | 비고 |
|------|-------|------|------|
| 2026-05-26 | Plan | ✅ Drafted | 초안 작성 |
| 2026-05-26 | Phase 1 | ✅ Done | 스캐폴딩 완료. localhost:3001 동작, typecheck/build 통과, web 과 동시 실행 검증. 커밋 완료 |
| 2026-05-26 | Phase 2 | ✅ Done | 디자인 토큰 + 폰트 + Topbar + Hero (정적). 시각적 검증 + 모바일 반응형 확인. CTA 화살표는 SVG 로 통일. masonry 자동 스크롤은 Phase 5 |
| 2026-05-26 | Phase 3 | ✅ Done | HowItWorks 3 step zigzag (정적). RadarPanel / ChatPanel / Timeline viz 마크업 완성. Step 02 reverse 레이아웃 fix. 애니메이션은 Phase 5 |
| 2026-05-26 | Phase 4 | ✅ Done | Comparison + FAQ + FinalCTA + Footer. CI fix (test 스크립트 제거). Comparison 모바일 반응형 + flat grid 리팩으로 row 정렬 안정화. 데스크탑 폰트 강조. FAQ 아코디언 동작 검증 |
