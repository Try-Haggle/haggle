# Developer Demo Follow-ups

Last updated: 2026-04-27

## Demo target

Show this flow in the developer demo:

1. Buyer chats with the advisor and says detailed iPhone preferences.
2. Advisor stores real HIL memory cards through `/intelligence/demo/advisor-memory`.
3. Buyer refreshes the page.
4. Demo restores memory through `/intelligence/demo/memory`.
5. Demo re-runs listing search using restored memory, so iPhone listings surface first.
6. Buyer clicks an actual DB listing.
7. `/negotiations/demo/init` starts negotiation and applies `user_memory_cards`.

## Production bridge

- Public listing CTA currently routes through intent creation. Close the gap so `/l/{publicId}` can create or retrieve a real negotiation session and redirect to `/buy/negotiations/{sessionId}`.
- Fix the web/API path mismatch around intent routes: the web client calls `/api/intents`, while the API route is registered as `/intents`.
- Decide whether `trigger-match` should create sessions directly or whether a dedicated "start negotiation from listing" endpoint should own that behavior.
- Move advisor memory restore from the developer demo into the production buyer path:
  - Load buyer memory once when the listing page or buyer dashboard opens.
  - Use the memory for ranking/recommendation copy.
  - Re-read/apply the memory at negotiation initialization time.
- Do not recompute full negotiation strategy on every product click in production browsing. Treat normal clicks as lightweight browse signals. Create a strategy only when the buyer starts negotiation, and cache the resulting session strategy.
- Add MCP listing discovery tools so a GPT app can search listings, select one, then call `haggle_create_negotiation_session`.
- Keep MCP direct negotiation path available for power users:
  - `haggle_create_negotiation_session`
  - `haggle_submit_offer`

## Demo-safe explanation

For the demo, say:

"In production we would not run a full negotiation strategy every time a user taps a product. Product clicks should update lightweight interest signals. When the user actually starts negotiation, we load the latest HIL memory, combine it with the selected listing and seller policy, then create the strategy/session once."
