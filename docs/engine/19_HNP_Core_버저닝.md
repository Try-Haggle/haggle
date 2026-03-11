# 19. HNP Core 버저닝

**문서:** Haggle Engine Architecture v1.0.2 — HNP Core Versioning and Compatibility Policy
**범위:** HNP core revision 체계, capability/extension versioning, 호환성 규칙, 협상 알고리즘
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [18_HNP_표준화_프로파일.md](./18_HNP_표준화_프로파일.md) | [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md) | [21_HNP_에이전트_프로파일_및_툴링.md](./21_HNP_에이전트_프로파일_및_툴링.md) | [23_HNP_시도제한_정책.md](./23_HNP_%EC%8B%9C%EB%8F%84%EC%A0%9C%ED%95%9C_%EC%A0%95%EC%B1%85.md)

---

## 1. 목표

HNP core 버저닝의 목표는 단순히 버전 문자열을 붙이는 것이 아니라, 서로 다른 구현체가 아래 질문에 같은 답을 갖게 만드는 것입니다.

1. 지금 대화하는 상대와 같은 core를 쓰는가
2. 어떤 capability와 extension이 공통으로 가능한가
3. additive change와 breaking change를 어떻게 구분하는가
4. 언제 세션을 거절해야 하는가

---

## 2. 버저닝 원칙

HNP는 **2단계 버저닝 모델**을 사용합니다.

| 계층 | 형식 | 용도 |
|------|------|------|
| Core revision | 날짜 기반 `YYYY-MM-DD` | wire semantics와 core schema의 호환 경계 |
| Capability / Extension version | SemVer `MAJOR.MINOR.PATCH` | 각 capability의 독립 진화 |

### 2.1 왜 core는 날짜 기반인가

HNP core는 MCP/UCP처럼 **프로토콜 리비전**에 가깝습니다. 이 계층은 "이 날짜의 스냅샷을 정확히 구현하는가"가 더 중요하므로 날짜 기반이 적합합니다.

### 2.2 왜 capability는 SemVer인가

개별 capability는 독립적으로 자주 진화할 수 있습니다. 예를 들어 `competitive-pressure`는 minor field 추가가 잦을 수 있으므로 semver가 운영상 유리합니다.

---

## 3. 버전 객체

```json
{
  "core_revision": "2026-03-09",
  "capabilities": {
    "hnp.core.negotiation": { "version": "1.0.0", "required": true },
    "ai.haggle.competitive-pressure": { "version": "1.1.0", "required": false },
    "ai.haggle.batna-proof": { "version": "1.0.0", "required": false },
    "ai.haggle.policy.attempt-control": { "version": "1.0.0", "required": false }
  }
}
```

---

## 4. Core revision 규칙

### 4.1 새 core revision이 필요한 경우

아래 변경은 반드시 새 `core_revision`을 발급해야 합니다.

1. envelope 필수 필드 추가/삭제/의미 변경
2. core message type의 의미 변경
3. 상태 전이 의미 변경
4. money 표현 방식 변경
5. 오류 코드의 의미 변경

### 4.2 새 core revision이 필요 없는 경우

아래 변경은 capability 또는 문서 errata 수준에서 처리할 수 있습니다.

1. 선택 extension 추가
2. 설명 문구/예시 개선
3. non-normative implementation guidance
4. optional capability의 additive field 추가

---

## 5. Capability version 규칙

### 5.1 SemVer 적용

| 변경 | 조치 |
|------|------|
| backward-compatible field 추가 | `MINOR` 증가 |
| 설명/버그 수정, 의미 불변 | `PATCH` 증가 |
| 필수 필드 삭제, 의미 변경 | `MAJOR` 증가 |

### 5.2 호환성

1. 같은 `MAJOR` 내에서는 `MINOR/PATCH` 차이를 허용합니다.
2. `required: true` capability는 major 교집합이 없으면 세션을 시작하면 안 됩니다.
3. `required: false` capability는 교집합이 없으면 비활성화하고 core만 유지할 수 있습니다.

---

## 6. Discovery 문서

표준 구현체는 `/.well-known/hnp`를 게시해야 합니다.

```json
{
  "hnp": {
    "core_revisions": ["2026-03-09", "2026-01-15"],
    "preferred_core_revision": "2026-03-09",
    "transports": [
      { "name": "rest", "endpoint": "https://agent.example.com/hnp/v1" },
      { "name": "mcp", "endpoint": "https://agent.example.com/mcp" }
    ],
    "capabilities": {
      "hnp.core.negotiation": { "versions": ["1.0.0"], "required": true },
      "ai.haggle.competitive-pressure": { "versions": ["1.1.0", "1.0.0"], "required": false },
      "ai.haggle.policy.attempt-control": { "versions": ["1.0.0"], "required": false }
    },
    "policy_defaults": {
      "attempt_control": {
        "scope": "buyer_per_listing",
        "max_concurrent_sessions": 1,
        "max_sessions_per_window": 3,
        "max_concurrent_sessions_per_listing": null,
        "max_concurrent_sessions_per_seller": null,
        "window_seconds": 86400,
        "cooldown_seconds": 43200
      }
    },
    "auth": {
      "schemes": ["jws-detached"],
      "jwks_uri": "https://agent.example.com/.well-known/jwks.json"
    }
  }
}
```

---

## 7. 버전 협상 알고리즘

### 7.1 Core revision 선택

1. initiator는 자신이 지원하는 `core_revisions` 목록을 보냅니다.
2. responder는 교집합 중 자신이 가장 선호하는 revision을 고릅니다.
3. 교집합이 없으면 `UNSUPPORTED_VERSION`으로 종료합니다.

### 7.2 Capability 선택

1. required capability는 major 호환 교집합이 있어야 합니다.
2. optional capability는 교집합이 있으면 활성화하고, 없으면 비활성화합니다.
3. 선택 결과는 `session_init_ack`에 명시해야 합니다.

### 7.3 선택 결과 예시

```json
{
  "selected_core_revision": "2026-03-09",
  "selected_capabilities": {
    "hnp.core.negotiation": "1.0.0",
    "ai.haggle.competitive-pressure": "1.1.0",
    "ai.haggle.policy.attempt-control": "1.0.0"
  },
  "disabled_capabilities": ["ai.haggle.batna-proof"]
}
```

---

## 8. 호환성 등급

| 등급 | 의미 |
|------|------|
| `FULL` | core revision 동일, required capability 모두 호환 |
| `DEGRADED` | core는 호환, optional capability 일부 비활성 |
| `INCOMPATIBLE` | core 또는 required capability 교집합 없음 |

`DEGRADED`는 세션 시작 가능하지만, 상대가 기대한 기능 일부가 빠질 수 있으므로 session metadata에 기록해야 합니다.

---

## 9. 상태와 버전의 관계

버전 협상은 반드시 세션 생성 전에 끝나야 합니다.

1. `NEGOTIATING_VERSION` 임시 상태에서 capability 교집합 계산
2. 성공 시 `CREATED`
3. 실패 시 `FAILED_COMPATIBILITY`

이미 시작된 세션 도중 core revision을 바꾸면 안 됩니다.

---

## 10. 표준 문서상 MUST / SHOULD

### MUST

1. `core_revision` exact-match negotiation
2. required capability major compatibility 검증
3. 선택된 버전 조합을 세션 메타데이터에 기록
4. `/.well-known/hnp` 게시

### SHOULD

1. 최소 2개 core revision 동시 지원 기간 운영
2. deprecation schedule 사전 공지
3. compatibility matrix 공개

---

## 11. 폐기 정책

1. 새 core revision 공개 후 이전 revision은 최소 180일 지원합니다.
2. security issue가 있으면 예외적으로 더 빠른 차단이 가능하지만, well-known profile과 changelog에 고지해야 합니다.
3. capability major deprecation은 최소 90일 이전 공지가 필요합니다.

---

## 12. SDK/구현 버전과의 분리

중요한 원칙은 아래입니다.

1. `protocol version != SDK version`
2. `protocol revision != product release version`

예를 들어:

- HNP core revision: `2026-03-09`
- `@haggle/engine-session` package version: `0.8.0`
- Haggle product release: `v1.2.4`

이 세 버전은 서로 다른 목적을 가집니다.

---

## 13. 최종 권고

HNP는 **core revision은 날짜 기반**, **capability/extension은 semver**로 가는 것이 가장 안정적입니다.

이 방식의 장점은 다음과 같습니다.

1. core 의미론을 명확히 고정할 수 있습니다.
2. extension을 민첩하게 진화시킬 수 있습니다.
3. MCP/UCP/A2A 시대의 discovery + negotiation 패턴과 잘 맞습니다.

---

*이전 문서: [18_HNP_표준화_프로파일.md](./18_HNP_표준화_프로파일.md) | 다음 문서: [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
