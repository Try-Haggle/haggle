import { describe, expect, it } from "vitest";
import {
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
