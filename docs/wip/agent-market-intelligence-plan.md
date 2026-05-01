# Haggle Intelligence Layer Plan

Branch: `agent-market-intelligence`

## Goal

Build Haggle Intelligence Layer: a conversation intelligence layer that improves agent conversations, creates a memory-like user experience, and turns negotiation activity into durable market data.

Tag Garden remains one output of the system, not the system itself. The primary unit is a structured conversation signal with evidence, confidence, source, and lifecycle.

## System Name

Umbrella system: **Haggle Intelligence Layer**

Internal modules:

- Conversation Signal Engine
- Adaptive User Memory Cards
- Evermemos
- Tag Garden Sync
- Term Intelligence
- Market Observation Sink
- L5 Market Context Provider

## Product Principles

1. General users should feel that agents remember useful context without exposing raw history or making the experience feel surveillance-heavy.
2. Memory must serve the current negotiation first, then market intelligence, then personalization.
3. Tag creation should follow conversation evidence. The system should infer useful entities from context, match existing tags when possible, and queue missing tags when needed.
4. Evermemos is the enhanced memory tier for qualified users. The general memory path should still be research-backed and useful.
5. Market data must separate observed facts from model inferences.

## Research-Informed Memory Model

The design borrows from several agent-memory patterns:

- Generative Agents: memory stream with observation, reflection, and retrieval for believable behavior.
- MemoryBank: selective update, reinforcement, and time-based decay instead of retaining every detail equally.
- MemGPT: tiered memory management, where only relevant slices enter the active context.
- HippoRAG: entity and relation indexing for long-term recall over accumulated experiences.
- A-MEM: linked, Zettelkasten-style memory notes that can evolve as new context arrives.
- MIRIX: separate memory classes such as core, episodic, semantic, procedural, resource, and knowledge vault.
- Mem0: production-oriented long-term memory with extraction, update, and graph memory options.
- EverOS/EverMemOS: external open-source memory operating system with message ingestion, profile/episodic retrieval, and self-host/cloud deployment options.

Haggle should not copy any one system directly. The practical architecture is a compact, typed memory layer tuned for negotiations.

## Memory Tiers

### Tier 1: Session Working Memory

Scope: all users, current negotiation only.

Contents:

- active product identity
- price anchors and current gap
- live deal blockers
- claims made by either side
- current negotiation phase
- recent tone and trust risk

Storage:

- existing negotiation rounds
- pipeline memory/memo snapshot
- ephemeral derived context

Use:

- immediate response quality
- validation and safety
- current-session market signal extraction

### Tier 2: User Memory Card

Scope: all users, cross-session but compact and explainable.

Contents:

- preferred categories
- recurring product interests
- recurring constraints
- price behavior profile
- negotiation style
- avoided terms
- trusted deal patterns

Update rule:

- only update from repeated or high-confidence signals
- keep evidence references, not full private text
- decay stale weak signals
- reinforce signals confirmed by later behavior

Example:

```json
{
  "preferred_categories": ["phones", "audio"],
  "recurring_constraints": ["unlocked", "battery_health_85_plus"],
  "price_behavior": "opens below market, closes near fair range",
  "recent_interest": ["iphone_15_pro", "airpods_max"],
  "avoid_terms": ["carrier_locked", "local_pickup"]
}
```

### Tier 3: Evermemos

Scope: eligible users.

Eligibility:

- Legendary or Mythic buddy plus monthly trade threshold
- reviewer participation threshold plus monthly trade threshold
- active subscription

Contents:

- richer preference memory
- category-specific pricing patterns
- buddy-specific performance patterns
- successful and failed negotiation strategies
- durable seller/buyer constraints
- long-term product watchlist

Use:

- higher-quality personalization
- better market-aware agent responses
- richer recall across sessions

Implementation stance:

- Haggle Intelligence Layer remains the source of truth for domain signals, eligibility, evidence pointers, and market data.
- EverOS/EverMemOS is connected as an enhanced memory backend, not as the owner of Haggle's intelligence layer.
- HIL sends structured summaries and evidence references to EverOS; it does not send raw conversation text by default.
- Stage 2 retrieval reads EverOS profile/episodic memory for eligible users and injects only bounded, non-authoritative hints.
- If EverOS is disabled or unavailable, the agent falls back to Adaptive User Memory Cards.
- user-facing "my agent knows how I trade" experience

## Conversation Signal Taxonomy

Signals should be stored as typed events. A single message can emit multiple signals.

Core signal types:

- `product_identity`: brand, model, generation, variant
- `product_attribute`: storage, color, size, carrier, material, accessories
- `condition_claim`: battery, scratch, repair, authenticity, warranty, missing parts
- `price_anchor`: initial ask, offer, counter, floor hint, ceiling hint
- `price_resistance`: explicit rejection threshold or repeated refusal region
- `deal_blocker`: pickup, shipping, payment, authenticity, timing, trust
- `demand_intent`: urgency, watchlist, substitute product, comparison shopping
- `term_preference`: shipping, insurance, returns, escrow, pickup, delivery speed
- `trust_risk`: off-platform payment, pressure, inconsistent claims, link sharing
- `market_outcome`: accepted, rejected, walkaway, timeout, dispute
- `tag_candidate`: entity that should map to Tag Garden or become a suggestion

Each signal should carry:

- normalized value
- raw evidence pointer
- confidence
- extraction method
- source round/message
- role perspective
- privacy class
- market usefulness class

Raw message text is retained for debugging and audit, but it is separated from
the market signal row:

- `conversation_signal_sources` stores the raw source text once with an access policy.
- `conversation_market_signals.evidence` stores `sourceKey`, offsets, and text hash.
- market, memory, and Tag Garden flows should use structured fields and evidence pointers, not raw text.
- raw evidence access requires an explicit debugging or audit purpose and a reason.

## Market Data Loop

Conversation data should flow into three surfaces:

1. Negotiation quality
   - better context for the current agent response
   - better validation of claims, terms, and price boundaries

2. Tag Garden growth
   - match extracted entities to existing tags
   - queue missing tags with evidence
   - promote repeated, useful tags through existing lifecycle rules

3. HFMI and market intelligence
   - accepted prices become price observations
   - rejected ranges become resistance observations
   - condition claims become attribute-level price modifiers
   - demand signals become trend signals

## Term Intelligence

Terms are not the same as tags.

- Tags describe what the item is: `iphone_15_pro`, `airpods_max`, `128gb`, `gaming_laptop`.
- Terms describe how the deal is evaluated: `applecare_active`, `oem_screen`, `seller_pays_shipping`, `receipt_included`, `battery_health_85_plus`.

Term Intelligence should let Haggle start with a strong known term library and then expand it from real conversations.

Lifecycle:

- `OBSERVED`: detected in a message with evidence
- `CANDIDATE`: repeated, high-confidence, or tied to a transaction outcome
- `VERIFIED`: reviewed by system/admin/market evidence
- `OFFICIAL`: safe for valuation, validation, prompt context, and rendering
- `DEPRECATED`: no longer useful or merged into another term

Runtime handling:

- match unknown phrases against known terms and aliases
- if no match, save a `term_candidate` signal
- treat the term as unverified in the current negotiation
- ask for clarification when it affects price, safety, or obligations
- accumulate evidence across sessions
- promote terms when repeated use and market impact justify it

Examples:

- `AppleCare+`
- `OEM screen`
- `replacement battery`
- `receipt included`
- `smoke-free home`
- `local pickup at police station`
- `battery cycle count`
- `unopened box`
- `serial number verified`

## Proposed DB Additions

Initial tables:

- `conversation_market_signals`
- `conversation_signal_sources`
- `user_memory_cards`
- `user_memory_events`
- `evermemos`
- `evermemo_events`
- `memory_eligibility_snapshots`
- `term_intelligence_terms`
- `term_intelligence_evidence`

Potential Tag Garden extension:

- add `category`, `evidence`, `source_session_id`, `source_round_id`, and `confidence` to tag suggestions, or create a companion table for suggestion evidence.

## Pipeline Integration

Stage 1: Understand

- parse message intent and price as today
- add structured signal extraction hook
- allow deterministic extraction first, model-assisted extraction later

Stage 2: Context

- load session working memory
- load User Memory Card
- load Evermemos only if eligible
- inject a bounded memory brief, never raw full history

Stage 3/4: Decide and Validate

- use memory as context, not authority
- validate against protocol, safety, and fairness rules

Stage 6: Persist

- save round
- save extracted signals
- update memory event stream
- queue tag suggestions
- emit market observations after terminal outcomes

## Implementation Phases

### Implementation Slice 1: Foundation

This branch starts with the smallest useful implementation surface:

- add durable Haggle Intelligence Layer tables
- define typed conversation market signals
- implement deterministic signal extraction for common negotiation messages
- keep extraction as a pure, tested service before wiring it into the live pipeline

Out of scope for this first slice:

- model-assisted extraction
- automatic Tag Garden writes
- User Memory Card mutation jobs
- Evermemos retrieval in Stage 2 context
- HFMI aggregation beyond the current accepted-price sink

### Implementation Slice 2: Round Signal Persistence

Implemented next:

- accept optional `message_text` on offer submission while keeping price-only offers compatible
- extract deterministic signals from incoming offer text
- extract deterministic signals from outgoing agent response text
- append signals to `conversation_market_signals` inside the round transaction
- store raw source messages separately in `conversation_signal_sources` with a debugging/audit access policy
- keep signal evidence rows limited to source pointer, offsets, hash, and raw availability
- keep signal persistence non-fatal so negotiation execution continues if intelligence writes fail
- run the sink across rule, legacy LLM, and staged pipeline executors

Still out of scope:

- automatic mutation of User Memory Cards
- Tag Garden suggestion writes from `tag_candidate`
- Term Intelligence promotion jobs from `term_candidate`
- L5 context retrieval from stored HIL signals

### Implementation Slice 3: Tag Garden Sync

Implemented next:

- map extracted `tag_candidate` signals into existing `tag_suggestions`
- reuse `queueProposedTags` so admin review, dedupe, and occurrence counts stay in the existing Tag Garden flow
- preserve signal storage as the source of truth and treat Tag Garden writes as best-effort side effects
- keep category mapping conservative until tag suggestion evidence fields are added

Still out of scope:

- richer suggestion evidence columns
- automatic tag approval
- term candidate promotion

### Implementation Slice 4: Term Intelligence Accumulation

Implemented next:

- add `term_intelligence_terms` as the reviewable lifecycle table for observed deal terms
- add `term_intelligence_evidence` for source-key evidence pointers without copying raw text
- record `term_candidate` signals from conversation extraction into Term Intelligence
- keep lifecycle conservative: repeated observations can move `OBSERVED` to `CANDIDATE`, but never to `VERIFIED` or `OFFICIAL` automatically
- ignore `private_context` term signals for accumulation

Still out of scope:

- admin review UI for term verification
- linking official terms back into `TermRegistry`
- model-assisted unknown-term discovery
- term impact modeling for HFMI/L5

### Implementation Slice 5: Memory Cards and Evermemos Eligibility

Implemented next:

- add `memory_key` to `user_memory_cards` so repeated structured observations reinforce the same card
- update User Memory Cards from `price_resistance`, `deal_blocker`, `term_preference`, and `demand_intent` signals
- keep User Memory Cards free of raw message text; cards store normalized values, typed fields, and evidence pointers
- write `user_memory_events` for created or reinforced cards
- add a pure Evermemos eligibility evaluator plus `memory_eligibility_snapshots` persistence
- keep subscription, manual override, Legendary/Mythic buddy plus monthly activity, and reviewer plus monthly activity as separate eligibility reasons

Still out of scope:

- Evermemos retrieval
- user-facing memory reset/suppression controls
- exact production thresholds for Evermemos gates
- automatic aggregation jobs that compute monthly trade and reviewer counts

### Implementation Slice 6: Bounded Memory Brief Retrieval

Implemented next:

- load active User Memory Cards for the agent owner inside the staged pipeline
- filter out stale/expired cards and cap the memory brief size before prompt assembly
- format memory as non-authoritative L5 hints instead of raw history
- pass Stage 2 L5 signal lines into the Stage 3 LLM prompt, so market, skill, and memory signals are actually visible to model-assisted decisions

Still out of scope:

- Evermemos retrieval
- user-visible memory management controls
- personalized retrieval ranking beyond strength and recency
- model-assisted memory consolidation jobs

### Implementation Slice 7: Idempotent Signal Replay

Implemented next:

- add stable `signal_key` to `conversation_market_signals`
- make `conversation_signal_sources` insertion idempotent for matching raw text hashes
- allow downstream signal writes to retry when a source row already exists
- prevent duplicate market signal rows on full replay
- queue Tag Garden candidates only for newly inserted market signals
- keep Term Intelligence and User Memory Card updates replay-safe through their own evidence-level idempotency

Still out of scope:

- recovery job that scans source-only rows and replays extraction
- operator tooling for source hash mismatch review

### Implementation Slice 8: EverOS/EverMemOS Adapter

Implemented next:

- add an EverOS client for v1 memory ingestion, flush, and search endpoints
- keep EverOS disabled by default behind `EVEROS_ENABLED=true`
- support self-host or cloud deployment through `EVEROS_BASE_URL`, `EVEROS_API_KEY`, and `EVEROS_TIMEOUT_MS`
- add an Evermemo bridge that maps HIL memory cards into structured EverOS messages without raw conversation text
- gate Stage 2 EverOS retrieval through the latest `memory_eligibility_snapshots` row by default
- inject EverOS retrieval into L5 as `EVEROS_MEMORY_HINTS:non_authoritative`
- preserve fallback to Adaptive User Memory Cards when EverOS is unavailable, not configured, or the user is not eligible

Still out of scope:

- async outbox/job runner for EverOS writes
- production eligibility aggregation from subscription, buddy, review, and monthly trade tables
- Memory Bank user controls for suppress/export/delete across both HIL and EverOS
- live EverOS integration test against self-hosted Docker services

### Implementation Slice 9: MVP Operations and User Controls

Implemented next:

- add authenticated memory card list, single-card suppress, and full memory reset endpoints
- keep reset/suppress non-destructive by marking cards `SUPPRESSED` and writing `user_memory_events`
- add an admin-only source-only replay endpoint for partial write recovery
- replay source rows by reading `conversation_signal_sources.raw_text` only for recovery and reusing the idempotent signal sink
- keep replay bounded by limit/session/source key filters

Still out of scope:

- user memory export/download
- EverOS delete/suppress propagation for the post-MVP adapter
- scheduled replay job with operator dashboard
- raw evidence access audit endpoint with required reason capture
- product policy for exposing memory controls in the UI; do not make full reset an easy first-level action before this is settled

### Phase 1: Design and Schema

- define TypeScript signal types
- add migrations
- write pure normalization utilities
- add tests for signal taxonomy and eligibility rules

### Phase 2: Extraction

- deterministic extractor for common product, condition, term, and trust signals
- confidence scoring
- evidence pointer format
- tests from realistic negotiation messages

### Phase 3: Memory Cards

- update compact user memory cards from repeated signals
- decay and reinforcement
- retrieval into Stage 2 context
- user-visible memory summary endpoint later

### Phase 4: Tag Garden Integration

- extracted `tag_candidate` signals match existing tags
- missing candidates create or update tag suggestions
- include source evidence and occurrence count

### Phase 5: Evermemos

- implement eligibility service
- add enhanced memory storage and retrieval
- connect buddy, reviewer, and subscription gates

### Phase 6: Market Intelligence

- extend HFMI observation sink beyond accepted price
- add resistance/demand/condition modifier aggregates
- expose L5 signals that include confidence and source class

## Open Decisions

- exact monthly trade threshold for Legendary/Mythic buddy eligibility
- exact reviewer participation threshold
- whether subscription state already exists elsewhere or needs a new table
- privacy retention window for user memory events
- final retention policy for `conversation_signal_sources.raw_text`

## Technical Debt

- Memory controls need product policy before UI exposure. Backend suppress/reset exists for safety and support operations, but MVP UI should not present "turn memory off" as a prominent action. Prefer correction-oriented language such as "hide this preference", "update this preference", or "this is wrong" over broad "do not remember" language.
- Clarify the boundary between user-facing personalization and HIL market intelligence. Suppressing a memory card should exclude it from personalization retrieval, but structured, non-identifying market/term/tag intelligence should remain available for Haggle's aggregate data layer where policy allows.

## Language

Describe the general user memory system with terms such as:

- compact memory
- adaptive memory
- efficient retrieval
- bounded context
- memory card
- enhanced memory
