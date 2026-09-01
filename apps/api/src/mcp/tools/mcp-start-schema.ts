import { z } from "zod";

/**
 * Canonical MCP args for haggle_start_negotiation.
 *
 * Kept as a raw Zod shape (not z.object) so MCP SDK server.tool() publishes it
 * via tools/list. Nested buyerCriteria must stay a z.array(z.object({checkId, stance?}))
 * so the live catalog lists checkId + optional stance — testers cannot pass it
 * when it is omitted and additionalProperties is false.
 */
export const mcpBuyerCriteriaItemSchema = z.object({
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
};
