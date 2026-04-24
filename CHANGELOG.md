# Changelog

All notable changes to this project will be documented in this file.

Format: [version] — date — summary

---

## [1.0.0.0] — 2026-04-30 — Phase 0 Launch (planned)

### Added
- Negotiation engine: 6-stage LLM pipeline (engine-core 102 tests, engine-session 121 tests)
- Payment: x402 USDC direct (1.5%) + Stripe Onramp card (3.0%)
- Smart contracts: HaggleSettlementRouter + HaggleDisputeRegistry (Base L2)
- Shipping: EasyPost integration + manual tracking fallback
- Dispute: 3-tier resolution (T1 auto → T2 panel → T3 arbitration)
- Trust system: Trust score + DS rating + ARP
- Gamification: Buddy system (8 species, 6 rarities), XP/leveling
- Web: Landing page, developer demo, buyer/seller dashboards
- API: 30+ route files, MCP integration

### Scope
- Electronics only (iPhone 13/14/15 Pro, 3 SKUs)
- US market only
- Non-custodial USDC settlement on Base L2
