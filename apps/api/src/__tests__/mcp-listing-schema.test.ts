import { objectFromShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buyerCriteriaRequiredErrorShape,
  haggleGetListingInputShape,
  haggleGetListingListingSchema,
  haggleGetListingOutputShape,
} from "../mcp/tools/mcp-listing-schema.js";
import { registerPlatformTools } from "../mcp/tools/platform.js";

/**
 * Same conversion ListTools uses in MCP SDK 1.26 (normalizeObjectSchema + toJsonSchemaCompat).
 * Cursor catalogs this JSON; additionalProperties:false means omitted fields cannot be seen.
 */
function publishedSchema(shape: Record<string, z.ZodTypeAny>) {
  const obj = objectFromShape(shape);
  return toJsonSchemaCompat(obj, {
    strictUnions: true,
    pipeStrategy: "input",
  }) as {
    properties?: Record<
      string,
      {
        type?: string;
        properties?: Record<
          string,
          { type?: string; items?: { properties?: Record<string, unknown> } }
        >;
        items?: { properties?: Record<string, unknown> };
        additionalProperties?: boolean;
      }
    >;
    additionalProperties?: boolean;
  };
}

describe("haggle_get_listing published MCP schema", () => {
  it("keeps public_id on the raw input shape used by registerTool()", () => {
    expect(Object.keys(haggleGetListingInputShape)).toEqual(["public_id"]);
    expect(z.object(haggleGetListingInputShape).safeParse({ public_id: "jc6r2T3d" }).success).toBe(
      true,
    );
  });

  it("lists required_criteria with checkId and ask after zod to JSON Schema", () => {
    const schema = publishedSchema(haggleGetListingOutputShape);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {})).toEqual(["listing"]);
    const listing = schema.properties?.listing;
    expect(listing?.additionalProperties).toBe(false);
    expect(listing?.properties?.required_criteria?.type).toBe("array");
    expect(listing?.properties?.required_criteria?.items?.properties?.checkId).toEqual(
      expect.objectContaining({ type: "string" }),
    );
    expect(listing?.properties?.required_criteria?.items?.properties?.ask).toEqual(
      expect.objectContaining({ type: "string" }),
    );
  });

  it("accepts a listing object with required_criteria {checkId, ask}", () => {
    const parsed = haggleGetListingListingSchema.safeParse({
      public_id: "jc6r2T3d",
      title: "iPhone",
      description: null,
      category: "electronics",
      condition: "good",
      target_price: "400",
      photo_url: null,
      listing_url: "https://app.staging.tryhaggle.ai/l/jc6r2T3d",
      required_criteria: [
        { checkId: "imei_verification", ask: "Should the agent require a clean IMEI?" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("publishes the empty-start error shape with required_criteria {checkId, ask}", () => {
    const schema = publishedSchema(buyerCriteriaRequiredErrorShape);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.required_criteria?.type).toBe("array");
    expect(schema.properties?.required_criteria?.items?.properties?.checkId).toEqual(
      expect.objectContaining({ type: "string" }),
    );
    expect(schema.properties?.required_criteria?.items?.properties?.ask).toEqual(
      expect.objectContaining({ type: "string" }),
    );
  });

  it("registers haggle_get_listing from registerPlatformTools", () => {
    expect(registerPlatformTools).toEqual(expect.any(Function));
    expect(haggleGetListingOutputShape.listing).toBeDefined();
  });
});
