import { objectFromShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hagglePlayNextInputShape } from "../mcp/tools/mcp-play-next-schema.js";

function publishedInputSchema(shape: Record<string, z.ZodTypeAny>) {
  const obj = objectFromShape(shape);
  return toJsonSchemaCompat(obj, {
    strictUnions: true,
    pipeStrategy: "input",
  }) as {
    properties?: Record<string, { type?: string }>;
    additionalProperties?: boolean;
  };
}

describe("haggle_play_next published MCP schema", () => {
  it("lists session_id, optional price_minor, optional message", () => {
    expect(Object.keys(hagglePlayNextInputShape)).toEqual(["session_id", "price_minor", "message"]);
    expect(
      z
        .object(hagglePlayNextInputShape)
        .safeParse({ session_id: "fc14da18-0000-4000-8000-000000000001" }).success,
    ).toBe(true);
    expect(
      z.object(hagglePlayNextInputShape).safeParse({
        session_id: "fc14da18-0000-4000-8000-000000000001",
        price_minor: 42000,
        message: "Listing doesn't spec storage or battery.",
      }).success,
    ).toBe(true);
  });

  it("publishes price_minor and message after zod to JSON Schema", () => {
    const schema = publishedInputSchema(hagglePlayNextInputShape);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["session_id", "price_minor", "message"]),
    );
    expect(schema.properties?.price_minor?.type).toBe("integer");
    expect(schema.properties?.message?.type).toBe("string");
  });
});
