# ChatGPT MCP 데모 런북 (HAGA-125)

소개 자료의 "02 MCP로 연결" 카드를 ChatGPT에서 직접 시연하기 위한 절차다.
대상 환경은 **staging**(`api.staging.tryhaggle.ai`)이며 결제는 test 자산만 사용한다.

## 1. 현재 연결 상태 (2026-10-02 외부 probe)

| 항목 | staging | production |
|------|---------|------------|
| `POST /mcp` (Streamable HTTP, stateless) | 401 + `WWW-Authenticate: Bearer ... resource_metadata=...` | 구버전(무인증) — 데모 대상 아님 |
| `/.well-known/oauth-protected-resource` | 200 | 404 |
| `/.well-known/oauth-protected-resource/mcp` | 404 → 이 브랜치에서 추가 | — |
| `/.well-known/oauth-authorization-server` | 200 (PKCE S256, public client) | 404 |
| `POST /oauth/register` (DCR) | 200, `https://chatgpt.com/connector_platform_oauth_redirect` 허용 | — |
| `https://app.staging.tryhaggle.ai/connect` (동의 화면) | 200 | — |
| CORS `https://chatgpt.com` | 허용 | — |

ChatGPT는 경로형 메타데이터(`/.well-known/oauth-protected-resource/mcp`)를 먼저 찾을 수 있어서
루트 문서와 같은 내용을 경로형 주소에서도 응답하게 했다.

## 2. 사전 준비

1. **ChatGPT 계정**: Plus/Pro/Business 등 Developer mode를 지원하는 플랜.
2. **Haggle staging 계정 2개**
   - 판매자 계정: 데모용 리스팅을 미리 publish 해 둔다.
   - 구매자 계정: ChatGPT에 연결할 계정. 판매자와 같은 계정이면 `BUYER_IS_SELLER`로 막힌다.
3. **데모 리스팅**: staging에 publish 된 리스팅 1개(예: 중고 아이폰). 협상 시작 시
   `required_criteria`에 답해야 하므로 질문 항목을 미리 확인한다.
4. staging API가 이 브랜치 이후 SHA로 배포되어 있어야 경로형 메타데이터가 응답한다.

## 3. ChatGPT 커넥터 등록

1. ChatGPT → Settings → Apps & Connectors → Advanced settings → **Developer mode** 켜기.
2. Settings → Apps & Connectors → **Create** (커넥터 만들기).
   - Name: `Haggle (staging)`
   - MCP Server URL: `https://api.staging.tryhaggle.ai/mcp`
   - Authentication: **OAuth** (클라이언트 ID/Secret은 비워 둔다 — 동적 등록 사용)
3. 저장하면 ChatGPT가 Haggle `/connect` 화면으로 이동한다. 구매자 계정으로 로그인하고
   권한(agents, listings, negotiate, orders, disputes)을 허용한다.
4. 새 채팅에서 `+` → Developer mode → `Haggle (staging)` 선택.

## 4. 시연 스크립트 (카드 문구와 1:1 대응)

| 카드 단계 | 사용자 발화 예시 | 호출되는 도구 |
|-----------|------------------|---------------|
| 연결 확인 | "Haggle에 누구로 연결돼 있어?" | `haggle_whoami` |
| 상품 검색 | "중고 휴대폰 찾아줘" | `haggle_search_listings` → `haggle_get_listing` |
| 협상 진행 | "이거 협상해 줘. 한도는 $470" | `haggle_start_negotiation`(필수 질문 답변 포함) → `haggle_play_until` / `haggle_get_negotiation` |
| 결제 링크 안내 | "합의됐으면 결제 링크 줘" | `haggle_create_checkout` (웹 checkout URL만 반환, MCP는 돈을 움직이지 않음) |
| 주문·배송 조회 | "주문이랑 배송 상태 알려줘" | `haggle_get_order` / `haggle_get_shipment` |

쓰기 도구(`haggle_start_negotiation`, `haggle_play_until` 등)는 ChatGPT가 실행 전 확인을 요청한다.
시연 중 "확인"을 눌러 진행한다.

## 5. 알려진 제약

- 게스트/무로그인 모드는 없다. 모든 MCP 호출은 OAuth 토큰이 필요하다(검색 포함).
- ChatGPT Deep Research용 `search`/`fetch` 도구는 없다. 일반 채팅 + Developer mode로만 시연한다.
- 리스팅 작성 도구만 위젯 UI(`ui://haggle/listing.html`)가 있고, 협상·주문 도구는 텍스트 응답이다.
- 결제 서명은 ChatGPT 안에서 하지 않는다. 반환된 checkout URL을 브라우저에서 열어 진행한다.
- production(`api.tryhaggle.ai`)은 staging → main 승격 전까지 구버전이라 데모에 쓰지 않는다.

## 6. 문제 해결

| 증상 | 확인 |
|------|------|
| 커넥터 생성 시 OAuth 오류 | `curl https://api.staging.tryhaggle.ai/.well-known/oauth-protected-resource/mcp`가 200인지 |
| Codex 앱 "인증" 후 "연결할 수 없습니다" | `/.well-known/oauth-authorization-server`의 `authorization_endpoint`가 issuer와 같은 origin(`/oauth/authorize`)인지. Codex는 다른 origin이면 로그인을 거부한다 |
| `/connect`에서 멈춤 | 구매자 계정으로 staging 웹에 로그인되어 있는지 |
| `INSUFFICIENT_SCOPE` | 커넥터를 다시 연결하고 모든 권한을 허용 |
| `BUYER_CRITERIA_REQUIRED` | 리스팅의 `required_criteria` 질문에 사용자 답을 받아 다시 시작 |
| `CHECKOUT_NOT_READY` | 협상이 `ACCEPTED`이고 정산 승인까지 끝났는지 `haggle_get_negotiation`으로 확인 |
