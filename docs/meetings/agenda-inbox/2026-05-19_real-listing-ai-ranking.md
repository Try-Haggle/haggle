---
include_in_meeting: true
status: proposed
meeting: next
created: 2026-05-19
topic: real-listing-ai-ranking
---

# 실매물 기반 AI 협상 랭킹 설계

## 배경

초기 아이디어는 모델 평가 벤치마크였지만, MVP에서 더 중요한 제품 표면은 사람들이 자신의 AI 협상 성과를 실제 물품 기준으로 순위화해서 볼 수 있는 것이다.

고정 챌린지 20~50개를 푸는 방식보다, 실제 판매 중인 물품 또는 실제 협상 결과를 기준으로 AI가 얼마나 좋은 딜을 만들었는지 보여주는 랭킹이 더 제품 가치에 가깝다.

## 핵심 방향

- 실제 매물과 실제 협상 결과를 평가 단위로 삼는다.
- 서로 다른 제품을 단순 할인액이나 할인율로 비교하지 않는다.
- 유사 매물/유사 협상 cohort 안에서 상위 또는 하위 몇 퍼센트인지로 평가한다.
- 점수는 임의 절대점수가 아니라 contextual percentile이어야 한다.
- 공식 모델 벤치마크는 나중에 같은 scoring engine 위에 얹는 별도 표면으로 둔다.

## 점수 원칙

가격 성과가 중심이지만 가격만 보지 않는다. 다음 신호를 함께 본다.

- Deal Outcome Percentile: 시장 기준가 대비 실제 최종 가격/순수령액 성과
- Terms/Risk Percentile: 배송, 구성품, 보증, 검수, 결제 안전성, 분쟁 리스크 등 비가격 조건과 리스크 완화
- Counteroffer Strategy Percentile: 역제안 품질, 양보 흐름, 조건 교환, 비가격 조건 활용
- HNP/Protocol Quality Percentile: HNP 규칙 준수, ProtocolDecision 일관성, RefereeBriefing 반영도

추천 표기:

```text
Overall Haggle Score
= Deal Outcome Percentile
+ Terms/Risk Percentile
+ Counteroffer Strategy Percentile
+ HNP/Protocol Quality Percentile
```

사용자에게는 하나의 점수만 보여주기보다 다음처럼 scorecard로 보여주는 것이 더 설명 가능하다.

```text
Overall: Top X%
Price Outcome: Top X%
Terms / Risk: Top X%
Counteroffer Strategy: Top X%
HNP / Protocol Quality: Top X%
```

## 용어 정리

`Tool Score`, `툴 점수`, MCP tool 사용량은 점수 항목으로 쓰지 않는다.

현재 Haggle의 MCP 툴은 내부 연결/통합 도구이지, 유저나 협상 AI가 제품 표면에서 선택적으로 쓰는 협상 기능이 아니다. 따라서 MCP tool call 수나 사용 여부를 점수화하면 잘못된 인센티브가 생긴다.

대신 Haggle 내부 용어로 다음을 사용한다.

- 조건 협상 활용도
- 역제안 전략
- HNP/Protocol 품질
- RefereeBriefing 반영도
- ProtocolDecision 품질

향후 제품에 실제 agent-facing 기능이 생기더라도 사용 횟수를 점수화하지 말고, 그 기능이 협상 결과 개선에 기여했는지를 별도 검증해야 한다.

## 회의에서 결정할 것

1. 최소 cohort 정의: 어떤 협상끼리 비교해야 공정한가?
2. Phase 0 카테고리별 시장 기준가 산정에 필요한 필드는 무엇인가?
3. 달러 가치로 환산 가능한 비가격 조건은 무엇인가?
4. 달러 가치로 환산하지 않고 별도 percentile로 둘 조건은 무엇인가?
5. 공개 UI는 전체 점수 하나가 좋은가, scorecard가 좋은가?
6. 리더보드에 reliable 라벨을 붙이려면 카테고리별 데이터가 몇 건 필요할까?
7. 공식 모델 벤치마크는 실매물 랭킹 루프 이후로 미루는가?

## 추천 결정

MVP는 공식 모델 벤치마크가 아니라 실매물 기반 AI 협상 랭킹에 집중한다. 벤치마크는 내부 scoring engine으로 유지하고, 실거래/실협상 데이터가 충분히 쌓인 뒤 모델 벤치마크를 공개 표면으로 확장한다.
