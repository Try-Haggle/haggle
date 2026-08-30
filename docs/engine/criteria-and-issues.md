# Criteria와 HNP issues

**상태:** 2026-08-24 정행. 이름과 Decide 시스템 프롬프트 계약.
**관련:** `W2026-08-22-02`

태그가 연 질문과, 봉투에 실리는 공개 값을 섞지 않기 위한 문서다.
전체 협상 흐름은 [`tag-spec-fewshot.md`](./tag-spec-fewshot.md). Decide 블록은 [`decide-prompt-contract.md`](./decide-prompt-contract.md). 와이어는 [`../protocol/HNP.md`](../protocol/HNP.md).

---

## 한 줄

**criteria**는 태그가 물은 질문이다. **issue**는 그 답이 공개 와이어에 실렸을 때의 칸이다. 같은 사실이 두 층에 있을 수 있지만, 이름이 같지는 않다.

---

## 두 층

| | criteria | HNP issue |
|---|---|---|
| 묻는 것 | 이 종류면 무엇을 고를지 | 이미 밝힌 값을 상대와 맞춰 둘지 |
| 언제 생김 | 태그 가든이 정확한 태그를 고른 뒤 | 호스트가 봉투 `issues[]`에 넣을 때 |
| 코드 | `NegotiationCheck` / `categoryCriteria` | `hnp.issue.*` |
| HARD / SOFT | 있음. HARD=게이트, SOFT=가격 레버 | 없음. 공개 값의 칸일 뿐 |
| 누가 보나 | 우리 엔진·Decide | 상대 에이전트·공개 compact state |

판매자가 `배터리 87%`를 고르면 그건 criteria `battery_health`의 답이다.
호스트가 그 값을 봉투에 넣으면 그때 `hnp.issue.condition.battery_health = 87%`가 된다.

호스트는 criteria에서 issue ID를 지어 넣지 않는다. 지금 Haggle 호스트 봉투는 `issues: []`다. 가격은 `total_price`로 간다.

---

## 겹침

겹치는 것은 **칸이 두 개**가 아니라 **같은 사실이 두 층**에 있는 것이다.

Decide에 이렇게 가르친다.

- 겹치면 한 사실이다. 두 번 묻지 않는다.
- criteria에만 있으면 엔진 질문이다. issue ID를 만들지 않는다.
- issue에만 있으면 거래 조건이다. 태그가 연 질문이 아니다.

HNP 코어 issue는 적다. 가격, 외관 등급, 배터리, 배송 창, 워런티, 번들, 결제.

| 사실 | criteria | 코어 issue |
|---|---|---|
| 배터리 87% | `battery_health` | `hnp.issue.condition.battery_health` |
| 외관 B | `cosmetic_grade` | `hnp.issue.condition.grade` |
| 남은 워런티 | `battery_warranty_remaining` 등 | `hnp.issue.warranty.remaining` |
| Find My 꺼짐 | `find_my_status` | 없음 |
| IMEI / 할부 / 용량 | 각 criteria | 없음 |
| 이번 호가 $480 | 없음 | `hnp.issue.price.total` (또는 `total_price`) |

---

## 아이폰 17 프로

17 프로 전용 노드는 없다. 태그 `iphone` / `아이폰` / `iphone-17-pro`가 **전자제품 → 폰 → 아이폰**을 연다.

**Criteria (질문이 열리는 것)**

| | id | 질문 |
|---|---|---|
| HARD | `imei_verification` | IMEI가 깨끗한지 |
| HARD | `financing_paid_off` | 할부 완납인지 |
| HARD | `water_damage` | 침수 없는지 |
| HARD | `find_my_status` | Find My 꺼졌는지 |
| SOFT | `working_status` | 정상 작동인지 |
| SOFT | `cosmetic_grade` | 외관 등급 |
| SOFT | `battery_health` | 배터리 % |
| SOFT | `carrier_lock` | 언락인지 |
| SOFT | `storage_capacity` | 용량 |

**Issues (지금 와이어)**
코어 이름으로 갈 수 있는 것은 배터리·외관·가격뿐이다. Find My와 용량은 criteria로만 남는다.

---

## Decide few-shot

Decide LLM을 부를 때마다 시스템 프롬프트에 아래가 **항상** 붙는다.

1. **범례** — 처음 보는 모델용. criteria가 뭔지, HARD/SOFT가 JSON action을 어떻게 바꾸는지, HOLD와 REJECT의 차이, 답을 어디서 읽는지.
2. **이 태그가 연 카드** — 열린 criteria마다 한 장. Meaning / Your move / What to say / Wire.

카드는 행동을 가르친다. “256은 항상 $480” 같은 대본은 넣지 않는다.
이번 매물의 답은 유저 프롬프트 LISTING / STRATEGY에만 있다.

구현: `apps/api/src/negotiation/prompts/criteria-fewshot.ts`
호출: `decide-system-prompt.ts` → 매 Decide `callLLM`

---

## 스킬은 세 번째 층

criteria 카드와 HNP issue 다음에, 엔진 스킬이 지식·시세·전술을 붙인다. 칸은 `## Skills`. 스킬은 issue id를 만들지 않고, 바닥을 바꾸지 않는다. 프로토콜 확장점은 issue namespace와 evidence이지 스킬 플러그인이 아니다. [`decide-prompt-contract.md`](./decide-prompt-contract.md) · [`../protocol/HNP.md`](../protocol/HNP.md).
