# nego-lab — 온디맨드 협상 테스트 랩

DeepSeek 기반 **실제 협상**을 UI 없이 대량으로 돌려서, 협상 에이전트 조합과
상품 속성이 협상 결과(타결가·타결률)에 어떤 영향을 주는지 측정하는 도구다.

- **왜 만들었나:** 스테이징 웹 UI로 협상을 돌리면 느리고 번거롭다. 백엔드는
  어차피 API를 호출하므로, 프론트를 거치지 않고 협상만 반복 실행한다.
- **무엇을 보나:** ① 에이전트 조합(판매자×구매자)별 타결가, ② 상품 속성
  (배터리·스크래치·용량 등) 변화가 가격에 주는 영향.
- **비용:** DeepSeek는 유료다. 그래서 **온디맨드로만** 돌리고, 실행 전 항상
  예상 비용을 보여준 뒤 승인받는다. (라운드당 실측 ≈ **$0.01**)
- **few-shot 비교 대시보드:** [local-fewshot/README.md](./local-fewshot/README.md)
  (`http://127.0.0.1:4177`). baseline과 `fewshot.md`를 같은 시나리오에 두 번 돌린다.

---

## 1. 동작 원리

nego-lab은 별도 서버를 띄우지 않는다. `apps/api`의 실제 라우트를 **인프로세스**로
불러(Fastify `inject()`) 게스트 협상 플로우를 그대로 실행한다.

```
ScenarioCase (시나리오 정의)
   │  seedListing: listing_drafts 직접 insert + publishDraft
   ▼
POST /negotiations/start   (게스트 — 인증 불필요, run_token 발급)
   │
   ▼
POST /negotiations/sessions/:id/auto-play/next  ← 반복 (최대 8라운드)
   │  라운드마다 DeepSeek 호출 → 가격/메시지 결정
   ▼
negotiation_rounds 테이블에서 결과 읽기 → NegotiationResult
```

- **상품 속성이 협상에 반영되는 경로:** 판매자가 답한 카테고리 기준은
  `projectSellerFacts` → `listing_context.seller_facts` → DeepSeek 프롬프트.
  소포는 `negotiationAgentSnapshot.parcel` → `extractListingContext` →
  `listing_context.parcel`. 배터리/스크래치 같은 사실은 **LLM 경로에서만**
  가격에 영향을 준다. 예전 `phoneAnswers` → `attributes` 경로는 제거됐다.
- **격리:** 실제(원격 Supabase) DB는 절대 건드리지 않는다. 로컬 전용 테스트 DB
  `haggle_negolab`만 사용하며, DATABASE_URL에 그 이름이 없으면 실행을 거부한다
  (`harness.ts`).

---

## 2. 사전 준비 (최초 1회)

### 2.1 로컬 Postgres + 테스트 DB

```bash
# Postgres 16 (예: Homebrew). 로케일 문제로 pg_ctl 직접 사용을 권장.
brew install postgresql@16 pgvector

# DB 생성 + 필수 확장 (임베딩 컬럼용 vector 확장)
createdb haggle_negolab
psql haggle_negolab -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

> Postgres가 `postmaster became multithreaded during startup`로 안 뜨면
> `LC_ALL="en_US.UTF-8"`를 지정하고 `pg_ctl`로 직접 기동한다.

### 2.2 스키마 동기화 (drizzle push)

빈 DB에 전체 스키마를 밀어넣는다. `db:push`는 `DATABASE_URL`을 읽는다.

```bash
DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab" \
  pnpm --filter @haggle/db db:push
```

### 2.3 DeepSeek API 키

레포 루트 `.env`에 `DEEPSEEK_API_KEY`가 있어야 한다 (harness가 루트 .env를 로드).
`dotenv`는 이미 export된 `DATABASE_URL`을 덮어쓰지 않으므로, 셸에서 export한
로컬 DB URL이 항상 우선한다.

### 2.4 워크스페이스 의존성

```bash
pnpm install
pnpm --filter "./packages/*" build   # dist가 오래됐을 때 (export 누락 에러 방지)
```

---

## 3. 환경 변수

모든 **실제 실행** 명령은 로컬 DB URL과 Postgres bin 경로가 필요하다. 매번 붙이는
게 번거로우면 셸에 export해 둔다.

```bash
export DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
```

> `dry-run`과 `report`는 DB/DeepSeek를 쓰지 않으므로 위 변수 없이도 돌아간다.

---

## 4. 명령어

레포 루트에서 `pnpm --filter @haggle/nego-lab <script>` 형태로 실행한다.

| 명령 | 비용 | 하는 일 |
|------|------|---------|
| `preflight` | **무료** | 유료 실행 전 환경 사전점검 (DB·API키·스키마) |
| `catalog` | **무료** | 시나리오를 카드로 시각화한 HTML (판매자/구매자 설정 + 결과 오버레이) |
| `dry-run` | **무료** | 실행 계획 미리보기 (케이스 목록 + 예상 비용/시간). 아무것도 안 돌림 |
| `run-batch` | **유료** | 승인 게이트 뒤에서 실제 협상 실행 → JSONL 저장 + 상세 출력 |
| `report` | **무료** | JSONL → 클릭 가능한 HTML 리포트 생성 |
| `clean` | **무료** | 결과 파일 / 테스트 DB 데이터 정리 |
| `run-one` | **유료** | 샘플 케이스 1건 실행 (스모크/디버그용) |

**권장 흐름:** `preflight` → `dry-run` (계획 확인) → `run-batch` (승인 후 실행) →
`report` (결과 보기).

### 4.0 preflight — 사전점검 (무료)

```bash
DATABASE_URL="postgresql://<user>@localhost:5432/haggle_negolab" \
  pnpm --filter @haggle/nego-lab preflight
```

유료 실행 전에 4가지를 확인한다: ① `DATABASE_URL`이 테스트 DB를 가리키는지,
② `DEEPSEEK_API_KEY` 존재, ③ DB 접속 가능, ④ 핵심 테이블 존재. 실패 시 각 항목에
해결 명령을 함께 출력한다. 하나라도 실패하면 exit 1.

### 4.1 dry-run — 무료 미리보기

```bash
pnpm --filter @haggle/nego-lab dry-run --group A            # A 그룹만
pnpm --filter @haggle/nego-lab dry-run --group A,B --repeat 3
pnpm --filter @haggle/nego-lab dry-run --group all
```

출력: 그룹별 케이스 수, 케이스 상세(에이전트·가격·속성), **예상 협상 수 / 최대
DeepSeek 호출 / 예상 비용 / 예상 소요시간**. 실제 실행은 하지 않는다.

### 4.2 run-batch — 실제 실행 (유료)

```bash
pnpm --filter @haggle/nego-lab run-batch --group A --repeat 3   # 승인 물어봄
pnpm --filter @haggle/nego-lab run-batch --group all --yes      # 승인 스킵
pnpm --filter @haggle/nego-lab run-batch --group A --limit 1    # 딱 1건만 (스모크)
```

동작:
1. 실행 계획 + 예상 비용 출력
2. `[y/N]` 승인 프롬프트 (`--yes`로 스킵). `y`가 아니면 **DB/DeepSeek 접근 전에 중단**
3. 케이스를 순차 실행하며 각 결과를 `results/<타임스탬프>.jsonl`에 **한 줄씩 append**
   (중간에 끊겨도 그때까지 보존)
4. 협상마다 **라운드별 상세 감사 출력** (역할·타입·가격·역제안·결정·토큰·전체 메시지)
5. 끝나면 그룹별 요약 + 총계(협상수·라운드·토큰·추정비용)

**플래그**

| 플래그 | 기본 | 의미 |
|--------|------|------|
| `--group`, `-g` | `all` | 그룹 선택. `A` / `A,B` / `all` |
| `--repeat`, `-r` | `1` | 각 케이스 반복 횟수 (응답 무작위성 평균용) |
| `--limit`, `-l` | `0`(무제한) | 총 협상 수 상한. 싸게 스모크할 때 |
| `--yes`, `-y` | off | 승인 프롬프트 스킵 |

### 4.3 report — HTML 리포트 (무료)

```bash
pnpm --filter @haggle/nego-lab report                          # 최신 JSONL 사용
pnpm --filter @haggle/nego-lab report --file results/xxx.jsonl # 특정 파일
open "results/<타임스탬프>.html"                                # 브라우저에서 열기
```

생성되는 리포트(외부 의존성 0, 오프라인 열림):
- **A 히트맵** — 판매자(행)×구매자(열) 평균 타결가, 가격 색상 스케일
- **B/C/D/E 스윕** — 레벨별 평균가·타결률·상대 막대
- **상세 패널** — 셀/행 클릭 → 해당 케이스 전체 트랜스크립트 드릴다운
- 상단 요약 — 총 협상수·라운드·토큰·추정비용

### 4.35 catalog — 시나리오 카탈로그 (무료)

```bash
pnpm --filter @haggle/nego-lab catalog                  # 전체, 최신 결과 오버레이
pnpm --filter @haggle/nego-lab catalog --group A
pnpm --filter @haggle/nego-lab catalog --no-results     # 시나리오만 (결과 안 얹음)
open "results/catalog.html"
```

각 테스트 케이스를 **카드**로 보여준다 — 한눈에 "이 테스트가 뭘 보는지" 파악용:
- **판매자 패널** — 에이전트 · ask · floor · 마감
- **구매자 패널** — 에이전트 · 예산 · 목표가 · 마감
- **상품 + 속성 칩** (그룹이 바꾸는 축은 강조 표시)
- **결과 오버레이** — 실행된 케이스는 타결률·평균 타결가, 미실행은 `not run yet`

실행 전에 무료로 계획을 시각적으로 검토하고, 실행 후엔 설정→결과 영향을 함께 본다.

### 4.4 clean — 정리 (무료)

```bash
pnpm --filter @haggle/nego-lab clean --results          # results/*.jsonl + *.html 삭제
DATABASE_URL=...haggle_negolab \
  pnpm --filter @haggle/nego-lab clean --db --yes        # 테스트 DB 데이터 초기화
pnpm --filter @haggle/nego-lab clean --db --results      # 둘 다
```

- `--results`: 결과/리포트 파일 삭제
- `--db`: 협상마다 쌓이는 테스트 데이터를 TRUNCATE (listing_drafts, listings_published,
  negotiation_sessions, negotiation_rounds). **`haggle_negolab`이 아니면 거부**하며,
  `--yes`가 없으면 확인 프롬프트를 띄운다.

---

## 5. 실험 그룹

`src/scenarios.ts`에 정의. 모두 공통 baseline(iPhone 15 Pro, ask $900 / floor $780)에서
**한 번에 한 축만** 바꾸는 OFAT(One-Factor-At-A-Time) 방식이다.

| 그룹 | 축 | 케이스 수 | 질문 |
|------|-----|-----------|------|
| **A** | 에이전트 매트릭스 (판매자×구매자) | 16 | 어떤 에이전트 조합이 어디로 수렴하나? |
| **B** | 배터리 건강도 (100→75%) | 5 | 배터리 한 단계가 가격을 얼마나 움직이나? |
| **C** | 스크래치 (없음→금감) | 4 | 흠집 정도가 가격에 주는 영향은? |
| **D** | 저장 용량 (128GB→1TB) | 4 | 용량이 가격에 주는 영향은? |
| **E** | 구매자 압박 (예산·마감) | 3 | 예산/시간 압박이 결과를 어떻게 바꾸나? |

합계 **32 케이스**. 에이전트 프리셋 4종: `hunter`(가격 중시/버림받기),
`closer`(시간 중시/빠른 양보), `verifier`(리스크 중시), `balancer`(균형).

---

## 6. 비용 모델

`src/cost.ts`에 정의. 실측 기준값:

- 협상 1건 ≈ 최대 8라운드, 라운드당 1 DeepSeek 호출
- **라운드당 ≈ $0.01** (DeepSeek V4 Pro reasoning, ~2.4k 토큰/라운드, 대시보드 실측)

| 실행 | 협상 수 | 최대 비용 |
|------|--------:|----------:|
| A ×1 | 16 | ~$1.3 |
| all ×1 | 32 | ~$2.6 |
| all ×3 | 96 | ~$7.7 |

> 실제로는 8라운드 전에 타결되는 경우가 많아 상한보다 싸다. 단가가 바뀌면
> `cost.ts`의 `USD_PER_ROUND_CALL`만 고치면 dry-run/러너 추정이 함께 갱신된다.

---

## 7. 안전장치

- **DB 격리 가드:** `DATABASE_URL`에 `haggle_negolab`이 없으면 즉시 중단
- **승인 게이트:** `run-batch`는 `y` 입력 전까지 DeepSeek/DB에 접근하지 않음
- **크래시 안전:** 결과를 협상마다 JSONL에 append → 중간에 끊겨도 보존
- **결과 비커밋:** `results/`는 `.gitignore` 처리 (실험 데이터는 저장소에 안 올림)

---

## 8. 새 시나리오 / 그룹 추가

`src/scenarios.ts`에서:

- **속성 스윕 추가:** `attributeSweep("F", "someKey", ["lvl1","lvl2", ...])` 형태로
  빌더를 만들고 `GROUPS` 배열에 `{ key, title, build }`를 추가.
- **baseline 변경:** `BASE_ITEM` / `BASE_BUYER` 수정 (모든 그룹에 반영됨).
- 추가 후 `dry-run --group F`로 먼저 무료 확인.

---

## 9. 파일 구조

```
nego-lab/
├── src/
│   ├── types.ts            # ScenarioCase / NegotiationResult / RoundRecord
│   ├── scenarios.ts        # 실험 그룹 A–E 정의 + expandGroups
│   ├── cost.ts             # 비용/시간 추정 모델
│   ├── harness.ts          # 인프로세스 서버+DB 부팅 (DB 격리 가드)
│   ├── run-negotiation.ts  # 협상 1건 실행 엔진 (seed→start→auto-play→read)
│   ├── dry-run.ts          # 무료 미리보기 CLI
│   ├── run.ts              # 실행 러너 (승인 게이트 + JSONL + 상세 출력)
│   ├── report.ts           # JSONL → HTML 리포트 생성기
│   ├── catalog.ts          # 시나리오 카탈로그 HTML (카드 + 결과 오버레이)
│   ├── doctor.ts           # preflight 사전점검 (DB·API키·스키마)
│   ├── clean.ts            # 결과/테스트 DB 데이터 정리
│   └── run-one.ts          # 샘플 1건 스모크
├── results/                # (gitignore) JSONL 결과 + HTML 리포트
└── README.md
```

---

## 10. 트러블슈팅

| 증상 | 원인 / 해결 |
|------|-------------|
| `Refusing to run: DATABASE_URL must be the local test DB` | `DATABASE_URL`을 `haggle_negolab`로 export |
| `type "vector" does not exist` | `psql haggle_negolab -c "CREATE EXTENSION vector;"` (pgvector 설치 필요) |
| `Cannot find package 'sharp'` | `pnpm install` (심링크 재생성) |
| `@haggle/contracts does not provide export ...` | `pnpm --filter "./packages/*" build` (dist가 오래됨) |
| `Cannot find package '@haggle/db'` | nego-lab이 워크스페이스에 포함됐는지(`pnpm-workspace.yaml`) + `pnpm install` |
| `ERR_INVALID_ARG_TYPE paths[0]` (load-env) | nego-lab이 ESM으로 실행돼야 함. `package.json`에 `"type":"module"` 확인 |
| Postgres `became multithreaded` | `LC_ALL="en_US.UTF-8"` 지정 후 `pg_ctl`로 기동 |
| `Unknown option: 'group'` (pnpm) | 스크립트명이 `run`이면 pnpm 내장과 충돌. `run-batch` 사용 |

---

*실제 구현 최종 결정 경로는 `apps/api/src/negotiation/pipeline`이며 DeepSeek V4 Pro가
최종 가격/메시지를 정한다. 엔진 현황은 `docs/engine/SOT.md` 참고.*
