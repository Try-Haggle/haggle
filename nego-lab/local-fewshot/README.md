# fewshot-lab — 로컬 협상 비교 대시보드

기존 프롬프트(baseline)와 `fewshot.md`를 **같은 시나리오에 두 번** 돌려
타결가·대사·저장용량 민감도를 비교한다. DeepSeek 비용이 든다.

프로덕션 `DeepSeekAdapter`에는 아직 넣지 않는다. 여기서 먼저 잰다.

## 다른 컴퓨터에서 이어서

```bash
git fetch origin
git checkout docs/w2026-08-22-meeting
git pull
```

이 브랜치에 올라온 것: `fewshot.md`(전자제품 흐름 예시), `tag-prompts.md`(패밀리별 초안),
대시보드·서버·패치 코드.

**이 브랜치에 없는 것 — 새 컴퓨터에서 다시 만들어야 한다.**

1. **DeepSeek 키.** 레포 루트 `.env`에 `DEEPSEEK_API_KEY`를 넣는다. git에 없다.
2. **로컬 DB `haggle_negolab`.** Postgres 데이터는 안 올라간다. 아래 최초 셋업을 한 번 한다.
3. **이전 실행 결과.** `results/`는 gitignore다. 비교 로그가 필요하면 이 컴퓨터의
   `nego-lab/local-fewshot/results/`를 따로 복사한다. 없어도 실험을 다시 돌리면 된다.
4. **`apps/api/.env`의 `DATABASE_URL`.** 원격 DB를 가리키면 위험하다. `start.sh`가
   셸의 `haggle_negolab` URL을 잠그므로, 반드시 아래처럼 export한 뒤 켠다.

## 켜기

nego-lab과 같은 로컬 DB가 필요하다. 최초 1회는 [nego-lab/README.md](../README.md) 사전 준비를 먼저 한다.

```bash
export DATABASE_URL="postgresql://$(whoami)@localhost:5432/haggle_negolab"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# 최초 1회, 또는 shared dist가 오래됐을 때
pnpm --filter @haggle/shared build
pnpm --filter @haggle/db db:push   # DATABASE_URL이 haggle_negolab 인 상태에서

./nego-lab/local-fewshot/start.sh
# 브라우저: http://127.0.0.1:4177
```

기본 실험은 iPhone 저장용량 스윕(128GB / 256GB / 512GB / 1TB).
각 용량을 baseline 한 번, few-shot 한 번 → 반복 1회면 **협상 8건**, 상한 약 **$0.64**.

## 안전

- `DATABASE_URL`에 `haggle_negolab`이 없으면 서버가 뜨지 않는다.
- 실행 전 대시보드에서 예상 비용을 보고 확인을 눌러야 한다.
- 결과는 `nego-lab/local-fewshot/results/`에만 쌓인다. 커밋하지 않는다.
