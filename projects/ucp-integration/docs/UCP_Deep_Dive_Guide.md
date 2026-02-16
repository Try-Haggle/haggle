# UCP 완전 정복 — Haggle 팀을 위한 심층 가이드

**작성일:** 2026년 2월 16일
**목적:** UCP 아키텍처를 이해하고, Haggle의 HNP가 어디에 어떻게 연동되는지 파악

---

## 1. UCP란 무엇인가

### 1.1 한 줄 요약

**UCP = "AI 에이전트가 아무 가게에서나 물건을 사고팔 수 있게 해주는 공용 언어"**

웹사이트가 인간을 위해 HTML로 쓰여졌다면, UCP는 AI 에이전트를 위해 JSON으로 쓰여진 "커머스 인터페이스"입니다.

### 1.2 왜 필요한가

현재 상태:
```
ChatGPT → Etsy 연동하려면 → Etsy 전용 API 개발 필요
ChatGPT → Shopify 연동하려면 → Shopify 전용 API 개발 필요
Gemini → Etsy 연동하려면 → 또 다른 전용 API 개발 필요
... N개 에이전트 × M개 판매자 = N×M개 커스텀 통합
```

UCP 이후:
```
모든 에이전트 → UCP 프로토콜 → 모든 판매자
1개 표준 × 1개 구현 = 전체 호환
```

### 1.3 누가 만들었나

- **공동 개발:** Google + Shopify
- **공동 설계 참여:** Etsy, Target, Walmart, Wayfair
- **지지 기업 (20+):** Visa, Mastercard, American Express, Stripe, Adyen, Best Buy, Macy's, The Home Depot, Flipkart, Zalando 등
- **라이센스:** Apache 2.0 (오픈소스, 상업적 사용 자유)
- **거버넌스:** GitHub 기반 오픈 커뮤니티 (아직 초기, 커밋 3개, 스타 5개)
- **발표:** 2026년 1월 11일, NRF(미국소매연합회) 컨퍼런스

---

## 2. 아키텍처 심층 분석

### 2.1 4가지 참여자 (Roles)

```
┌─────────────────┐      ┌─────────────────┐
│    Platform      │      │    Business      │
│  (AI 에이전트)    │◄────►│   (판매자)        │
│                  │      │                  │
│ Gemini, ChatGPT, │      │ Shopify 가게,     │
│ Copilot, 커스텀   │      │ Target, Etsy 등   │
└────────┬────────┘      └────────┬────────┘
         │                        │
         │                        │
┌────────▼────────┐      ┌────────▼────────┐
│   Credential     │      │      PSP         │
│   Provider       │      │ (결제 서비스)      │
│                  │      │                  │
│ Google Wallet,   │      │ Stripe, Adyen,   │
│ Apple Pay        │      │ PayPal           │
└─────────────────┘      └─────────────────┘
```

**핵심 원칙: Business가 Merchant of Record (MoR)**
- 판매자가 거래의 법적 주체
- 고객 데이터, 가격 결정권, 사후 관리 모두 판매자 소유
- UCP는 "중개자"가 아니라 "통역기"

### 2.2 3가지 핵심 개념

#### Capabilities (능력) — "동사"
판매자가 할 수 있는 핵심 기능들:

| Capability | 설명 | 상태 |
|-----------|------|------|
| `dev.ucp.shopping.checkout` | 체크아웃 (장바구니, 세금 계산, 결제) | ✅ 런칭 |
| `dev.ucp.shopping.identity_linking` | OAuth 2.0으로 사용자 계정 연동 | ✅ 런칭 |
| `dev.ucp.shopping.order` | 주문 관리 (배송 추적, 반품) | ✅ 런칭 |
| Catalog | 상품 카탈로그 검색 | 🔜 로드맵 |
| Loyalty | 로열티 프로그램 | 🔜 로드맵 |
| Travel, Services 등 | 새 버티컬 | 🔜 로드맵 |

#### Extensions (확장) — "형용사/부사"
Capability를 보강하는 선택적 기능들:

| Extension | extends | 설명 |
|-----------|---------|------|
| `dev.ucp.shopping.fulfillment` | checkout | 배송 옵션, 픽업, 배송 시간대 |
| `dev.ucp.shopping.discount` | checkout | 할인 코드, 프로모션 |
| `dev.ucp.shopping.ap2_mandates` | checkout | AP2 결제 보안 |
| `dev.ucp.shopping.buyer_consent` | checkout | 구매자 동의 (약관 등) |
| `com.loyaltyprovider.points` | checkout | (예시) 서드파티 로열티 포인트 |
| **`ai.haggle.negotiation`** | **checkout** | **Haggle이 만들 Extension** |

#### Services (서비스) — "통신 방법"
같은 Capability를 여러 방식으로 제공:

| Service | 프로토콜 | 용도 |
|---------|---------|------|
| REST API | HTTP/JSON | 기본, 범용 |
| MCP | JSON-RPC | Claude 등 LLM 도구 호출 |
| A2A | gRPC/HTTP | Google 에이전트 간 통신 |
| Embedded | iframe/JSON-RPC | 내장형 체크아웃 UI |

---

## 3. Discovery & Negotiation (발견 & 협상) 상세

### 3.1 Business Profile — 판매자가 자기 능력을 선언

판매자는 자기 도메인에 JSON 프로필을 게시합니다:

```
GET https://cool-store.com/.well-known/ucp
```

```json
{
  "ucp": {
    "version": "2026-01-11",
    "services": {
      "dev.ucp.shopping": {
        "version": "2026-01-11",
        "spec": "https://ucp.dev/specification/overview",
        "rest": {
          "schema": "https://ucp.dev/services/shopping/rest.openapi.json",
          "endpoint": "https://cool-store.com/ucp/v1"
        },
        "mcp": {
          "schema": "https://ucp.dev/services/shopping/mcp.openrpc.json",
          "endpoint": "https://cool-store.com/ucp/mcp"
        },
        "a2a": {
          "endpoint": "https://cool-store.com/.well-known/agent-card.json"
        }
      }
    },
    "capabilities": [
      {
        "name": "dev.ucp.shopping.checkout",
        "version": "2026-01-11",
        "spec": "https://ucp.dev/specification/checkout",
        "schema": "https://ucp.dev/schemas/shopping/checkout.json"
      },
      {
        "name": "dev.ucp.shopping.fulfillment",
        "version": "2026-01-11",
        "extends": "dev.ucp.shopping.checkout"
      },
      {
        "name": "dev.ucp.shopping.discount",
        "version": "2026-01-11",
        "extends": "dev.ucp.shopping.checkout"
      },
      {
        "name": "com.loyaltyprovider.points",
        "version": "1.0",
        "extends": "dev.ucp.shopping.checkout",
        "spec": "https://loyaltyprovider.com/ucp-extension/spec"
      }
    ],
    "payment_handlers": [
      { "name": "com.google.pay", "version": "1.0" },
      { "name": "com.shopify.shop_pay", "version": "1.0" }
    ]
  }
}
```

이것은 robots.txt의 커머스 버전입니다. AI 에이전트가 이걸 읽으면:
- "이 가게는 체크아웃, 배송, 할인을 지원하고"
- "로열티 포인트도 있고"
- "Google Pay와 Shop Pay로 결제 가능하구나"
를 즉시 파악합니다.

### 3.2 Agent Profile — 에이전트도 자기 능력을 선언

에이전트도 프로필을 가집니다:

```json
{
  "ucp": {
    "version": "2026-01-11",
    "capabilities": [
      { "name": "dev.ucp.shopping.checkout" },
      { "name": "dev.ucp.shopping.fulfillment" },
      { "name": "dev.ucp.shopping.discount" }
    ],
    "credential_providers": [
      { "name": "com.google.pay", "version": "1.0" },
      { "name": "com.apple.pay", "version": "1.0" }
    ]
  }
}
```

### 3.3 Capability Negotiation — 교집합 계산

에이전트가 요청을 보낼 때 자기 프로필 URL을 같이 보냅니다.
판매자 서버가 **양쪽 다 지원하는 것만** 골라서 응답합니다.

```
판매자 지원:   checkout, fulfillment, discount, loyalty, [Google Pay, Shop Pay]
에이전트 지원:  checkout, fulfillment, discount,          [Google Pay, Apple Pay]
──────────────────────────────────────────────────────────────────────
교집합:        checkout, fulfillment, discount,          [Google Pay]
```

→ 이 거래에서는 loyalty 빠지고, 결제는 Google Pay만 가능.

**이것은 HTTP의 Content Negotiation과 같은 원리:**
```
HTTP:  Accept: text/html, application/json  →  Content-Type: application/json
UCP:   capabilities: [checkout, discount]   →  negotiated: [checkout, discount]
```

### 3.4 Reverse-Domain Naming — 승인 없이 확장

```
dev.ucp.shopping.*        → UCP 공식 (ucp.dev 관리)
com.shopify.*             → Shopify가 정의 (shopify.com 소유)
com.loyaltyprovider.*     → 로열티 업체가 정의
ai.haggle.*               → Haggle이 정의 (tryhaggle.ai 소유)
```

**도메인을 소유하면 네임스페이스를 소유.**
중앙 레지스트리도 없고, 승인 위원회도 없습니다.
Java의 패키지 네이밍과 동일한 방식입니다.

---

## 4. Checkout Flow 상세

### 4.1 체크아웃 상태 머신

```
incomplete → requires_escalation → ready_for_complete → completed
                    ↓
              (Human Handoff)
              사람이 직접 처리
```

| 상태 | 의미 | 에이전트 행동 |
|------|------|-------------|
| `incomplete` | 정보 부족 | API로 정보 채우기 시도 |
| `requires_escalation` | 사람 입력 필요 | API로 해결 시도 → 안 되면 `continue_url`로 사람에게 넘김 |
| `ready_for_complete` | 모든 정보 수집됨 | 프로그래밍으로 완료 가능 |
| `completed` | 거래 완료 | 끝 |

### 4.2 실제 API 흐름

```
1. 에이전트 → 판매자: POST /ucp/v1/checkout/sessions
   {
     "line_items": [{"item_id": "macbook-pro-m3", "quantity": 1}],
     "buyer": {"email": "user@example.com"}
   }

2. 판매자 → 에이전트:
   {
     "id": "chk_123456789",
     "status": "incomplete",          ← 배송 주소 없음
     "line_items": [...],
     "totals": {"subtotal": 199900, "tax": 0, "total": 199900},
     "currency": "USD",
     "required_fields": ["shipping_address"]
   }

3. 에이전트 → 판매자: PATCH /ucp/v1/checkout/sessions/chk_123456789
   {
     "shipping_address": {
       "line1": "123 Main St",
       "city": "Salt Lake City", "state": "UT", "zip": "84101"
     }
   }

4. 판매자 → 에이전트:
   {
     "id": "chk_123456789",
     "status": "ready_for_complete",    ← 이제 결제 가능
     "totals": {"subtotal": 199900, "tax": 13993, "total": 213893},
     "payment": {
       "handlers": [
         {"name": "com.google.pay", ...}
       ]
     }
   }

5. 에이전트 → 판매자: POST /ucp/v1/checkout/sessions/chk_123456789/complete
   {
     "payment_token": "tok_xxx..."     ← Google Pay 토큰
   }

6. 판매자 → 에이전트:
   {
     "status": "completed",
     "order_id": "ord_789",
     "confirmation_url": "https://cool-store.com/orders/789"
   }
```

### 4.3 Human Handoff (에스컬레이션)

에이전트가 처리 못하는 경우 (예: 가구 배송 날짜 선택):

```json
{
  "status": "requires_escalation",
  "escalation": {
    "reason": "delivery_window_selection",
    "message": "Please select a delivery date and time window",
    "continue_url": "https://cool-store.com/checkout/chk_123?token=abc"
  }
}
```

에이전트: "배송 날짜를 직접 선택하셔야 합니다. 이 링크에서 완료해주세요."
→ 사용자가 링크 클릭 → 기존 체크아웃 상태 그대로 이어서 진행

**Embedded Checkout Protocol (ECP):** 더 세련된 방식. iframe으로 판매자 체크아웃을 에이전트 UI 안에 내장. JSON-RPC로 양방향 통신.

---

## 5. 결제 (Payment) 아키텍처

### 5.1 결제 핸들러 시스템

UCP의 가장 혁신적인 부분. **결제 수단(instrument)과 결제 처리자(handler)를 분리:**

```
결제 수단 (Instrument)     결제 처리자 (Handler)
─────────────────────     ───────────────────
신용카드                   → Stripe
Google Wallet 토큰         → Adyen
Apple Pay 토큰             → Chase
Shop Pay 토큰              → Shopify Payments
BNPL (후불결제)             → Klarna
```

**핵심:** 새로운 결제 수단을 추가하려면 프로토콜을 바꿀 필요 없이, 새 handler 스펙만 발행하면 됨.

### 5.2 양쪽 협상으로 결제 수단 결정

```
에이전트가 제공 가능한 것:  [Google Pay, Apple Pay]
판매자가 받을 수 있는 것:   [Google Pay, Shop Pay, Klarna]
──────────────────────────────────────────────────────
이 거래에서 사용 가능:      [Google Pay] → 소비자가 선택
```

장바구니 내용, 구매자 위치, 거래 금액에 따라 가능한 결제 수단이 동적으로 변합니다.

### 5.3 AP2 (Agent Payments Protocol)와의 관계

AP2는 Google이 2025년에 발표한 에이전트 결제 프로토콜:
- **UCP가 "뭘 살지"를 결정** → **AP2가 "어떻게 돈을 낼지"를 처리**
- AP2 Mandates = 에이전트에게 특정 금액까지 결제를 위임하는 서명된 권한
- UCP Extension으로 통합됨 (`dev.ucp.shopping.ap2_mandates`)

---

## 6. 경쟁 프로토콜과의 비교

### 6.1 ACP vs UCP

| | ACP (OpenAI+Stripe) | UCP (Google+Shopify) |
|---|---|---|
| **초점** | 체크아웃 레일 | 전체 쇼핑 여정 |
| **발견** | ChatGPT 내부 온보딩 | `/.well-known/ucp` 오픈 크롤링 |
| **결제** | Stripe 위임 토큰 | 멀티 PSP 핸들러 |
| **배포** | ChatGPT에서 먼저 | Google AI Mode + Gemini에서 먼저 |
| **거버넌스** | OpenAI+Stripe 공동 | 오픈소스 커뮤니티 |
| **확장성** | RFC 기반 | Extension + reverse-domain |
| **현재 구현** | ChatGPT Instant Checkout | Google AI Mode 내 구매 |

**이 둘은 경쟁이 아니라 공존.** UCP는 A2A, MCP, AP2와 호환되도록 설계. 결국 판매자는 둘 다 지원하게 됩니다.

### 6.2 전체 프로토콜 스택

```
┌─────────────────────────────────────────────────┐
│ AI 에이전트 (Gemini, ChatGPT, Copilot)           │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│ A2A — 에이전트 간 통신 (Google → Linux Foundation) │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│ UCP — 커머스 표준 (Google + Shopify)              │
│  ├── Checkout (체크아웃)                          │
│  ├── Identity Linking (계정 연동)                  │
│  ├── Order (주문 관리)                            │
│  ├── Extensions:                                 │
│  │   ├── Fulfillment (배송)                      │
│  │   ├── Discount (할인)                         │
│  │   ├── ai.haggle.negotiation ← HERE            │
│  │   └── ...                                     │
│  └── Payment Handlers                            │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│ AP2 — 에이전트 결제 (Google)                      │
│ ACP — 에이전트 체크아웃 (OpenAI + Stripe)          │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│ MCP — LLM 도구 통합 (Anthropic → Foundation)      │
└─────────────────────────────────────────────────┘
```

---

## 7. Haggle의 UCP 통합 전략

### 7.1 `ai.haggle.negotiation` Extension 설계 초안

```json
{
  "name": "ai.haggle.negotiation",
  "version": "1.0",
  "extends": "dev.ucp.shopping.checkout",
  "spec": "https://protocol.tryhaggle.ai/ucp-extension/spec",
  "schema": "https://protocol.tryhaggle.ai/ucp-extension/negotiation.json",
  "description": "Enables AI-to-AI price negotiation for listings"
}
```

### 7.2 판매자 프로필에 추가되는 모습

```json
{
  "ucp": {
    "capabilities": [
      { "name": "dev.ucp.shopping.checkout", ... },
      { "name": "dev.ucp.shopping.fulfillment", ... },

      {
        "name": "ai.haggle.negotiation",
        "version": "1.0",
        "extends": "dev.ucp.shopping.checkout",
        "spec": "https://protocol.tryhaggle.ai/spec",
        "config": {
          "negotiation_endpoint": "https://api.tryhaggle.ai/v1",
          "protocol": "HNP/1.0",
          "max_rounds": 20,
          "categories": ["electronics", "general"],
          "price_negotiable": true
        }
      }
    ]
  }
}
```

### 7.3 협상이 포함된 체크아웃 흐름

```
일반 UCP 체크아웃:
  에이전트 → 판매자: "이거 살게" → 고정가격 → 결제 → 끝

Haggle Extension이 있는 체크아웃:
  에이전트 → 판매자: "이거 살게"
  에이전트 → /.well-known/ucp 확인: "ai.haggle.negotiation 지원!"
  에이전트 → Haggle API: "이 상품 협상해줘" (HNP 프로토콜)
  Haggle → 판매자 에이전트: AI-to-AI 협상 (10라운드)
  합의 도달 → 합의된 가격으로 UCP Checkout 세션 생성
  에이전트 → 판매자: 일반 체크아웃 진행 (합의가로)
  결제 → 완료
```

**핵심: 협상은 체크아웃 "전에" 별도로 일어나고, 합의가가 체크아웃에 반영됨.**
UCP 체크아웃 자체를 바꿀 필요가 없습니다.

### 7.4 에이전트가 Haggle Extension을 모를 경우

Capability Negotiation의 장점:
```
에이전트: "나는 checkout, fulfillment만 할 수 있어"
판매자:   "나는 checkout, fulfillment, ai.haggle.negotiation 있어"
교집합:   checkout, fulfillment (협상 없이 정가 거래)
```

→ Haggle Extension을 모르는 에이전트는 그냥 정가로 삼. 아무것도 깨지지 않음.
→ Haggle Extension을 아는 에이전트만 가격 협상을 시도함.

이것이 **"graceful degradation"** — 하위 호환성이 자동으로 보장되는 설계.

---

## 8. 실전 체크리스트: Haggle가 해야 할 일

### 즉시 (1-2주)

- [ ] UCP GitHub 레포 전체 코드 리뷰 (`spec/`, `source/`, `generated/`)
- [ ] UCP 샘플 구현 실행해보기 (Python 샘플 있음)
- [ ] `ai.haggle.negotiation` Extension JSON Schema 초안 작성
- [ ] UCP GitHub Discussions에 자기소개 + Negotiation Extension 아이디어 포스팅

### 단기 (1-2개월)

- [ ] Haggle UCP Extension 스펙 문서 작성 (protocol.tryhaggle.ai에 호스팅)
- [ ] 레퍼런스 판매자 구현: Shopify 앱 → 판매자 /.well-known/ucp에 자동 추가
- [ ] 레퍼런스 에이전트 구현: MCP 어댑터로 Claude가 Haggle Extension 인식

### 중기 (3-6개월)

- [ ] UCP 공식 Extension 제안 (RFC 또는 Discussion을 통해)
- [ ] Conformance test 추가 (UCP가 conformance test 레포를 별도로 운영)
- [ ] Google Developer Relations 접촉

---

## 9. 핵심 리소스

| 리소스 | URL |
|--------|-----|
| UCP 공식 사이트 | https://ucp.dev |
| UCP GitHub 레포 | https://github.com/Universal-Commerce-Protocol/ucp |
| UCP 스펙 (Checkout) | https://ucp.dev/specification/checkout/ |
| UCP 샘플 코드 | https://github.com/Universal-Commerce-Protocol/samples |
| UCP SDK | https://github.com/orgs/Universal-Commerce-Protocol/repositories |
| Shopify 엔지니어링 블로그 (설계 철학) | https://shopify.engineering/ucp |
| Google 개발자 가이드 | https://developers.google.com/merchant/ucp |
| ACP (OpenAI+Stripe) | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol |
| Google 개발자 블로그 (기술 상세) | https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/ |

---

## 10. Haggle 관점 핵심 요약

1. **UCP는 오픈 프로토콜이고, Extension은 승인 없이 만들 수 있다.**
   → `ai.haggle.negotiation`을 정의하는 데 누구의 허락도 필요 없음

2. **UCP의 Discovery 메커니즘이 Haggle의 배포 문제를 해결한다.**
   → ChatGPT 앱스토어 심사를 기다릴 필요 없이, 판매자의 `.well-known/ucp`에 있으면 모든 에이전트가 발견

3. **Capability Negotiation이 하위 호환성을 자동 보장한다.**
   → Haggle Extension을 모르는 에이전트는 그냥 정가로 거래, 아무것도 안 깨짐

4. **UCP는 체크아웃"만" 한다. 협상은 빈자리다.**
   → 이 빈자리를 HNP로 채우는 것이 Haggle의 기회

5. **지금이 골든타임이다.**
   → GitHub에 커밋 3개, 스타 5개. 아직 극초기 단계. 지금 들어가면 Extension 생태계의 First Mover.
