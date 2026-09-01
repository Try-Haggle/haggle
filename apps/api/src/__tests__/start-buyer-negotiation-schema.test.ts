import { describe, expect, it } from "vitest";
import { startBuyerNegotiationSchema } from "../services/start-buyer-negotiation.service.js";

describe("startBuyerNegotiationSchema buyerCriteria", () => {
  const base = {
    listing_public_id: "jc6r2T3d",
    negotiation_agent_preset_id: "balancer",
  };

  it("accepts buyerCriteria from the start wizard", () => {
    const parsed = startBuyerNegotiationSchema.safeParse({
      ...base,
      buyerCriteria: [
        { checkId: "imei_verification", stance: "clean IMEI required" },
        { checkId: "financing_paid_off", stance: "fully paid off" },
        { checkId: "water_damage", stance: "no liquid/water damage" },
        { checkId: "find_my_status", stance: "Find My must be off" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.buyerCriteria).toHaveLength(4);
    expect(parsed.data.buyerCriteria?.[0]?.checkId).toBe("imei_verification");
  });

  it("allows omitting buyerCriteria", () => {
    const parsed = startBuyerNegotiationSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.buyerCriteria).toBeUndefined();
  });

  it("rejects a blank checkId", () => {
    const parsed = startBuyerNegotiationSchema.safeParse({
      ...base,
      buyerCriteria: [{ checkId: "", stance: "yes" }],
    });
    expect(parsed.success).toBe(false);
  });
});
