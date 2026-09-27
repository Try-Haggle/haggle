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
      buyerCriteria: [{ checkId: "imei_verification", stance: "clean IMEI required" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.buyerCriteria).toEqual([
      { checkId: "imei_verification", stance: "clean IMEI required" },
    ]);
  });

  it("accepts start without buyerCriteria", () => {
    const parsed = startBuyerNegotiationSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.buyerCriteria).toBeUndefined();
  });

  it("strips a legacy requested_model instead of rejecting the body", () => {
    const parsed = startBuyerNegotiationSchema.safeParse({
      ...base,
      requested_model: "deepseek-v4-pro",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("requested_model");
  });
});
