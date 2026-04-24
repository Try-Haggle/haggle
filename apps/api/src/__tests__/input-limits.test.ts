import { describe, expect, it } from "vitest";
import { z } from "zod";
import { boundedJson, configuredJsonBodyLimit, INPUT_LIMITS } from "../lib/input-limits.js";

describe("input limits", () => {
  it("uses a bounded default JSON body limit", () => {
    delete process.env.HAGGLE_MAX_JSON_BODY_BYTES;
    expect(configuredJsonBodyLimit()).toBe(INPUT_LIMITS.jsonBodyBytes);
  });

  it("rejects oversized structured JSON payloads", () => {
    const schema = boundedJson(z.record(z.any()), 32, "payload");
    const result = schema.safeParse({ text: "x".repeat(64) });
    expect(result.success).toBe(false);
  });
});
