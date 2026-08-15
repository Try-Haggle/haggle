# Haggle

AI 협상 + 온체인 결제 프로토콜 인프라. 프로젝트 개요·아키텍처는 [CLAUDE.md](./CLAUDE.md),
환경 분리 전략은 [docs/wip/Environment_Separation_Playbook.md](./docs/wip/Environment_Separation_Playbook.md) 참고.

개발을 시작하기 전에 [CONTRIBUTING.md](./CONTRIBUTING.md)의 주간 작업 그래프, 단일 리뷰어,
검증·인계 규칙을 확인한다. 자신의 이번 주 담당과 리뷰 작업은 `pnpm work:me -- "<이름>"`으로 조회한다.

---

## 로컬 개발 환경 (Local Development)

각 개발자는 **Supabase 로컬 스택**(Docker)으로 완전히 격리된 풀스택을 띄운다.
Auth/Storage/Postgres/pgvector가 모두 노트북 안에서 돌아가므로, 스키마를 바꾸거나
시드를 돌려도 다른 사람을 깨뜨리지 않는다.

### 사전 요구사항 (한 번만)

| 도구 | 설치 |
|------|------|
| Node 22 (arm64) | `nvm install 22 && nvm use` (저장소에 `.nvmrc` 있음). **Apple Silicon은 arm64 네이티브 Node 필수** — `node -p process.arch`가 `arm64`여야 한다 (`x64`면 터미널이 Rosetta로 떠 있는 것 → 아래 트러블슈팅 참고). 아키텍처가 어긋나면 네이티브 도구(Biome 등)가 깨진다. |
| pnpm 9 | `corepack enable` |
| Docker | Docker Desktop 실행 |
| Supabase CLI | `brew install supabase/tap/supabase` |

### 첫 셋업 — 명령 하나

```bash
make setup
```

이 한 줄이 순서대로 실행한다:
1. `pnpm install` — 의존성 설치
2. `supabase start` — 로컬 Supabase 스택 기동 (Auth/Storage/Postgres/pgvector)
3. `make migrate` — pgvector 확장 보장 후 Drizzle 마이그레이션 적용
4. `make seed` — baseline fixtures(태그 + 유저·리스팅 10개) 시드

완료되면 `.env`에 로컬 접속값을 채운다 (`supabase status` 출력 참고):

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase status의 anon key>
SUPABASE_SERVICE_ROLE_KEY=<supabase status의 service_role key>
NODE_ENV=development
```

> `make db-url`로 로컬 DB URL을 바로 출력할 수 있다.

### 일상 개발

```bash
make dev          # Supabase(미기동 시 자동) + api(3001)·web(3000) 동시 실행
```

| 서비스 | 로컬 주소 |
|--------|----------|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Landing | http://localhost:3002 |
| Supabase Studio | http://127.0.0.1:54323 |
| 메일 캐처(Inbucket) | http://127.0.0.1:54324 |

### 자주 쓰는 명령

```bash
make help         # 전체 명령 목록
make migrate      # 로컬 DB에 마이그레이션 적용
make migrate-new  # 스키마 변경 후 새 마이그레이션 생성 (drizzle generate)
make seed         # baseline fixtures 재시드
make seed-full    # baseline + 확장(유사도 테스트용) 시드
make reset        # DB 초기화 + 재마이그레이션 + 재시드 (PR 머지 후 동기화)
make stop         # Supabase 스택 종료
```

### 코드 품질 (Lint / Format)

린트·포맷은 **Biome**(`biome.json`) 단일 도구로 통일한다. 별도 셋업은 없다 —
`make setup`(또는 `pnpm install`)이 `prepare: husky`를 실행해 커밋 훅을 자동 활성화한다.

| 레이어 | 무엇이 강제되나 |
|--------|----------------|
| **에디터** | `.vscode/settings.json` — 저장 시 Biome 자동 포맷 + import 정리. VSCode가 Biome 확장 설치를 권장한다(`.vscode/extensions.json`). |
| **커밋** | husky `pre-commit` → `lint-staged` → **변경 파일만** `biome check --write`. 자동수정 불가한 위반(미사용 변수/import, `==` 등)이 남으면 커밋이 차단된다. |
| **CI** | PR/staging push 시 base 대비 **변경 파일만** 검사([.github/workflows/ci.yml](.github/workflows/ci.yml)). 훅을 우회한 커밋도 여기서 잡힌다. |

> 점진 도입: 기존 코드는 일괄 정리하지 않는다. **앞으로 만지는 파일만** 규칙이 적용된다.

```bash
pnpm lint         # 전체 린트 검사 (수정 안 함)
pnpm lint:fix     # 전체 자동수정 (포맷 + 린트)
pnpm format       # 포맷만
pnpm check        # 검사만 (CI와 동일)
```

### 마이그레이션 소스 = Drizzle (단일 소스)

스키마 마이그레이션은 **Drizzle**(`packages/db/drizzle/`)가 단일 소스다.
Supabase CLI는 로컬 인프라를 띄우는 용도로만 쓰며, CLI 자체 마이그레이션은
비활성(`supabase/config.toml`의 `db.migrations.enabled = false`)이다.

- 스키마를 바꾸려면: 스키마 파일 수정 → `make migrate-new` → `make migrate`
- `db:generate`는 먼저 `@haggle/db`를 빌드하고 전체 compiled schema를 읽는다. 생성 전후 `pnpm verify:db-schema`로 migration, Drizzle, raw SQL 소유권을 대조한다.
- `pnpm db:audit:relations`는 `DATABASE_URL`의 정산·결제 위임·배송 APV 관계 16개에 대해 FK 존재 여부, orphan 수, validation 상태를 점검한다. 실제 운영 DB에서는 URL을 파일이나 Git에 저장하지 말고 배포 환경의 secret으로 주입한다.
- pgvector 확장은 `supabase/init-extensions.sql`이 마이그레이션 직전에 보장한다.

#### ⚠️ 마이그레이션 황금률 (반드시 지킬 것)

> 어기면 staging/prod DB가 꼬여서 수동 복구가 필요하다. 실제로 한 번 사고가 있었다 (2026-05).

1. **이미 커밋된 마이그레이션 파일은 절대 수정하지 않는다.**
   Drizzle은 `meta/_journal.json`의 `when`(타임스탬프) **오름차순**으로 적용 여부를 판단하고,
   각 파일의 해시를 `drizzle.__drizzle_migrations`에 저장한다. 적용된 `00xx.sql`을 나중에 고치면
   해시가 어긋나 이후 마이그레이션이 막히거나 `relation already exists` 에러가 난다.
   → 추가/수정할 게 생기면 **무조건 새 파일**(`0026_...`).

2. **cloud DB(staging/prod)에 `db:push`를 직접 쓰지 않는다.**
   `db:push`는 마이그레이션 파일을 안 남겨서, 테이블이 DB엔 있는데 히스토리엔 없게 된다.
   그러면 새 환경에서 `db:migrate` 시 그 테이블이 누락된다.
   → 항상 `db:generate`(파일 생성) → 커밋 → `db:migrate` 순서로만 바꾼다.

3. **migration 숫자 prefix를 중복 생성하지 않는다.**
   브랜치를 최신 `staging`과 맞춘 뒤 생성하고 `pnpm verify:migrations`를 실행한다.
   검증기는 과거 이력의 중복 7개만 허용하며 새 `00xx_*.sql` 충돌은 CI에서 차단한다.
   이미 커밋되거나 적용된 파일은 번호를 고치지 말고, 새 변경은 Drizzle이 생성한 다음 고유 prefix로 만든다.

4. **새 테이블은 기본적으로 Drizzle schema와 migration 양쪽에 둔다.**
   고급 trigger/운영 복구처럼 raw SQL이 필요한 경우에도 테이블 모델은 Drizzle에 선언한다.
   기존 raw SQL 전용 테이블 23개는 `packages/db/schema-ownership.json`에 소유자를 고정하며,
   새 예외는 아키텍처 리뷰 없이 추가할 수 없다.

DB 전체 흐름과 변경 승인 기준: [Database Structure and Governance](docs/mvp/database-structure-and-governance.md)
상세 + 사고 진단 쿼리: [Environment Separation Playbook §6.4](docs/wip/Environment_Separation_Playbook.md)

### Google OAuth (선택)

로컬에서 Google 로그인을 테스트하려면 `.env`에 아래를 채우고
`supabase/config.toml`의 `[auth.external.google] enabled = true`로 바꾼다:

```bash
SUPABASE_AUTH_GOOGLE_CLIENT_ID=...
SUPABASE_AUTH_GOOGLE_SECRET=...
```

기본은 비활성이며, 이메일/비밀번호 로그인만으로도 개발 가능하다.

---

## Docker 격리 — 기존 Docker 사용자에게 영향 없음

Supabase 로컬 스택은 **자기 컨테이너만** 띄운다. 회사/개인 프로젝트에서 돌리던
다른 Docker 컨테이너(앱·DB 등)와 섞이지 않는다.

| 충돌 종류 | 안전? | 이유 |
|----------|------|------|
| 일반 Docker 컨테이너 | ✅ | Supabase는 `project_id`(=`haggle`) 네임스페이스의 컨테이너만 관리 |
| 다른 Supabase 프로젝트 컨테이너 | ✅ | `project_id`별로 컨테이너 이름이 분리됨 (`supabase_db_haggle`) |
| **포트** | ⚠️ | 고정 포트를 점유 (아래) |

**점유 포트** (`supabase/config.toml`): API `54321`, DB `54322`, Studio `54323`,
메일 `54324`. DB는 일부러 `5432`가 아닌 `54322`라 로컬 Postgres와 안 겹친다.

**포트가 겹친다면** (다른 Supabase 스택을 동시에 돌리는 경우 등):
```bash
supabase status            # 무엇이 점유 중인지 확인
make stop                  # 안 쓰는 Haggle 스택 종료
# 그래도 겹치면 supabase/config.toml의 포트 번호를 바꾼 뒤 supabase start
```

---

## 트러블슈팅 (Local Setup)

> 실제로 막힌 지점·해결법을 발견하면 여기에 계속 추가한다 (살아있는 문서).

| 증상 | 원인 / 해결 |
|------|------------|
| `make setup` → `supabase CLI 필요` | `brew install supabase/tap/supabase` |
| `Docker가 실행 중이 아님` | Docker Desktop을 켠다 |
| `supabase start` 포트 충돌 | 위 "Docker 격리" 섹션 — `supabase status`로 확인, 포트 변경 |
| `make migrate` pgvector 에러 | `supabase/init-extensions.sql`이 먼저 실행되는지 확인 (`make migrate`로 실행) |
| 로그인 안 됨 | `.env`의 `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 `supabase status` 값과 일치하는지 |
| Node 엔진 경고 | `nvm use` (저장소 `.nvmrc` = 22) |
| Biome 확장 `Unable to find the Biome binary` / `wagmi`·`@rainbow-me/rainbowkit` `Cannot find module` (타입체크) | **Apple Silicon인데 x64 Node(Rosetta)로 `pnpm install`** 한 경우. pnpm이 x64용 네이티브 바이너리를 받아 arm64 도구·확장이 못 찾는다. `node -p process.arch` 확인 → `x64`면: ① `arch`가 `arm64`인지 확인(아니면 터미널 "Rosetta로 열기" 끄기) → ② `nvm install 22 && nvm use` → `node -p process.arch`가 `arm64`인지 재확인 → ③ `rm -rf node_modules && pnpm install` → ④ 에디터 창 새로고침. |
| `supabase start` → `exec format error` (특정 컨테이너) | 해당 이미지가 잘못된 아키텍처(amd64)로 받아짐 (Apple Silicon). 로그에 찍힌 컨테이너만 arm64로 강제 재pull. 예시(studio): `docker rmi -f $(docker images 'public.ecr.aws/supabase/studio' -q)` → `docker pull --platform linux/arm64 public.ecr.aws/supabase/studio:<태그>` → `docker image inspect <이미지> --format '{{.Architecture}}'`로 `arm64` 확인 → `supabase start`. ⚠️ 전체 이미지를 지우고 받아도 일부가 또 amd64로 받아질 수 있으니, **막힌 이미지만 `--platform`으로 강제**하는 게 확실. |
| `supabase start` 일부 서비스만 뜸 | Docker VM 불안정. Docker Desktop 재시작 → `docker info` 정상 확인 → `supabase stop && supabase start` |
| `input/output error` (이미지 pull 중) | Docker 디스크 꽉 참/손상. `df -h /`·`docker system df`로 확인 → `docker image prune -f` 또는 Mac 디스크 정리 → 재시도. 지속되면 Docker Desktop 재시작 |
| `supabase stop`이 무한 대기 | `Ctrl+C` → `docker rm -f $(docker ps -aq --filter name=supabase)` (회사/개인 컨테이너 안 건드림) → `supabase start` |
| `make migrate` → `relation "xxx" does not exist` | 일부 테이블/컬럼이 `db:push`로만 생성돼 마이그레이션 히스토리에 누락됨. `0024_missing_tables.sql`로 보완됨 (2026-05-31). 같은 에러가 새로 나오면 해당 테이블/컬럼을 `0024`에 추가하고 `supabase db reset && make migrate` 재실행. |
| `make seed` 완료 후 hang | seed 스크립트가 DB 연결을 안 닫아서 발생. `process.exit(0)` 추가로 수정됨. 새 seed 스크립트 작성 시 `main().then(() => process.exit(0)).catch(...)` 패턴 사용. |

---

## 기존 dev 환경을 쓰던 개발자 → 로컬 스택 전환

기존에 **클라우드 Supabase 공유 dev**를 `.env`로 가리키던 개발자는:

1. `git pull` 후 `make setup` 실행 (로컬 스택 기동)
2. `.env`의 `DATABASE_URL`·`NEXT_PUBLIC_SUPABASE_URL`·키를 **로컬 값으로 교체**
   (`supabase status` 출력 또는 README 위 예시 참고)
3. 기존 클라우드 dev는 더 이상 사용하지 않는다 (폐기 예정 —
   [Environment_Separation_Playbook §R5](./docs/wip/Environment_Separation_Playbook.md))

> 이제부터 각자 로컬이 격리돼 있으므로, 스키마 변경·시드가 다른 사람에게 영향 없다.

---

## 빌드 · 테스트

```bash
pnpm build        # turbo build (전체)
pnpm test         # turbo test
pnpm typecheck    # turbo typecheck
```
