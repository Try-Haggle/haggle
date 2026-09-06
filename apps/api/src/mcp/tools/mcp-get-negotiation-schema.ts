import { z } from "zod";

/**
 * Canonical MCP args for haggle_get_negotiation.
 *
 * expand is optional Stripe-style field selection:
 * - omit / [] → default FULL view (transcript + offers), so agents negotiate
 *   without an extra expand round-trip (E1 / CTO product feedback vs A8 fold)
 * - "transcript" → full chat transcript (OPENING synthesis included)
 * - "offers" → price/decision offer history derived from the same transcript
 *
 * Explicit expand still selects a subset; omit no longer folds.
 * Kept as a raw Zod shape (not z.object) so MCP SDK server.tool() publishes it.
 */
export const GET_NEGOTIATION_EXPAND_VALUES = ["transcript", "offers"] as const;
export type GetNegotiationExpandField = (typeof GET_NEGOTIATION_EXPAND_VALUES)[number];

/** MCP default when expand is omitted or empty — full transcript + offers. */
export const GET_NEGOTIATION_EXPAND_DEFAULT: GetNegotiationExpandField[] = ["transcript", "offers"];

export const haggleGetNegotiationExpandSchema = z.enum(GET_NEGOTIATION_EXPAND_VALUES);

export const haggleGetNegotiationInputShape = {
  session_id: z.string().uuid().describe("Negotiation session id"),
  expand: z
    .array(haggleGetNegotiationExpandSchema)
    .optional()
    .describe(
      'Optional field selection. Default (omit or []) returns full transcript + offers. Pass ["transcript"] and/or ["offers"] to request a subset; expand is optional/redundant for the full default.',
    ),
};

export function normalizeGetNegotiationExpand(
  expand: ReadonlyArray<string> | undefined | null,
): GetNegotiationExpandField[] {
  // MCP-facing default: full transcript + offers (E1). Internal helpers that still
  // want a folded recent_messages window call buildMcpGetNegotiationExpandView with [].
  if (!expand || expand.length === 0) return [...GET_NEGOTIATION_EXPAND_DEFAULT];
  const allowed = new Set<string>(GET_NEGOTIATION_EXPAND_VALUES);
  const out: GetNegotiationExpandField[] = [];
  for (const raw of expand) {
    if (!allowed.has(raw)) continue;
    const field = raw as GetNegotiationExpandField;
    if (!out.includes(field)) out.push(field);
  }
  // If every value was unknown, fall back to the full default rather than folding.
  return out.length > 0 ? out : [...GET_NEGOTIATION_EXPAND_DEFAULT];
}
