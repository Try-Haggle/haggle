# 21. HNP 에이전트 프로파일 및 툴링

**문서:** Haggle Engine Architecture v1.0.2 — Agent Profile, Tooling, and Bindings
**범위:** 에이전트 시대에 맞는 HNP discovery profile, MCP/A2A/UCP 바인딩 원칙, agent-friendly tool surface
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md) | [23_HNP_시도제한_정책.md](./23_HNP_%EC%8B%9C%EB%8F%84%EC%A0%9C%ED%95%9C_%EC%A0%95%EC%B1%85.md)

---

## 1. 왜 툴링이 중요한가

표준 프로토콜만 잘 정의되어 있어도, 실제 에이전트는 붙기 어렵습니다. 에이전트 시대의 프로토콜은 아래 두 층을 함께 가져야 합니다.

1. **wire protocol** — 정밀하고 안전한 세션 메시지 교환
2. **agent tooling surface** — 에이전트가 적은 토큰과 적은 상태 관리로 붙을 수 있는 도구

HNP는 두 층을 모두 제공해야 합니다.

---

## 2. Agent Profile

에이전트 친화적 HNP 구현체는 `/.well-known/hnp` 외에 아래 항목을 공개해야 합니다.

```json
{
  "agent_profile": {
    "agent_id": "agent.example.com",
    "display_name": "Example Seller Agent",
    "roles": ["SELLER"],
    "transports": ["rest", "mcp"],
    "supports_async_sessions": true,
    "supports_streaming": true,
    "supports_human_approval": true,
    "resources": [
      "hnp://sessions/{id}",
      "hnp://schemas/core/{revision}",
      "hnp://profiles/{agent_id}"
    ],
    "policy_capabilities": ["ai.haggle.policy.attempt-control"]
  }
}
```

---

## 3. 최소 MCP Tool Surface

MCP에서 HNP를 쓸 때 최소한 아래 tool 집합이 있어야 합니다.

| Tool | 목적 |
|------|------|
| `hnp_negotiate_capabilities` | 버전/능력 교집합 계산 |
| `hnp_create_session` | 새 협상 세션 생성 |
| `hnp_submit_proposal` | OFFER/COUNTER 제출 |
| `hnp_get_session` | 현재 세션 상태 조회 |
| `hnp_accept_proposal` | 특정 proposal 수락 |
| `hnp_reject_session` | 세션 거절 |
| `hnp_cancel_session` | 세션 취소 |
| `hnp_verify_proof` | BATNA proof 등 외부 proof 검증 |

### 3.1 설계 원칙

1. 모든 write tool은 `idempotency_key`를 받습니다.
2. 모든 read tool은 `summary`와 `full` 두 모드를 지원해야 합니다.
3. tool 응답은 항상 `selected_core_revision`과 `active_capabilities`를 포함해야 합니다.
4. quota가 적용되는 구현체는 `remaining_sessions`, `active_sessions`, `retry_after_seconds`를 요약 응답에 포함해야 합니다.

---

## 4. 최소 Resource Surface

에이전트가 긴 히스토리를 다시 다 읽지 않도록 resource를 제공합니다.

| Resource | 설명 |
|---------|------|
| `hnp://sessions/{id}` | canonical session state |
| `hnp://sessions/{id}/summary` | 최근 상태 요약 |
| `hnp://profiles/{agent_id}` | 상대 agent profile |
| `hnp://schemas/core/{revision}` | core schema |
| `hnp://conformance/{revision}` | golden vector 목록 |

---

## 5. A2A 대응

A2A 계열 시스템에서는 HNP를 아래처럼 맵핑합니다.

1. agent card에 HNP capability 선언
2. task input/output은 HNP session lifecycle로 맵핑
3. long-running negotiation은 async task + event stream으로 처리

즉, A2A는 HNP를 대체하는 것이 아니라 **HNP 세션을 담는 상위 orchestration 채널**이 됩니다.

---

## 6. UCP 대응

UCP에서는 HNP를 checkout 이전 negotiation extension으로 배치합니다.

1. Discovery는 UCP profile이 담당
2. 실제 협상 세션 메시지는 HNP core를 사용
3. 최종 합의 가격은 UCP checkout session으로 브리지

즉, UCP는 commerce orchestration, HNP는 negotiation specialization 역할을 맡습니다.

---

## 7. Agent-friendly 응답 설계

에이전트가 쓰기 쉬운 프로토콜은 사람이 읽기 쉬운 프로토콜과 조금 다릅니다. 아래 속성이 중요합니다.

1. `summary-first` 응답
2. proposal diff 제공
3. human approval 필요 여부 명시
4. retryable 여부 명시
5. 현재 세션에서 허용된 다음 액션 목록 제공
6. 현재 principal에 적용되는 quota 정보 포함
7. principal은 request payload가 아니라 인증 정보 또는 플랫폼 발급 식별자로 해석

예시:

```json
{
  "session_id": "sess_123",
  "status": "WAITING_HUMAN",
  "next_actions": ["accept", "counter", "cancel"],
  "human_approval_required": true,
  "attempt_control": {
    "remaining_sessions": 2,
    "active_sessions": 1,
    "active_sessions_on_listing": 12,
    "active_sessions_on_seller": 124,
    "retry_after_seconds": null
  },
  "latest_proposal_summary": {
    "total_price_minor": 74000,
    "changed_issues": ["price", "shipping_speed"]
  }
}
```

---

## 8. 권고 구현 순서

1. `/.well-known/hnp` + agent profile
2. MCP tool/resource 정의
3. canonical session summary resource
4. proof verification tool
5. REST/MCP/A2A binding examples

---

## 9. 최종 판단

에이전트 시대의 표준은 "스펙 문서가 있다"로 끝나지 않습니다.

누가 봐도 쓸 만한 표준이 되려면 HNP는 아래 세 가지를 동시에 보여줘야 합니다.

1. **wire-level rigor**
2. **버전/호환성 discipline**
3. **agent-friendly tooling surface**

---

*이전 문서: [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
