/**
 * Listing Auto-Detect Service.
 *
 * Given a draft listing's photo URL + title (+ optional description),
 * calls GPT-4o-mini (vision) to propose 4–8 lowercase-hyphenated
 * descriptive tags.
 *
 * Pure LLM layer. No DB reads/writes. Never throws — failures returned
 * as `{ ok: false, error }`.
 */

import { getTaxonomyVocabulary } from "@haggle/shared";
import OpenAI from "openai";
import { usageExtractors, withLLMTelemetry } from "../lib/llm-telemetry.js";

export interface AutoDetectInput {
  photoUrl: string;
  title: string;
  description?: string | null;
}

export interface AutoDetectSuccess {
  ok: true;
  tags: string[];
  modelVersion: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface AutoDetectFailure {
  ok: false;
  error: {
    code: "OPENAI_ERROR" | "INVALID_JSON" | "TIMEOUT" | "EMPTY_RESPONSE";
    message: string;
  };
  modelVersion: string;
  latencyMs?: number;
}

export type AutoDetectResult = AutoDetectSuccess | AutoDetectFailure;

export const AUTO_DETECT_MODEL_DEFAULT = "gpt-4o-mini";
const MAX_TAGS = 8;

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export interface OpenAIClientLike {
  chat: {
    completions: {
      create: (args: unknown) => Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>;
    };
  };
}

/**
 * Controlled item-type vocabulary from the negotiation taxonomy. The tags we get back are
 * what `resolveChecks` uses to reach an item's safety gates (mattress → bed bugs,
 * car-seat → expiration/crash, iphone → IMEI), so the tagger is steered to name the item
 * using one of these terms. Descriptive attributes stay free-form.
 */
const ITEM_TYPE_VOCABULARY = getTaxonomyVocabulary();

const SYSTEM_PROMPT = `You analyze marketplace listings. Given a product photo, title, and optional description, propose descriptive tags.

Tag rules:
- 4 to 8 tags total
- lowercase-hyphenated (e.g. "256gb", "space-black", "minor-scratches", "with-charger")
- focus on objectively visible / known attributes: model/generation, storage, color, condition cues, included accessories
- do NOT invent specs you cannot verify from the photo + text
- do NOT include carrier lock status (unlocked, locked, carrier-locked, etc.) — this is collected separately
- prefer specific over generic ("iphone-15-pro" over just "smartphone")

ITEM-TYPE TAG (important):
- In addition to the descriptive tags, include ONE tag naming what the item IS, chosen from this list when one genuinely applies:
${ITEM_TYPE_VOCABULARY.join(", ")}
- Pick the most specific match (e.g. "iphone" over "phones", "mattress" over "furniture").
- If nothing in the list genuinely applies, omit it — never force a match.
- ACCESSORY RULE: a case/cover/stand/mount/charger/cable/strap FOR an item is NOT that item. For "iPhone case" do NOT emit "iphone"; for "TV stand" do NOT emit "television".`;

function buildUserPrompt(input: AutoDetectInput): string {
  const parts = [
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description.slice(0, 500)}` : null,
    "",
    "Return JSON matching the schema.",
  ];
  return parts.filter((p): p is string => p !== null).join("\n");
}

export async function autoDetectListing(
  input: AutoDetectInput,
  openai?: OpenAIClientLike,
): Promise<AutoDetectResult> {
  const modelVersion = process.env.AUTO_DETECT_MODEL || AUTO_DETECT_MODEL_DEFAULT;

  const startedAt = Date.now();

  try {
    // Constructed INSIDE the try: the OpenAI constructor throws when OPENAI_API_KEY is
    // missing, and this service's contract is "never throws" — the caller degrades on
    // `{ ok: false }` and still applies deterministic tag enrichment.
    const client: OpenAIClientLike = openai ?? (getOpenAI() as OpenAIClientLike);
    const resp = await withLLMTelemetry(
      {
        service: "openai.chat",
        model: modelVersion,
        operation: "listing-auto-detect",
        correlationId: null,
      },
      () =>
        client.chat.completions.create({
          model: modelVersion,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: buildUserPrompt(input) },
                { type: "image_url", image_url: { url: input.photoUrl } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "listing_auto_detect",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  tags: {
                    type: "array",
                    items: {
                      type: "string",
                      pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
                    },
                    minItems: 1,
                    maxItems: MAX_TAGS,
                  },
                },
                required: ["tags"],
                additionalProperties: false,
              },
            },
          },
        }),
      { extractUsage: usageExtractors.openaiChat },
    );

    const latencyMs = Date.now() - startedAt;
    const tokensIn = resp.usage?.prompt_tokens ?? 0;
    const tokensOut = resp.usage?.completion_tokens ?? 0;

    const content = resp.choices?.[0]?.message?.content;
    if (content == null || content === "") {
      return {
        ok: false,
        error: { code: "EMPTY_RESPONSE", message: "Empty response from LLM" },
        modelVersion,
        latencyMs,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        ok: false,
        error: { code: "INVALID_JSON", message: "Failed to parse LLM JSON" },
        modelVersion,
        latencyMs,
      };
    }

    const obj = parsed as { tags?: unknown };
    const tags = Array.isArray(obj.tags)
      ? (obj.tags as unknown[])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t))
          .slice(0, MAX_TAGS)
      : [];

    return {
      ok: true,
      tags,
      modelVersion,
      tokensIn,
      tokensOut,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|timed out/i.test(message);
    return {
      ok: false,
      error: {
        code: isTimeout ? "TIMEOUT" : "OPENAI_ERROR",
        message,
      },
      modelVersion,
      latencyMs,
    };
  }
}
