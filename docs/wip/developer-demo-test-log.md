# Developer Demo Test Log

Last updated: 2026-04-28

Scope: developer demo advisor flow at `http://localhost:3002/demo/developer`.

Baseline memory used for the current run:

- User intent: used iPhone 15
- Budget: max $500
- Must-have: battery >= 90%
- Avoid: exterior/visible damage
- Backend memory source: real `/intelligence/demo/memory` restore with stored HIL cards

## Current Test Matrix

| ID | Scenario | Expected gate result | Observed result | Status |
| --- | --- | --- | --- | --- |
| T1 | Select `iPhone 15 Pro 256GB Black` after restoring iPhone 15 memory | Same model, but battery evidence missing. Do not call this a product mismatch. | Chat says model is correct and `battery` is missing. Product card shows `조건 확인 필요: battery`. Negotiation start remains blocked until HIL confirmation. | PASS |
| T2 | Select `iPhone 13 Pro` while memory says iPhone 15 | Model mismatch should be explicit. | Chat says memory is `iphone 15`, selected item is `iphone 13`. Card and brief show `모델 확인 필요: iphone 15 -> iphone 13`. Negotiation start remains blocked. | PASS |
| T3 | From T2, click `아니오` to return toward remembered product | Demo should move back to the best memory-target listing, even if it is a near match because condition evidence is missing. | Initially failed because only `match` listings were considered. Fixed fallback ranking to allow remembered-model near matches. Retest moved to `iPhone 15 Pro 256GB Black` and showed `조건 확인 필요: battery`. | PASS after fix |
| T4 | Confirm `예` on `condition_missing` for iPhone 15 | HIL confirmation should unlock negotiation start while keeping battery as a verification point. | `iPhone 15 Pro 256GB Black 선택을 확인했습니다.` appeared. `intent alignment: iphone 15 -> iphone 15 · matched`. `협상 시작` became enabled. Battery remains visible in the brief as `must_have: battery >= 90%`. | PASS |
| T5 | Change budget from $500 to $450 for the same iPhone 15 intent | Budget-change confirmation should appear, and stored memory should remain at $500 until approval. | Initially failed: LLM kept $500 and the active listing could drift to iPhone 13. Fixed local budget parsing, pending proposed memory, and retained selected listing. Retest showed `$500 -> $450` confirmation, Backend Memory stayed saved at $500, `아니오` kept $500 and re-enabled negotiation for iPhone 15. | PASS after fix |
| T6 | Memory says iPhone 15 128GB, selected listing is iPhone 15 256GB | Storage mismatch should be separated from model mismatch. | After save completed, memory restored `battery >= 90%, 128GB`. Product gate showed `storage` with `memory 128GB -> listing 256GB`; card showed `용량 확인 필요: storage, battery`; issue reason was `storage_mismatch`. | PASS |
| T8 | Select unrelated laptop listing while memory says iPhone 15 | Product mismatch and `아니오` fallback should return to iPhone listings. | Not executable in this state because the 128GB memory search narrowed visible DB candidates to only iPhone listings. Needs either a show-all candidates control or a separate reset/browse-state setup. | BLOCKED |
| T9 | Refresh page after saved 128GB memory | Memory restore should reload stored HIL cards, rerun listing search, and choose the best memory-aligned listing as active. | Initially failed: refresh kept `iPhone 13 Pro` active because a generic effect preserved a stale active listing. Fixed memory-ranked active listing selection. Retest restored `128GB`, selected `iPhone 15 Pro 256GB Black`, and showed `용량 확인 필요: storage, battery`. | PASS after fix |
| T10 | User previously had iPhone memory, then says they want a lightweight laptop | New active intent should replace the active advisor slots. Old iPhone facts may remain historical, but must not gate laptop browsing/negotiation. | Initially failed because `user_memory_cards` kept old iPhone cards active and reconstructed them on restore. Fixed active-intent switch persistence to mark old advisor cards `STALE` before saving the new intent. Retest showed Backend Memory with only `interest:category_interest = laptop` and `style:risk_and_tactic`; no iPhone conditions remained active. | PASS after fix |
| T11 | User has laptop memory and clicks an unrelated tablet/phone while browsing | Browsing another product should show an alignment note, but should not interrupt the chat with a forced HIL question. | Added intervention policy levels: `observe`, `inline_confirm`, and `chat_confirm`. Retest showed `참고: 상품 확인 필요` on the unrelated product card and `intent alignment ... observed` in the brief, with no chat prompt injected. | PASS |
| T12 | Advisor asks for budget, user replies only `500` | Numeric-only reply should fill `budgetMax`, remove the stale budget question, and avoid blocking negotiation with "budget missing". | Added frontend fallback parsing using the previous advisor question as budget context, and added backend regression coverage. API route test confirms `500` becomes `budgetMax: 500`, `max_budget` is no longer missing, and the next action is not `budget`. | PASS after fix |

## Fixes Applied During This Run

- Added issue-level alignment categories in `agent-product-advisor.tsx`:
  - `condition_missing`
  - `condition_violation`
  - `model_mismatch`
  - `variant_mismatch`
  - `storage_mismatch`
  - `budget_warning`
  - `product_mismatch`
- Added per-character HIL copy templates so the visible question uses the selected agent's voice instead of a generic system message.
- Replaced developer card badge text from generic `기억 확인 필요` to issue-specific labels such as `조건 확인 필요: battery` or `모델 확인 필요: iphone 15 -> iphone 13`.
- Fixed `아니오` fallback routing so it can return to remembered-product near matches, not only perfect matches.
- Added local budget parsing for explicit dollar amounts such as `450달러` so budget changes do not depend only on LLM extraction.
- Changed budget-change handling to keep proposed memory pending until user confirmation; approval persists it, rejection leaves stored memory unchanged.
- Kept the selected listing stable during budget-change confirmation so the demo does not jump from iPhone 15 to a cheaper iPhone 13 candidate.
- Changed memory restore and stored-memory active-listing effects to prefer the best memory-ranked listing instead of preserving stale default selections.
- Replaced ambiguous `예 / 아니오 / 기타` quick actions with action-specific labels such as `이 상품으로 협상`, `iphone 15로 돌아가기`, and `직접 입력`.
- Added active-intent switch handling: when the user moves from one product family to another, previous advisor memory cards are marked `STALE` and the new active intent is saved as the current retrieval/gating context.
- Added flexible intervention policy so the demo separates passive browsing notes, inline pre-negotiation confirmation, and hard chat-level confirmation.
- Added numeric-only budget fallback: when the previous advisor question asked for budget, answers like `500` are treated as user-facing USD budget even if the LLM fails to extract it, and stale budget questions are removed from the memory state.
- Changed the Engine Flow explainer from a fixed "first ACTIVE step" sentence to the actual current step/status, so blocked states point to the real gate that stopped negotiation.

## Next Cases

| ID | Scenario | Purpose |
| --- | --- | --- |
| T7 | Memory says iPhone 15 Pro, selected listing is iPhone 15 base or Pro Max | Verify variant mismatch is separated from product mismatch. |
| T8b | Re-run unrelated laptop case from a broad candidate list | Verify product mismatch and `아니오` fallback still route back to iPhone listings. |
