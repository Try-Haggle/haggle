# 코드 네이밍 컨벤션 — 협상 에이전트 & 빌더 챗

> 협상 에이전트 / 빌더 챗 관련 코드의 **이름 단일화 규칙**. 새 코드는 반드시 이 표준을 따르고,
> 옛/외부 브랜치에서 들어온 다른 이름(예: `AgentProfile`, `Advisor*`)은 머지 시 이쪽으로 통일한다.

---

## 핵심 규칙

1. **협상 에이전트 관련 식별자에는 항상 `NegotiationAgent…`** 를 쓴다. 단독 `Agent`, `AgentProfile` 금지.
2. **빌더 챗은 `NegotiationAgentBuilderChat` / "builder chat"** 으로 부른다. `StrategyChat`, `advisor chat` 금지.
3. **빌드 세션 상태의 단일 소스는 `AgentBuilderState`** (`@haggle/shared`). 화면(위저드·에이전트 페이지·buyer-landing·edit)마다 따로 만들지 않는다.
4. **코드 내 모든 것, 특히 UI에 보이는 문자열은 영어.** (사용자 노출 한글 금지)

---

## 표준 용어 (canonical)

| 개념 | 표준 이름 | 쓰지 말 것 (legacy/외부) |
|------|-----------|--------------------------|
| 저장된 에이전트 | `NegotiationAgent` | `Agent`(단독), `AgentProfile` |
| 프리셋 / 프리셋 id | `NegotiationAgentPreset`, `NegotiationAgentPresetId` | `NegotiationPreset`(Agent 빠진), 8-stat 프리셋(`fox` 등은 legacy 경로) |
| 빌드 세션 상태 | `AgentBuilderState` | `NegotiationAgentDraft`(제거됨) |
| 빌더 챗 컴포넌트 | `NegotiationAgentBuilderChat` | `StrategyChat`, advisor chat |
| 빌더 챗 메모리 | `NegotiationAgentBuilderMemory` | `AdvisorMemory` |
| 챗이 돌려주는 전략(4 weights + 4 curves) | `ChatStrategy` | — |
| 세션/리스팅 스냅샷 필드 | `negotiationAgentSnapshot` | `negotiationAgentDraft`(옛), `strategyConfig` |
| 프리셋 id 필드 | `negotiationAgentPresetId` | `agentPresetId`, 맥락 모호한 `presetId` |
| 가격 의미 헬퍼 | `priceSemantics` (seller=floor, buyer=ceiling) | — |

## 파생/직렬화 헬퍼 (단일 구현, `@haggle/shared`)

- `resolveEffectivePreset(state)` — 베이스 프리셋 + override → 완전 해석된 프리셋 (UI·직렬화가 읽음)
- `engineParamsFromPreset(preset)` — 12개 엔진 knob 추출 (모든 직렬화 경계가 이걸 사용 → 필드 누락 방지)
- `applyChatStrategyToState(state, strategy)` — 챗 전략을 빌드 상태에 반영 (스텟 변경)
- `builderStateFromAgentRow(agent, side)` / `createBuilderState({side, presetId})` — 빌드 상태 생성
- `agentStrategySnapshotFromState(state, memory)` — 백엔드 스냅샷 직렬화 (web)

> 엔진 knob/weights를 손으로 나열하지 말 것. 항상 위 헬퍼를 거쳐 **전부** 전달한다.

---

## API 경로

| 용도 | 경로 |
|------|------|
| 에이전트 CRUD | `/negotiations/agents` |
| 빌더 챗 1턴 | `/negotiations/agents/builder/chat-turn` |
| 협상 시작 | `/negotiations/start` |

## 가중치 / 파라미터 이름

- 4D weights: `w_p`(price), `w_t`(time), `w_r`(risk), `w_s`(social) — 합 = 1
- engineParams(behavior curves): `alpha`, `beta`, `u_threshold`, `u_aspiration`, `anchor_ratio`, `v_t_floor`, `w_rep`, `r_score_minimum`, `i_completeness_minimum`, `v_s_base`, `n_threshold`, `late_round_aggression_modifier`

---

## 머지 시 통일 대상 (외부/옛 이름 → 표준)

| 들어오는 이름 | 통일 |
|---------------|------|
| `AgentProfile` | `NegotiationAgent` |
| `NegotiationPreset*` | `NegotiationAgentPreset*` |
| `StrategyChat` | `NegotiationAgentBuilderChat` |
| `AdvisorMemory`, `advisor-demo-types`, `analyzeAdvisorTurn`, `saveAdvisorMemory` | `NegotiationAgentBuilder*` |
| `NegotiationAgentDraft` | `AgentBuilderState` |

---

*Last Updated: 2026-06-17*
