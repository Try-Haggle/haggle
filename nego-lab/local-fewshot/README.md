# fewshot-lab — 스테이징과 같은 협상 경로

라운드 경로는 스테이징 웹과 같다.

```
enrichTagsWithTaxonomy(title) → listingDrafts.tags
buildCategoryCriteriaScaffold(tags) + seller stance
publishDraft
POST /negotiations/start
POST /negotiations/sessions/:id/auto-play/next
executeStagedNegotiationRound → decide → DeepSeek
```

스테이징 웹에 토글은 없다. 실험은 로컬 `haggle_negolab` + DeepSeek.

그룹 D는 제목과 공개 호가를 용량에 맞춘다. 128 $800/$700, 256 $900/$780, 512 $1100/$950, 1TB $1300/$1130. 구매자 예산·목표도 호가에 비례한다. 엔진에 용량 단가표는 없다.

`--retail-ab`는 같은 케이스를 **시세 스킬 없음 / 있음**으로 두 번 돌린다. 있음이면 `retail-msrp`가 해당 제품의 용량별 신제품 출시가를 Market 칸에만 넣는다. 오프닝·타결가가 아니다.

## 켜기

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/haggle_negolab"
./nego-lab/local-fewshot/start.sh
# http://127.0.0.1:4177
```

```bash
pnpm --filter @haggle/nego-lab compare-fewshot -- --group D --repeat 1 --dry-run
pnpm --filter @haggle/nego-lab compare-fewshot -- --group D --repeat 1 --yes
pnpm --filter @haggle/nego-lab compare-fewshot -- --group D --repeat 1 --retail-ab --yes
pnpm --filter @haggle/nego-lab compare-fewshot -- --group F --repeat 1 --yes
# Group F: asks $22 / $55 / $80 → Flash. HARD stances are pre-filled like D.
```

반복 1회면 협상 4건(스테이징만), 상한 약 **$0.32**. `--retail-ab`면 8건, 상한 약 **$0.64**.

각 건과 잡 끝에 DeepSeek 실측 토큰·캐시 히트·추정 요금(`tokens=… $… cache …%`)을 찍는다. 요금은 V4 Pro 피크/오프피크 + cache hit/miss. 대시보드 청구와 1센트 단위로 다를 수 있다.
