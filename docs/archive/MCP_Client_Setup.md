# MCP Client Setup

Haggle MCP 서버는 현재 [server.ts](/Users/jeonghaengheo/work/Haggle/Haggle/apps/api/src/server.ts) 에서 `/mcp` 로 열려 있습니다.

권장 데모 주소:

```text
https://haggle-production-7dee.up.railway.app/mcp
```

로컬 개발 주소:

```text
http://127.0.0.1:3001/mcp
```

## 1. Claude Code

프로젝트 루트에 이미 [.mcp.json](/Users/jeonghaengheo/work/Haggle/Haggle/.mcp.json) 을 추가해뒀습니다.

```json
{
  "mcpServers": {
    "haggle": {
      "type": "http",
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

보통은 이 상태에서 Claude Code를 이 워크스페이스에서 다시 열면 project-scoped MCP 서버로 인식합니다.

예시 프롬프트:

```text
Use the haggle MCP server. Register a seller profile, create a listing draft for a used MacBook, publish it, then start a negotiated checkout as a buyer.
```

Claude 앱 자체를 붙이려면 별도 문서 [클로드_앱_MCP_연결.md](/Users/jeonghaengheo/work/Haggle/Haggle/docs/%ED%81%B4%EB%A1%9C%EB%93%9C_%EC%95%B1_MCP_%EC%97%B0%EA%B2%B0.md) 를 따른다.

## 2. Gemini CLI

Gemini CLI 쪽은 아래 블록을 `~/.gemini/settings.json` 의 `mcpServers` 에 넣으면 됩니다.

```json
{
  "mcpServers": {
    "haggle": {
      "httpUrl": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

이미 다른 서버가 있으면 `mcpServers` 아래에 `haggle` 만 추가하면 됩니다.

예시 프롬프트:

```text
Use @haggle to register a seller profile, create a listing draft for an iPhone, publish the listing, fetch the public link, and open a negotiated checkout as a buyer using the FAIR preset.
```

## 3. 지금 바로 쓸 수 있는 주요 MCP 도구

- `haggle_ping`
- `haggle_register_seller`
- `haggle_get_seller`
- `haggle_create_listing_draft`
- `haggle_get_draft`
- `haggle_update_listing_draft`
- `haggle_publish_listing`
- `haggle_get_public_listing`
- `haggle_ucp_create_checkout`
- `haggle_ucp_get_checkout`
- `haggle_ucp_submit_offer`
- `haggle_ucp_update_checkout`
- `haggle_ucp_complete_checkout`
- `haggle_ucp_cancel_checkout`

## 4. 외부 AI에서 바로 쓰기 쉽게 바꾼 점

기존에는 협상형 checkout 생성 시 `strategy_id` 를 미리 등록해야 했습니다. 지금은 [ucp-checkout.ts](/Users/jeonghaengheo/work/Haggle/Haggle/apps/api/src/mcp/tools/ucp-checkout.ts) 에서 아래 입력만으로도 전략을 자동 생성합니다.

- `negotiate`
- `role`
- `persona`
- `condition`
- `seller_id`
- `seller_reputation`
- `info_completeness`
- `floor_price_minor`

즉 Claude/Gemini에서도 별도 전략 등록 없이 바로 협상 세션을 열 수 있습니다.

## 5. 서버 실행

```bash
cd /Users/jeonghaengheo/work/Haggle/Haggle
corepack pnpm --filter @haggle/api exec tsx src/index.ts
```

## 6. 참고

OpenAI 외 클라이언트에서는 ChatGPT용 `registerAppTool` UI는 보통 보이지 않습니다. 그래서 Claude/Gemini용으로는 data-only MCP tool 경로를 우선 쓰는 게 맞습니다.
