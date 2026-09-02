import { z } from "zod";

/**
 * Canonical MCP args for haggle_play_next.
 *
 * Kept as a raw Zod shape (not z.object) so MCP SDK server.tool() publishes it
 * via tools/list. price_minor + optional message must stay on this shape so the
 * live catalog lists them — testers cannot pass fields omitted under
 * additionalProperties: false. Omit both to keep autoplay.
 */
export const hagglePlayNextInputShape = {
  session_id: z.string().uuid().describe("Negotiation session id"),
  price_minor: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "User-specified counter in integer cents (e.g. 42000 = $420). Omit to autoplay the model-chosen price. How to answer ask_user — not a separate tool.",
    ),
  message: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe("Optional buyer text sent with the user-specified counter."),
};
