# 클로드_앱_MCP_연결

Haggle MCP 서버를 macOS용 Claude 앱에 직접 연결하는 방법입니다.

## 1. 현재 기준

- 권장 데모용 MCP endpoint: `https://haggle-production-7dee.up.railway.app/mcp`
- 로컬 개발용 MCP endpoint: `http://127.0.0.1:3001/mcp`
- Claude Desktop config 경로: `~/Library/Application Support/Claude/claude_desktop_config.json`

Anthropic 공식 문서 기준으로 Claude Desktop은 `claude_desktop_config.json` 에 MCP 서버를 추가하는 방식입니다.  
공식 참고:
- [Model Context Protocol (MCP)](https://docs.anthropic.com/en/docs/mcp)
- [Connect Claude Code to tools via MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)

## 2. 데모 전 준비

오늘 데모 기준으로는 Railway 배포 서버를 우선 사용한다.  
로컬 서버는 개발 또는 fallback 용도다.

## 3. Claude 앱 설정

`claude_desktop_config.json` 의 `mcpServers` 에 아래 항목을 넣습니다.

```json
{
  "mcpServers": {
    "haggle": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://haggle-production-7dee.up.railway.app/mcp",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

Claude 앱은 stdio MCP 구성을 기대하므로, `mcp-remote` 브리지로 원격 HTTP MCP 서버에 연결한다.

## 4. Claude 앱에서 확인

1. Claude 앱을 완전히 종료 후 다시 실행
2. 새 채팅에서 MCP 도구가 보이는지 확인
3. 먼저 `haggle_ping` 이 되는지 확인

예시 프롬프트:

```text
Use the haggle MCP server and run haggle_ping.
```

## 5. 데모용 추천 프롬프트

```text
Use the haggle MCP server.

1. Register a seller with handle "demo-seller", display name "Demo Seller", and email "demo-seller@example.com".
2. Create a listing draft for a used MacBook Pro.
3. Publish the listing.
4. Return the share URL.
```

협상까지 보려면:

```text
Use the haggle MCP server.

1. Register a seller.
2. Create and publish a listing for a used iPhone.
3. Create a negotiated checkout.
4. Initialize a buyer engine with preset LONG_GAME.
5. Advance the buyer engine round by round.
6. Show the final decision and transcript summary.
```

## 6. 주의

- Railway 서버가 살아 있으면 로컬 서버를 띄우지 않아도 된다.
- 로컬 fallback으로 바꿀 때는 URL만 `http://127.0.0.1:3001/mcp` 로 바꾸고 `--allow-http` 를 추가하면 된다.
- 설정 변경 후에는 Claude 앱을 재시작하는 게 안전합니다.
- 오늘 데모 기준으로는 Railway MCP가 더 안정적입니다.
