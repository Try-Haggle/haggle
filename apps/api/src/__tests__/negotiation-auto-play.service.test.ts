import { describe, expect, it } from "vitest";
import {
  createNegotiationAutoPlaySetup,
  getNegotiationAutoPlayContext,
  planNegotiationAutoPlayRound,
  validateNegotiationAutoPlayToken,
} from "../services/negotiation-auto-play.service.js";

describe("negotiation auto-play", () => {
  const setup = createNegotiationAutoPlaySetup({
    buyerSnapshot: { side: "buyer" },
    sellerSnapshot: { side: "seller" },
    buyerTargetMinor: 111_900,
    maxRounds: 8,
  });
  const context = getNegotiationAutoPlayContext(setup.sellerSnapshot)!;

  it("stores only a token hash in the session snapshot", () => {
    expect(context.runTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(setup.sellerSnapshot)).not.toContain(setup.runToken);
    expect(validateNegotiationAutoPlayToken(context, setup.runToken)).toBe(true);
    expect(validateNegotiationAutoPlayToken(context, "wrong-token")).toBe(false);
  });

  it("plans the buyer opening against the seller", () => {
    const plan = planNegotiationAutoPlayRound(
      {
        status: "CREATED",
        currentRound: 0,
        role: "SELLER",
        negotiationAgentSnapshot: setup.sellerSnapshot,
      },
      [],
      context,
    );

    expect(plan).toMatchObject({
      roundNo: 1,
      senderRole: "BUYER",
      responderRole: "SELLER",
      offerPriceMinor: 111_900,
      responderSnapshot: { side: "seller" },
    });
  });

  it("uses the previous responder and message for the next turn", () => {
    const plan = planNegotiationAutoPlayRound(
      {
        status: "ACTIVE",
        currentRound: 1,
        role: "BUYER",
        negotiationAgentSnapshot: setup.sellerSnapshot,
      },
      [
        {
          roundNo: 1,
          senderRole: "BUYER",
          priceminor: "111900",
          counterPriceMinor: "135000",
          message: "I can do $1,350.",
        },
      ],
      context,
    );

    expect(plan).toMatchObject({
      roundNo: 2,
      senderRole: "SELLER",
      responderRole: "BUYER",
      offerPriceMinor: 135_000,
      messageText: "I can do $1,350.",
      responderSnapshot: { side: "buyer" },
    });
  });

  it("stops planning at a terminal status or round limit", () => {
    const base = {
      currentRound: 8,
      role: "BUYER" as const,
      negotiationAgentSnapshot: setup.buyerSnapshot,
    };
    expect(planNegotiationAutoPlayRound({ ...base, status: "ACTIVE" }, [], context)).toBeNull();
    expect(
      planNegotiationAutoPlayRound({ ...base, currentRound: 2, status: "ACCEPTED" }, [], context),
    ).toBeNull();
  });
});
