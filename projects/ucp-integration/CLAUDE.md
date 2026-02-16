# Haggle UCP Integration

**UCP(Universal Commerce Protocol) 생태계에 HNP를 Negotiation Layer로 통합하는 프로젝트**

> 상태: 🔨 Active

---

## 개요

Haggle의 HNP(Haggle Negotiation Protocol)를 UCP Extension으로 등록하여,
모든 UCP 호환 AI 에이전트가 가격 협상을 자동으로 발견하고 활용할 수 있게 합니다.

### 이중 등록 전략
1. **`ai.haggle.negotiation`** — UCP Extension (협상 기능)
2. **`ai.haggle.escrow`** — UCP Payment Handler (결제 기능)

Discovery는 UCP에 맡기고, 협상과 결제의 주도권은 Haggle이 유지합니다.

---

## 핵심 문서

| 문서 | 내용 |
|------|------|
| [UCP Deep Dive Guide](./docs/UCP_Deep_Dive_Guide.md) | UCP 아키텍처 심층 분석, Haggle 통합 포인트 |
| [Integration Strategy](./docs/Haggle_UCP_Integration_Strategy.md) | 통합 전략, 3-Track 결제 모델, 경제성 분석 |
| [Vertical Slice Plan](./docs/Vertical_Slice_Implementation_Plan.md) | 6개 Slice 구현 계획, 타임라인, 패키지 구조 |

---

## Vertical Slices

| Slice | 이름 | 설명 | 의존 |
|-------|------|------|------|
| 0 | Extension 스펙 + Discovery | 스키마 정의, /.well-known/ucp 서빙 | - |
| 1 | 협상 브릿지 API | UCP ↔ HNP 변환, 협상 세션 관리 | Slice 0 |
| 2 | UCP Checkout 연동 | 합의가로 체크아웃, Track B 결제 | Slice 1 |
| 3 | Escrow Payment Handler | ai.haggle.escrow, Track A 결제 | Slice 2 |
| 4 | Agent Adapter (MCP/A2A) | Claude/Gemini 어댑터 | Slice 1 |
| 5 | Merchant SDK (Shopify App) | 판매자 원클릭 활성화 | Slice 0, 1 |

---

## 프로젝트 구조

```
projects/ucp-integration/
├── CLAUDE.md                      ← 이 문서
├── docs/                          ← 전략/분석 문서
├── apps/
│   ├── ucp-api/                   # UCP API 서버
│   ├── ucp-discovery/             # /.well-known/ucp 서빙
│   └── shopify-app/               # Shopify 앱
└── packages/
    ├── ucp-spec/                  # Extension/Handler JSON Schema
    ├── ucp-bridge/                # UCP ↔ HNP 브릿지
    ├── ucp-checkout/              # Checkout 어댑터
    ├── ucp-escrow/                # Escrow Payment Handler
    ├── ucp-mcp-adapter/           # MCP 어댑터 (Claude)
    └── ucp-a2a-adapter/           # A2A 어댑터 (Gemini)
```

---

## Tech Stack

| 영역 | 기술 |
|------|------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.7+ |
| API | Hono |
| Schema | JSON Schema (UCP 호환) |
| Blockchain | Base L2, USDC, Viem |
| Agent Protocol | MCP (Claude), A2A (Gemini) |

---

## 핵심 리소스

| 리소스 | URL |
|--------|-----|
| UCP 공식 | https://ucp.dev |
| UCP GitHub | https://github.com/Universal-Commerce-Protocol/ucp |
| UCP Checkout 스펙 | https://ucp.dev/specification/checkout/ |
| UCP 샘플 코드 | https://github.com/Universal-Commerce-Protocol/samples |

---

## 개발 원칙

1. **UCP 호환 우선**: UCP 표준 스키마를 정확히 준수
2. **Graceful Degradation**: Haggle Extension을 모르는 에이전트도 정상 거래
3. **이중 등록**: Extension(협상) + Payment Handler(결제) 동시 등록
4. **독립 동작**: UCP 없이도 HNP만으로 동작 가능하게 설계
5. **MVP 재사용**: 기존 MVP의 engine/protocol/contracts 패키지 활용
