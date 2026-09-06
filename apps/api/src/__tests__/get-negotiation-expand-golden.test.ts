/**
 * A8 goldens: haggle_get_negotiation fold/expand(transcript/offers) + cross-user reject.
 *
 * Fixtures cover:
 * 1. folded (no expand) — recent_messages only; no transcript/offers keys
 * 2. expand transcript — full OPENING-aware chat
 * 3. expand offers — price/decision history
 * 4. expand combined
 * 5. cross-user (other buyer/seller) reject before any expand payload
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateSessionParticipant } from "../lib/session-access.js";
import {
  GET_NEGOTIATION_EXPAND_VALUES,
  haggleGetNegotiationInputShape,
  normalizeGetNegotiationExpand,
} from "../mcp/tools/mcp-get-negotiation-schema.js";
import {
  buildMcpGetNegotiationExpandView,
  MCP_GET_NEGOTIATION_RECENT_LIMIT,
  type McpTranscriptRound,
} from "../mcp/tools/negotiation-talk.js";

const sellerCounter: McpTranscriptRound = {
  roundNo: 1,
  senderRole: "BUYER",
  message:
    "This one is like-new, unlocked, 128GB, and battery is 90%+, so $360 is below what it's worth. I can meet you at $395.",
  decision: "COUNTER",
  priceminor: "36000",
  counterPriceMinor: "39500",
};

/** Long enough that folded recent_messages drops the synthetic OPENING. */
function longExchangeFixture(): McpTranscriptRound[] {
  const later: McpTranscriptRound[] = [2, 3, 4].map((n) => ({
    roundNo: n,
    senderRole: n % 2 === 0 ? ("SELLER" as const) : ("BUYER" as const),
    message: `line ${n}`,
    decision: "COUNTER",
    priceminor: "39500",
    counterPriceMinor: "38000",
  }));
  return [sellerCounter, ...later];
}

const SESSION = { buyerId: "buyer-1", sellerId: "seller-1" };

describe("A8 get_negotiation expand goldens", () => {
  it("folded: default response does not leak transcript/offers keys", () => {
    const rounds = longExchangeFixture();
    const view = buildMcpGetNegotiationExpandView(rounds, 4, []);

    expect(view.recent_messages).toHaveLength(MCP_GET_NEGOTIATION_RECENT_LIMIT);
    expect(view.recent_messages.map((m) => m.round_no)).toEqual([2, 3, 4, 5]);
    expect(view.recent_messages[0]?.decision).not.toBe("OPENING");
    expect(view).not.toHaveProperty("transcript");
    expect(view).not.toHaveProperty("offers");
    expect(Object.keys(view).sort()).toEqual(["current_round", "recent_messages"]);
  });

  it("expanded transcript: returns full OPENING-aware chat when authorized", () => {
    const rounds = longExchangeFixture();
    const view = buildMcpGetNegotiationExpandView(rounds, 4, ["transcript"]);

    expect(view.transcript).toBeDefined();
    expect(view.transcript!.length).toBeGreaterThan(view.recent_messages.length);
    expect(view.transcript![0]).toMatchObject({
      round_no: 1,
      speaker: "BUYER",
      decision: "OPENING",
      price_minor: "36000",
    });
    expect(view.transcript!.at(-1)?.round_no).toBe(view.current_round);
    expect(view).not.toHaveProperty("offers");
    expect(view.recent_messages).toHaveLength(MCP_GET_NEGOTIATION_RECENT_LIMIT);
  });

  it("expanded offers: returns price/decision history without requiring transcript key", () => {
    const rounds = longExchangeFixture();
    const view = buildMcpGetNegotiationExpandView(rounds, 4, ["offers"]);

    expect(view.offers).toBeDefined();
    expect(view.offers!.length).toBeGreaterThan(view.recent_messages.length);
    expect(view.offers![0]).toMatchObject({
      round_no: 1,
      speaker: "BUYER",
      decision: "OPENING",
      price_minor: "36000",
      incoming_price_minor: "36000",
      counter_price_minor: null,
    });
    expect(view.offers![1]).toMatchObject({
      round_no: 2,
      speaker: "SELLER",
      offer_sender_role: "BUYER",
      decision: "COUNTER",
      price_minor: "39500",
    });
    // Offers are price/decision rows — no chat message field.
    expect(view.offers![0]).not.toHaveProperty("message");
    expect(view).not.toHaveProperty("transcript");
  });

  it("expanded combined: transcript + offers when both requested", () => {
    const rounds = longExchangeFixture();
    const view = buildMcpGetNegotiationExpandView(rounds, 4, ["transcript", "offers"]);

    expect(view.transcript).toHaveLength(view.offers!.length);
    expect(view.transcript!.map((m) => m.round_no)).toEqual(view.offers!.map((o) => o.round_no));
    expect(view.recent_messages).toHaveLength(MCP_GET_NEGOTIATION_RECENT_LIMIT);
  });

  it("cross-user: other buyer/seller is rejected (no expand payload)", () => {
    const buyer = { id: "buyer-1", role: "user" as const };
    const seller = { id: "seller-1", role: "user" as const };
    const otherBuyer = { id: "buyer-other", role: "user" as const };
    const otherSeller = { id: "seller-other", role: "user" as const };

    expect(validateSessionParticipant(buyer, SESSION)).toEqual({ ok: true });
    expect(validateSessionParticipant(seller, SESSION)).toEqual({ ok: true });
    expect(validateSessionParticipant(otherBuyer, SESSION)).toEqual({
      ok: false,
      status: 403,
      error: "SESSION_ACTOR_MISMATCH",
    });
    expect(validateSessionParticipant(otherSeller, SESSION)).toEqual({
      ok: false,
      status: 403,
      error: "SESSION_ACTOR_MISMATCH",
    });

    // Gate order: reject before building expand view (mirrors platform tool).
    const access = validateSessionParticipant(otherBuyer, SESSION);
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.error).toBe("SESSION_ACTOR_MISMATCH");
    // Intruder must not receive folded or expanded payload keys from this gate.
    expect(access).not.toHaveProperty("recent_messages");
    expect(access).not.toHaveProperty("transcript");
    expect(access).not.toHaveProperty("offers");
  });

  it("schema: expand accepts transcript/offers and normalizes unknown values out", () => {
    expect(GET_NEGOTIATION_EXPAND_VALUES).toEqual(["transcript", "offers"]);
    expect(normalizeGetNegotiationExpand(undefined)).toEqual([]);
    expect(normalizeGetNegotiationExpand(["transcript", "offers", "transcript"])).toEqual([
      "transcript",
      "offers",
    ]);
    expect(normalizeGetNegotiationExpand(["secret", "offers"])).toEqual(["offers"]);

    const parsed = z.object(haggleGetNegotiationInputShape).safeParse({
      session_id: "fc14da18-0000-4000-8000-000000000001",
      expand: ["transcript", "offers"],
    });
    expect(parsed.success).toBe(true);

    const folded = z.object(haggleGetNegotiationInputShape).safeParse({
      session_id: "fc14da18-0000-4000-8000-000000000001",
    });
    expect(folded.success).toBe(true);

    const bad = z.object(haggleGetNegotiationInputShape).safeParse({
      session_id: "fc14da18-0000-4000-8000-000000000001",
      expand: ["utility"],
    });
    expect(bad.success).toBe(false);
  });
});
