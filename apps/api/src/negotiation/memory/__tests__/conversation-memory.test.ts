import { describe, expect, it } from "vitest";
import {
  buildConversationContext,
  collectConversationTurns,
  factsToHnpPublicActs,
  turnsToHnpPublicActs,
} from "../conversation-memory.js";

describe("conversation-memory", () => {
  it("rebuilds every spoken turn, not a last-6 window", () => {
    const rounds = Array.from({ length: 8 }, (_, i) => ({
      roundNo: i + 1,
      senderRole: (i % 2 === 0 ? "BUYER" : "SELLER") as "BUYER" | "SELLER",
      message: `argument about storage in round ${i + 1}`,
      counterPriceMinor: 40000 + i * 250,
    }));

    const turns = collectConversationTurns(rounds);
    expect(turns).toHaveLength(8);
    expect(turns[0]?.text).toContain("round 1");
    expect(turns[7]?.text).toContain("round 8");
  });

  it("appends the incoming line so the next decide sees it", () => {
    const ctx = buildConversationContext(
      [
        {
          roundNo: 1,
          senderRole: "BUYER",
          message: "256 is worth more than 128",
          counterPriceMinor: 42000,
        },
      ],
      "battery is 87% so I can come down a little",
      "SELLER",
      46000,
    );

    expect(ctx.recent_turns).toHaveLength(2);
    expect(ctx.opponent_message).toContain("battery is 87%");
    expect(ctx.recent_turns?.[1]?.sender).toBe("SELLER");
  });

  it("maps turns to HNP public acts without private fields", () => {
    const acts = turnsToHnpPublicActs([
      { round: 1, sender: "BUYER", text: "256GB so I start lower", price_minor: 37000 },
      { round: 2, sender: "SELLER", text: "battery is 87%", price_minor: 48000 },
    ]);
    expect(acts[0]?.type).toBe("OFFER");
    expect(acts[1]?.type).toBe("COUNTER");
    expect(acts[0]?.total_price?.units_minor).toBe(37000);
    expect(JSON.stringify(acts)).not.toContain("floor");
  });

  it("maps price facts to HNP public acts without synthesizing claims", () => {
    const acts = factsToHnpPublicActs([
      {
        round: 1,
        phase: "BARGAINING",
        buyer_offer: 37000,
        seller_offer: 48000,
        gap: 11000,
        conditions_changed: {},
        coaching_given: { recommended: 40000, tactic: "reciprocal_concession" },
        coaching_followed: true,
        human_intervened: false,
        timestamp: 1,
      },
    ]);
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ role: "BUYER", type: "OFFER" });
    expect(acts[1]).toMatchObject({ role: "SELLER", type: "COUNTER" });
    expect(acts[0]?.total_price?.units_minor).toBe(37000);
    expect(acts[0]?.claim).toBeUndefined();
  });
});
