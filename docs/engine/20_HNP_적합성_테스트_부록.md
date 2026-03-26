# 20. HNP 적합성 테스트 부록

**문서:** Haggle Engine Architecture v1.0.2 — HNP Conformance Appendix
**범위:** core revision, capability negotiation, wire semantics, security에 대한 최소 상호운용 테스트
**관련 문서:** [15_적합성_테스트.md](./15_적합성_테스트.md) | [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md) | [23_HNP_시도제한_정책.md](./23_HNP_%EC%8B%9C%EB%8F%84%EC%A0%9C%ED%95%9C_%EC%A0%95%EC%B1%85.md)

---

## 1. 목적

HNP는 문서만으로 표준이 되지 않습니다. 독립 구현체끼리 같은 입력에서 같은 상태와 같은 직렬화 결과를 내야 합니다.

---

## 2. 필수 테스트 세트

| ID | 시나리오 | 기대 결과 |
|----|----------|----------|
| HNP-C01 | core revision 교집합 없음 | `UNSUPPORTED_VERSION` |
| HNP-C02 | required capability major 불일치 | 세션 생성 실패 |
| HNP-C03 | optional capability 교집합 없음 | `DEGRADED`로 세션 시작 |
| HNP-C04 | 동일 `message_id` 재전송 | 상태 1회만 반영 |
| HNP-C05 | 동일 `idempotency_key`, 네트워크 재시도 | 동일 응답 재반환 |
| HNP-C06 | `sequence` 역전 | `OUT_OF_ORDER` |
| HNP-C07 | 만료 메시지 | `STALE_MESSAGE` |
| HNP-C08 | 잘못된 서명 | `INVALID_SIGNATURE` |
| HNP-C09 | 존재하지 않는 proposal을 ACCEPT | `INVALID_PROPOSAL` |
| HNP-C10 | rounding 경계값 | 구현체 간 동일 결과 |
| HNP-C11 | REST와 MCP 바인딩 비교 | 동일 최종 상태 |
| HNP-C12 | `ESCALATE`와 `ERROR` 구분 | 상태 전이와 프로토콜 오류가 분리됨 |
| HNP-C13 | buyer session quota 초과 | `ATTEMPT_LIMIT_EXCEEDED` |
| HNP-C14 | 동시 활성 세션 수 초과 | `CONCURRENT_SESSION_LIMIT_EXCEEDED` |
| HNP-C15 | listing global cap이 비활성일 때 여러 principal 동시 허용 | 세션 생성 지속 가능 |
| HNP-C16 | listing global cap이 활성화된 구현체에서 초과 | `LISTING_CONCURRENT_SESSION_LIMIT_EXCEEDED` |
| HNP-C17 | seller global cap이 활성화된 구현체에서 초과 | `SELLER_CONCURRENT_SESSION_LIMIT_EXCEEDED` |
| HNP-C18 | cooldown 만료 후 재시도 | 동일 principal로 세션 재개 가능 |
| HNP-C19 | REST와 MCP에서 quota 공유 | 동일 principal에 동일 제한 적용 |

---

## 3. Golden Vector 요구사항

각 core revision은 아래 artifact를 함께 제공해야 합니다.

1. canonical request/response examples
2. message signing examples
3. ordering/idempotency edge case vectors
4. numeric rounding vectors

---

## 4. 합격 기준

1. 필수 테스트 100% 통과
2. 선택한 core revision 명시
3. 선택한 capability set 명시
4. canonical serialization 바이트 또는 구조 일치

---

*이전 문서: [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md) | 다음 문서: [21_HNP_에이전트_프로파일_및_툴링.md](./21_HNP_에이전트_프로파일_및_툴링.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
