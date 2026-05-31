# 환경 분리 플레이북 (Environment Separation Playbook)

> **목적:** `app.tryhaggle.ai`에 MVP를 배포하면서, **3단계 환경(Local · Staging · Production)**을
> 물리적으로 분리해 ① 4인 개발팀의 동시작업 충돌, ② 결제·배송·온체인 통합 리허설,
> ③ 실데이터 오염을 모두 구조적으로 차단한다.
>
> **상태:** WIP — 청사진 합의 완료, 셋업 진행 대기. 단계별 ✅ 후 `docs/` 승격 또는 삭제.
> **작성일:** 2026-05-30

---

## 0. 결정 요약 (합의됨)

| 결정 | 값 | 근거 |
|------|-----|------|
| **환경 단계 수** | **3단계** (Local + Staging + Production) | 개발자 4명(동시배포 충돌) + 결제·배송·온체인 통합 리허설 필요 → staging 트리거 충족 |
| **로컬 DB 격리** | **개발자별 Supabase CLI 로컬 스택** (`supabase start`) | Auth·Storage·pgvector를 Supabase에 의존 → 순수 로컬 Postgres 불가. CLI 스택이 풀 격리 + 무료 + 오프라인 |
| **Staging 외부서비스** | **real 코드경로 + test 자산** | Stripe test·EasyPost test·x402 base-sepolia. 진짜 통합 버그를 잡되 실제 돈·메일은 안 나감 |
| **Web 호스팅** | **Vercel** (landing과 동일) | Next.js 궁합·프리뷰·환경변수 관리 |
| **API 호스팅** | **Railway** | Dockerfile·railway.toml 이미 존재 |
| **Staging DB 플랜** | **Supabase Free** | prod와 합쳐 Free 2프로젝트 한도 활용 → staging DB 비용 $0 |
| **prod 유료화 타이밍** | **Soft Launch** (첫 사용자 직전 ON) | 셋업 기간 ≈$5, 실사용자 시점에 Vercel/Supabase Pro 전환 (§10) |
| **예상 비용** | 셋업기 **≈$5** → 런치 후 **≈$50/월** | 환경 3개여도 곱하기 3 아님 (§10) |

---

## 1. 왜 3단계인가

| 트리거 | 우리 상황 | 충족 |
|--------|----------|------|
| 팀 규모 증가 → 동시 배포 충돌 | **개발자 4명** | ✅ |
| "틀리면 돈 나가는" 플로우(결제·배송·온체인) 리허설 | **곧 통합 예정** | ✅ |
| 유료 사용자 → 다운타임 실손해 | 런치 임박 | 🔶 임박 |

3개 트리거 중 2개 충족 → staging은 "나중"이 아니라 **지금 1급 시민**으로 셋업.

**역할 분담:**
- **Local** = 각 개발자가 자기 노트북에서 완전 격리된 풀스택(`supabase start`)으로 개발
- **Staging** = 4명의 작업을 합쳐 prod 가기 전 검증하는 **공동 통합 지점** (결제·배송 리허설의 집)
- **Production** = 실사용자. 오직 검증된 것만 도달

```
개발자 로컬 ×4 (각자 격리)  ──►  Staging (공동 통합·리허설)  ──►  Production (실사용자)
   supabase start                staging.app...               app.tryhaggle.ai
   완전 격리                       real코드+test자산              real 자산
```

---

## 2. 환경별 자원 매트릭스

| 자원 | LOCAL (개발자별) | STAGING (신규) | PRODUCTION (신규) |
|------|-----------------|----------------|-------------------|
| **DB/Auth/Storage** | `supabase start` 로컬 스택 (각자) | Supabase `haggle-staging` **(Free)** 🔴 | Supabase `haggle-prod` **(Pro)** 🔴 |
| **현재 클라우드 프로젝트** | (해당없음) | — | — |
| `NODE_ENV` | development | production* | production |
| **API** | localhost:3001 | Railway → `api.staging.tryhaggle.ai` 🔴 | Railway → `api.tryhaggle.ai` 🔴 |
| **Web** | localhost:3000 | Vercel → `app.staging.tryhaggle.ai` 🔴 | Vercel → `app.tryhaggle.ai` 🔴 |
| **Landing** | localhost:3002** | — | `tryhaggle.ai` (배포완료) |
| `ENABLE_CRON` | false | true (1 인스턴스) | true (1 인스턴스) |
| **외부 서비스** | mock | **real 코드경로 + test 자산** | real + live 자산 |
| **배포 브랜치** | (로컬) | `staging` 브랜치 | `main` 브랜치 |

> \* staging도 `NODE_ENV=production`으로 둬야 runtime.ts의 prod 검증(JWT_SECRET 등)·실제 코드경로가 켜짐. 환경 구분은 별도 플래그(`HAGGLE_ENV=staging`)로.
> \*\* landing dev 포트 3001→3002 변경 필요 (api와 충돌, §7-E)

> **기존 클라우드 Supabase(`gdmhbrcqhwinafntrjhb`)는?** 지금까지 "공유 dev"로 쓰던 것.
> DB 점검(2026-05-30) 결과 **실사용자·실거래 0, 전부 재생성 가능한 테스트/시드 데이터** →
> **폐기 확정.** staging은 백지에서 신규 생성. (§9 R5)

---

## 3. 외부 서비스 키 — 3환경 분리표

> **3가지 모드:** Local=`mock` · Staging=`real코드 + test자산` · Prod=`real + live자산`

| 서비스 | LOCAL | STAGING | PRODUCTION | 토글 |
|--------|-------|---------|------------|------|
| Supabase | 로컬 스택 | staging 프로젝트 | prod 프로젝트 | — |
| Stripe | `mock` | **test 키** + staging webhook | live 키 + prod webhook | `STRIPE_MODE` |
| x402 (CDP) | `mock` | `real` + **base-sepolia** | `real` + **base mainnet** | `HAGGLE_X402_MODE`, `HAGGLE_X402_NETWORK` |
| EasyPost | `mock` | **test 키** | prod 키 | `EASYPOST_API_KEY` |
| Resend | NODE_ENV 가드 미발송 | test 도메인 | 인증된 prod 도메인 | `RESEND_API_KEY` |
| xAI(Grok) | `rule` (LLM off) | `staged` (리허설) | `staged` | `NEGOTIATION_ENGINE` |
| OpenAI/Replicate/LegitApp | dev 키 | test/dev 키 | prod 키 | 각 API 키 |

> ⚠️ **온체인·결제 prod 전환은 staging 리허설 완료 후 마지막에.** staging에서 base-sepolia로
> 전체 결제·정산 플로우를 끝까지 통과시킨 뒤에만 mainnet으로. (CLAUDE.md: "안전 > 편리")

---

## 4. 로컬 개발 환경 — Supabase CLI 스택 (개발자별)

각 개발자가 자기 노트북에서 풀 Supabase를 Docker로 실행 → **완전 격리**.

**현재 상태 (2026-05-31 완료):** `supabase/config.toml`·`Makefile`·`README.md` 생성, 마이그레이션 누락 보완, seed 스크립트 버그 수정 → **Slice 0 검증 통과** ✅

### 4.1 1회 셋업 (팀 공통 — 완료 ✅)
- [x] 🟢 `supabase/config.toml` 생성 (pgvector·Auth·Google OAuth·Inbucket. CLI 마이그레이션 비활성 — Drizzle 단일 소스)
- [x] 🟢 `supabase/init-extensions.sql` — `make migrate` 전 `CREATE EXTENSION vector` 보장 (0002 마이그레이션 버그 우회)
- [x] 🟢 `Makefile` — `make setup`/`dev`/`migrate`/`seed`/`reset`/`stop`
- [x] 🟢 `packages/db/drizzle/0024_missing_tables.sql` — `db:push`로만 존재하던 누락 테이블/컬럼 보완 (`buyer_listings`·`negotiation_*`·`trust_*` 등)
- [x] 🟢 seed 스크립트 4개 `process.exit(0)` 추가 (완료 후 hang 수정)
- [x] 🟢 `README.md` — 온보딩·Docker 격리·트러블슈팅·기존 dev 전환 가이드

### 4.2 개발자별 (각자 1회)
- [ ] 🔴 Supabase CLI 설치 (`brew install supabase/tap/supabase`)
- [ ] 🔴 Docker Desktop 실행
- [ ] 🔴 `supabase start` → 로컬 Auth/Storage/Postgres/pgvector 기동
- [ ] 🔴 출력된 로컬 anon key·service key·DB URL을 자기 `.env`/`.env.local`에 기입

> **장점:** 각자 스키마 변경·시드를 마음껏 해도 남을 안 깨뜨림. PR 머지 후 `supabase db reset`으로 동기화.

### 4.3 Docker 격리 (기존 Docker 사용자 영향 없음)
Supabase 로컬 스택은 `project_id`(=`haggle`) 네임스페이스의 **자기 컨테이너만** 관리.
회사/개인의 다른 Docker 컨테이너·다른 Supabase 프로젝트와 **컨테이너 레벨 격리** ✅.
유일한 주의는 **포트** — 고정 포트(54321 API, 54322 DB, 54323 Studio, 54324 메일) 점유.
DB는 `5432`가 아닌 `54322`라 로컬 Postgres와 비충돌. 충돌 시 `supabase status` 확인 →
config.toml 포트 변경. (상세: README "Docker 격리")

### 4.4 온보딩 — 살아있는 문서로 유지
신규/기존 개발자 전환 과정에서 막힌 지점·해결법을 **README 트러블슈팅 섹션에 계속 축적**.
Slice 0 검증(A5)에서 발견되는 함정을 그때그때 기록 → 다음 개발자는 안 막힘.

---

## 5. `.env` 파일 체계

| 파일 | 역할 | git |
|------|------|-----|
| `.env.example` (루트) | 전 환경 키 템플릿 | ✅ 커밋 |
| `.env` (루트, 로컬) | 개발자 로컬 실값 (`supabase start` 출력값) | ❌ ignore |
| `apps/web/.env.local.example` | web 키 템플릿 | ✅ 커밋 |
| `apps/web/.env.local` (로컬) | web 로컬 실값 | ❌ ignore |
| **Vercel 환경변수 (staging/prod)** | web staging·prod 실값 | 플랫폼 |
| **Railway 환경변수 (staging/prod)** | api staging·prod 실값 | 플랫폼 |

**불변 규칙:** staging·prod 시크릿은 **파일 금지**, Vercel/Railway 대시보드에만. 레포엔 로컬 키조차 안 들어감(예시 템플릿만).

---

## 6. 배포 파이프라인 & 브랜치 워크플로우

### 6.1 브랜치 전략 (Git Flow)
```
feature/* ──PR──► staging ──Deploy PR──► main
(staging에서 분기)   (자동배포→테스트)      (자동배포→프로덕션)
```

| 브랜치 | 분기 기준 | → 환경 | 머지 방법 |
|--------|----------|--------|----------|
| `feature/*` | **staging에서 분기** | 로컬만 | PR → staging |
| **`staging`** | (장수 브랜치) | Staging 자동배포 | feature PR을 머지 |
| **`main`** | (장수 브랜치) | Production 자동배포 | **staging→main "Deploy PR"만** |

**규칙:**
1. 모든 작업은 `staging`에서 feature 브랜치를 따서 시작
2. feature → `staging` PR 머지 → staging 환경에서 통합 테스트
3. 테스트 통과 후 `staging` → `main` **"Deploy PR"** 머지 → 프로덕션 런치
4. `main`에는 staging을 거치지 않은 코드가 직접 들어가지 않음 (hotfix 예외는 별도 규정)

> ⚠️ **CLAUDE.md 기존 브랜치 전략과 정합화 필요** — 현재 CLAUDE.md는 "`main`=MVP 전용"만
> 규정. 이 3환경 워크플로우(staging 장수 브랜치 도입)를 CLAUDE.md에 반영해야 함 (Phase G2).

### 6.2 CI/CD 자동 배포 (PR 머지 → 자동 배포)
| 트리거 | web (Vercel) | api (Railway) | DB 마이그레이션 |
|--------|-------------|---------------|----------------|
| `staging` 머지 | 자동 배포 | 자동 배포 | **자동** (CI에서 `db:migrate`) |
| `main` 머지 | 자동 배포 | 자동 배포 | **자동** (배포 전 검증 게이트 통과 시) |

**연동 방식:**
- **Vercel**: GitHub 연동 → `staging` 브랜치=Preview/staging 도메인, `main`=Production 도메인 (네이티브 지원)
- **Railway**: GitHub 트리거 → 브랜치별 서비스 자동 배포 (railway.toml watchPatterns 활용)
- **마이그레이션**: GitHub Actions 잡으로 환경별 `DATABASE_URL`에 `db:migrate` 실행

### 6.3 마이그레이션 자동화 + 안전장치 (D6 결정: 둘 다 자동)
staging·prod **둘 다 자동** 적용하되, prod 자동의 비가역성 리스크를 아래로 완화:
1. **배포 전 검증** — CI가 `verify:migrations`(journal 정합)로 마이그레이션 무결성 선검사
2. **순서 강제** — `main` 배포는 **항상 staging에서 같은 마이그레이션이 먼저 성공**한 뒤에만 (staging이 prod의 리허설)
3. **실패 시 배포 중단** — `db:migrate` 실패하면 앱 배포도 중단 (깨진 스키마로 배포 안 됨)
4. **백업 선행** — prod 마이그레이션 전 Supabase 자동 백업(Pro) 존재 확인

> 💡 완전 자동이되 "맹목적 자동"은 아님: staging 리허설을 통과 못한 마이그레이션은 prod에 못 감.

---

## 7. 셋업 절차 (실행 순서)

> 🔴 = 사용자(콘솔/대시보드)  ·  🟢 = 코드/설정(Claude 가능)

### Phase A — 로컬 스택 전환 (4인 개발 기반) ✅ Slice 0 완료
- [x] 🟢 A1. `supabase/config.toml` 생성 (pgvector·Auth·Google OAuth·Inbucket)
- [x] 🟢 A2. Drizzle 마이그레이션 ↔ Supabase CLI 연동 — CLI는 인프라만, Drizzle이 단일 소스. `0024_missing_tables.sql`로 누락 테이블/컬럼 보완
- [x] 🟢 A3. **Makefile** (`make setup`/`dev`/`migrate`/`migrate-new`/`seed`/`seed-full`/`reset`/`stop`)
- [x] 🟢 A4. **Fixtures** — `seed-tag-garden`→`seed-test-data` 순서로 baseline. `process.exit(0)` hang 버그 수정
- [ ] 🔴 A5. 개발자 4명 각자 `brew install supabase/tap/supabase` + `make setup` 실행 ← **팀 온보딩 대기**
- [x] 🟢 A6. `README.md` — 온보딩·Docker 격리·트러블슈팅·기존 dev 전환 가이드 완성
- [x] 🟡 A7. 트러블슈팅 축적 — Slice 0 검증에서 발견한 8가지 에러 README에 기록 완료

### Phase B — Staging 구축
- [ ] 🔴 B1. Supabase `haggle-staging` 프로젝트 생성 (us-west-2)
- [ ] 🟢 B2. staging DB 마이그레이션 적용
- [ ] 🔴 B3. Railway staging 서비스 + 환경변수(§2·§3) + `api.staging.tryhaggle.ai`
- [ ] 🔴 B4. Vercel staging(`staging` 브랜치) + 환경변수 + `app.staging.tryhaggle.ai`
- [ ] 🔴 B5. staging 외부서비스 test 자산 연결 (Stripe test·EasyPost test·x402 sepolia)

### Phase C — Production 구축
- [ ] 🔴 C1. Supabase `haggle-prod` 프로젝트 생성
- [ ] 🟢 C2. prod DB 마이그레이션 적용 (실데이터만, 시드 스크립트 금지)
- [ ] 🔴 C3. Railway prod 서비스 + 환경변수 + `api.tryhaggle.ai`
- [ ] 🔴 C4. Vercel prod(`main` 브랜치) + 환경변수 + `app.tryhaggle.ai`
- [ ] 🔴 C5. prod 외부서비스 live 자산 (결제·온체인은 staging 리허설 후 최종)

### Phase D — 도메인·CORS·링크 (배포 즉시 깨짐 방지)
- [ ] 🟢 D1. API CORS에 `app.tryhaggle.ai` + `app.staging.tryhaggle.ai` 추가 (`runtime.ts`/`HAGGLE_CORS_ORIGINS`)
- [ ] 🟢 D2. API `PUBLIC_APP_URL` 환경별 분리 (현재 tryhaggle.ai 고정 → 공유링크 오류)
- [ ] 🔴 D3. DNS: `app.tryhaggle.ai`·`app.staging`·`api`·`api.staging` 레코드 (서브도메인 — 추가 비용 $0)
- [ ] ✅ D4. 랜딩 CTA → `app.tryhaggle.ai` 살아있는지 확인 (죽은 링크 해소)

### Phase E — Cron·운영·정리
- [ ] 🟢 E1. staging·prod 각각 API 인스턴스 1개만 `ENABLE_CRON=true`
- [ ] 🟢 E2. Dockerfile 중복 정리 (`Dockerfile.api` vs `apps/api/Dockerfile`)
- [x] 🟢 E3. landing dev 포트 3001→3002 ✅
- [x] 🟢 E4. `.nvmrc` Node 22 — 이미 존재 확인 ✅
- [ ] 🔴 E5. 기존 클라우드 Supabase(`gdmhbrcqhwinafntrjhb`) **폐기** — 삭제하거나 Free auto-pause로 방치(7일). 신규 staging으로 대체 (§9 R5)

### Phase F — CI/CD 자동 배포 (PR 머지 → 자동 배포·마이그레이션)
- [ ] 🔴 F1. Vercel ↔ GitHub 연동: `staging` 브랜치=staging 도메인, `main`=prod 도메인 자동배포
- [ ] 🔴 F2. Railway ↔ GitHub 연동: 브랜치별 서비스 자동배포 트리거
- [ ] 🟢 F3. **마이그레이션 자동화 워크플로우** — GitHub Actions에 환경별 `db:migrate` 잡 추가 (staging·prod, §6.2/6.3)
- [ ] 🟢 F4. **마이그레이션 안전장치** — 배포 전 `verify:migrations` 게이트 + 실패 시 배포 중단 (§6.3)
- [ ] 🔴 F5. GitHub Secrets에 staging·prod `DATABASE_URL` 등록 (Actions가 마이그레이션 실행용)
- [ ] 🟢 F6. branch protection: `main`은 staging 경유 + CI 통과 PR만 머지 허용

### Phase G — 브랜치 전략 정합화
- [ ] 🟢 G1. `staging` 장수 브랜치 생성 (현재 `main`에서 분기)
- [ ] 🟢 G2. **CLAUDE.md 브랜치 전략 섹션 갱신** — 기존 "`main`=MVP 전용"을 3환경 워크플로우로 (§6.1)

---

## 8. 검증 체크리스트 (각 환경 배포 후)

**Staging:**
- [ ] `api.staging.tryhaggle.ai/health` → ok
- [ ] `app.staging.tryhaggle.ai` 로그인 동작
- [ ] **결제 리허설**: Stripe test 카드로 전체 플로우 통과
- [ ] **배송 리허설**: EasyPost test 라벨 생성
- [ ] **온체인 리허설**: x402 base-sepolia로 정산까지 통과
- [ ] WebSocket(`wss://api.staging.tryhaggle.ai`) 연결

**Production (배포 검증):**
- [ ] `api.tryhaggle.ai/health` → ok
- [ ] `app.tryhaggle.ai` 로그인 + CORS 통과
- [ ] 랜딩 CTA → app 정상 진입
- [ ] prod DB에 테스트 시드 **미혼입**
- [ ] prod 이메일/결제가 staging·dev로 안 샘

**🚦 첫 실사용자 받기 전 게이트 (Soft Launch 유료화 — 절대 누락 금지):**
- [ ] Vercel **Pro 전환** 완료 (상업적 사용 약관 — 미전환 시 프로젝트 정지 위험)
- [ ] Supabase prod **Pro 전환 + 자동 백업 ON** (백업 없는 상태로 실거래 받지 말 것)
- [ ] auto-pause 해제 확인 (Pro는 미적용)

---

## 9. 리스크 & 결정 로그

| # | 항목 | 결정/대응 |
|---|------|----------|
| D1 | 환경 단계 | **3단계** (4인 + 결제·배송 리허설) |
| D2 | 로컬 DB | **Supabase CLI 로컬 스택** (개발자별) |
| D3 | staging 서비스 | **real 코드경로 + test 자산** |
| D4 | web/api 호스팅 | Vercel / Railway |
| R1 | CORS에 web 도메인 누락 → 배포 즉시 API 차단 | D1을 배포 전 필수 선행 |
| R2 | 인프로세스 cron 멀티인스턴스 중복 | 환경당 1 인스턴스만 ENABLE_CRON |
| R3 | 테스트 시드(`seed-*.ts`)가 staging/prod 오염 | staging/prod에서 시드 스크립트 실행 금지 |
| R4 | 마이그레이션 비가역성 | **D6로 갱신됨** — 자동화하되 staging 선행 + verify 게이트 (§6.3) |
| R5 | 기존 클라우드 Supabase 용도 | **폐기 확정** — DB 점검 결과 실사용자·실거래 0, 전부 재생성 가능한 테스트/시드 데이터. staging은 백지에서 신규 생성 |
| R6 | staging `NODE_ENV` | production으로 두되 `HAGGLE_ENV=staging`로 구분 |
| D5 | prod 유료화 타이밍 | **Soft Launch** — 구조는 지금, prod Pro 전환은 첫 사용자 직전 |
| R7 | 백업 없는 prod로 실거래 받음 | 첫 사용자 게이트(§8)에서 Supabase Pro+백업 강제 |
| D6 | DB 마이그레이션 자동화 | **staging·prod 둘 다 자동** + 안전장치(§6.3): verify 게이트·staging 선행·실패 시 배포 중단·백업 선행 |
| D7 | 로컬 부트 스크립트 | **Makefile이 pnpm·supabase 호출** (`make setup`/`dev`/`migrate`/`seed`, §12) |
| D8 | 브랜치 전략 | feature(staging 분기) → PR → `staging` → Deploy PR → `main` (§6.1). CLAUDE.md 갱신(G2) |
| R8 | prod 마이그레이션 자동화의 비가역성 | staging 리허설 선통과 강제 + verify 게이트 + 배포중단 (§6.3). 완전무결 아님 — 위험 마이그레이션은 수동 검토 권장 |

---

## 10. 비용 구조 (2026 요금제 기준)

### 핵심 원리: "환경 × 3 ≠ 비용 × 3"
Railway·Vercel·Supabase **모두 "구독료 + 사용량"** 구조라, 안 쓰는 환경은 포함 크레딧
안에서 흡수됨. 환경별 비용 성격:
- **Local ×4** → **$0** (각자 `supabase start` Docker 로컬, 클라우드 자원 미사용)
- **Staging** → 트래픽 거의 없음 → 사용량 과금 거의 $0 + Free DB → **≈ $0**
- **Production** → 유일하게 실비용 발생

### 서비스별 요금 (확인된 최신)
| 서비스 | 무료/시작 | 다음 단계 | 주의 |
|--------|----------|----------|------|
| **Railway** | Hobby $5/월 ($5 크레딧 포함) | Pro $20 ($20 크레딧) | 서비스(컨테이너)·분당 과금. staging+prod 합산이 크레딧 내면 추가 $0 |
| **Vercel** | Hobby 무료 | **Pro $20/시트** | ⚠️ Hobby는 **상업적 사용 금지** → 런치 전 Pro 전환 필수. viewer 시트는 무료 → 배포 담당만 유료 |
| **Supabase** | Free (2 프로젝트, 7일 미사용 시 pause) | Pro $25/월(조직, 컴퓨트 $10 포함) | 추가 Pro 프로젝트마다 ~$10 컴퓨트. **staging=Free, prod=Pro** |

### 월 비용 시나리오 (USD)
| | Railway | Vercel | Supabase | 합계 |
|---|---|---|---|---|
| **A. 런치 직후 (시작점)** | $5 | Pro $20 (1시트) | Pro $25 (prod) + Free (staging) | **≈ $50** |
| **B. 성장 후 (마진)** | Pro $20 | $40 (2시트) | $25 + ~$10 컴퓨트 | **≈ $95** |

> Local 4벌은 두 시나리오 모두 **$0**.

### 비용을 키우는 변수 (감시 포인트)
1. **Vercel 시트 수** — 4명 다 유료시트면 $80. **배포·결제 담당 1~2명만 유료**로 제한
2. **Supabase 프로젝트/컴퓨트** — staging을 Pro로 올리면 +$10. Free 유지로 절약
3. **실트래픽 초과분** — 세 플랫폼 다 포함 크레딧 초과 시 사용량 과금

### prod 유료화 — "무조건 전부 유료"는 아님 (서비스별로 다름)
| 서비스 | prod 무료 가능? | 결론 |
|--------|----------------|------|
| **Railway** | 무료 영구 없음 | Hobby $5 (이미 납부 중) |
| **Vercel** | ❌ **약관상 상업적 사용 금지** | Pro 필수 (선택 아님) |
| **Supabase** | △ 기술적 가능, but **백업 없음 + 7일 auto-pause** | Pro 강권 (거래·결제 데이터에 백업 부재는 용납 불가, CLAUDE.md "안전>편리") |

> 무료 가능한 건 Supabase 하나뿐인데, 하필 백업·가용성이 가장 중요한 DB라 prod 무료는 부적합.

### 🚦 Soft Launch 비용 전환 전략 (결정됨)
**인프라 구조·코드는 지금 전부 셋업하되, prod 유료화 스위치는 "첫 실사용자 받는 날"에 ON.**

| 시점 | Vercel prod | Supabase prod | 월 비용 |
|------|------------|---------------|---------|
| **셋업~런치 전** | Hobby/preview로 구조만 | Free (임시) | **≈ $5** (Railway만) |
| **첫 사용자 받는 날** | **Pro 전환** | **Pro 전환 + 백업 ON** | **≈ $50** |

→ 셋업 기간 비용 거의 $0, 돈은 매출/실사용자 시점부터. prod 유료 트리거(=실사용자)와 타이밍 일치.
> ⚠️ 단, **실사용자 받기 전 반드시** Vercel Pro(약관)·Supabase Pro(백업) 전환 완료. 체크리스트 §8에 게이트로.

### 비용 관점 결정 (반영됨)
- ✅ Local = CLI 스택 → 개발 비용 $0
- ✅ Staging DB = **Free 플랜** (auto-pause 허용, 리허설엔 충분)
- ✅ Staging API/Web = prod와 **같은 플랫폼 계정 + 별 도메인** → 구독료 중복 없음
- ✅ prod 유료화 = **Soft Launch** (첫 사용자 직전 스위치 ON), Vercel 시트 최소화

**Sources:** [Railway Pricing](https://docs.railway.com/pricing/plans) · [Supabase Pricing](https://supabase.com/pricing) · [Vercel Pricing](https://vercel.com/pricing)

---

## 11. 예상 일정 (Estimated Timeline)

> **전제:** 팀이 이 작업에 **풀타임 집중**. 결제·배송·분쟁은 **이미 구현됨**
> (`payments/shipments/disputes.ts` 각 1100+ 라인, `payment-production-readiness.test.ts` 존재)
> → "기능 신규 개발"이 아니라 **"기존 기능을 환경 분리 + 실자산 연결"** 단계.

### 런치 정의 (3단계로 분리)
| 단계 | 의미 |
|------|------|
| **L1. 기술적 런치** | app.tryhaggle.ai 떠서 로그인·협상 핵심 플로우 동작 (결제 test/mock) |
| **L2. 결제 런치** | prod 실결제 (USDC mainnet·Stripe live) |
| **L3. 공개 런치** | 외부 오픈 + 모니터링·백업·안정화 |

### Phase별 작업량 (man-days)
| Phase | 작업 | 순수 시간 | 주체 |
|-------|------|----------|------|
| A. 로컬 CLI 스택 | init·config·4인 온보딩 | 0.5~1d | 🟢+🔴 |
| D. CORS·도메인·링크 | CORS·`PUBLIC_APP_URL`·`HAGGLE_ENV` | 0.5d | 🟢 |
| E. 정리 | Dockerfile·포트·`.nvmrc` | 0.5d | 🟢 |
| B. Staging 구축 | Supabase+Railway+Vercel staging | 1~2d | 🔴 多 |
| C. Production 구축 | prod 3종 (staging 복제라 빠름) | 1d | 🔴 |
| 결제·배송 리허설 | Stripe test·EasyPost·x402 sepolia 완주 | 2~4d | ⚠️ 최대 변수 |
| 검증·디버깅·DNS | CORS·env·DNS 전파 잔버그 | 1~2d | 공통 |
| **순수 합계** | | **≈ 7~12 man-days** | |

### 달력 일정 (풀타임 집중 기준)
| 목표 | 낙관 | **현실** | 보수 |
|------|------|---------|------|
| **L1. 기술적 런치** | 4~5일 | **1~1.5주** | 2주 |
| **L2. 결제 런치** | +3일 | **+1주** | +2주 |
| **L3. 공개 런치** | +2일 | **+3~4일** | +1주 |

→ **app 뜨고 동작(L1): ≈ 1~1.5주. 실결제 포함 프로덕션 런치(L2): ≈ 2.5~3주.**

### 달력 > 순수시간인 이유 (지연 요인)
1. 🔴 콘솔 작업은 사용자 손 필요 (프로젝트 생성·키 발급·DNS) → 가용시간에 묶임
2. 외부 대기 — DNS 전파·도메인 인증·Resend 검증·Stripe 심사
3. 온체인(sepolia) 리허설 비결정성 — 가스·RPC·지갑에서 예상 못한 막힘
4. 4인 협업 오버헤드 (온보딩·리뷰·머지)

### 일정 단축 레버
1. **L1/L2 분리** — app 먼저 띄우고(결제 test) 실결제는 다음 주 → 죽은 CTA 링크 즉시 해소
2. **🟢 코드 작업 병렬화** — 사용자가 콘솔 작업 하는 동안 CORS·env·config·Dockerfile 동시 준비
3. **staging 먼저 완주** → prod는 복제라 가속

---

## 12. 로컬 부트스트랩 & Makefile (D7)

> **목표:** 신규 개발자가 명령 하나로 — Docker 스택 기동 → 마이그레이션 → fixtures 시드 →
> 서버·웹 기동까지 — 끝나게. Makefile을 얇은 진입점으로, 내부는 pnpm·supabase 호출.

### 제공할 명령 (예시 — 실제 셋업 시 확정)
| 명령 | 동작 |
|------|------|
| `make setup` | **신규 개발자 1회**: CLI/Docker 확인 → `supabase start` → `db:migrate` → `make seed` |
| `make dev` | 일상 개발: `supabase start`(미기동 시) + `turbo dev` (api·web 동시) |
| `make migrate` | 로컬 DB에 마이그레이션 적용 (`pnpm --filter @haggle/db db:migrate`) |
| `make migrate-new` | 새 마이그레이션 생성 (`db:generate`) |
| `make seed` | fixtures 시드 (`seed-test-data.ts` 등 정리된 시드 일괄) |
| `make reset` | `supabase db reset` (스키마 동기화 + 재시드) — PR 머지 후 |
| `make stop` | `supabase stop` (로컬 스택 종료) |

> **Makefile은 Docker 전용 아님** — 단순 명령 래퍼. 스택(pnpm/turbo/supabase) 무관하게 동작.
> 진입장벽 최소화(개발자는 `make`만 알면 됨) + 내부 구현 유연성 확보.

### Fixtures 정책
- 신규 개발자가 `make seed` 한 번에 **일관된 개발 데이터** 확보 (테스트 유저·리스팅·태그 등)
- 현재 산재한 `seed-*.ts`(seed-test-data, seed-tag-garden 등)를 **단일 진입점으로 정리**
- ⚠️ 시드는 **로컬·staging 전용.** prod 금지 (R3, §8 게이트)

---

## 13. 전체 워크플로우 (네 목표와 1:1 매핑)

```
┌─ 로컬 개발 ──────────────────────────────────────────────┐
│ git checkout staging && git checkout -b feature/x        │
│ make setup  (최초)  /  make dev  (이후)                   │
│   → Docker 스택 + 마이그레이션 + fixtures + api·web 자동   │
│ 코드 작업 → make migrate (스키마 바꾸면)                   │
└──────────────────────────────────────────────────────────┘
                         │ PR
                         ▼
┌─ Staging (app.staging.tryhaggle.ai) ─────────────────────┐
│ feature → staging 머지                                    │
│   → CI 통과 → Vercel·Railway 자동배포 + DB 자동 마이그레이션│
│   → 결제·배송·온체인(test자산) 통합 리허설                  │
└──────────────────────────────────────────────────────────┘
                         │ Deploy PR (staging → main)
                         ▼
┌─ Production (app.tryhaggle.ai) ──────────────────────────┐
│ staging → main 머지                                       │
│   → verify 게이트 → 자동배포 + DB 자동 마이그레이션(staging │
│      선통과분만) → 프로덕션 런치                            │
└──────────────────────────────────────────────────────────┘
```

| 네가 말한 요구 | 커버 위치 |
|---------------|----------|
| 3환경 (로컬·staging·prod) | §2 |
| 로컬 = 각자 Docker 격리 | §4 |
| staging 분기 → PR → staging 머지 | §6.1 |
| Deploy PR (staging→main) 프로덕션 런치 | §6.1 |
| PR 머지 시 CI/CD 자동 배포 (web+server) | §6.2, Phase F |
| Makefile 시작 스크립트 | §12, A3 |
| 신규 개발자 fixtures | §12, A4 |
| DB 마이그레이션 자동(staging·main) + 로컬 쉽게 | §6.3, §12, Phase F |
| app.staging.tryhaggle.ai (비용 $0) | §2, D3 (서브도메인 무료) |
| app.tryhaggle.ai 프로덕션 | §2 |

→ **네가 말한 항목 전부 문서에 매핑됨.** 미커버 0.

---

## 14. Vertical Slice 실행 순서 (구현→테스트 단위, D9)

> **원칙:** Phase A~G는 "무엇이 필요한지"의 **카탈로그**. 실제 구현은 아래 슬라이스 순서로 —
> 각 슬라이스는 **하나의 얇은 가치가 로컬→staging→prod를 관통**하고, 끝마다 **테스트 가능.**
> 연속성(파이프라인 작동) 우선 → 그 위에 기능을 얹는다.

### Slice 0 — 로컬 부팅 (개발 기반) ✅ **완료 (2026-05-31)**
**구현:** A1·A2·A3·A4·A6·A7 + E3·E4
**검증 결과:** `supabase start` 13개 서비스 기동 + `make migrate` 28개 마이그레이션 통과 + `make seed` 태그 7개·유저 10명·리스팅 10개 입력 성공
**발견 버그:** 마이그레이션 누락 테이블 5개·컬럼 3개 (0024로 보완), seed hang 4개 (process.exit 추가), config.toml 파싱 오류 (수정)
**미완료:** A5 (팀 4명 각자 온보딩) — 실제 실행은 개발자별 진행

### Slice 1 — 헬스체크가 파이프라인을 관통 (연속성 증명) ⭐
**구현:** G1(staging 브랜치) → D1·D2(CORS·`HAGGLE_ENV`·`PUBLIC_APP_URL`) → B1·B3·B4(staging 3종) → F1·F2(자동배포 연동) → D3(DNS)
**테스트:** `staging` 머지 → 자동배포 → `api.staging.../health` ok + `app.staging...` 로드
**완료 기준:** **PR 머지 → 자동배포 파이프라인이 실제로 작동** ✅ (이후 모든 슬라이스의 토대)

### Slice 2 — DB 마이그레이션 자동화 관통
**구현:** B2 + F3·F4·F5 (Actions 마이그레이션 잡 + verify 게이트 + Secrets)
**테스트:** 더미 마이그레이션 PR → staging 머지 → staging DB에 자동 적용 확인, 깨진 마이그레이션은 배포 중단 확인
**완료 기준:** 스키마 변경이 자동 반영 + 안전장치 작동 ✅

### Slice 3 — 인증·핵심 플로우 (L1 기술 런치)
**구현:** staging에서 로그인·협상·리스팅 핵심 플로우 검증 + 잔버그 수정
**테스트:** §8 Staging 체크리스트 중 로그인·WebSocket·CTA
**완료 기준:** staging이 "실제로 쓸 수 있는 앱" ✅

### Slice 4 — 결제·배송·온체인 리허설 (test 자산)
**구현:** B5 (Stripe test·EasyPost test·x402 sepolia 연결)
**테스트:** §8 결제/배송/온체인 리허설 3종 통과
**완료 기준:** "틀리면 돈 나가는" 플로우가 test 자산으로 끝까지 통과 ✅

### Slice 5 — Production 승격 (Deploy PR)
**구현:** C1·C2·C3·C4 (prod 3종) + F6(branch protection) + G2(CLAUDE.md) + E1·E2·E5
**테스트:** `staging`→`main` Deploy PR → §8 Production 검증 체크리스트
**완료 기준:** **app.tryhaggle.ai 라이브** (결제 test 모드, L1 런치) ✅

### Slice 6 — 실결제 전환 (L2, Soft Launch 게이트)
**구현:** C5 (prod live 자산) + §8 첫 사용자 게이트 (Vercel Pro·Supabase Pro+백업)
**테스트:** prod 실결제 1건 통과 + 백업 동작 확인
**완료 기준:** 실사용자 받을 준비 완료 ✅

```
Slice 0 ──► Slice 1 ──► Slice 2 ──► Slice 3 ──► Slice 4 ──► Slice 5 ──► Slice 6
로컬부팅    파이프라인   마이그레이션  핵심플로우   결제리허설   prod런치    실결제
            관통⭐                              (test자산)   (L1)       (L2)
   각 화살표 = 구현→테스트 게이트. 통과해야 다음 슬라이스로.
```

> **vertical slice 적합성:** ✅ 가능. 각 슬라이스가 독립적으로 테스트 가능하고,
> Slice 1(파이프라인 관통)을 먼저 세워서 이후 슬라이스가 "머지하면 자동 검증"되는 구조.

---

*Last Updated: 2026-05-31 · Status: **Slice 0 완료** (로컬 부팅 검증). 다음: Slice 1 (staging 파이프라인 관통)*
