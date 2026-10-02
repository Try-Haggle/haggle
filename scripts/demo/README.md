# Agentic buyer demo runner (external MCP client)

`agentic-buyer.ts` plays an external AI buyer using the official MCP SDK and a short-lived
OAuth 2.1 token. It never pays and never touches production.

Flow: `haggle_search_listings` → `haggle_get_listing` → `haggle_start_negotiation` →
`haggle_play_next` → `haggle_play_until` → `haggle_get_negotiation` → attempt
`haggle_create_checkout` (must be denied) → print the human approval link and stop.

## Safety

- Targets only `localhost` or hosts containing `staging` (https). Anything else is refused.
- Use a token with **only** `listings negotiate` (no `orders`). The final checkout attempt must return
  `INSUFFICIENT_SCOPE`; otherwise the run fails.
- Payment, wallet signing and the `/negotiations/demo` policy are untouched; a human opens the printed link.
- Trace JSON masks tokens, bearer headers, OAuth codes, emails, phones and address/name fields.
  Trace files are written with mode 0600 under `output/agentic-buyer-demo/` (git-ignored scratch — do not commit).

## Run

```bash
pnpm install

# Option A: you already have a short-lived listings+negotiate token
HAGGLE_API_URL=https://<staging-api-host> HAGGLE_MCP_TOKEN=<token> pnpm demo:agentic-buyer

# Option B: let the runner do OAuth 2.1 + PKCE (prints a consent URL; approve ONLY listings+negotiate
# as the demo buyer; redirect is captured on http://127.0.0.1:8976/callback)
HAGGLE_API_URL=http://localhost:3001 pnpm demo:agentic-buyer -- --oauth
```

Options: `--listing <public_id>` (skip search), `--query <text>`, `--trace-dir <dir>`.
The buyer account must not be the listing seller. Exit code is 0 only when the denial was observed.

## Tests

```bash
pnpm test:demo-runner   # target guard, masking, runner against an in-process fake MCP server
```
