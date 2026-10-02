import { z } from "zod";

/**
 * Canonical MCP args for haggle_start_negotiation.
 *
 * Kept as a raw Zod shape (not z.object) so MCP SDK server.tool() publishes it
 * via tools/list. Nested buyerCriteria must stay a z.array(z.object({checkId, stance?}))
 * so the live catalog lists checkId + optional stance — testers cannot pass it
 * when it is omitted and additionalProperties is false.
 */
export const mcpBuyerCriteriaItemSchema = z.strictObject({
  checkId: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "Seller required check id, e.g. imei_verification, financing_paid_off, water_damage, find_my_status",
    ),
  stance: z.string().max(2000).optional().describe("Buyer stance for this check"),
});

export const haggleStartNegotiationInputShape = {
  public_id: z.string().min(1).describe("Listing slug (jc6r2T3d) or full /l/... URL"),
  agent_id: z
    .string()
    .min(1)
    .optional()
    .describe("Preset (hunter, balancer, closer, verifier) or id from haggle_list_agents"),
  deadline_hours: z
    .number()
    .positive()
    .max(24 * 14)
    .optional(),
  buyerCriteria: z
    .array(mcpBuyerCriteriaItemSchema)
    .max(40)
    .optional()
    .describe(
      "Start-wizard answers for seller required criteria (IMEI/완납/침수/Find My). Each item is {checkId, stance?}. Required when the listing has those checks.",
    ),
  builder_memory: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Same as the web negotiation_agent_builder_memory: {budgetMax, targetPrice (WHOLE DOLLARS), mustHave[], avoid[], categoryCriteria[], ...}. Pass the memory from haggle_builder_chat_turn or the user's answers from haggle_prepare_negotiation. Without budgetMax the walk-away price defaults to the asking price.",
    ),
  agent_weights: z
    .record(z.string(), z.number())
    .optional()
    .describe("Optional strategy weights {w_p, w_t, w_r, w_s} (web agent_weights)."),
  agent_overrides: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional sparse engine overrides (web agent_overrides), e.g. {alpha, beta}."),
  buyer_control_mode: z
    .enum(["auto", "manual"])
    .optional()
    .describe("manual = consult mode (decide each round with the user); auto = delegate."),
  fulfillment: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Fulfillment preference, e.g. {methods:['carrier'], preferred:'carrier'}. See fulfillment_choices from haggle_prepare_negotiation.",
    ),
};

export const haggleStartNegotiationInputSchema = z.strictObject(haggleStartNegotiationInputShape);
