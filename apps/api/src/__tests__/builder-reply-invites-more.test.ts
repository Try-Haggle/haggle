/**
 * The seller builder must never dead-end.
 *
 * `usePlanner` is `side === "buyer" && hasListingContext`, and the planner is what
 * appends the next slot question on that side. The seller path and the standalone
 * buyer agent return the model's raw reply, so a turn could close on a flat
 * "Got it, I'll hold firm on that." with nothing telling the user whether more input
 * is wanted or the setup is done. `ensureReplyInvitesMore` guarantees an opening.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { callLLMMock } = vi.hoisted(() => ({ callLLMMock: vi.fn() }));
vi.mock("../negotiation/adapters/deepseek-client.js", () => ({ callLLM: callLLMMock }));

import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
} from "../services/negotiation-agent-builder-chat.service.js";

const PREVIOUS_MEMORY = {
  categoryInterest: "탐색 중",
  mustHave: [],
  avoid: [],
  riskStyle: "balanced" as const,
  negotiationStyle: "balanced" as const,
  openingTactic: "fair_market_anchor" as const,
  questions: [],
  source: [],
};

/** A long-tail listing: no taxonomy checks, so the seller path runs the raw LLM reply. */
const TELESCOPE = {
  id: "listing-1",
  title: "Vintage brass telescope 1900s",
  category: "other",
  condition: "good",
  askPriceMinor: 40000,
  floorPriceMinor: 32000,
  marketMedianMinor: 40000,
  tags: ["brass-telescope"],
};

function mockReply(reply: string) {
  callLLMMock.mockResolvedValueOnce({
    content: JSON.stringify({
      memory: PREVIOUS_MEMORY,
      reply,
      reasoning_summary: "test",
    }),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    reasoning_used: false,
  });
}

async function sellerTurn(reply: string) {
  mockReply(reply);
  const result = await processNegotiationAgentBuilderTurn(
    negotiationAgentBuilderTurnBodySchema.parse({
      user_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "verifier",
      side: "seller",
      message: "1912년 영국제이고 렌즈에 흠집 없어요",
      previous_memory: PREVIOUS_MEMORY,
      listings: [TELESCOPE],
    }),
  );
  return result.reply;
}

beforeEach(() => vi.clearAllMocks());

describe("seller builder reply never dead-ends", () => {
  it("appends an invitation when the model just acknowledges and stops", async () => {
    // The exact shape reported from e2e: answer accepted, conversation over.
    const reply = await sellerTurn("Got it, I'll lead with the 1912 provenance.");
    expect(reply).toBe(
      "Got it, I'll lead with the 1912 provenance. Anything else you want it to emphasize or hold firm on?",
    );
  });

  it("leaves a reply that already asks something untouched", async () => {
    // Never stack two questions in one turn.
    const original = "Noted. Is the original case included?";
    expect(await sellerTurn(original)).toBe(original);
  });

  it("invites more even when the acknowledgement ends without punctuation", async () => {
    const reply = await sellerTurn("Understood, holding firm at $320");
    expect(reply).toContain("Anything else you want it to emphasize or hold firm on?");
  });

  it("does not treat a rhetorical mid-sentence question mark as the next move", async () => {
    // A question anywhere means the user has something to answer; leave it alone.
    const original = "Scratch-free? Great, that's worth leading with.";
    expect(await sellerTurn(original)).toBe(original);
  });
});

describe("seller builder asks one thing at a time", () => {
  it("drops a second question bundled into the same reply", async () => {
    // Verbatim from e2e on an EV charger (long-tail → no planner to trim it).
    const reply = await sellerTurn(
      "Let's shape this agent to your charger. First, tell me: is it in flawless working order, or does it hold any fault? And its exterior—has time left any marks on it?",
    );
    expect(reply).toBe(
      "Let's shape this agent to your charger. First, tell me: is it in flawless working order, or does it hold any fault?",
    );
  });

  it("keeps a single question that merely contains an 'or' clause", async () => {
    const original = "Is the title clean, or is it salvage?";
    expect(await sellerTurn(original)).toBe(original);
  });

  it("keeps non-question sentences that follow the dropped question", async () => {
    const reply = await sellerTurn(
      "Noted. Any water damage? Has it been opened? I'll lead with the low hours.",
    );
    expect(reply).toBe("Noted. Any water damage? I'll lead with the low hours.");
  });

  it("still appends the invitation when trimming leaves no question", async () => {
    // Trimming never removes the LAST question, so this stays a pure acknowledgement.
    const reply = await sellerTurn("Understood. I'll hold firm.");
    expect(reply).toBe(
      "Understood. I'll hold firm. Anything else you want it to emphasize or hold firm on?",
    );
  });
});

describe("standalone buyer agent (no listing) also invites more", () => {
  it("appends the buyer-framed invitation", async () => {
    mockReply("Got it, I'll push hard on price.");
    const result = await processNegotiationAgentBuilderTurn(
      negotiationAgentBuilderTurnBodySchema.parse({
        user_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "verifier",
        side: "buyer",
        message: "공격적으로 해줘",
        previous_memory: PREVIOUS_MEMORY,
        listings: [],
      }),
    );
    expect(result.reply).toBe(
      "Got it, I'll push hard on price. Anything else you want it to prioritize or avoid?",
    );
  });
});

/**
 * An imperative is an ask. Verbatim from e2e on a brass telescope, where the one-ask
 * rule let two through because only one carried a question mark:
 *   "…Tell me what a buyer should appreciate — its history, a flawless lens, the case
 *    it nests in. What is its story?"
 */
describe("imperative requests count as asks", () => {
  it("drops a trailing question when the reply already asked imperatively", async () => {
    const reply = await sellerTurn(
      "A brass telescope carries weight beyond its metal. Tell me what a buyer should appreciate. What is its story?",
    );
    expect(reply).toBe(
      "A brass telescope carries weight beyond its metal. Tell me what a buyer should appreciate.",
    );
  });

  it("drops a trailing imperative when the reply already asked a question", async () => {
    const reply = await sellerTurn("Any damage to the lens? Tell me about the case too.");
    expect(reply).toBe("Any damage to the lens?");
  });

  it("does not bolt an invitation onto a reply that already asks imperatively", async () => {
    // `ensureReplyInvitesMore` used to see no question mark and append a second ask.
    const original = "Noted. Tell me anything you won't budge on.";
    expect(await sellerTurn(original)).toBe(original);
  });

  it("leaves a plain statement containing 'share' alone", async () => {
    // The imperative must be anchored at the sentence start, not matched anywhere.
    const reply = await sellerTurn("I'll share the service history with buyers.");
    expect(reply).toBe(
      "I'll share the service history with buyers. Anything else you want it to emphasize or hold firm on?",
    );
  });
});
