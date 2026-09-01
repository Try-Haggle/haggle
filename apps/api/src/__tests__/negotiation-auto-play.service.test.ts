import { describe, expect, it } from "vitest";
import {
  applyUserSpecifiedAutoPlayCounter,
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

  it("does not persist the counterpart snapshot in plaintext", () => {
    const sealed = createNegotiationAutoPlaySetup({
      buyerSnapshot: { side: "buyer", floor: 40_000 },
      sellerSnapshot: { side: "seller", floor: 70_000 },
      buyerTargetMinor: 111_900,
      maxRounds: 8,
    });
    const sellerRow = JSON.stringify(sealed.sellerSnapshot);
    const buyerRow = JSON.stringify(sealed.buyerSnapshot);
    expect(sellerRow).not.toContain('"floor":40000');
    expect(sellerRow).not.toContain('"side":"buyer"');
    expect(buyerRow).not.toContain('"floor":70000');
    expect(buyerRow).not.toContain('"side":"seller"');
    expect(getNegotiationAutoPlayContext(sealed.sellerSnapshot)?.buyerSnapshot).toEqual({
      side: "buyer",
      floor: 40_000,
    });
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

  it("preserves the buyer's standing offer across a seller-criteria HOLD round (no seller-price echo)", () => {
    // A Phase G pause persists a HOLD round. With the fix it carries the buyer's OWN
    // standing offer as counterPriceMinor, so the next buyer offer uses that — NOT the
    // seller's incoming priceminor (which would collapse the deal to the seller's ask).
    const buyerStanding = 90_000;
    const sellerIncoming = 150_000;
    const plan = planNegotiationAutoPlayRound(
      {
        status: "ACTIVE",
        currentRound: 2,
        role: "BUYER",
        negotiationAgentSnapshot: setup.buyerSnapshot,
      },
      [
        {
          roundNo: 2,
          senderRole: "SELLER",
          priceminor: String(sellerIncoming),
          counterPriceMinor: String(buyerStanding), // carried by persistHoldRound
          message: "Should the agent only consider clean-title vehicles?",
        },
      ],
      { ...context, buyerTargetMinor: 80_000 },
    );
    expect(plan?.senderRole).toBe("BUYER");
    expect(plan?.offerPriceMinor).toBe(buyerStanding); // NOT sellerIncoming (150_000)
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

  it("overlays a user-specified counter and leaves autoplay when omitted", () => {
    const plan = {
      roundNo: 3,
      senderRole: "BUYER" as const,
      responderRole: "SELLER" as const,
      responderSnapshot: { side: "seller" },
      offerPriceMinor: 45000,
      messageText: "autoplay",
    };
    expect(applyUserSpecifiedAutoPlayCounter(plan)).toEqual(plan);
    expect(applyUserSpecifiedAutoPlayCounter(plan, {})).toEqual(plan);
    expect(
      applyUserSpecifiedAutoPlayCounter(plan, {
        priceMinor: 42000,
        message:
          "Listing doesn't spec storage or battery, and 14 Plus is a discontinued size. $495 is still asking.",
      }),
    ).toMatchObject({
      offerPriceMinor: 42000,
      messageText:
        "Listing doesn't spec storage or battery, and 14 Plus is a discontinued size. $495 is still asking.",
      senderRole: "BUYER",
      roundNo: 3,
    });
  });
});
