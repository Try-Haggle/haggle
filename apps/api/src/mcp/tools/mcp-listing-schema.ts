import { z } from "zod";

/**
 * Canonical MCP schemas for haggle_get_listing (and the empty-start error body).
 *
 * Kept as raw Zod shapes (not z.object wrapping the whole tool) so MCP SDK
 * registerTool() / tools/list publishes them. Nested required_criteria must stay
 * a z.array(z.object({checkId, ask})) so the live catalog lists the questions —
 * testers cannot see the field when it is omitted and additionalProperties is false.
 */
export const mcpRequiredCriterionSchema = z.object({
  checkId: z
    .string()
    .min(1)
    .describe(
      "Seller required check id from the listing snapshot — do not assume IMEI/완납/침수/Find My",
    ),
  ask: z.string().describe("Buyer-facing question for this check"),
});

export const haggleGetListingInputShape = {
  public_id: z.string().min(1).describe("Listing slug (jc6r2T3d) or full /l/... URL"),
};

export const haggleGetListingListingSchema = z.object({
  public_id: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  condition: z.string().nullable(),
  target_price: z.string().nullable(),
  photo_url: z.string().nullable(),
  claimed: z.boolean().optional(),
  listing_url: z.string().nullable(),
  required_criteria: z
    .array(mcpRequiredCriterionSchema)
    .describe(
      "Seller required checks {checkId, ask} from extractSellerRequiredCriteria(listing.negotiationAgentSnapshot). Empty when none.",
    ),
});

export const haggleGetListingOutputShape = {
  listing: haggleGetListingListingSchema,
};

/** BUYER_CRITERIA_REQUIRED body for empty start_negotiation / play_next. */
export const buyerCriteriaRequiredErrorShape = {
  error: z.literal("BUYER_CRITERIA_REQUIRED"),
  message: z.string(),
  required_check_ids: z.array(z.string()),
  required_criteria: z.array(mcpRequiredCriterionSchema),
};
