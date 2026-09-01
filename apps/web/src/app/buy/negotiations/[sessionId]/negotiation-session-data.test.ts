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
});
