# 12. 장기 협상 지원과 HNP v1.1

**문서:** Haggle Engine Architecture v1.0.2 — 장기 협상 & HNP 확장
**범위:** V_t의 한계, 재평가 정책, 세션 페이스, HNP v1.1 CompetitivePressure, BATNA 증명
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [02_효용_함수.md](./02_효용_함수.md) | [11_협상_토폴로지.md](./11_협상_토폴로지.md)

---

## 1. 장기 협상 지원

### 1.1 V_t의 역할과 한계

`V_t`(시간 효용)는 "데드라인까지 얼마나 남았는가"를 정확히 반영한다.

```
Day 1: V_t = 0.97 → "여유 있어"
Day 3: V_t = 0.82 → "아직 괜찮아"
Day 6: V_t = 0.24 → "급해지는데"
Day 7: V_t = 0.00 → "끝"
```

**V_t가 모르는 것: "세상이 변했는지."**

Day 3에 시장가가 급락해도 V_t는 여전히 0.82다. 변화된 조건은 **Skill Layer가 입력값을 갱신**해야만 엔진에 반영된다.

| | V_t (Engine Core) | 재평가 (Skill Layer) |
|---|---|---|
| **역할** | "지금 얼마나 급한가" | "지금 파라미터가 맞는가" |
| **주기** | 매 라운드 | 이벤트 or 4시간 |
| **변경 대상** | 없음 (계산만) | P_target, P_limit, w_i, α, β |

> **핵심 원칙:** Engine Core는 순수 계산기다. "세상이 변했으니 전략을 바꿔라"는 판단은 Skill Layer의 책임이며, 엔진은 주어진 파라미터로 최적의 의사결정만 수행한다.

---

### 1.2 재평가 트리거

재평가는 **주기적(4시간)** 또는 **이벤트 기반**으로 발동한다.

```python
class ReEvaluationPolicy:
    PERIODIC_INTERVAL = 4 * 3600  # 4시간

    EVENT_TRIGGERS = [
        "new_listing_in_category",
        "listing_removed",
        "listing_price_changed",
        "competitor_deal_closed",
        "competitor_expired",
        "market_shift_detected",
        "user_strategy_changed",
    ]

    def should_reevaluate(self, last_eval_time, events) -> bool:
        if now() - last_eval_time > self.PERIODIC_INTERVAL:
            return True
        new_events = [e for e in events if e.time > last_eval_time]
        return any(e.type in self.EVENT_TRIGGERS for e in new_events)
```

**트리거 분류:**

- **시장 변동:** `new_listing_in_category`, `listing_removed`, `listing_price_changed`, `market_shift_detected`
- **경쟁 상황:** `competitor_deal_closed`, `competitor_expired`
- **사용자 행동:** `user_strategy_changed`

---

### 1.3 재평가 시 수행 작업

재평가 트리거가 발동하면 다음 파이프라인이 순차적으로 실행된다.

```
재평가 트리거
    │
    ├─→ Market Research Skill
    │       시장가 재조사
    │       P_market 변동 시 Strategy Skill에 통지
    │
    ├─→ Strategy Skill
    │       파라미터 재조정 (규칙 기반, 보통 LLM 불필요)
    │       대폭 변동(>10%) 시에만 LLM 재전략화 검토
    │
    ├─→ Engine Core Batch Evaluate
    │       전체 리스팅 재평가
    │       Top N 재선정
    │       탈락 세션 교체
    │
    └─→ 사용자 알림 (중요 변동만)
            "시장 평균이 $820→$790으로 하락. 마지노선 조정을 추천합니다."
```

**비용 최적화 포인트:**

- 규칙 기반 재조정이 대부분이므로 LLM 호출 비용은 극히 낮다.
- 대폭 변동(>10%)이 아닌 경우 LLM 재전략화를 생략하여 Hot Path 비율을 유지한다.
- 사용자 알림은 중요 변동에만 발송하여 알림 피로를 방지한다.

---

### 1.4 HNP 세션 페이스

장기 협상에서는 응답 속도가 다양하다. `SessionPace`로 타임아웃 정책을 구분한다.

```protobuf
message SessionMeta {
  string topology = 1;        // "1:1", "1:N", "N:N"
  int32 round_number = 2;
  float session_age_hours = 3;

  enum SessionPace {
    REALTIME = 0;       // 분 단위 응답
    ASYNC_HOURS = 1;    // 시간 단위 응답
    ASYNC_DAYS = 2;     // 일 단위 응답
  }
  SessionPace pace = 4;
}
```

**타임아웃 정책:**

| Pace | 무응답 → STALLED | STALLED → EXPIRED |
|---|---|---|
| **REALTIME** | 30분 | +24시간 |
| **ASYNC_HOURS** | 8시간 | +24시간 |
| **ASYNC_DAYS** | 72시간 | +48시간 |

> **STALLED 상태:** 상대방에게 리마인더를 발송하고, 다른 세션의 우선순위를 높인다. EXPIRED 전환 시 해당 세션은 자동 종료되며 BATNA 후보에서 제외된다.

---

## 2. HNP v1.1 확장

### 2.1 새 필드

HNP v1.1은 기존 v1.0 패킷에 **경쟁 압력(CompetitivePressure)** 과 **세션 메타데이터(SessionMeta)** 를 추가한다.

```protobuf
message NegotiationPacket {
  // ... 기존 v1.0 필드 유지 ...

  CompetitivePressure pressure = 10;   // v1.1 추가
  SessionMeta session_meta = 11;       // v1.1 추가
}

message CompetitivePressure {
  int32 active_alternatives = 1;       // 현재 활성 대안 수
  float best_alternative_price = 2;    // 최적 대안 가격
  bytes batna_proof = 3;               // 플랫폼 서명 증명

  enum PressureType {
    NONE = 0;               // 압력 없음
    INFORMATIONAL = 1;      // "다른 옵션도 보고 있어요"
    DEADLINE_WARNING = 2;   // "곧 다른 거래로 갈 수 있어요"
    FINAL_OFFER = 3;        // "이게 마지막 제안이에요"
  }
  PressureType type = 4;
}
```

**PressureType 사용 시나리오:**

| PressureType | 의미 | 엔진 반응 |
|---|---|---|
| `NONE` | 압력 없음 | 기본 전략 유지 |
| `INFORMATIONAL` | 대안 존재 알림 | 상대방 양보 확률 소폭 상승 기대 |
| `DEADLINE_WARNING` | 마감 임박 경고 | β 값 조정으로 양보 속도 변경 가능 |
| `FINAL_OFFER` | 최종 제안 | AC_next 로직에서 수락/거절 즉시 판단 |

---

### 2.2 BATNA 증명

BATNA(Best Alternative to Negotiated Agreement) 증명은 **"나에게 더 나은 대안이 있다"는 주장을 플랫폼이 검증**하는 메커니즘이다. 상대방의 구체적 정보는 노출하지 않으면서 대안의 존재만 확인해준다.

**검증 흐름:**

```
에이전트 A → B: {best_alternative: $740, proof: 0x...}
에이전트 B → 플랫폼: "이 proof 검증해줘"
플랫폼 → B: "유효함" (해당 가격대 제안 존재 확인, 상대방 비공개)
```

**설계 원칙:**

1. **프라이버시 보호:** 플랫폼은 "해당 가격대의 대안이 존재한다"는 사실만 확인한다. 구체적인 상대방, 리스팅 ID, 정확한 가격은 공개하지 않는다.
2. **허위 방지:** `batna_proof`는 플랫폼이 서명한 증명이므로 위조할 수 없다.
3. **전략적 활용:** 에이전트는 BATNA 증명을 선택적으로 공개하여 협상력을 높일 수 있다. 공개 여부 자체가 전략적 판단이다.

**증명 생성 조건:**

- 에이전트가 실제로 해당 가격대의 활성 세션을 보유해야 한다.
- 증명에는 유효 기간(TTL)이 있으며, 만료된 증명은 검증에 실패한다.
- 한 세션에서 동시에 사용할 수 있는 증명 수에는 제한이 있다(남용 방지).

---

*이전 문서: [11_협상_토폴로지.md](./11_협상_토폴로지.md) | 다음 문서: [13_LLM_비용.md](./13_LLM_비용.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*

> **표준화 보강 참고:** 이 문서는 HNP의 도메인 개념과 확장을 설명합니다. 외부 상호운용 표준으로서 필요한 결함 목록, core 버저닝, 적합성, 에이전트 툴링은 [18_HNP_표준화_프로파일.md](./18_HNP_표준화_프로파일.md), [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md), [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md), [21_HNP_에이전트_프로파일_및_툴링.md](./21_HNP_에이전트_프로파일_및_툴링.md)를 참조하세요.
