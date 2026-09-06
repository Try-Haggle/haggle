# Haggle Core, Platform and Protocol Design

> **Status:** Draft / Working Architecture — **Source of Truth 아님**
> **Authority:** 설계 토론용. 현재 동작은 코드와 기존 영역별 SOT를 따른다.
> **Created:** 2026-08-09
> **Last verified against code:** 2026-08-09
> **Scope:** Haggle 철학, HNP의 장기 역할, 플랫폼 경계, 외부 채널 연결, 에이전틱 시대 확장
> **Implementation status:** 이 문서로 인한 구현 변경 없음
> **Intended destination:** 승인 후 전역 원칙은 `CLAUDE.md`, 엔진 결정은 `docs/engine/SOT.md`, 장기 플랫폼 구조는 필요 시 `docs/architecture/`로 승격

---

## 문서 상태 표기

| 표기 | 의미 |
|---|---|
| **Current** | 현재 코드 또는 기존 SOT에서 확인된 사실 |
| **Accepted Direction** | 현재 설계 대화에서 채택한 방향. 정식 SOT 반영 전 |
| **Proposed** | 유망하지만 추가 결정·검증이 필요한 제안 |
| **Deferred** | 미래 호환성만 확보하고 현재 구현하지 않는 범위 |
| **Open** | 제품·정책·기술 결정이 남은 항목 |

이 문서는 현재 구현, 합의된 방향, 미래 아이디어를 한곳에서 비교하기 위한 WIP 문서다. **Current가 아닌 항목을 현재 제품 동작으로 간주하면 안 된다.**

---

## 0. Executive Summary

Haggle은 단순한 AI 가격 흥정 앱이 아니라, 장기적으로 **사람이 정한 권한 안에서 AI 에이전트들이 조건을 협상하고, 검증 가능하며 이식 가능한 합의를 생성하는 인프라**를 지향한다.

핵심 구조는 다음과 같다.

```text
사람의 목표와 권한
        ↓
Identity & Authority
        ↓
자유롭게 발전하는 협상 에이전트와 엔진
        ↓
HNP: 제안·조건·합의·증거의 공통 언어
        ↓
Agreement Capsule
        ↓
ACP / UCP / Shopify / Haggle Checkout / AP2 / 결제망
```

HNP는 MCP, A2A, UCP, ACP, AP2와 경쟁하지 않는다. 각 프로토콜이 담당하지 않는 **협상 의도에서 검증 가능한 합의까지의 구간**을 책임지고, 기존 표준에는 extension 또는 binding으로 연결한다.

장기 핵심 포지션:

> **HNP는 에이전트가 위임받은 범위 안에서 협상하고, 검증 가능하며 이식 가능한 합의를 생성하는 프로토콜이다.**

HNP의 대표 수명주기:

```text
Discover → Delegate → Negotiate → Prove → Redeem
```

- **Discover:** 상품·서비스가 무엇을 협상할 수 있는지 기계가 발견한다.
- **Delegate:** 사람 또는 조직이 에이전트의 행동 범위를 정한다.
- **Negotiate:** 모델과 전략은 범위 안에서 자유롭게 발전한다.
- **Prove:** 비공개 한도를 노출하지 않고 권한과 합의 무결성을 증명한다.
- **Redeem:** 합의를 다양한 체크아웃과 결제 레일에서 사용한다.

---

## 1. 이 문서가 결정하는 것과 결정하지 않는 것

### 1.1 다루는 범위

- Haggle의 장기 철학과 시스템 경계
- HNP가 산업 표준이 되기 위해 맡아야 할 역할
- Range Harness와 AI 자율성의 관계
- Haggle 내부 사용자, 외부 에이전트, ChatGPT, Shopify 연결 구조
- MCP, A2A, UCP, ACP, AP2와의 계층 관계
- 에이전틱 쇼핑 시대의 Haggle 제품·네트워크 형태
- 기업 간 복합 협상을 위한 미래 호환성
- 협상 API 비용과 장기 경제성 원칙
- 구현 전에 확정해야 할 결정과 검증 항목

### 1.2 다루지 않는 범위

- 구체적인 API·DB schema의 최종 계약
- 즉시 구현할 파일 목록과 작업 순서
- 법률 계약의 유효성 판단
- 특정 모델·결제 사업자에 대한 영구 종속
- 현재 코드 동작을 이 문서만으로 변경하는 것
- 기업용 복합 협상의 현재 구현

### 1.3 영역별 진실의 원천

| 범위 | 현재 진실의 원천 |
|---|---|
| 프로젝트 철학·전역 개발 원칙 | [`CLAUDE.md`](../../CLAUDE.md) |
| 협상 엔진 목표·현황 | [`docs/engine/SOT.md`](../engine/SOT.md) |
| HNP 표준화 진행 현황 | [`docs/wip/hnp-standardization-review.md`](./hnp-standardization-review.md) 및 실제 코드 |
| DB 배포 이력 | `packages/db/drizzle/*.sql`, journal |
| ORM 모델 | `packages/db/src/schema/*.ts` |
| 런타임 행동 | `apps/api/src/routes`, `services`, `negotiation/pipeline` |
| 이 문서 | 영역 간 관계와 장기 방향을 검토하는 WIP 지도 |

---

## 2. 철학과 불변조건

### 2.1 기존 철학

`CLAUDE.md`에 이미 다음 원칙이 존재한다.

- 협상의 민주화
- 공정함, 투명함, 안전함, 편리함, 정직함
- 사용자 보호 우선
- 자동화가 기본
- Protocol-First
- 양쪽 모두에게 공정
- 데이터는 사용자 것
- Open Protocol, Closed Engine
- Non-Custodial

이 문서는 위 원칙을 대체하지 않고, 에이전틱 시스템에서 어떻게 적용할지를 구체화한다.

### 2.2 Accepted Direction — 에이전틱 협상 원칙

1. **권한을 제한하고 전략은 제한하지 않는다.**
   사용자는 행동 가능한 범위를 정하고, AI는 그 안에서 모델 발전의 이점을 활용한다.

2. **비공개 한도는 상대방과 공개 프로토콜에 노출하지 않는다.**
   판매자의 최저가, 구매자의 최대가, 내부 효용·전략은 private policy다.

3. **구속력 있는 결과는 자연어가 아니라 구조화된 조건에 바인딩한다.**
   자연어는 설명과 관계 형성에 사용하고, 합의는 typed issues와 canonical hash로 확정한다.

4. **협상과 결제를 분리한다.**
   HNP는 합의를 만들고, 결제·주문·재고·세금은 commerce protocol 또는 merchant system이 처리한다.

5. **모델 추론을 신뢰 경계로 사용하지 않는다.**
   권한, 금액 범위, 서명, 상태 전이, 중복 방지, 만료 검증은 결정론적 코드가 수행한다.

6. **역할 중립성과 대칭성을 유지한다.**
   Haggle 플랫폼 AI가 양측 이해를 대신 결정하지 않는다. 각 당사자의 에이전트와 권한을 분리한다.

7. **프로토콜은 공개하고 경쟁 가능한 엔진을 허용한다.**
   외부 구현체가 HNP를 사용할 수 있어야 하며, Haggle Engine은 최고의 선택지로 경쟁한다.

8. **사용자 통제는 자율성 단계로 표현한다.**
   관찰, 작성, 협상, 범위 내 수락, 결제 실행을 서로 다른 권한으로 둔다.

9. **감사 가능하되 불필요한 사적 추론은 수집하지 않는다.**
   제안·권한·합의 증거는 남기되 chain-of-thought와 비공개 전략 원문은 표준 기록으로 요구하지 않는다.

10. **안전 > 편리, 공정 > 수익이라는 기존 우선순위를 유지한다.**

---

## 3. 현재 시스템과 설계의 출발점

### 3.1 Current — 현재 존재하는 기반

현재 저장소에는 다음 기반이 이미 존재한다.

- MCP Streamable HTTP endpoint: `POST/GET/DELETE /mcp`
- ChatGPT UI 도구와 데이터 도구
- 상품 draft 생성·수정·검증·게시
- 구매자 협상 세션 생성과 오퍼 제출
- REST 협상 세션, 오퍼, 수락, 거절, 상태 조회
- `/.well-known/hnp` capability profile
- HNP envelope, issue namespace, proposal hash, detached signature
- agent delegation 및 ingress 검증
- agreement object와 transaction handoff 기반
- 결제, 정산, 배송, 분쟁, trust 영역

주요 코드 근거:

| 영역 | 근거 |
|---|---|
| MCP transport | [`apps/api/src/mcp/router.ts`](../../apps/api/src/mcp/router.ts) |
| MCP 도구 | [`apps/api/src/mcp/tools/index.ts`](../../apps/api/src/mcp/tools/index.ts) |
| HNP profile | [`apps/api/src/routes/hnp-profile.ts`](../../apps/api/src/routes/hnp-profile.ts) |
| 협상 ingress·수락 | [`apps/api/src/routes/negotiations.ts`](../../apps/api/src/routes/negotiations.ts) |
| HNP ingress validation | [`apps/api/src/services/hnp-ingress.service.ts`](../../apps/api/src/services/hnp-ingress.service.ts) |
| HNP protocol guard | [`apps/api/src/services/hnp-protocol-guard.service.ts`](../../apps/api/src/services/hnp-protocol-guard.service.ts) |
| HNP signature | [`apps/api/src/services/hnp-signature.service.ts`](../../apps/api/src/services/hnp-signature.service.ts) |
| 엔진 목표·현황 | [`docs/engine/SOT.md`](../engine/SOT.md) |

### 3.2 Current — 주요 경계 문제

1. `/.well-known/hnp`는 현재 REST와 MCP를 광고하지만 A2A Agent Card와 A2A endpoint는 없다.
2. MCP 협상 도구는 `buyer_id`, `seller_id`를 입력으로 받는다. 공개 연결 전에는 인증 토큰과 listing ownership에서 서버가 파생해야 한다.
3. MCP router 자체에는 사용자별 OAuth 2.1 resource-server 경계가 아직 명확히 결합돼 있지 않다.
4. ChatGPT 판매 흐름은 상당 부분 존재하지만 검색→상태 조회→합의 검토→명시적 승인→checkout의 구매 흐름은 완전하지 않다.
5. Shopify merchant, product, inventory, order를 Haggle identity와 연결하는 channel adapter가 없다.
6. HNP의 미래 역할 일부가 엔진 SOT, WIP, 전략 토론, archive에 분산돼 있다.

이 항목들은 구현 지시가 아니라 이후 설계 감사에서 검증·우선순위화할 대상이다.

---

## 4. 목표 시스템 구조

### 4.1 Accepted Direction — 채널과 코어의 분리

```text
Haggle Web/App ───── First-party Adapter ─┐
ChatGPT ──────────── MCP + OAuth 2.1 ─────┤
External Agents ──── A2A + HNP ──────────┼──→ Identity & Authority Gateway
Shopify ──────────── Shopify App/Webhook ─┤                 ↓
Partner Apps ─────── REST/SDK/Widget ─────┘          HNP Application Core
                                                            ↓
                                                     Negotiation Engine
                                                            ↓
                                                     Agreement Capsule
                                                            ↓
                                        Commerce / Settlement Adapter Layer
```

모든 채널은 별도 협상 엔진을 만들지 않는다. 동일한 application command와 HNP 의미 모델로 수렴하고, 인증·표현·전송 방식만 adapter가 처리한다.

### 4.2 제안하는 계층

| 계층 | 책임 | 포함하지 않는 것 |
|---|---|---|
| Channel Adapter | MCP, A2A, REST, Shopify, Web 요청 변환 | 협상 전략 |
| Identity & Authority | 사용자·조직·에이전트 연결, 위임, scope, range | 자연어 생성 |
| HNP Application Core | 세션, proposal, issue, accept, agreement, evidence binding | 결제 실행 |
| Negotiation Engine | 제안 전략, 양보, 모델 선택, 컨텍스트 | 외부 wire format 소유 |
| Referee & Policy | 범위, 권한, 안전, 공정, 남용 검증 | 사용자 대신 새 권한 생성 |
| Commerce Router | checkout·order·payment provider 선택 | 협상 이유 결정 |
| Trust & Dispute | 신원, 증거, 판례, 분쟁, 평판 | 사적 협상 한도 공개 |

### 4.3 Core domain 후보

```text
Principal
├─ Human
├─ Organization
└─ Agent

ChannelConnection
├─ Haggle
├─ ChatGPT
├─ Shopify
└─ External A2A/Partner

AuthorityGrant
├─ scope
├─ monetary/term boundaries
├─ allowed actions
├─ escalation rules
└─ expiry

Negotiation
├─ session
├─ parties
├─ proposals
├─ issue graph
└─ protocol events

Agreement
├─ accepted proposal snapshot
├─ signatures/proofs
├─ evidence references
└─ redemption bindings

CommerceBinding
├─ provider
├─ external product/order ids
├─ checkout reference
└─ lifecycle events
```

필드와 테이블은 이후 코드·DB 감사 후 결정한다. 위 구조는 소유권과 경계를 표현하는 개념 모델이다.

---

## 5. HNP의 장기 역할

### 5.1 HNP가 메워야 하는 공백

기존 에이전틱 상거래 표준은 다음 영역을 발전시키고 있다.

```text
Catalog / Search
Cart
Checkout
Payment Authorization
Order / Fulfillment
Agent Communication
```

그러나 다음 질문은 여전히 별도의 의미 계층이 필요하다.

- 이 상품·서비스는 협상 가능한가?
- 어떤 조건을 협상할 수 있는가?
- 에이전트는 어디까지 제안·수락할 권한이 있는가?
- 가격과 비가격 조건을 어떤 구조로 교환하는가?
- 수락이 정확히 어떤 proposal과 issue snapshot에 바인딩되는가?
- 합의를 다른 checkout으로 어떻게 전달하는가?

HNP는 이 구간에 집중한다.

```text
Discovery → [HNP: Intent to Agreement] → Checkout → Payment → Order
```

### 5.2 HNP Core에 포함할 것

- protocol version과 capability negotiation
- party·agent identity reference
- message id, sequence, idempotency, expiry
- typed issue와 namespace
- proposal와 canonical hash
- accept, reject, counter, escalate, error
- 부분 또는 전체 합의의 정확한 snapshot
- signature와 authority proof reference
- Agreement Capsule
- extension registry와 binding metadata

### 5.3 HNP Core에서 제외할 것

- LLM prompt와 chain-of-thought
- 양보 알고리즘과 scoring threshold
- 캐릭터·tone·agent persona
- 판매자 floor와 구매자 max 원문
- 상품 catalog와 검색 ranking
- 재고, 세금, checkout UI
- payment instrument와 결제 실행
- 배송·환불·분쟁의 전체 상태 머신
- Haggle 전용 점수와 내부 memory

### 5.4 표준화 원칙

1. 하나의 canonical wire type family
2. reverse-DNS 또는 URI 기반 issue·extension namespace
3. transport-neutral core
4. 하위 호환 가능한 version/capability handshake
5. 실행 가능한 conformance test kit
6. 최소 하나 이상의 외부 reference implementation
7. Haggle 계정 없이도 core protocol 구현 가능
8. 공개 spec과 비공개 engine의 명확한 분리

---

## 6. Discover → Delegate → Negotiate → Prove → Redeem

### 6.1 Discover — Negotiability Manifest

**Proposed:** 상품·서비스가 “협상 가능함”을 기계가 발견할 수 있는 표준 manifest를 만든다.

```json
{
  "negotiation": {
    "protocol": "HNP",
    "version": "1.0",
    "endpoint": "https://merchant.example/hnp",
    "issues": [
      "hnp.issue.price.total",
      "hnp.issue.shipping.cost",
      "hnp.issue.delivery.window",
      "hnp.issue.return.period"
    ],
    "modes": ["bilateral", "async"],
    "settlement_bindings": ["ucp", "shopify"]
  }
}
```

노출 위치 후보:

- `/.well-known/hnp`
- A2A Agent Card extension
- UCP vendor extension
- MCP tool metadata
- Shopify product metafield
- 일반 product feed의 `negotiation_endpoint`
- 향후 HTTP link relation `rel="negotiate"`

이 “Negotiation Slot”이 널리 쓰이면 HNP는 Haggle 앱 안에 갇히지 않고 모든 agentic shopping surface에서 발견될 수 있다.

### 6.2 Delegate — Private Authority Policy

사용자가 위임하는 것은 최대 가격 하나가 아니다.

```json
{
  "allowed_actions": ["offer", "counter", "accept"],
  "price": {
    "currency": "USD",
    "target_minor": 78000,
    "maximum_minor": 90000
  },
  "required_terms": ["tracked_shipping", "return_period_days >= 7"],
  "forbidden_terms": ["final_sale"],
  "must_escalate_when": ["identity_unverified", "price_above_90000"],
  "expires_at": "..."
}
```

이 원문은 private storage에 남고 상대방에게 전송하지 않는다. 외부로는 policy hash, scope, expiry, issuer, 허용 action처럼 검증에 필요한 최소 정보만 보낸다.

### 6.3 Negotiate — 구조화된 조건 교환

```json
{
  "proposal_id": "prop_123",
  "issues": [
    {
      "name": "hnp.issue.price.total",
      "value": { "amount_minor": 82000, "currency": "USD" }
    },
    {
      "name": "hnp.issue.shipping.method",
      "value": "insured"
    },
    {
      "name": "hnp.issue.return.period_days",
      "value": 7
    }
  ],
  "expires_at": "...",
  "proposal_hash": "sha256:..."
}
```

자연어 모델은 제안을 설명하고 설득할 수 있지만, 수락은 이 구조화된 snapshot과 hash에 바인딩된다.

### 6.4 Prove — Boundary Proof

**Accepted Direction:** HNP는 비공개 한도를 전송하지 않고도 에이전트가 권한 안에서 행동했음을 증명할 수 있어야 한다.

초기 형태:

```text
authority_policy_hash
+ proposal_hash
+ agent_id
+ permitted_action
+ expiry
+ issuer/verifier signature
```

**Proposed / Long-term:** 선택적 privacy-preserving proof.

```text
seller_floor ≤ agreed_price ≤ buyer_max
```

실제 floor와 max를 공개하지 않고 조건 만족만 증명한다.

진화 순서 후보:

1. HNP 1.0 — JWS와 server attestation
2. HNP 1.x — trusted verifier 또는 TEE attestation
3. HNP 2.x — 선택적 zero-knowledge boundary proof

ZK proof는 초기 필수 기능이 아니다. 표준 채택을 막지 않는 optional extension이어야 한다.

### 6.5 Redeem — Portable Agreement Capsule

HNP의 핵심 출력은 대화가 아니라 이식 가능한 합의 객체다.

```json
{
  "agreement_id": "agr_123",
  "subject": {
    "product_id": "shopify:variant:456"
  },
  "parties": {
    "buyer": "principal:buyer",
    "seller": "principal:seller"
  },
  "accepted_proposal_hash": "sha256:...",
  "agreed_issues": [],
  "authority_proofs": [],
  "evidence_references": [],
  "expires_at": "...",
  "redemption": {
    "provider": "shopify",
    "checkout_reference": "draft_order_789"
  },
  "signatures": []
}
```

Agreement Capsule은 Shopify Draft Order, UCP Checkout, OpenAI commerce flow, Haggle settlement 등에서 authoritative negotiated offer로 사용할 수 있어야 한다.

---

## 7. Range Harness와 모델 발전

### 7.1 Accepted Direction — Hard Authority와 Soft Preference 분리

```text
Hard Authority
├─ 판매자 최저 허용가
├─ 구매자 최대 허용가
├─ 금지 조건
├─ 자동 수락 가능 범위
├─ 결제 한도
└─ 인간 승인 조건

Soft Preference
├─ 목표 가격
├─ 선호하는 거래 속도
├─ 위험·신뢰 가중치
├─ 양보 성향
└─ 비가격 조건 우선순위
```

- Hard Authority는 결정론적 policy/referee가 강제한다.
- Soft Preference 안에서는 모델과 전략이 자유롭게 발전한다.
- HNP는 제안과 합의 결과를 표현하며 내부 range 전체를 공개하지 않는다.

### 7.2 자율성 단계

| 단계 | 에이전트 권한 |
|---|---|
| Observe | 협상을 관찰하고 조언만 함 |
| Prepare | 제안을 작성하지만 전송하지 않음 |
| Negotiate | 제안·역제안 가능, 수락 불가 |
| Commit | 지정 범위 안에서 자동 수락 가능 |
| Execute | 별도 결제 권한 안에서 주문·결제 가능 |

사용자는 상품, 금액, 상대 신뢰도, 채널별로 단계를 다르게 설정할 수 있어야 한다.

### 7.3 모델이 발전해도 남는 경계

- 모델은 더 좋은 전략과 더 짧은 라운드를 만든다.
- HNP는 동일한 proposal·agreement contract를 유지한다.
- Referee는 금액, 권한, 서명, 상태 전이를 계속 결정론적으로 검증한다.
- 새 모델 도입은 engine adapter와 evaluation 변경으로 흡수한다.

---

## 8. 채널별 연결 설계

### 8.1 Haggle 내부 사용자

```text
Haggle 로그인
  → 상품·구매 intent 생성
  → Authority/Range 설정
  → 내부 application service 호출
  → HNP-compatible session/event 기록
  → Agreement Capsule
```

내부 호출은 public REST나 A2A를 네트워크로 한 바퀴 돌 필요가 없다. 그러나 identity, authority, proposal, agreement 의미는 외부 채널과 동일하게 유지한다.

### 8.2 외부 AI 에이전트

```text
1. /.well-known/agent-card.json 발견
2. HNP extension과 /.well-known/hnp 확인
3. OAuth 또는 신뢰 가능한 agent credential 획득
4. A2A Message/Task 안에서 HNP envelope 교환
5. push/webhook/polling으로 상태 수신
6. Agreement Capsule 또는 checkout handoff 수신
```

필요한 공개 표면 후보:

- `/.well-known/agent-card.json`
- `/.well-known/hnp`
- `/a2a`
- `/partners/v1`
- partner webhook
- TypeScript/Python SDK
- conformance sandbox

### 8.3 ChatGPT

ChatGPT는 MCP를 통해 Haggle의 사용자 목표 단위 도구를 호출한다.

판매 흐름:

```text
start draft → detect/apply details → configure authority → validate → publish
```

구매 흐름 목표:

```text
search listings
→ inspect listing
→ configure buyer authority
→ start negotiation
→ inspect agreement
→ explicit approval when required
→ create checkout
→ track order
```

필요한 MCP 도구 후보:

- `haggle_search_listings`
- `haggle_get_listing`
- `haggle_set_buyer_authority`
- `haggle_start_negotiation`
- `haggle_get_negotiation` — MCP default (omit/`[]` expand) returns **full transcript + offers** (E1); web SoT unchanged. See [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md).
- `haggle_review_agreement`
- `haggle_approve_agreement`
- `haggle_create_checkout`
- `haggle_get_order`

보안 원칙:

- 사용자 데이터와 write action은 OAuth 2.1로 인증한다.
- `buyer_id`는 access token에서 파생한다.
- `seller_id`는 authoritative listing에서 조회한다.
- 모델이 임의 사용자·판매자 ID를 지정하게 하지 않는다.
- 조회, 협상, 수락, 결제 도구의 scope와 confirmation을 분리한다.
- seller floor와 private strategy를 tool result에 넣지 않는다.

OpenAI의 직접 상품 checkout 경로는 2026-08-09 확인 기준 승인된 파트너 대상 beta다. 초기에는 Haggle 또는 Shopify checkout URL을 반환하고, 승인·상품 feed 조건을 충족한 뒤 표준 `checkout_session` 경로를 추가할 수 있다.

### 8.4 Shopify

```text
Merchant installs Haggle Shopify App
  → Shopify shop ↔ Haggle merchant 연결
  → product/variant/inventory 초기 동기화
  → product별 Authority Policy 설정
  → Theme App Extension으로 “Make an offer” 진입
  → HNP negotiation
  → accepted agreement
  → Shopify Draft Order
  → invoiceUrl / Shopify Checkout
  → order/payment/refund webhook으로 Haggle 갱신
```

원칙:

- 테마 직접 수정이나 범용 script injection보다 Theme App Extension을 사용한다.
- 합의 가격은 실제 Shopify variant에 discount로 적용해 inventory 연결을 유지한다.
- custom item은 실제 variant 재고 추적이 필요 없는 경우에만 사용한다.
- webhook은 HMAC, idempotency, duplicate, out-of-order를 처리한다.
- webhook 유실을 전제로 reconciliation job을 둔다.
- Shopify는 merchant system이고, HNP 협상 의미의 소유자가 아니다.

### 8.5 일반 웹사이트·파트너 플랫폼

A2A를 강제하지 않는다.

- 인간용 웹사이트: embeddable widget 또는 REST SDK
- 파트너 backend: OAuth/client credential 기반 REST API
- AI agent: A2A + HNP
- ChatGPT/Codex: MCP

모든 adapter는 동일한 내부 command로 변환한다.

---

## 9. 기존 표준과의 역할 분담

| 기술 | 주 역할 | HNP와의 관계 |
|---|---|---|
| MCP | 모델/호스트가 Haggle 도구를 호출 | ChatGPT 진입 binding |
| A2A | 원격 에이전트 discovery, Message, Task, streaming | HNP를 domain extension으로 운반 |
| UCP | catalog, cart, checkout, order, identity linking | HNP agreement를 checkout 앞단 extension으로 연결 |
| ACP / OpenAI Commerce | OpenAI 상거래·checkout 경로 | HNP 합의 가격·offer를 commerce 입력으로 전달 |
| AP2 | checkout·payment에 대한 agent authorization 증명 | HNP 협상 권한과 별개이며 결제 실행 시 결합 |
| Shopify | merchant catalog, inventory, order, checkout | HNP의 external commerce adapter |
| HNP | negotiation capability, authority reference, proposal, agreement | 위 표준 사이의 intent-to-agreement 계층 |

### 9.1 A2A와 HNP

```text
A2A = 통신과 작업 수명주기
HNP = 협상 의미와 상태 머신
```

HNP는 A2A custom extension URI로 시작하고, 사용 사례·reference implementation·TCK가 확보되면 공식 확장 제안을 검토한다.

### 9.2 UCP와 HNP

UCP의 capability negotiation은 지원 기능의 교집합 선택이며, 가격·SLA·배송 조건을 주고받는 상업적 협상과 다르다. HNP는 UCP vendor extension으로 시작할 수 있다.

```text
dev.ucp.shopping.catalog
        ↓
ai.haggle.negotiation
        ↓
dev.ucp.shopping.checkout
```

### 9.3 AP2와 HNP

- HNP Authority: offer, counter, accept 등 협상 행동 권한
- AP2 Mandate: 특정 checkout과 payment 실행 권한

ChatGPT 또는 외부 에이전트가 AP2 mandate를 자동으로 제공한다고 가정하지 않는다. 지원 capability가 확인될 때만 AP2 verifier를 활성화한다.

---

## 10. 에이전틱 시대의 Haggle

### 10.1 사용자 경험의 변화

현재:

```text
사람이 검색 → 상품 비교 → 메시지 → 가격 협상 → 결제
```

에이전틱 시대:

```text
사람이 목표·경계 설정
  → 에이전트가 후보 검색
  → 여러 상대와 병렬 협상
  → 가격·배송·보증·반품 비교
  → 권한 안에서 합의
  → 필요한 경우만 인간 승인
  → checkout·payment 실행
```

구매 예시:

```text
“비슷한 노트북을 배송 포함 $900 이하,
배터리 90% 이상, 금요일 전 도착 조건으로 사줘.”
```

판매 예시:

```text
“이 재고 200개를 30일 안에 판매해.
개당 최소 $70, 20개 이상이면 할인 가능,
반품 불가 조건이면 추가 양보 가능.”
```

### 10.2 Haggle의 제품 형태

```text
HNP
→ 공개된 협상 표준

Haggle Network
→ discovery, routing, identity, conformance, abuse control

Haggle Engine
→ 모델·전략·데이터를 활용하는 고성능 비공개 구현체

Haggle Trust
→ 합의 검증, 평판, 판례, 분쟁

Haggle App
→ 사람이 에이전트 권한과 결과를 통제하는 인터페이스
```

Haggle UI는 장기적으로 단순 marketplace보다 Mandate Dashboard 또는 Agent Control Center에 가까워질 수 있다.

### 10.3 Persistent Intent Market

**Proposed:** 구매자와 판매자가 일회성 요청이 아니라 지속되는 intent와 policy를 등록한다.

```text
Persistent Buyer Intent
          ↕
HNP Matching & Negotiation
          ↕
Persistent Seller Policy
```

예:

- “향후 3개월 안에 이 조건의 카메라가 $1,200 이하가 되면 협상해 구매.”
- “재고가 30일 이상이면 허용 가격을 낮추고 5개 이하이면 할인 폭 축소.”

Haggle은 검색 결과를 보여주는 곳을 넘어, 조건이 맞을 때 거래를 생성하는 시장이 될 수 있다.

### 10.4 전문 에이전트의 거래 조립

```text
Buyer Agent ↔ Seller Agent
                 ├─ Verification Agent
                 ├─ Shipping Agent
                 ├─ Insurance Agent
                 ├─ Payment Agent
                 └─ Trust/Dispute Agent
```

가격 차이가 있을 때 배송, 검수, 보증, 보험 에이전트가 새로운 조건을 제시해 거래 가능성을 높일 수 있다. HNP는 가격 흥정을 넘어 여러 전문 에이전트가 거래를 조립하는 공통 합의 계층이 된다.

### 10.5 Haggle의 장기 단계

```text
현재    Haggle = 상품을 등록하고 AI가 협상하는 플랫폼
중기    Haggle = 여러 플랫폼의 거래를 협상하는 에이전트 네트워크
장기    Haggle = AI 경제의 합의·권한·신뢰 Control Plane
```

---

## 11. 기업 간 복합 협상 — 설계만, 구현은 Deferred

> **Status: Deferred / Design Only**
> 현재 MVP와 초기 외부 연동 범위에 포함하지 않는다. Core가 미래 확장을 막지 않도록 compatibility seam만 유지한다.

### 11.1 가능한 장기 사용 사례

- 공급업체 조달: 단가, MOQ, 납기, 품질보증
- SaaS 계약: 좌석 수, 연간 약정, SLA, 지원 등급
- API·클라우드 계약: 사용량, rate limit, 데이터 보관
- 물류 계약: 물량, 운송 구간, 보험, 지연 패널티
- 데이터·콘텐츠 라이선스
- AI 에이전트 간 서비스 구매
- 경쟁입찰, 역경매, 다자 협상

### 11.2 미래 호환성을 위해 남길 개념

1. `parties[]`와 확장 가능한 role
2. 가격 외 typed issue
3. 조건 dependency를 표현할 Agreement Graph
4. package offer와 alternative package
5. provisional/partial agreement
6. term reopen과 version/diff
7. 조직·부서·에이전트별 Authority Matrix
8. 역할별 approval requirement
9. selective disclosure와 confidentiality
10. 다수 당사자·다수 서명
11. 법률 문서 hash와 CLM/e-sign reference
12. amendment와 dispute evidence binding

### 11.3 기업용 Agreement Graph 예시

```json
{
  "terms": [
    {
      "id": "annual_volume",
      "type": "quantity.minimum",
      "value": 1000000,
      "unit": "USD/year"
    },
    {
      "id": "discount",
      "type": "price.discount.percent",
      "value": 12,
      "condition": { "requires": ["annual_volume"] }
    }
  ]
}
```

### 11.4 HNP가 법률 계약을 대체하지 않는다

```text
HNP Agreement Capsule
├─ 구조화된 상업 조건
├─ 제안·승인·권한 기록
├─ agreement hash
├─ legal document hash
└─ CLM/e-sign reference
```

HNP는 합의 과정과 상업 조건의 무결성을 책임지고, 법률 문서 작성·검토·전자서명은 전문 시스템과 사람에게 연결한다.

### 11.5 미래 extension 후보

```text
HNP Core
├─ proposal
├─ issues
├─ parties
├─ accept/reject/escalate
├─ hash/signature
└─ agreement

HNP Extensions
├─ procurement
├─ SLA
├─ licensing
├─ multi-party
├─ legal-approval
└─ confidentiality
```

현재에는 extension의 구체적인 상태 머신과 UI를 구현하지 않는다.

---

## 12. API 비용과 장기 경제성

### 12.1 기본 비용식

```text
Negotiation AI Cost
= rounds
× model calls per round
× tokens per call
× model price
```

단순 소비자 협상의 단위 원가는 장기적으로 낮아질 가능성이 높다. 그러나 모델 가격 하락만을 사업 전제로 삼지 않는다.

### 12.2 Accepted Direction — 비용을 구조적으로 낮추는 방법

1. 서명·권한·범위·hash·상태 전이는 코드가 처리한다.
2. 한 라운드에 가능한 한 한 번 이하의 LLM call을 목표로 한다.
3. 전체 대화 대신 state snapshot과 delta를 전달한다.
4. 반복되는 protocol rule과 prompt prefix는 cache 가능한 구조로 둔다.
5. 단순 협상은 소형 모델 또는 규칙 엔진으로 처리한다.
6. 고가·복합·위험 거래만 고성능 모델로 승격한다.
7. 명확한 overlap 또는 incompatibility는 LLM 전에 판정한다.
8. max rounds, model calls, tokens, cost, parallel sessions를 mandate별로 제한한다.
9. 외부 A2A 환경에서는 각 당사자 agent operator가 자신의 inference 비용을 부담할 수 있다.

### 12.3 모델 라우팅 원칙

```text
L0 Deterministic Code
→ 권한·서명·범위·상태·합의 검증

L1 Small Model
→ 일반 상품 해석과 단순 협상

L2 Mid Model
→ 조건 충돌과 복합 제안

L3 Frontier/Premium Model
→ 고가 거래, 기업 협상, 높은 실패 비용
```

### 12.4 예산 필드 후보

```text
max_rounds
max_model_calls
token_budget
cost_budget
parallel_session_limit
premium_model_allowed
escalation_threshold
```

비용 한도 도달 시 안전한 행동은 다음 중 하나여야 한다.

- 상태를 압축하고 저가 모델로 전환
- best-known proposals를 사용자에게 제시
- 추가 비용 승인을 요청
- 협상을 안전하게 중단

### 12.5 장기 가치

모델 비용이 낮아질수록 HNP와 Haggle의 가치는 inference 자체보다 다음에 남는다.

- 누가 어떤 권한으로 행동했는가
- 어떤 조건이 합의됐는가
- 합의가 변조되지 않았는가
- 어떤 agent와 evidence를 신뢰할 수 있는가
- 어느 checkout에서 합의를 redeem할 수 있는가
- 문제가 생기면 어떤 절차와 판례로 해결하는가

---

## 13. 신뢰·안전·시장 안정성

에이전트의 속도와 병렬성이 증가하면 새로운 공격과 실패가 생긴다.

| 위험 | 필요한 방어 |
|---|---|
| 반복 오퍼로 floor 탐색 | attempt control, rate limit, cooldown, probing detection |
| Sybil agent | principal·agent identity, reputation, credential binding |
| 권한 위조 | signed authority, issuer validation, expiry, revocation |
| 같은 재고의 동시 합의 | inventory reservation, agreement expiry, atomic redeem |
| 오래된 proposal 수락 | sequence, proposal hash, expiry |
| private range 유출 | data minimization, selective disclosure, proof reference |
| 모델 hallucination | deterministic validation, authoritative product lookup |
| 에이전트 담합·가격 조작 | cross-session anomaly detection, audit, policy limits |
| 약한 에이전트 착취 | symmetric rules, attempt caps, optional trusted referee |
| 결제와 합의 불일치 | checkout hash binding, Agreement Capsule verification |
| webhook 중복·순서 오류 | idempotency, event timestamp, reconciliation |

설명 가능성은 모델의 숨은 추론을 공개하는 것이 아니라 다음을 제공하는 것으로 정의한다.

- 어떤 조건이 변경됐는가
- 어떤 권한·정책 때문에 수락 또는 escalation됐는가
- 어떤 proposal에 합의가 바인딩됐는가
- 어떤 evidence와 checkout이 연결됐는가

---

## 14. 프로토콜과 플랫폼의 장기 사업 경계

### 14.1 Open Protocol, Closed Engine

```text
Open
├─ HNP Core spec
├─ JSON schemas
├─ test vectors
├─ conformance kit
├─ reference SDK
└─ extension/binding rules

Competitive / Hosted
├─ Haggle negotiation engine
├─ routing and orchestration
├─ trust and precedent intelligence
├─ abuse detection
├─ hosted verifier
├─ dispute services
└─ enterprise operations
```

### 14.2 네트워크 성공 조건

Haggle 내부 거래량만으로 HNP 표준화를 판단하지 않는다.

- 외부 채널에서 생성된 HNP session 비율
- Haggle 밖의 agent가 생성한 proposal 비율
- 외부 checkout에서 redeem된 Agreement Capsule 비율
- 독립 HNP 구현체 수
- conformance suite 통과 agent·merchant 수
- 복수 commerce rail에서 같은 agreement를 사용할 수 있는지
- 평균 라운드·비용·시간 대비 합의율
- private authority 위반과 probing 차단률

---

## 15. 단계별 발전 방향

> 아래는 설계 순서다. 구현 승인이 아니다.

### Phase A — 철학·경계 확정

- 기존 문서와 코드의 모순 감사
- HNP core와 Haggle application policy 분리
- Identity/Agent/Authority 용어 확정
- Agreement Capsule 최소 계약 확정
- 채널별 책임 표 작성

### Phase B — Consumer Core

- canonical HNP envelope·issue·proposal·agreement
- private range와 deterministic referee
- ChatGPT 구매·판매 전체 흐름
- Shopify product/checkout adapter
- 사용자 승인과 자율성 단계
- 비용 telemetry와 session budget

### Phase C — External Agent Network

- A2A Agent Card와 extension
- partner OAuth, SDK, webhook
- Negotiability Manifest
- external conformance sandbox
- UCP/OpenAI commerce binding

### Phase D — Proof and Trust

- signed Boundary Attestation
- portable Agreement Capsule redemption
- agent reputation와 precedent
- trusted verifier 또는 TEE 검토
- optional privacy-preserving proof 연구

### Phase E — Persistent Markets

- persistent buyer intent
- dynamic seller policy
- 병렬 협상과 multi-listing BATNA
- 전문 agent가 참여하는 거래 조립
- market manipulation 방어

### Phase F — Enterprise Extensions (Deferred)

- Agreement Graph
- package/partial/multi-party negotiation
- organization Authority Matrix
- legal/CLM integration
- confidentiality extension

---

## 16. 설계 결정 현황

### 16.1 Accepted Direction

- 구현 전 코드·철학·경계를 먼저 설계한다.
- 초기 설계는 이 WIP 한 문서에 통합한다.
- HNP는 transport·commerce protocol과 경쟁하지 않고 negotiation semantic layer가 된다.
- HNP는 private strategy가 아니라 proposal·authority reference·agreement를 표준화한다.
- Hard Authority와 Soft Preference를 분리한다.
- AI는 range 안에서 자유롭게 발전하고 deterministic referee가 경계를 강제한다.
- 내부 Web, MCP, A2A, Shopify는 같은 core에 연결되는 adapter다.
- ChatGPT는 MCP, 외부 agent는 A2A, Shopify는 Shopify App/API로 연결한다.
- 기업용 복합 협상은 설계 호환성만 확보하고 현재 구현하지 않는다.
- 단순 협상의 장기 원가는 낮아지도록 code-first validation과 model routing을 사용한다.

### 16.2 Proposed

- Discover → Delegate → Negotiate → Prove → Redeem을 HNP 대표 수명주기로 사용
- Negotiability Manifest와 `rel="negotiate"`
- Portable Agreement Capsule을 HNP의 대표 출력으로 지정
- signed Boundary Attestation
- 장기 optional zero-knowledge boundary proof
- Persistent Intent Market
- Haggle을 AI 경제의 Agreement/Authority/Trust Control Plane으로 포지셔닝
- 승인 후 `docs/architecture/` 정식 폴더 승격

### 16.3 Deferred

- 기업용 Agreement Graph 전체 구현
- package/partial/multi-party negotiation engine
- 조직별 legal approval workflow
- zero-knowledge proof 구현
- HNP 공식 표준 기구 제안
- 완전 자율 결제

### 16.4 Open Questions

1. HNP 1.0의 최소 core message와 required field는 무엇인가?
2. AuthorityGrant는 HNP core object인가, protocol-adjacent reference인가?
3. Agreement Capsule의 필수 서명자는 누구인가?
4. merchant-signed offer와 neutral verifier의 관계는 무엇인가?
5. Negotiability Manifest를 HNP profile, UCP extension, product feed 중 어디서 먼저 증명할 것인가?
6. ChatGPT 사용자는 어느 단계에서 Haggle account linking이 필수인가?
7. guest negotiation을 허용한다면 claim과 abuse 방어는 어떻게 연결할 것인가?
8. Shopify에서 accepted deal을 variant discount, draft order, discount function 중 어떤 방식으로 redeem할 것인가?
9. 합의 시 inventory reservation을 Haggle과 merchant 중 누가 소유하는가?
10. 외부 agent가 자신의 모델 비용을 부담할 때 fee와 rate limit은 어떻게 정산하는가?
11. HNP conformance badge와 trust score를 분리할 것인가?
12. Protocol governance를 언제 Haggle 회사에서 분리할 것인가?

---

## 17. 다음 설계 감사에서 확인할 것

### 코드 감사

- HNP canonical type family와 legacy adapter 경계
- current agreement object와 transaction handoff 구조
- agent delegation의 issuer, scope, expiry, revocation
- MCP tool별 auth·ownership·annotation
- negotiation session actor derivation
- group negotiation과 multi-listing 기반의 미래 확장성
- payment/order/shipment/dispute handoff의 authoritative identifiers
- 현재 telemetry에서 round/token/model/cost를 측정할 수 있는지

### 문서 감사

- `CLAUDE.md`의 전역 SOT 범위
- `docs/engine/SOT.md`와 이 문서의 겹침
- `hnp-standardization-review.md`의 구현 완료 항목 검증
- `Haggle_Strategic_Discussion_20260409.md`의 장기 전략 승격 여부
- archive UCP 문서 중 현재 spec과 맞지 않는 내용 표시
- WIP 완료 후 정식 문서 승격·통합·삭제 경로

### 제품 감사

- 사용자가 실제로 이해할 수 있는 range와 approval UI
- 판매자·구매자 양쪽에 동등한 control surface가 있는지
- ChatGPT 안에서 판매와 구매가 각각 끝까지 가능한지
- Shopify merchant가 상품별 정책을 설정하고 해제할 수 있는지
- Agreement Capsule이 checkout 실패·만료·재협상 시 어떻게 처리되는지

---

## 18. 정식 문서 승격 계획

이 WIP가 승인되면 한 번에 여러 문서로 분해하지 않는다.

```text
확정된 전역 철학·불변조건
→ CLAUDE.md

협상 엔진 목표·실제 상태
→ docs/engine/SOT.md

플랫폼→네트워크→프로토콜 전략
→ docs/strategy/

MVP 구현 순서·기술 부채
→ docs/mvp/

구현 브리프와 리뷰 흐름
→ handoff/
```

플랫폼 전체의 장기 구조가 승인되고 독립적으로 유지할 가치가 확인되면 다음 승격을 검토한다.

```text
docs/architecture/
├── 00_INDEX.md
└── haggle-core-and-ecosystem.md
```

HNP normative spec, binding, conformance가 각각 독립 변경 주기를 갖게 되면 그때 protocol 폴더 승격을 검토한다.

```text
docs/protocol/
├── 00_INDEX.md
├── HNP_SOT.md
├── bindings-and-extensions.md
└── conformance-and-versioning.md
```

정식 승격 시 해당 `00_INDEX.md`, `docs/README.md`, 필요한 경우 `CLAUDE.md` 라우팅을 함께 갱신한다. 이 WIP는 승인된 내용을 정식 문서에 통합한 뒤 archive 또는 삭제한다.

---

## Appendix A. 용어

| 용어 | 의미 |
|---|---|
| Authority | 에이전트가 수행할 수 있는 행동·금액·조건의 경계 |
| Range Harness | Hard Authority와 Soft Preference로 AI 자율성을 제한하는 실행 장치 |
| Negotiability Manifest | 무엇을 어떤 프로토콜·조건으로 협상할 수 있는지 광고하는 문서 |
| Proposal | 하나 이상의 typed issue를 포함한 제안 snapshot |
| Boundary Proof | 비공개 한도를 노출하지 않고 제안·합의가 권한 안임을 증명하는 수단 |
| Agreement Capsule | 서명·hash·조건·redemption 정보를 담은 이식 가능한 합의 객체 |
| Binding | 동일한 HNP 의미를 MCP, A2A, REST 등에 매핑하는 방식 |
| Adapter | 외부 채널 요청과 내부 application command 사이의 변환 계층 |
| Commerce Router | 합의 후 Shopify, UCP, ACP, Haggle 등 실행 레일을 선택하는 계층 |
| Control Plane | agent discovery, identity, authority, routing, policy, trust를 관리하는 Haggle 플랫폼 역할 |
| Referee | 모델의 전략을 대신하지 않고 경계·권한·공정·무결성을 검증하는 결정론적 계층 |

---

## Appendix B. 내부 참고 문서

- [`CLAUDE.md`](../../CLAUDE.md)
- [`docs/README.md`](../README.md)
- [`docs/engine/SOT.md`](../engine/SOT.md)
- [`docs/wip/hnp-standardization-review.md`](./hnp-standardization-review.md)
- [`docs/Haggle_Strategic_Discussion_20260409.md`](../Haggle_Strategic_Discussion_20260409.md)
- [`docs/strategy/Haggle_Moat_Strategy.md`](../strategy/Haggle_Moat_Strategy.md)
- [`docs/archive/UCP_Integration_Plan.md`](../archive/UCP_Integration_Plan.md)
- [`docs/wip/agent-system-state-and-direction-2026-05-05.md`](./agent-system-state-and-direction-2026-05-05.md)

## Appendix C. 외부 표준 참고

> 아래 링크는 2026-08-09 설계 검토 시점의 공식 문서다. 외부 표준은 변경될 수 있으므로 구현 직전에 다시 검증한다.

- [OpenAI — Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI — MCP authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI — Product checkout conversion spec](https://developers.openai.com/plugins/guides/product-checkout-conversion-spec)
- [OpenAI — Model guidance and prompt caching](https://developers.openai.com/api/docs/guides/latest-model)
- [A2A — Agent discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [A2A — Extensions and binding governance](https://a2a-protocol.org/latest/topics/extension-and-binding-governance/)
- [UCP — Core concepts](https://ucp.dev/documentation/core-concepts/)
- [UCP — Official specification overview](https://ucp.dev/latest/specification/overview/)
- [UCP — Discount extension](https://ucp.dev/latest/specification/discount/)
- [AP2 — Agentic Payment Protocol](https://ap2-protocol.org/ap2/specification/)
- [Shopify — Theme App Extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions)
- [Shopify — Draft Order API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftordercreate)
- [Shopify — Webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe)
