import { describe, expect, it } from "vitest";
import { negotiationSayToUser } from "../mcp/tools/negotiation-talk.js";

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
});
