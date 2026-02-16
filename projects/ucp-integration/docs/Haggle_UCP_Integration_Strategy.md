# Haggle × Universal Commerce Protocol — UCP 통합 전략 및 기술 분석 문서

**HNP를 UCP 생태계의 Negotiation Layer로 포지셔닝하기 위한 로드맵**

Version 1.0 | 2026년 2월 16일
Haggle Inc. | Confidential

---

## 목차

1. UCP 개요: AI 커머스의 공용어
2. UCP 아키텍처 심층 분석
3. Discovery & Negotiation 메커니즘
4. Checkout Flow 상세
5. 결제 (Payment) 아키텍처
6. Haggle의 UCP 통합 전략
7. 결제 레이어 전략: 3-Track 모델
8. 수수료 비교 및 경제성 분석
9. 경쟁 프로토콜 비교
10. 실행 로드맵

---

## 1. UCP 개요: AI 커머스의 공용어

### 1.1 UCP란 무엇인가

Universal Commerce Protocol (UCP) = AI 에이전트가 아무 가게에서나 물건을 사고팔 수 있게 해주는 공용 언어

웹사이트가 인간을 위해 HTML로 쓰여졌다면, UCP는 AI 에이전트를 위해 JSON으로 쓰여진 "커머스 인터페이스"입니다.

**배경: 왜 필요한가**

현재 AI 에이전트가 커머스를 처리하려면 N개 에이전트 x M개 판매자 = NxM개의 커스텀 통합이 필요합니다. UCP는 이를 1개 표준으로 해결합니다.

| 핵심 정보 | |
|-----------|---|
| 공동 개발 | Google + Shopify |
| 공동 설계 | Etsy, Target, Walmart, Wayfair |
| 지지 기업 | Visa, Mastercard, Amex, Stripe, Adyen, Best Buy, Macy's 등 20+ |
| 라이센스 | Apache 2.0 (오픈소스, 상업적 사용 자유) |
| 발표일 | 2026년 1월 11일 (NRF 컨퍼런스) |
| GitHub | github.com/Universal-Commerce-Protocol/ucp |

---

## 2. UCP 아키텍처 심층 분석

### 2.1 4가지 참여자 (Roles)

| 참여자 | 역할 | 예시 |
|--------|------|------|
| Platform (AI 에이전트) | 소비자 대리로 상품 발견, 체크아웃 진행 | Gemini, ChatGPT, Copilot, 커스텀 에이전트 |
| Business (판매자) | 상품/서비스 제공, Merchant of Record (MoR) | Shopify 가게, Target, Etsy, 개인 판매자 |
| Credential Provider | 결제 수단/주소 등 민감 정보 관리 | Google Wallet, Apple Pay |
| PSP (결제 서비스) | 결제 처리, 정산, 카드 네트워크 통신 | Stripe, Adyen, PayPal |

**Haggle의 위치:** Haggle은 Platform과 Business 사이의 Negotiation Extension으로 들어가면서, 동시에 Payment Handler로도 등록하여 결제 레이어 주도권을 유지합니다.

### 2.2 3가지 핵심 개념

**Capabilities (능력) — "동사"**

| Capability | 설명 | 상태 |
|-----------|------|------|
| dev.ucp.shopping.checkout | 체크아웃 (장바구니, 세금, 결제) | ✅ 런칭 |
| dev.ucp.shopping.identity_linking | OAuth 2.0 사용자 계정 연동 | ✅ 런칭 |
| dev.ucp.shopping.order | 주문 관리 (배송 추적, 반품) | ✅ 런칭 |
| Catalog | 상품 카탈로그 검색 | 🔜 로드맵 |
| Loyalty | 로열티 프로그램 | 🔜 로드맵 |

**Extensions (확장) — "형용사"**

Capability를 보강하는 선택적 기능. 승인 없이 누구나 만들 수 있습니다:

| Extension | extends | 설명 |
|-----------|---------|------|
| dev.ucp.shopping.fulfillment | checkout | 배송 옵션, 픽업 |
| dev.ucp.shopping.discount | checkout | 할인 코드, 프로모션 |
| dev.ucp.shopping.ap2_mandates | checkout | AP2 결제 보안 |
| com.loyaltyprovider.points | checkout | 서드파티 로열티 |
| **ai.haggle.negotiation** | **checkout** | **Haggle 가격 협상** |

**Services (서비스) — "통신 방법"**

| Service | 프로토콜 | 용도 |
|---------|---------|------|
| REST API | HTTP/JSON | 기본, 범용 (Shopify, Target 등) |
| MCP | JSON-RPC | Claude 등 LLM 도구 호출 |
| A2A | gRPC/HTTP | Google 에이전트 간 통신 |
| Embedded | iframe + JSON-RPC | 내장형 체크아웃 UI |

---

## 3. Discovery & Negotiation 메커니즘

### 3.1 Business Profile — 판매자가 자기 능력을 선언

판매자는 자기 도메인에 JSON 프로필을 게시합니다. 이것은 robots.txt의 커머스 버전입니다:

```
GET https://cool-store.com/.well-known/ucp
```

```json
{
  "ucp": {
    "version": "2026-01-11",
    "capabilities": [
      { "name": "dev.ucp.shopping.checkout", "..." : "..." },
      { "name": "dev.ucp.shopping.fulfillment", "..." : "..." },
      { "name": "ai.haggle.negotiation",
        "extends": "dev.ucp.shopping.checkout" }
    ],
    "payment_handlers": [
      { "name": "com.google.pay" },
      { "name": "ai.haggle.escrow" }
    ]
  }
}
```

### 3.2 Capability Negotiation — 교집합 계산

| | 판매자 지원 | 에이전트 지원 |
|---|---|---|
| checkout | ✅ | ✅ |
| fulfillment | ✅ | ✅ |
| discount | ✅ | ✅ |
| haggle.negotiation | ✅ | ? |
| loyalty | ✅ | ❌ |

결과: 에이전트가 ai.haggle.negotiation을 지원하면 협상 진행, 모르면 정가로 거래. 아무것도 깨지지 않습니다 (graceful degradation).

### 3.3 Reverse-Domain Naming — 승인 없이 확장

| 네임스페이스 | 소유자 |
|-------------|--------|
| dev.ucp.shopping.* | UCP 공식 (ucp.dev 관리) |
| com.shopify.* | Shopify (shopify.com 소유) |
| ai.haggle.* | Haggle (tryhaggle.ai 소유) — 승인 불필요 |

---

## 4. Checkout Flow 상세

### 4.1 체크아웃 상태 머신

| 상태 | 의미 | 에이전트 행동 |
|------|------|-------------|
| incomplete | 정보 부족 (주소, 결제 등) | API로 정보 채우기 시도 |
| requires_escalation | 사람 입력 필요 | API 시도 → 안 되면 continue_url로 핸드오프 |
| ready_for_complete | 모든 정보 수집됨 | 프로그래밍으로 결제 완료 가능 |
| completed | 거래 완료 | 주문 확인 제공 |

### 4.2 Human Handoff (에스컬레이션)

에이전트가 처리 못하는 경우, 판매자가 continue_url을 제공하면 사용자가 기존 체크아웃 상태 그대로 이어서 진행합니다.

**Haggle의 Hold 시스템과의 유사성:**
UCP의 requires_escalation → continue_url 패턴은 Haggle의 Hold → Human Approval → Payment 패턴과 구조적으로 동일합니다.

---

## 5. 결제 (Payment) 아키텍처

### 5.1 Payment Handler 시스템

결제 수단(instrument)과 결제 처리자(handler)를 분리합니다:
- **결제 수단 (Instrument):** 신용카드, Google Wallet 토큰, Apple Pay, USDC 스테이블코인
- **결제 처리자 (Handler):** Stripe, Adyen, Shop Pay, Haggle Escrow

### 5.2 양쪽 협상으로 결제 수단 결정

```
에이전트: [Google Pay, Apple Pay, ai.haggle.escrow]
판매자:   [Google Pay, Shop Pay, ai.haggle.escrow]
──────────────────────────
교집합: [Google Pay, ai.haggle.escrow] → 소비자가 선택
```

### 5.3 AP2와의 관계

- UCP가 "뭘 살지"를 결정 → AP2가 "어떻게 돈을 낼지"를 처리
- UCP Extension으로 통합됨 (dev.ucp.shopping.ap2_mandates)

---

## 6. Haggle의 UCP 통합 전략

### 6.1 핵심 원칙: 이중 등록

1. **ai.haggle.negotiation** — UCP Extension으로 등록 (협상 기능)
2. **ai.haggle.escrow** — UCP Payment Handler로 등록 (결제 기능)

이 이중 구조로 Discovery는 UCP를 활용하면서, 협상과 결제의 주도권은 Haggle이 유지합니다.

### 6.2 ai.haggle.negotiation Extension 설계

```json
{
  "name": "ai.haggle.negotiation",
  "version": "1.0",
  "extends": "dev.ucp.shopping.checkout",
  "spec": "https://protocol.tryhaggle.ai/spec",
  "config": {
    "negotiation_endpoint": "https://api.tryhaggle.ai/v1",
    "protocol": "HNP/1.0",
    "max_rounds": 20,
    "price_negotiable": true,
    "fee_negotiable": true
  }
}
```

### 6.3 ai.haggle.escrow Payment Handler 설계

```json
{
  "name": "ai.haggle.escrow",
  "version": "1.0",
  "spec": "https://protocol.tryhaggle.ai/payment-handler/spec",
  "supported_tokens": ["USDC", "USDT", "DAI"],
  "network": "Base L2",
  "features": {
    "escrow": true,
    "dispute_resolution": true,
    "fee_negotiable": true
  }
}
```

### 6.4 협상이 포함된 체크아웃 흐름

| # | 주체 | 액션 | 설명 |
|---|------|------|------|
| 1 | 에이전트 → 판매자 | /.well-known/ucp 크롤링 | ai.haggle.negotiation 지원 확인 |
| 2 | 에이전트 → Haggle API | HNP 프로토콜로 협상 시작 | AI-to-AI 협상 (최대 20라운드) |
| 3 | Haggle → 양측 | 합의 도달 | 합의가 + 수수료 부담 비율 확정 |
| 4 | 에이전트 → 판매자 | UCP Checkout 세션 생성 | 합의가로 line_item 생성 |
| 5 | 에이전트 → Haggle | ai.haggle.escrow로 결제 | 에스크로 잠금 + 수수료 차감 |
| 6 | 배송 확인 후 | 에스크로 해제 | 판매자에게 송금, 거래 완료 |

---

## 7. 결제 레이어 전략: 3-Track 모델

### 핵심 문제

UCP 표준 체크아웃(Stripe/Google Pay)에만 결제를 맡기면:
- "수수료 부담 비율 협상" 불가능 (고정 구조)
- Haggle 에스크로 무용지화 (분쟁 해결 불가)
- Stripe 2.9%+30c vs Haggle 1.5% + $0.01 가스비 → 비용 증가

**해결책: 거래 유형별로 결제 경로를 분리하는 3-Track 모델**

### Track A: P2P 거래 (Haggle 풀 스택)

| | |
|---|---|
| 대상 | 중고거래, 개인 간 거래 |
| 협상 | HNP (ai.haggle.negotiation) |
| 결제 | Haggle Escrow (ai.haggle.escrow) — x402, 스테이블코인 |
| 수수료 | 1.5%, 부담 비율 협상 가능 |
| 분쟁 해결 | Haggle 3-tier 시스템 |
| 비용 | 1.5% + ~$0.01 가스비 |

### Track B: 머천트 거래 (하이브리드)

| | |
|---|---|
| 대상 | Shopify 가게에서 협상 가능 상품 |
| 협상 | HNP (ai.haggle.negotiation) |
| 결제 | 판매자의 기존 PSP (Stripe, Shop Pay) — UCP 표준 |
| 수수료 | Haggle 협상 수수료 0.5% (API 과금) |
| 분쟁 해결 | 판매자의 기존 시스템 |
| 비용 | Stripe 2.9%+30c + Haggle 0.5% |

### Track C: 선택형 하이브리드

판매자가 Haggle Escrow를 지원하는 경우, 소비자에게 선택지를 제공:
- **Option 1:** Google Pay로 결제 → 정가 $999, 카드 수수료 2.9%
- **Option 2:** Haggle Escrow로 결제 → 협상가 $850, 수수료 1.5%, 에스크로 보호

---

## 8. 수수료 비교 및 경제성 분석

### 8.1 결제 경로별 비용 분석

| 결제 경로 | 상품가 | 협상 절약 | 결제 수수료 | Haggle 수수료 | 소비자 실결제 | 판매자 실수령 |
|-----------|--------|----------|------------|-------------|-------------|-------------|
| 기존 Shopify (정가) | $999 | $0 | $29.27 | $0 | $999 | $969.73 |
| Track B (협상+Stripe) | $850 | $149 | $24.95 | $4.25 | $850 | $820.80 |
| Track A (협상+Escrow) | $850 | $149 | ~$0.01 | $12.75 | $850 | $837.24 |

### 8.2 수수료 부담 협상 — Haggle만의 차별점

Track A (Haggle Escrow)에서만 가능:

```
Agreement {
  final_price: $850
  fee_split: {
    buyer_ratio: 0.4   // 40%
    seller_ratio: 0.6   // 60%
  }
  // 결과:
  // 구매자 부담: $850 + $5.10 = $855.10
  // 판매자 수령: $850 - $7.65 = $842.35
}
```

Stripe나 Google Pay를 통하면 구조적으로 불가능합니다. 전통 PSP는 "판매자가 수수료를 냄"이 고정이고, 수수료 비율도 고정입니다.

---

## 9. 경쟁 프로토콜 비교

| 프로토콜 | 주체 | 영역 | Haggle 관계 | 협상 지원 |
|---------|------|------|------------|----------|
| UCP | Google+Shopify | 전체 쇼핑 여정 | 보완적 | ❌ 없음 |
| ACP | OpenAI+Stripe | 체크아웃 & 결제 | 보완적 | ❌ 없음 |
| A2A | Google→LF | 에이전트간 통신 | L0 어댑터 | ❌ 없음 |
| AP2 | Google | 결제 프로토콜 | L0 어댑터 | ❌ 없음 |
| MCP | Anthropic→LF | 도구 통합 | L0 어댑터 | ❌ 없음 |
| **HNP** | **Haggle** | **가격 협상** | **빈자리 채움** | **✅ 핵심** |

**핵심 인사이트:** UCP, ACP, A2A, AP2, MCP — 모두 "고정 가격 거래"를 전제합니다. "가격 협상" 레이어는 완전히 비어 있으며, 이것이 HNP의 기회입니다.

---

## 10. 실행 로드맵

### Phase 1: 즉시 (1-2주)
- UCP GitHub 레포 전체 코드 리뷰 (spec/, source/, generated/)
- UCP 샘플 구현 실행해보기 (Python 샘플 제공)
- ai.haggle.negotiation Extension JSON Schema 초안 작성
- UCP GitHub Discussions에 Negotiation Extension 아이디어 포스팅

### Phase 2: 단기 (1-2개월)
- Haggle UCP Extension 스펙 문서 작성 (protocol.tryhaggle.ai 호스팅)
- ai.haggle.escrow Payment Handler 스펙 작성
- 레퍼런스 판매자 구현: Shopify 앱 → /.well-known/ucp 자동 추가
- 레퍼런스 에이전트 구현: MCP 어댑터로 Claude가 Haggle Extension 인식

### Phase 3: 중기 (3-6개월)
- UCP 공식 Extension 제안 (RFC 또는 Discussion)
- Conformance test 추가 (UCP conformance test 레포)
- Google Developer Relations 접촉
- ChatGPT Apps + UCP Extension 병렬 운영 시작

### Phase 4: 장기 (6-12개월)
- B2B 파일럿 (SMB 견적서 협상)
- 멀티 버티컬 확장 (Travel, Services, Real Estate)
- HNP Certified 인증 프로그램 런칭
- Data flywheel 구축 (협상 데이터 → 엔진 튜닝 → 성공률 향상)

---

## 결론: UCP에 맡기는 것과 가져가는 것

| UCP에 맡기는 것 | Haggle이 가져가는 것 |
|----------------|---------------------|
| Discovery (발견) | Price Negotiation (가격 협상) |
| Capability Negotiation (호환성) | Payment + Escrow (결제) |
| Checkout 세션 관리 | Dispute Resolution (분쟁) |
| Fallback 결제 (Stripe 등) | Fee Negotiation (수수료 협상) |

UCP는 "이 가게가 협상을 지원하는지 찾아주는 전화번호부"입니다.
Haggle은 "실제로 협상하고, 돈을 안전하게 처리하는 엔진"입니다.

**글로벌 타임라인:** UCP GitHub에 커밋 3개, 스타 5개. 극초기 단계입니다. 지금 들어가면 Extension 생태계의 First Mover가 될 수 있습니다.
