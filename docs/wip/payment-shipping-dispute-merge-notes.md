# Payment Shipping Dispute Merge Notes

Merge target: `main`
Merged branch: `feature/payment-shipping-dispute`

## Conflict Decisions

### apps/api/src/routes/negotiation-demo.ts - non-price terms rendering

Decision: keep the `feature/payment-shipping-dispute` behavior.

Resolution:

```ts
const terms = normalizeNonPriceTerms(decision.non_price_terms);
```

Reason: the feature branch added normalization for negotiation non-price terms so default protections do not get rendered as negotiable concessions. Keeping normalized terms at render time makes the structured response match the validation and prompt contract in this file.

### apps/api/src/routes/negotiation-demo.ts - respond trace metadata

Decision: keep the `feature/payment-shipping-dispute` behavior.

Resolution:

```ts
render_contract: {
  price_source: 'ProtocolDecision.price',
  currency: 'USD',
  unit: 'minor',
  llm_free_text: false,
  voice_profiles_cached: true,
  current_renderer: 'structured_template',
},
lumen_voice_context: buildCachedVoiceContext(session.lumenProfiles.buyer_agent.id),
```

Reason: the feature branch records the structured renderer and cached Lumen voice context in the response trace. This keeps the negotiation demo trace aligned with the branch's Lumen persona and structured rendering changes.
