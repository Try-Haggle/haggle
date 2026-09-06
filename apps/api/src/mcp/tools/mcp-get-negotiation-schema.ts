import { z } from "zod";

/**
 * Canonical MCP args for haggle_get_negotiation.
 *
 * expand is optional Stripe-style field selection:
 * - omit / [] → folded view (recent_messages only; no transcript/offers keys)
 * - "transcript" → full chat transcript (OPENING synthesis included)
 * - "offers" → price/decision offer history derived from the same transcript
 *
 * Kept as a raw Zod shape (not z.object) so MCP SDK server.tool() publishes it.
 */
export const GET_NEGOTIATION_EXPAND_VALUES = ["transcript", "offers"] as const;
export type GetNegotiationExpandField = (typeof GET_NEGOTIATION_EXPAND_VALUES)[number];

export const haggleGetNegotiationExpandSchema = z.enum(GET_NEGOTIATION_EXPAND_VALUES);

export const haggleGetNegotiationInputShape = {
  session_id: z.string().uuid().describe("Negotiation session id"),
  expand: z
    .array(haggleGetNegotiationExpandSchema)
    .optional()
    .describe(
      "Optional fields to expand beyond the folded recent_messages window: transcript (full chat) and/or offers (price/decision history). Omit for the default folded response.",
    ),
};

export function normalizeGetNegotiationExpand(
  expand: ReadonlyArray<string> | undefined | null,
): GetNegotiationExpandField[] {
  if (!expand || expand.length === 0) return [];
  const allowed = new Set<string>(GET_NEGOTIATION_EXPAND_VALUES);
  const out: GetNegotiationExpandField[] = [];
  for (const raw of expand) {
    if (!allowed.has(raw)) continue;
    const field = raw as GetNegotiationExpandField;
    if (!out.includes(field)) out.push(field);
  }
  return out;
}
