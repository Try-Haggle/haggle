# HNP — Haggle Negotiation Protocol

**Status:** public core spec (draft). Implementation lives in `@haggle/engine-session`.  
**Revision:** `2026-03-09` · compact state `hnp.compact.v1`

HNP is a **negotiation-only** protocol. It does not search, rank, or recommend products.

---

## Scope

HNP standardizes how two (or more) agents **agree on price and terms** for something already identified.

In scope:

- session messages (OFFER, COUNTER, ACCEPT, REJECT, …)
- typed money and issue slots
- proposal binding (hash)
- public compact state (same acts → same state)
- handoff of an **accepted** deal to checkout / settlement

Out of scope (on purpose):

- discovery, search, ranking, ads
- catalog browsing
- being the shopping homepage

Those belong to UCP, A2A, or a marketplace. Haggle’s own listing UI can stay. Other sites should attach HNP **after** a listing is chosen.

---

## Protocol vs engine

| Layer | Job | Public? |
|---|---|---|
| **HNP** | Neutral rules for public acts and terms | Yes — others may implement |
| **Engine** | How *this* agent picks the next number and sentence | No — that is the product |

A third party can speak HNP without using Haggle’s model, few-shot, or floors. They can also send HNP into a Haggle endpoint and let our engine answer.

The wire is HNP only. Engine MEMO (floors, targets, box, opponent pattern) is not a second protocol. A Haggle host keeps it in Postgres (`negotiation_sessions`, `negotiation_rounds`) and rebuilds it each round for *its* model. It does not go in the envelope.

Human-facing flow: [`docs/engine/tag-spec-fewshot.md`](../engine/tag-spec-fewshot.md). What our Decide model reads: [`docs/engine/decide-prompt-contract.md`](../engine/decide-prompt-contract.md). Public compact rules: [`docs/engine/hnp-compact-state.md`](../engine/hnp-compact-state.md).

---

## What a message is

Every message is an `HnpEnvelope`. Types in `packages/engine-session/src/protocol/core.ts` are normative.

```json
{
  "spec_version": "2026-03-09",
  "capability": "hnp.core.negotiation",
  "session_id": "11111111-1111-1111-1111-111111111111",
  "message_id": "msg-1",
  "idempotency_key": "idem-1",
  "sequence": 1,
  "sent_at_ms": 1700000000000,
  "expires_at_ms": 1700000060000,
  "sender_agent_id": "agent.buyer",
  "sender_role": "BUYER",
  "type": "OFFER",
  "payload": {
    "proposal_id": "p1",
    "issues": [
      { "issue_id": "hnp.issue.condition.battery_health", "value": "87%" }
    ],
    "total_price": { "currency": "USD", "units_minor": 48000 }
  }
}
```

Required envelope fields: `spec_version`, `capability`, `session_id`, `message_id`, `idempotency_key`, `sequence`, `sent_at_ms`, `expires_at_ms`, `sender_agent_id`, `sender_role`, `type`, `payload`.  
Optional: `correlation_id`, `detached_signature`.

Message types: `HELLO`, `CAPABILITIES`, `OFFER`, `COUNTER`, `ACCEPT`, `REJECT`, `ESCALATE`, `CANCEL`, `ACK`, `ERROR`.

Money is always integer minor units. Never floats.

OFFER/COUNTER payload: `issues[]` + `total_price` + optional `proposal_hash`. If the hash is omitted, a Haggle host computes it. If it is present and wrong, the host rejects before the engine runs.

ACCEPT binds to `accepted_proposal_id` and preferably `accepted_proposal_hash`. Compact state is the deterministic reduction of the public act sequence — not a private memory dump. See `packages/engine-session/src/protocol/compact-state.ts`.

---

## How outsiders attach

1. `GET /.well-known/hnp` — revisions, transports, issue namespaces.
2. Create or join a session for a **listing reference** (ours or theirs).
3. Send envelopes on REST `POST /negotiations/sessions/:id/offers` with `{ "hnp": <envelope> }`, or MCP `hnp_submit_offer`.
4. Accept with REST `PATCH /negotiations/sessions/:id/accept` or MCP `hnp_accept`.
5. Take the agreement / transaction handoff into **your** checkout (UCP or otherwise).

MCP offer/accept tools take an HNP envelope. There is no price-only MCP offer tool.

REST still accepts `{ price_minor, sender_role, idempotency_key }` as a host convenience. The host wraps that as an unsigned envelope (`haggle.host.buyer|seller`) and runs the same ingress. It is not a second protocol.

Haggle's own web auto-play speaks HNP too. Each `/auto-play/next` round is a host envelope through the same ingress.

The public website spec stays in-repo until MVP ships. We publish it with MVP, not earlier.

---

## UCP and A2A

HNP does not replace them.

- **UCP** owns commerce discovery and checkout. HNP is the negotiation extension *between* “this listing” and “checkout session”. Mapping: `hnpAgreementToUcpCheckoutBridge`.
- **A2A** owns agent-to-agent tasks. A task carries HNP envelopes; it does not invent a second offer format. Mapping: `hnpEnvelopeToA2ATaskPart`.

---

## Open protocol, closed engine

Publishing HNP means others can copy the envelope. That is intended.

What they cannot copy by reading the spec:

- the decision engine
- listing liquidity and trust
- how well agents actually close

A protocol that stays secret is a private API. A protocol that is public can become the default **negotiation socket**. Compete on the engine and the network, not on hiding the message shape.

---

## Skills stay in the engine

Do not put skill plugins, few-shot, recommended prices, or floors on the wire.

HNP already has extension points for **public facts**:

- issue namespaces (`hnp.issue.*`, later `com.vendor.issue.*`)
- listing evidence
- `GET /.well-known/hnp` revisions, transports, and issue namespaces

A verification or market API can publish a fact (IMEI clean, battery 87%, median sold). That fact may become an issue or evidence. The host engine may also feed it to a skill slot. The skill text, tactic list, and dollar hints never become envelope fields.

If another host wants different knowledge, they run their own engine. They still speak the same acts and issue slots.

---

## Non-goals for this revision

- Implementing UCP catalog or Google/OpenAI shopping
- Multi-item carts in core (later extension)
- Forcing every Haggle UI screen to speak envelopes (product path may stay convenient)
