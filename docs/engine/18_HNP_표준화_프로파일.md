# 18. HNP 표준화 결함 목록

**문서:** Haggle Engine Architecture v1.0.2 — HNP Standards Gap Catalog
**범위:** 현재 HNP 문서/구현이 외부 표준으로 쓰이기 위해 보완해야 하는 결함 목록과 우선순위
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [12_장기협상_HNP.md](./12_장기협상_HNP.md) | [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md) | [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md) | [21_HNP_에이전트_프로파일_및_툴링.md](./21_HNP_에이전트_프로파일_및_툴링.md) | [23_HNP_시도제한_정책.md](./23_HNP_%EC%8B%9C%EB%8F%84%EC%A0%9C%ED%95%9C_%EC%A0%95%EC%B1%85.md)

---

## 1. 진단 요약

현재 HNP는 **협상 엔진 내부 메시지 모델**로는 유용하지만, **독립 구현체 간 상호운용 표준**으로는 아직 부족합니다.

핵심 문제는 다음 한 줄로 정리할 수 있습니다.

> 현재 HNP는 "무엇을 협상하는가"는 잘 설명하지만, "서로 다른 두 에이전트가 어떻게 안전하게, 같은 의미로, 같은 결과를 내며 협상하는가"는 아직 충분히 고정하지 못했습니다.

---

## 2. 결함 분류

결함은 4개 계층으로 나뉩니다.

| 계층 | 질문 | 현재 상태 |
|------|------|----------|
| Core Wire | 메시지가 동일 의미로 전달되는가 | 취약 |
| Compatibility | 버전/확장을 안전하게 협상하는가 | 부재 |
| Trust | 상대 신원과 메시지 무결성을 검증하는가 | 취약 |
| Agent UX | 에이전트가 도구처럼 쉽게 붙을 수 있는가 | 취약 |

---

## 3. P0 결함

이 항목들은 해결되지 않으면 HNP를 외부 표준으로 내세우기 어렵습니다.

### P0-1. Core 버전 협상 부재

- 문제: 상대가 어떤 HNP core revision과 capability를 지원하는지 확인하는 절차가 없습니다.
- 영향: 서로 다른 구현체가 같은 `HNP`라는 이름으로 다른 의미를 처리할 수 있습니다.
- 보강: [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md)의 `/.well-known/hnp` + core revision negotiation 도입

### P0-2. Canonical envelope 부재

- 문제: 현재 메시지에는 `message_id`, `idempotency_key`, `sequence`, `expires_at`, `sender_agent_id`가 없습니다.
- 영향: 중복 처리, 재전송, out-of-order 처리, 서명 검증 기준이 없습니다.
- 보강: envelope와 payload를 분리하고 envelope를 core로 고정

### P0-3. ACCEPT 대상 불명확

- 문제: `ACCEPT`가 어떤 제안을 수락하는지 문서와 타입이 고정하지 않습니다.
- 영향: 중복 제안이나 병렬 라운드에서 합의 대상이 어긋날 수 있습니다.
- 보강: `accepted_message_id`, `accepted_proposal_id` 필수화

### P0-4. 부동소수점 가격 표현

- 문제: 현재 구현은 `price: number` 구조입니다.
- 영향: 플랫폼/언어별 반올림 차이로 최종 합의가 엇갈릴 수 있습니다.
- 보강: wire에서는 `Money { currency, units_minor }` 사용

### P0-5. 프로토콜 오류와 협상 행위의 혼재

- 문제: `ESCALATE`는 도메인 행위인데, 프로토콜 계층 `ERROR`와 분리돼 있지 않습니다.
- 영향: 네트워크 오류와 협상 판단을 같은 채널로 해석하게 됩니다.
- 보강: `ERROR` 메시지와 표준 오류 코드를 core에 추가

### P0-6. 인증/무결성 규정 부족

- 문제: 서명 방식, 키 배포, replay 방지 규칙이 충분히 고정돼 있지 않습니다.
- 영향: 허위 상대, 변조 메시지, replay 공격을 표준 차원에서 막기 어렵습니다.
- 보강: TLS + detached JWS + `jwks_uri` + expiry/idempotency 규정

### P0-7. 적합성 테스트 부재

- 문제: 독립 구현체가 실제로 같은 결과를 내는지 검증할 golden vector가 없습니다.
- 영향: "문서를 읽고 비슷하게 만든 구현체"가 양산됩니다.
- 보강: [20_HNP_적합성_테스트_부록.md](./20_HNP_적합성_테스트_부록.md) 정의

---

## 4. P1 결함

이 항목들은 P0 이후 바로 해결되어야 표준 문서 완성도가 올라갑니다.

### P1-1. 다중 Term 엔진과 wire payload 불일치

- 문제: 엔진 문서는 다중 Term 협상을 전제하지만 wire는 사실상 `price` 단일 필드입니다.
- 영향: 문서상 기능과 표준상 기능이 어긋납니다.
- 보강: proposal을 term-set 기반 구조로 승격

### P1-2. CANCEL / ACK / RESUME 부재

- 문제: 비동기 에이전트 환경에서 세션 취소, 수신 확인, 재개 semantics가 없습니다.
- 영향: 장기 협상과 agent task runtime에서 복구가 어렵습니다.
- 보강: core 또는 required capability로 정의

### P1-3. transport binding 문서 부족

- 문제: REST, MCP, WebSocket, gRPC에서 payload가 어떻게 매핑되는지 불명확합니다.
- 영향: transport마다 사실상 별도 프로토콜이 될 위험이 있습니다.
- 보강: binding annex 추가

### P1-4. privacy boundary 미정

- 문제: BATNA proof, competitive pressure, reputation 신호 중 무엇이 공개 가능한지 계층 구분이 약합니다.
- 영향: 표준 채택 시 개인정보/상거래 민감 정보 노출 우려가 큽니다.
- 보강: 공개/비공개/플랫폼 검증 전용 분류표 필요

### P1-5. machine-readable schema 부재

- 문제: 문서에 protobuf 조각은 있지만 버전별 공식 schema artifact와 media type이 없습니다.
- 영향: 생성형 코드와 validator를 자동화하기 어렵습니다.
- 보강: canonical `.proto` 또는 JSON schema 배포

### P1-6. 무료 서비스용 anti-probing policy 부재

- 문제: 무료 운영 전제에서 buyer가 다수 세션과 반복 라운드로 seller 전략을 추론하는 것을 막는 표준 policy가 없습니다.
- 영향: 실제 운영에서는 상호운용성보다 먼저 abuse와 probing에 무너질 수 있습니다.
- 보강: [23_HNP_시도제한_정책.md](./23_HNP_%EC%8B%9C%EB%8F%84%EC%A0%9C%ED%95%9C_%EC%A0%95%EC%B1%85.md)의 `ai.haggle.policy.attempt-control` capability 도입

---

## 5. P2 결함

이 항목들은 표준 생태계를 키울 때 중요합니다.

### P2-1. extension registry 운영 규칙 부재
### P2-2. media type / canonical serialization 부재
### P2-3. observability / trace correlation 규칙 부족
### P2-4. governance 및 deprecation policy 부재

---

## 6. 문서-구현 불일치

현재 구현체 [types.ts](/Users/jeonghaengheo/work/Haggle/Haggle/packages/engine-session/src/protocol/types.ts)는 아래 수준입니다.

```ts
interface HnpMessage {
  session_id: string;
  round: number;
  type: HnpMessageType;
  price: number;
  sender_role: HnpRole;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

이 구조는 내부 MVP에는 충분하지만, 표준으로는 부족합니다.

불일치 포인트는 다음과 같습니다.

1. `round`는 UI/도메인 표현에 가깝고, 표준 순서 규칙은 `sequence`가 필요합니다.
2. `price: number`는 wire 안정성이 없습니다.
3. `metadata` 자유형은 extension 경계를 무너뜨립니다.
4. `sender_role`만 있고 `sender_agent_id`가 없습니다.
5. 수락 대상 바인딩이 없습니다.

---

## 7. 우선 조치 순서

1. core 버저닝과 discovery를 먼저 고정합니다.
2. envelope와 payload semantics를 분리합니다.
3. money, error, capability 타입을 core schema로 고정합니다.
4. agent-facing tool surface를 따로 정의합니다.
5. 마지막으로 적합성 테스트와 reference implementation으로 마감합니다.

---

## 8. 최종 판단

누가 봐도 표준으로 쓸 만하다고 느끼게 하려면, HNP는 이제 "협상 엔진 설명서"에서 한 단계 올라가야 합니다.

필수 조건은 아래 네 가지입니다.

1. **core revision이 명확할 것**
2. **상호운용 실패 시 오류가 명확할 것**
3. **에이전트가 도구처럼 바로 붙을 수 있을 것**
4. **구현체 간 적합성 검증이 가능할 것**

---

*이전 문서: [17_확장_미결.md](./17_확장_미결.md) | 다음 문서: [19_HNP_Core_버저닝.md](./19_HNP_Core_버저닝.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
