import { describe, expect, it } from "vitest";
import {
  getRoundSpeaker,
  isTerminalNegotiationStatus,
  type ServerRound,
  transformNegotiationPlayback,
} from "./negotiation-session-data";

function round(overrides: Partial<ServerRound> = {}): ServerRound {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    round_no: 1,
    sender_role: "BUYER",
    message_type: "COUNTER",
    price_minor: 100_00,
    counter_price_minor: 110_00,
    utility: null,
    decision: "COUNTER",
    message: "I can meet you at $110.",
    phase_at_round: null,
    tactic_used: null,
    concession_rate: null,
    created_at: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("negotiation live session data", () => {
  it("attributes generated text to the responding agent", () => {
    expect(getRoundSpeaker(round())).toBe("SELLER");
    expect(getRoundSpeaker(round({ sender_role: "SELLER" }))).toBe("BUYER");
  });

  it("keeps the persisted sender for authoritative rows without generated text", () => {
    expect(getRoundSpeaker(round({ message: null, sender_role: "BUYER" }))).toBe("BUYER");
  });

  it("recognizes final statuses and keeps active statuses live", () => {
    for (const status of [
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
      "SUPERSEDED",
      "NEAR_DEAL",
      "STALLED",
    ]) {
      expect(isTerminalNegotiationStatus(status)).toBe(true);
    }
    expect(isTerminalNegotiationStatus("CREATED")).toBe(false);
    expect(isTerminalNegotiationStatus("ACTIVE")).toBe(false);
  });

  it("shows a near-deal price line instead of pause-checklist text", () => {
    const transformed = transformNegotiationPlayback({
      session: {
        id: "33333333-3333-4333-8333-333333333333",
        status: "WAITING",
        current_round: 2,
        last_offer_price_minor: 880_00,
        buyer_negotiation_agent_preset_id: null,
        listing: null,
      },
      rounds: [
        round({
          round_no: 2,
          sender_role: "SELLER",
          decision: "NEAR_DEAL",
          price_minor: 880_00,
          counter_price_minor: null,
          message: "IMEI clean? Water damage? FRP off?",
          held_for_criteria_pause: true,
          pause_questions: ["IMEI clean?", "Water damage?", "FRP off?"],
        }),
      ],
    });
    const last = transformed.rounds.at(-1);
    expect(last?.sender).toBe("SELLER");
    expect(last?.message).toMatch(/\$880/);
    expect(last?.message).not.toContain("IMEI");
  });

  it("keeps each agent wearing the face its owner picked", () => {
    const transformed = transformNegotiationPlayback({
      session: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "ACTIVE",
        current_round: 1,
        last_offer_price_minor: null,
        // hunter's own face is the fox, verifier's the owl — both overridden.
        buyer_negotiation_agent_preset_id: "hunter",
        buyer_negotiation_agent_emoji: "panda",
        listing: {
          public_id: "pub-1",
          title: "Camera",
          photo_url: null,
          target_price: "900.00",
          category: "cameras",
          seller_agent_preset: "verifier",
          seller_agent_emoji: "raccoon",
        },
      },
      rounds: [round()],
    });
    expect(transformed.session.buyerAgent.emoji).toBe("panda");
    expect(transformed.session.sellerAgent.emoji).toBe("raccoon");
    // The face is the only thing overridden; the preset still names the agent.
    expect(transformed.session.buyerAgent.presetId).toBe("hunter");
  });

  it("falls back to each preset's own face on sessions started before faces existed", () => {
    const transformed = transformNegotiationPlayback({
      session: {
        id: "55555555-5555-4555-8555-555555555555",
        status: "ACTIVE",
        current_round: 1,
        last_offer_price_minor: null,
        buyer_negotiation_agent_preset_id: "hunter",
        listing: {
          public_id: "pub-1",
          title: "Camera",
          photo_url: null,
          target_price: "900.00",
          category: "cameras",
          seller_agent_preset: "verifier",
        },
      },
      rounds: [round()],
    });
    expect(transformed.session.buyerAgent.emoji).toBe("fox");
    expect(transformed.session.sellerAgent.emoji).toBe("owl");
  });

  it("leaves an unknown agent as a glyph rather than naming it with an animal", () => {
    const transformed = transformNegotiationPlayback({
      session: {
        id: "66666666-6666-4666-8666-666666666666",
        status: "ACTIVE",
        current_round: 1,
        last_offer_price_minor: null,
        buyer_negotiation_agent_preset_id: null,
        listing: null,
      },
      rounds: [round()],
    });
    expect(transformed.session.buyerAgent.emoji).toBe("🤝");
    expect(transformed.session.sellerAgent.emoji).toBe("🏷️");
  });

  it("does not label a zero-round created session as escalated", () => {
    const transformed = transformNegotiationPlayback({
      session: {
        id: "22222222-2222-4222-8222-222222222222",
        status: "CREATED",
        current_round: 0,
        last_offer_price_minor: null,
        buyer_negotiation_agent_preset_id: null,
        listing: null,
      },
      rounds: [],
    });

    expect(transformed.session.finalStatus).toBe("IN_PROGRESS");
  });

  it("does not collapse buyer OPENING and seller COUNTER into one round", () => {
    const transformed = transformNegotiationPlayback({
      session: {
        id: "a9626ebf-31af-4cee-842d-3454fc4dec83",
        status: "ACTIVE",
        current_round: 1,
        last_offer_price_minor: 395_00,
        buyer_negotiation_agent_preset_id: "steady-buyer",
        listing: null,
      },
      rounds: [
        round({
          sender_role: "BUYER",
          message_type: "OFFER",
          price_minor: 360_00,
          counter_price_minor: 395_00,
          decision: "COUNTER",
          message:
            "This one is like-new, unlocked, 128GB, and battery is 90%+, so $360 is below what it's worth. I can meet you at $395.",
        }),
      ],
    });
    expect(transformed.rounds).toHaveLength(2);
    expect(transformed.session.roundsTotal).toBe(2);
    expect(transformed.rounds[0]).toMatchObject({
      roundIndex: 1,
      sender: "BUYER",
      decision: "OPENING",
      offerPrice: 360,
    });
    expect(transformed.rounds[0]?.message).toBe(
      "Hi, I'm interested in this listing. I'd like to offer $360.",
    );
    expect(transformed.rounds[1]).toMatchObject({
      roundIndex: 2,
      sender: "SELLER",
      decision: "COUNTER",
      offerPrice: 395,
    });
  });
});
