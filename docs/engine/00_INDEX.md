# Haggle Engine Architecture — 문서 색인

**최종 정리:** 2026-04-13
**상태:** v1.x 엔진 코어 사양 + v2.0 LLM-First 아키텍처

> 이 폴더는 Haggle Engine의 **완전한 기술 사양서**입니다.
> 각 문서는 독립적으로 읽을 수 있으며, 상호 참조는 파일명으로 표기합니다.
>
> v2.0부터 LLM이 기본 협상 경로이며, 엔진은 심판(Referee) 역할입니다.
> 01~07번은 engine-core 수학 패키지 사양으로 여전히 유효합니다.

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
| v2.3.0 | 2026-04-13 | **Skill v2 + RefereeBriefing**: RefereeCoaching → RefereeBriefing (facts-only, 추천 제거). Skill을 자율 모듈로 재설계 (knowledge/advisor/validator/service/composite). SkillStack Hook 아키텍처, faratin-coaching을 advisor Skill로 분리. 25번 §4.2, §5 전면 개정. |
| v2.2.0 | 2026-04-13 | **NSV v2 (Negotiation State Vector)**: DY/LP 필드 제거 (coaching 중복 + 앵커링 취약), PT gap% 제거. "절대값만, 파생 지표는 coaching에 위임" 원칙. 5라인 ~100토큰. 25번 §7.3 전면 개정. |
| v2.1.0 | 2026-04-13 | NSV v1: O(1) 고정 크기 상태 인코딩, DY(Dynamics) 필드, TG(Tag Garden) 확장. → v2.2.0에서 대체 |
| v2.0.0 | 2026-04-11 | **LLM-First 아키텍처 전환**: 심판-선수 모델, 6-Stage 파이프라인, Living Memo Codec. 기존 25~31번 문서 통합 정리. |
| v1.0.2 | 2026-03-07 | **다중 Term 엔진 업그레이드**: Term 타입 시스템 + Offer Inverter, 6종 이동 분류, 베이지안 상대방 모델, 동적 마감, 선택 정책, 전술 엔진. |
| v1.0.1 | 2026-03-04 | 엔진 4-Gap: OpponentModel (EMA), 동적 베타, 효용 공간 양보 곡선, AC_next. AgentStats 시스템. |
| v1.0.0 | 2026-02-17 | 초판. 4차원 효용 + Decision Maker + Faratin 양보 곡선. |

---

## 문서 구조

### Part A: 엔진 코어 수학 (01-07)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 01 | [01_아키텍처_개요.md](./01_아키텍처_개요.md) | 4-Layer 시스템 구조, 설계 원칙. §3/§4는 v2.0 배너 참조 | L0~L3, 결정론, 스킬 경계 |
| 02 | [02_효용_함수.md](./02_효용_함수.md) | V_p, V_t, V_r, V_s 전체 수식 + 다중 Term 일반화 | U_total, 가중치, Protobuf |
| 03 | [03_양보_곡선_역산.md](./03_양보_곡선_역산.md) | Faratin 곡선, 동적 베타, AC_next, 동적 마감, Offer Inverter | β, U_target, invertVp |
| 04 | [04_상대방_모델.md](./04_상대방_모델.md) | 3종/6종 이동 분류, EMA 추적기, 베이지안 모델, Reputation Prior | classifyMove, OpponentModel |
| 05 | [05_의사결정_전술.md](./05_의사결정_전술.md) | Decision Maker 규칙, 전술 엔진, 미러링 전략, 선택 정책 | ACCEPT/COUNTER/ESCALATE |
| 06 | [06_에이전트_스탯.md](./06_에이전트_스탯.md) | 8개 스탯 전체 사양, 파라미터 변환, 6개 프리셋, 예산 제약 | AgentStats, 400포인트 |
| 07 | [07_구현_계획.md](./07_구현_계획.md) | engine-core/engine-session 수학 패키지 구현 계획 | engine-core, engine-session |

### Part B: 운영 및 인프라 (08-17)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 08 | [08_LLM_정책.md](./08_LLM_정책.md) | v1.x LLM 호출 정책, 에스컬레이션 트리거. v2.0 배너 참조 | Cold/Reactive/Review |
| 09 | [09_세션_오케스트레이션.md](./09_세션_오케스트레이션.md) | Master Strategy 구조, 전략 변경 규칙, 토폴로지 감지, 상태 머신 | MasterStrategy, Topology |
| 10 | [10_이벤트_매칭.md](./10_이벤트_매칭.md) | 대기 의도(WaitingIntent), 이벤트 흐름 시나리오, 매칭 트리거 | WaitingIntent, 양방향 매칭 |
| 11 | [11_협상_토폴로지.md](./11_협상_토폴로지.md) | 1:N, N:1, N:M 분해, Anti-Sniping, 크로스 프레셔 | BATNA, Top N, 경쟁 주입 |
| 12 | [12_장기협상_HNP.md](./12_장기협상_HNP.md) | V_t 한계, 재평가 정책, 세션 페이스, HNP v1.1, BATNA 증명 | ReEvaluation, SessionPace |
| 13 | [13_LLM_비용.md](./13_LLM_비용.md) | Grok 4.1 Fast 선정, 모델 비교, 협상당 비용, 월간 P&L | $0.001/건, 99.5% 마진 |
| 14 | [14_데이터_성능.md](./14_데이터_성능.md) | Redis Hot State, PostgreSQL Cold Storage, 성능 계약, 확장 단계 | < 200μs, 10K req/sec |
| 15 | [15_적합성_테스트.md](./15_적합성_테스트.md) | Engine Core 수학 적합성 테스트 10개 | ±0.001 허용오차 |
| 16 | [16_스킬_마켓플레이스.md](./16_스킬_마켓플레이스.md) | 스킬 유형, 인터페이스 표준, 수익 모델, SDK, 구독 연동 | SkillManifest, 10% 분배 |
| 17 | [17_확장_미결.md](./17_확장_미결.md) | V_m 예약, EvoEngine, AgentStats/OpponentModel 확장, 10개 미결 | 확장 포인트, Open Issues |

### Part C: HNP 프로토콜 표준화 (19-24)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 19 | [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md) | HNP 표준화 배경(구 18번 흡수), core revision, capability versioning | Core Versioning, Gap Catalog |
| 20 | [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md) | HNP 프로토콜 상호운용 적합성 테스트 최소 세트 | Conformance Appendix |
| 21 | [21_HNP_에이전트_프로파일_및_툴링.md](./21_HNP_에이전트_프로파일_및_툴링.md) | 에이전트 친화적 discovery, MCP/A2A/UCP 툴링 표면 | Agent Tooling |
| 22 | [22_에이전트_스탯_UI_매핑.md](./22_에이전트_스탯_UI_매핑.md) | 엔진 능력치를 제품 UI로 번역하는 기준 | Stats UI Mapping |
| 23 | [23_HNP_시도제한_정책.md](./23_HNP_시도제한_정책.md) | anti-probing 정책과 quota 표준 | Attempt Control |
| 24 | [24_남용_탐지_정책.md](./24_남용_탐지_정책.md) | 행동 기반 남용 탐지 신호와 대응 단계 | Abuse Detection |

### Part D: LLM-First 아키텍처 v2.0 (25-28)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 25 | [25_LLM_협상_설계.md](./25_LLM_협상_설계.md) | **통합 (구 25+26)** 심판-선수 모델, 6-Stage 파이프라인, Living Memo Codec, **NSV v2**, **Skill v2** (Hook 아키텍처), RefereeBriefing | Referee, 6-Stage, NSV v2, Skill v2, RefereeBriefing |
| 26 | [26_구현_현황_및_리팩토링_계획.md](./26_구현_현황_및_리팩토링_계획.md) | **통합 (구 27+29)** 구현 현황, 디렉토리 맵, Stage별 인터페이스, 마이그레이션 계획 | Implementation, Refactoring |
| 28 | [28_엔진_전략_분석_및_진화_로드맵.md](./28_엔진_전략_분석_및_진화_로드맵.md) | 대기업 구조적 한계 분석, 철학 점검, LLM 발전 연동 전략 | Strategy & Evolution |

### Part E: 데이터 (31)

| # | 파일 | 내용 | 핵심 키워드 |
|---|------|------|------------|
| 31 | [31_전체_데이터_영속화_정책.md](./31_전체_데이터_영속화_정책.md) | **확장 (구 30번 흡수)** 데이터 해자 배경, 전수 저장, 해시 체인, 암호화/보존 정책 | Data Moat, Persistence |

---

## 읽기 가이드

### 처음 읽는 경우
`01 → 02 → 03 → 05 → 06` 순서를 권장합니다. 그 다음 v2.0 아키텍처는 `25 → 26` 순서로.

### 특정 주제만 필요한 경우
- **수학 공식**: `02_효용_함수.md` + `03_양보_곡선_역산.md`
- **상대방 분석**: `04_상대방_모델.md`
- **의사결정 로직**: `05_의사결정_전술.md`
- **사용자 설정**: `06_에이전트_스탯.md`
- **v2.0 LLM 아키텍처 (설계)**: `25_LLM_협상_설계.md` (심판 모델, 6-Stage, Codec, **NSV v2 §7.3**, **Skill v2 §5**, RefereeBriefing §4.2)
- **v2.0 구현 현황 + 계획**: `26_구현_현황_및_리팩토링_계획.md` (디렉토리, 비용, 마이그레이션)
- **엔진 전략/진화**: `28_엔진_전략_분석_및_진화_로드맵.md`
- **v1.x LLM 정책**: `08_LLM_정책.md` + `13_LLM_비용.md`
- **세션/매칭 흐름**: `09_세션_오케스트레이션.md` + `10_이벤트_매칭.md`
- **멀티 세션 협상**: `11_협상_토폴로지.md` + `12_장기협상_HNP.md`
- **HNP 표준화**: `19_HNP_Core_버저닝.md` → `20_HNP_적합성_테스트_부록.md` → `21_HNP_에이전트_프로파일_및_툴링.md`
- **보안 정책**: `23_HNP_시도제한_정책.md` + `24_남용_탐지_정책.md`
- **UI 매핑**: `22_에이전트_스탯_UI_매핑.md`
- **데이터/해자**: `31_전체_데이터_영속화_정책.md`
- **인프라/성능**: `14_데이터_성능.md`
- **적합성 검증**: `15_적합성_테스트.md` (엔진 수학) + `20_HNP_적합성_테스트_부록.md` (프로토콜)
- **스킬 생태계**: `16_스킬_마켓플레이스.md`
- **향후 계획**: `17_확장_미결.md`

---

## 아카이브

다음 문서들은 통합/대체되어 `docs/archive/engine/`로 이동되었습니다:

| 파일 | 사유 |
|------|------|
| `Haggle_Gap_Analysis.md` | v1.0.0 이전 초안, 02~04번에 완전 흡수 |
| `18_HNP_표준화_프로파일.md` | 19번 서론으로 흡수 |
| `25_LLM_협상_아키텍처.md` | 새 25번(통합본)으로 대체 |
| `26_LLM_Native_협상_파이프라인.md` | 새 25번(통합본)으로 대체 |
| `27_LLM_엔진_구현_현황.md` | 새 26번(통합본)으로 대체 |
| `29_6Stage_리팩토링_구현계획.md` | 새 26번(통합본)으로 대체 |
| `30_데이터_해자_설계.md` | 31번에 흡수 |

---

*최종 정리: 2026-04-13. 33개 → 28개 문서 (7개 archive).*
