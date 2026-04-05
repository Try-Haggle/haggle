# 23. HNP 시도제한 정책

**문서:** Haggle Engine Architecture v1.0.2 — Attempt Control and Anti-Probing Policy
**범위:** 무료 서비스 전제에서 협상 probing을 억제하기 위한 표준 정책 계층, discovery 노출 방식, 기본값, 오류 코드
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [18_HNP_표준화_프로파일.md](./18_HNP_%ED%91%9C%EC%A4%80%ED%99%94_%ED%94%84%EB%A1%9C%ED%8C%8C%EC%9D%BC.md) | [19_HNP_Core_버저닝.md](./19_HNP_Core_%EB%B2%84%EC%A0%80%EB%8B%9D.md) | [20_HNP_적합성_테스트_부록.md](./20_HNP_%EC%A0%81%ED%95%A9%EC%84%B1_%ED%85%8C%EC%8A%A4%ED%8A%B8_%EB%B6%80%EB%A1%9D.md) | [21_HNP_에이전트_프로파일_및_툴링.md](./21_HNP_%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8_%ED%94%84%EB%A1%9C%ED%8C%8C%EC%9D%BC_%EB%B0%8F_%ED%88%B4%EB%A7%81.md)

---

## 1. 목표

Haggle은 초기 단계에서 **무료 서비스**를 전제로 한다. 따라서 협상 남용 억제는 가격 정책이 아니라 **정책 제한(policy control)** 로 달성해야 한다.

이 문서의 목표는 아래 두 가지다.

1. 정상 사용자의 협상을 과도하게 막지 않는다.
2. 에이전트가 병렬 세션과 반복 probing으로 seller 전략을 추론하는 비용을 높인다.

---

## 2. 표준 위치

시도제한은 HNP Core가 아니라 **정책 확장 capability** 로 정의한다.

- capability name: `ai.haggle.policy.attempt-control`
- required: `false`
- versioning: SemVer

표준은 값 자체가 아니라 **표현 방식과 해석 방식** 을 고정해야 한다.

---

## 3. 기본 개념

표준 구현체는 최소한 아래 네 가지를 구분해야 한다.

1. `concurrent sessions`
2. `session attempts per window`
3. `window`
4. `cooldown`

핵심 보호 대상은 `한 buyer가 같은 listing에 대해 여러 엔진/세션을 동시에 만들거나, 짧은 시간 안에 반복 생성하는 것`이다.
`round cap`은 선택 정책일 수는 있지만, 이 문서의 기본 보호 수단은 아니다.

---

## 4. principal 정의

표준은 buyer identity를 하나의 일반화된 `principal` 개념으로 본다.

우선순위 예시는 아래와 같다.

1. verified `buyer_account_id`
2. signed `buyer_agent_id`
3. listing-scoped `visitor_grant`
4. platform-issued anonymous fingerprint

중요한 점은 `request body` 의 `counterparty_id` 같은 자기신고식 값은 principal로 쓰면 안 된다는 것이다.
그 값은 표시용 메타데이터로는 남길 수 있지만, quota 계산은 반드시 **검증되거나 플랫폼이 발급한 principal** 기준으로 해야 한다.
같은 principal에 대해 같은 제한이 적용되어야 한다.

공유 링크 기반 익명 유입은 단순 IP/UA fingerprint보다, 링크 랜딩 시 서버가 발급하는 `listing visitor grant` 를 우선 사용하는 것이 권고된다.

---

## 5. 정책 객체

```json
{
  "attempt_control": {
    "scope": "buyer_per_listing",
    "principal_type": "authenticated_credential",
    "max_concurrent_sessions": 1,
    "max_sessions_per_window": 3,
    "max_concurrent_sessions_per_listing": null,
    "max_concurrent_sessions_per_seller": null,
    "window_seconds": 86400,
    "cooldown_seconds": 43200,
    "remaining_sessions": 2,
    "active_sessions": 1,
    "active_sessions_on_listing": 2,
    "active_sessions_on_seller": 4,
    "retry_after_seconds": null
  }
}
```

### 5.1 scope 값

표준 권고 scope 값:

- `buyer_per_listing`
- `buyer_per_seller`
- `buyer_per_marketplace`

MVP 기본값은 `buyer_per_listing` 을 권고한다.

---

## 6. 무료 서비스 기준 권고 기본값

초기 무료 운영 기준 권고값은 아래와 같다.

- `max_concurrent_sessions_per_buyer_per_listing = 1`
- `max_sessions_per_buyer_per_listing_per_window = 3`
- `max_concurrent_sessions_per_listing = null` (기본 비활성)
- `max_concurrent_sessions_per_seller = null` (기본 비활성)
- `window_seconds = 86400`
- `cooldown_seconds = 43200`

이 값들은 **표준 필수값** 이 아니라 **권고 프로파일** 이다.
정상적인 공개 링크 트래픽을 막지 않기 위해, listing/seller 전체 cap은 기본적으로 비활성화하는 것이 권고된다.

---

## 7. discovery 노출 방식

`/.well-known/hnp` 또는 상위 commerce profile은 attempt control capability와 기본 정책을 광고해야 한다.

```json
{
  "hnp": {
    "capabilities": {
      "hnp.core.negotiation": { "versions": ["1.0.0"], "required": true },
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
    }
  }
}
```

세션 생성 응답에는 **현재 세션에 실제로 적용되는 값** 이 포함되어야 한다.

---

## 8. 오류 코드

표준 구현체는 아래 오류 코드를 지원해야 한다.

| 코드 | 의미 |
|------|------|
| `ATTEMPT_LIMIT_EXCEEDED` | window 안의 session quota 초과 |
| `CONCURRENT_SESSION_LIMIT_EXCEEDED` | 동시 활성 세션 수 초과 |
| `LISTING_CONCURRENT_SESSION_LIMIT_EXCEEDED` | 같은 listing의 전체 활성 세션 수 초과 |
| `SELLER_CONCURRENT_SESSION_LIMIT_EXCEEDED` | 같은 seller의 전체 활성 세션 수 초과 |
| `COOLDOWN_ACTIVE` | cooldown 기간 중 |
| `PRINCIPAL_UNVERIFIED` | 정책 계산에 필요한 principal을 검증할 수 없음 |

응답에는 가능하면 `retry_after_seconds` 를 포함해야 한다.

---

## 9. privacy / anti-probing 원칙

attempt control은 아래 원칙과 함께 써야 한다.

1. 외부 응답에 utility 세부값을 과도하게 노출하지 않는다.
2. `remaining_sessions`, `active_sessions` 외의 내부 threshold는 공개하지 않는다.
3. seller의 reserve price나 전략 파라미터는 절대 직접 노출하지 않는다.

즉 quota 제어와 공개 정보 최소화는 같이 가야 한다.

---

## 10. MCP/UCP 바인딩 권고

### MCP

MCP tool 응답은 아래 필드를 요약 응답에 포함해야 한다.

- `attempt_control.remaining_sessions`
- `attempt_control.active_sessions`
- `attempt_control.retry_after_seconds`

### UCP

UCP checkout/negotiation extension은 listing-level policy와 session-level counters를 함께 노출할 수 있어야 한다.

---

## 11. 적합성 테스트 포인트

최소한 아래 시나리오는 적합성 테스트에 포함돼야 한다.

1. 동시 세션 수 1개일 때 두 번째 세션 생성 시 `CONCURRENT_SESSION_LIMIT_EXCEEDED`
2. 기본 프로파일에서 다른 buyer principal은 동시에 여러 개 허용
3. listing-global cap이 활성화된 구현체는 초과 시 `LISTING_CONCURRENT_SESSION_LIMIT_EXCEEDED`
4. window quota 직전까지는 세션 생성 가능
5. quota 초과 시 `ATTEMPT_LIMIT_EXCEEDED`
6. cooldown 만료 후 재시도 가능
7. REST와 MCP에서 동일 principal에 동일 제한 적용

---

## 12. 최종 판단

무료 서비스에서 probing을 막기 위한 표준의 핵심은 `가격 장벽`이 아니라 `정책 장벽`이다.

따라서 HNP 표준화 기준에서 시도제한은:

1. **Core가 아니라 policy capability여야 하고**
2. **discovery 가능해야 하며**
3. **세션 응답에서 남은 quota가 노출되어야 하고**
4. **동시 세션과 반복 세션 생성을 같은 의미로 제한해야 하고**
5. **MCP/UCP/REST에서 같은 의미로 동작해야 한다**

---

*이전 문서: [22_에이전트_스탯_UI_매핑.md](./22_%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8_%EC%8A%A4%ED%83%AF_UI_%EB%A7%A4%ED%95%91.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
