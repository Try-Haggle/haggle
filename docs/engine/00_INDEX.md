# Haggle Engine Architecture v2.0.0 — 문서 색인

**버전:** 2.0.0
**작성일:** 2026-03-16
**상태:** 구현 사양서 (개발 승인 완료)

> 이 폴더는 Haggle Engine Core의 **완전한 기술 사양서**입니다.
> 각 문서는 독립적으로 읽을 수 있으며, 상호 참조는 파일명으로 표기합니다.

---

## 참조 논문

- Faratin, P., Sierra, C., & Jennings, N.R. (1998). *Negotiation Decision Functions for Autonomous Agents.* Robotics and Autonomous Systems, 24(3-4), 159-182.
- Jonker, C.M., Hindriks, K.V., Wiggers, P., & Broekens, J. (2012). *Negotiating Agents.* AI Magazine, Fall 2012, 79-91.
- Jennings, N.R., Parsons, S., Sierra, C., & Faratin, P. *Automated Negotiation.* Proceedings of the 5th PAAM.
- Hindriks, K.V. & Tykhonov, D. (2008). *Opponent Modelling in Automated Multi-Issue Negotiation Using Bayesian Learning.* AAMAS 2008.

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| v2.0.0 | 2026-03-16 | **vNext 다중이슈 엔진 구현**: (1) Multi-Issue 효용 모델 U_total = clip(U_contract - C_risk + B_rel, 0,1), (2) J(ω) Offer Search, (3) Parallel Session EU + Dynamic BATNA, (4) NEAR_DEAL 밴드 + proximity, (5) Direction-aware 상대 모델 (enum/boolean/scalar), (6) Offer 검증 + 가중치 검증, (7) NegotiationEngine 인터페이스, (8) executeMultiIssueRound 파이프라인, (9) 수치 안정성 (beta=0, T=0 가드), (10) Settlement 재귀 정렬 |
| v1.0.2 | 2026-03-07 | **다중 이슈 엔진 업그레이드**: (1) 이슈 타입 시스템 + Offer Inverter, (2) 6종 이동 분류 (Jonker Fig.2), (3) 베이지안 상대방 모델 + Reputation Prior, (4) 동적 마감 (Faratin 4.2.1), (5) 선택 정책, (6) 전술 엔진. v1.0.1 하위 호환. |
| v1.0.1 | 2026-03-04 | 엔진 4-Gap: OpponentModel (EMA), 동적 베타, 효용 공간 양보 곡선, AC_next. AgentStats 시스템. |
| v1.0.0 | 2026-02-17 | 초판. 4차원 효용 + Decision Maker + Faratin 양보 곡선. |

---

## 문서 구조

### Part A: 엔진 코어 수학 (01-07)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 01 | [01_아키텍처_개요.md](./01_아키텍처_개요.md) | 4-Layer 시스템 구조, 설계 원칙, Hot/Cold Path | L0~L3, 결정론, 스킬 경계 |
| 02 | [02_효용_함수.md](./02_효용_함수.md) | V_p, V_t, V_r, V_s 전체 수식 + 다중 이슈 일반화 + vNext 다중이슈 U_contract 모델, 검증 | U_total, 가중치, Protobuf |
| 03 | [03_양보_곡선_역산.md](./03_양보_곡선_역산.md) | Faratin 곡선, 동적 베타, AC_next, 동적 마감, Offer Inverter + J(ω) Offer Search, 수치안정성 가드 | β, U_target, invertVp |
| 04 | [04_상대방_모델.md](./04_상대방_모델.md) | 3종/6종 이동 분류, EMA 추적기, 베이지안 모델, Reputation Prior + Direction-aware 추적, enum/boolean 지원 | classifyMove, OpponentModel |
| 05 | [05_의사결정_전술.md](./05_의사결정_전술.md) | Decision Maker 규칙, 전술 엔진, 미러링 전략, 선택 정책 + NEAR_DEAL 밴드, Parallel Session EU | ACCEPT/COUNTER/ESCALATE |
| 06 | [06_에이전트_스탯.md](./06_에이전트_스탯.md) | 8개 스탯 전체 사양, 파라미터 변환, 6개 프리셋, 예산 제약 | AgentStats, 400포인트 |
| 07 | [07_구현_계획.md](./07_구현_계획.md) | Phase별 구현 순서, 패키지 배치, 테스트 전략, 리스크 | engine-core, engine-session |

### Part B: 운영 및 인프라 (08-17)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 08 | [08_LLM_정책.md](./08_LLM_정책.md) | LLM 호출 지점 3가지, 에스컬레이션 트리거, 제어 장치, 캐싱 | Cold/Reactive/Review, 세션당 8회 |
| 09 | [09_세션_오케스트레이션.md](./09_세션_오케스트레이션.md) | Master Strategy 구조, 전략 변경 규칙, 토폴로지 감지, 상태 머신 | MasterStrategy, Topology |
| 10 | [10_이벤트_매칭.md](./10_이벤트_매칭.md) | 대기 의도(WaitingIntent), 이벤트 흐름 시나리오, 매칭 트리거 | WaitingIntent, 양방향 매칭 |
| 11 | [11_협상_토폴로지.md](./11_협상_토폴로지.md) | 1:N, N:1, N:M 분해, Anti-Sniping, 크로스 프레셔 | BATNA, Top N, 경쟁 주입 |
| 12 | [12_장기협상_HNP.md](./12_장기협상_HNP.md) | V_t 한계, 재평가 정책, 세션 페이스, HNP v1.1, BATNA 증명 | ReEvaluation, SessionPace |
| 13 | [13_LLM_비용.md](./13_LLM_비용.md) | Grok 4.1 Fast 선정, 모델 비교, 협상당 비용, 월간 P&L | $0.001/건, 99.5% 마진 |
| 14 | [14_데이터_성능.md](./14_데이터_성능.md) | Redis Hot State, PostgreSQL Cold Storage, 성능 계약, 확장 단계 | < 200μs, 10K req/sec |
| 15 | [15_적합성_테스트.md](./15_적합성_테스트.md) | 10개 적합성 테스트 (효용, 경쟁, 스탯, E2E) | ±0.001 허용오차 |
| 16 | [16_스킬_마켓플레이스.md](./16_스킬_마켓플레이스.md) | 스킬 유형, 인터페이스 표준, 수익 모델, SDK, 구독 연동 | SkillManifest, 10% 분배 |
| 17 | [17_확장_미결.md](./17_확장_미결.md) | V_m 예약, EvoEngine, AgentStats/OpponentModel 확장, 10개 미결 | 확장 포인트, Open Issues |

---

## 읽기 가이드

### 처음 읽는 경우
`01 → 02 → 03 → 05 → 06` 순서를 권장합니다. 운영/인프라는 `08 → 09 → 11 → 13` 순서로.

### 특정 주제만 필요한 경우
- **수학 공식이 궁금하면**: `02_효용_함수.md` + `03_양보_곡선_역산.md`
- **상대방 분석이 궁금하면**: `04_상대방_모델.md`
- **의사결정 로직이 궁금하면**: `05_의사결정_전술.md`
- **사용자 설정이 궁금하면**: `06_에이전트_스탯.md`
- **구현 계획이 궁금하면**: `07_구현_계획.md`
- **LLM 사용 정책이 궁금하면**: `08_LLM_정책.md` + `13_LLM_비용.md`
- **세션/매칭 흐름이 궁금하면**: `09_세션_오케스트레이션.md` + `10_이벤트_매칭.md`
- **멀티 세션 협상이 궁금하면**: `11_협상_토폴로지.md` + `12_장기협상_HNP.md`
- **인프라/성능이 궁금하면**: `14_데이터_성능.md`
- **적합성 검증이 궁금하면**: `15_적합성_테스트.md`
- **스킬 생태계가 궁금하면**: `16_스킬_마켓플레이스.md`
- **향후 계획이 궁금하면**: `17_확장_미결.md`

### v1.0.2 신규 내용만 필요한 경우
각 문서에서 `(v1.0.2 신규)` 또는 `(v1.0.2 확장)` 표기를 찾으세요.

### v2.0 신규 내용만 필요한 경우
각 문서에서 `(v2.0 신규)` 또는 `(v2.0 구현)` 표기를 찾으세요.

---

*이 색인은 Haggle Engine v2.0.0의 완전한 기술 사양서 세트에 대한 라우팅 문서입니다.*
