import { describe, expect, it } from "vitest";
import {
  buyerOpeningMessage,
  expandMcpTranscript,
  mcpNegotiationTranscript,
  negotiationSayToUser,
  spokenRoundPriceMinor,
  spokenRoundSpeaker,
} from "../mcp/tools/negotiation-talk.js";

describe("negotiationSayToUser", () => {
  it("quotes the counterpart line and asks the human what to do next", () => {
    const talk = negotiationSayToUser({
      counterpartRole: "SELLER",
      counterpartMessage: "I can do $880.",
      decision: "NEAR_DEAL",
      priceMinor: 880_00,
    });
    expect(talk.say_to_user).toContain("Seller said: I can do $880.");
    expect(talk.ask_user).toContain("Quote that line");
  });

  it("keeps pause questions separate from the bargain line", () => {
    const talk = negotiationSayToUser({
      counterpartRole: "SELLER",
      counterpartMessage: "Seller is at $880.",
      decision: "NEAR_DEAL",
      priceMinor: 880_00,
      pauseQuestions: ["IMEI clean?", "FRP off?"],
    });
    expect(talk.say_to_user).toContain("Seller said: Seller is at $880.");
    expect(talk.say_to_user).toContain("IMEI clean?");
    expect(talk.ask_user).toContain("Answer each question");
  });

  it("labels the seller answer, not the incoming buyer offer", () => {
    const speaker = spokenRoundSpeaker({
      senderRole: "BUYER",
      message:
        "This one is like-new, unlocked, 128GB, and battery is 90%+, so $360 is below what it's worth. I can meet you at $395.",
    });
    const price = spokenRoundPriceMinor({
      priceMinor: "36000",
      counterPriceMinor: "39500",
    });
    const talk = negotiationSayToUser({
      counterpartRole: speaker,
      counterpartMessage:
        "This one is like-new, unlocked, 128GB, and battery is 90%+, so $360 is below what it's worth. I can meet you at $395.",
      decision: "COUNTER",
      priceMinor: price,
    });
    expect(speaker).toBe("SELLER");
    expect(price).toBe("39500");
    expect(talk.say_to_user).toMatch(/^Seller said:/);
    expect(talk.say_to_user).not.toMatch(/^Buyer said:/);
  });
});

const sellerCounter = {
  roundNo: 1,
  senderRole: "BUYER" as const,
  message:
    "This one is like-new, unlocked, 128GB, and battery is 90%+, so $360 is below what it's worth. I can meet you at $395.",
  decision: "COUNTER",
  priceminor: "36000",
  counterPriceMinor: "39500",
};

describe("expandMcpTranscript", () => {
  it("does not collapse buyer OPENING and seller COUNTER into one message", () => {
    const messages = expandMcpTranscript([sellerCounter]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      round_no: 1,
      speaker: "BUYER",
      sender_role: "BUYER",
      decision: "OPENING",
      price_minor: "36000",
      message: "Hi, I'm interested in this listing. I'd like to offer $360.",
    });
    expect(messages[1]).toMatchObject({
      round_no: 2,
      speaker: "SELLER",
      sender_role: "SELLER",
      offer_sender_role: "BUYER",
      decision: "COUNTER",
      price_minor: "39500",
      incoming_price_minor: "36000",
      counter_price_minor: "39500",
      message: sellerCounter.message,
    });
  });

  it("still expands when the spoken speaker is SELLER after #98", () => {
    const messages = expandMcpTranscript([sellerCounter]);
    expect(spokenRoundSpeaker({ senderRole: "BUYER", message: sellerCounter.message })).toBe(
      "SELLER",
    );
    expect(messages.map((m) => [m.round_no, m.speaker, m.decision])).toEqual([
      [1, "BUYER", "OPENING"],
      [2, "SELLER", "COUNTER"],
    ]);
  });

  it("does not double-prepend if a real opening already exists", () => {
    const messages = expandMcpTranscript([
      {
        roundNo: 1,
        senderRole: "BUYER",
        message: buyerOpeningMessage("36000"),
        decision: "OPENING",
        priceminor: "36000",
        counterPriceMinor: null,
      },
      {
        roundNo: 2,
        senderRole: "BUYER",
        message: sellerCounter.message,
        decision: "COUNTER",
        priceminor: "36000",
        counterPriceMinor: "39500",
      },
    ]);
    expect(messages.filter((m) => m.decision === "OPENING")).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => [m.round_no, m.speaker, m.decision])).toEqual([
      [1, "BUYER", "OPENING"],
      [2, "SELLER", "COUNTER"],
    ]);
    expect(messages[0]?.message).toBe(buyerOpeningMessage("36000"));
  });
});

describe("mcpNegotiationTranscript", () => {
  it("reports current_round 2 so MCP matches web chat for a folded first exchange", () => {
    const view = mcpNegotiationTranscript([sellerCounter], 1);
    expect(view.current_round).toBe(2);
    expect(view.recent_messages).toHaveLength(2);
  });

  it("keeps later rounds after the synthesized opening", () => {
    const view = mcpNegotiationTranscript(
      [
        sellerCounter,
        {
          roundNo: 2,
          senderRole: "SELLER",
          message: "I can do $380.",
          decision: "COUNTER",
          priceminor: "39500",
          counterPriceMinor: "38000",
        },
      ],
      2,
    );
    expect(view.current_round).toBe(3);
    expect(view.recent_messages.map((m) => [m.round_no, m.speaker, m.decision])).toEqual([
      [1, "BUYER", "OPENING"],
      [2, "SELLER", "COUNTER"],
      [3, "BUYER", "COUNTER"],
    ]);
  });

  it("does not invent an opening when the first row has no spoken answer yet", () => {
    const view = mcpNegotiationTranscript(
      [
        {
          roundNo: 1,
          senderRole: "BUYER",
          message: null,
          decision: null,
          priceminor: "36000",
          counterPriceMinor: null,
        },
      ],
      1,
    );
    expect(view.current_round).toBe(1);
    expect(view.recent_messages).toHaveLength(1);
    expect(view.recent_messages[0]).toMatchObject({
      speaker: "BUYER",
      decision: null,
      price_minor: "36000",
    });
  });

  it("keeps current_round on the last unfolded line when recent_messages is sliced", () => {
    const later = [2, 3, 4].map((n) => ({
      roundNo: n,
      senderRole: n % 2 === 0 ? ("SELLER" as const) : ("BUYER" as const),
      message: `line ${n}`,
      decision: "COUNTER",
      priceminor: "39500",
      counterPriceMinor: "38000",
    }));
    const view = mcpNegotiationTranscript([sellerCounter, ...later], 4);
    expect(view.current_round).toBe(5);
    expect(view.recent_messages).toHaveLength(4);
    expect(view.recent_messages.map((m) => m.round_no)).toEqual([2, 3, 4, 5]);
    expect(view.recent_messages[0]?.decision).not.toBe("OPENING");
  });
});
