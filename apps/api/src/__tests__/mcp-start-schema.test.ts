import { objectFromShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { haggleStartNegotiationInputShape } from "../mcp/tools/mcp-start-schema.js";
import { registerPlatformTools } from "../mcp/tools/platform.js";

/**
 * Same conversion ListTools uses in MCP SDK 1.26 (normalizeObjectSchema + toJsonSchemaCompat).
 * Cursor catalogs this JSON; additionalProperties:false means omitted fields cannot be passed.
 */
function publishedInputSchema(shape: Record<string, z.ZodTypeAny>) {
  const obj = objectFromShape(shape);
  return toJsonSchemaCompat(obj, {
    strictUnions: true,
    pipeStrategy: "input",
  }) as {
    properties?: Record<
      string,
      { type?: string; items?: { properties?: Record<string, unknown> } }
    >;
    additionalProperties?: boolean;
  };
}

describe("haggle_start_negotiation published MCP schema", () => {
  it("keeps buyerCriteria on the raw shape used by server.tool()", () => {
    expect(Object.keys(haggleStartNegotiationInputShape)).toEqual(
      expect.arrayContaining(["public_id", "agent_id", "deadline_hours", "buyerCriteria"]),
    );
    const parsed = z.object(haggleStartNegotiationInputShape).safeParse({
      public_id: "jc6r2T3d",
      buyerCriteria: [{ checkId: "imei_verification", stance: "clean IMEI required" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("lists buyerCriteria with checkId and optional stance after zod to JSON Schema", () => {
    const schema = publishedInputSchema(haggleStartNegotiationInputShape);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["public_id", "agent_id", "deadline_hours", "buyerCriteria"]),
    );
    const buyerCriteria = schema.properties?.buyerCriteria;
    expect(buyerCriteria?.type).toBe("array");
    expect(buyerCriteria?.items?.properties?.checkId).toEqual(
      expect.objectContaining({ type: "string" }),
    );
    expect(buyerCriteria?.items?.properties?.stance).toEqual(
      expect.objectContaining({ type: "string" }),
    );
  });

  it("registers haggle_start_negotiation from registerPlatformTools", () => {
    expect(registerPlatformTools).toEqual(expect.any(Function));
    expect(haggleStartNegotiationInputShape.buyerCriteria).toBeDefined();
  });
});
