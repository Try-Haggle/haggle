/**
 * The vision tagger's prompt must steer the model into the taxonomy's controlled
 * item-type vocabulary — that token is what lets `resolveChecks` reach an item's safety
 * gates. These tests pin the prompt contract and the parsing of the returned tags.
 */

import { getTaxonomyVocabulary, resolveChecks } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import {
  autoDetectListing,
  type OpenAIClientLike,
} from "../services/listing-auto-detect.service.js";

/** Capture the prompt the service sends, and reply with a canned tagger response. */
function fakeOpenAI(reply: { tags: string[] }) {
  const seen: { system?: string; user?: string } = {};
  const client: OpenAIClientLike = {
    chat: {
      completions: {
        create: async (args: unknown) => {
          const a = args as { messages: Array<{ role: string; content: unknown }> };
          for (const m of a.messages) {
            const text =
              typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
            if (m.role === "system") seen.system = text;
            if (m.role === "user") seen.user = text;
          }
          return {
            choices: [{ message: { content: JSON.stringify(reply) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    },
  };
  return { client, seen };
}

const INPUT = {
  photoUrl: "https://example.com/p.jpg",
  title: "iPhone 15 Pro 256GB",
  description: null,
};

describe("vision prompt — controlled item-type vocabulary", () => {
  it("injects the taxonomy vocabulary and an accessory rule into the system prompt", async () => {
    const { client, seen } = fakeOpenAI({ tags: ["iphone", "256gb"] });
    await autoDetectListing(INPUT, client);

    const sys = seen.system ?? "";
    expect(sys).toContain("ITEM-TYPE TAG");
    // Real safety-gate anchors must be offered to the model.
    for (const term of ["iphone", "mattress", "car-seat", "stroller", "office-chair"]) {
      expect(sys).toContain(term);
    }
    // The accessory rule prevents "iPhone case" → iphone gates.
    expect(sys).toContain("ACCESSORY RULE");
    expect(sys.toLowerCase()).toContain("is not that item");
  });

  it("offers only real taxonomy terms (no invented vocabulary)", async () => {
    const { client, seen } = fakeOpenAI({ tags: [] });
    await autoDetectListing(INPUT, client);
    const sys = seen.system ?? "";

    const vocab = getTaxonomyVocabulary();
    expect(vocab.length).toBeGreaterThan(100);
    // Every offered term must resolve to at least one real check (i.e. it is a live node).
    for (const term of ["iphone", "mattress", "car-seat"]) {
      expect(vocab).toContain(term);
      expect(resolveChecks([term]).length).toBeGreaterThan(0);
    }
    // The vocabulary block is rendered as a comma-separated list.
    expect(sys).toContain(vocab.slice(0, 3).join(", ").split(",")[0]!.trim());
  });

  it("keeps the prompt affordable (vocabulary is a bounded block)", async () => {
    const { client, seen } = fakeOpenAI({ tags: [] });
    await autoDetectListing(INPUT, client);
    // ~600 tokens of vocabulary is intentional; guard against unbounded growth.
    expect((seen.system ?? "").length).toBeLessThan(12_000);
  });

  it("returns the model's item-type tag so the taxonomy can resolve gates", async () => {
    const { client } = fakeOpenAI({
      tags: ["iphone", "256gb", "space-black"],
    });
    const result = await autoDetectListing(INPUT, client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tags).toContain("iphone");
    const hard = resolveChecks(["electronics", ...result.tags])
      .filter((c) => c.enforcement === "hard")
      .map((c) => c.id);
    expect(hard).toContain("imei_verification");
  });

  it("never throws on a provider failure — returns ok:false for the caller to degrade", async () => {
    const client: OpenAIClientLike = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("image unreachable");
          },
        },
      },
    };
    const result = await autoDetectListing(INPUT, client);
    expect(result.ok).toBe(false);
  });

  it("tolerates a malformed model response", async () => {
    const client: OpenAIClientLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: "not json" } }],
            usage: {},
          }),
        },
      },
    };
    const result = await autoDetectListing(INPUT, client);
    expect(result.ok).toBe(false);
  });
});
