/**
 * Tag Placement LLM Service — L4~L6 of the tag placement pipeline.
 *
 * Given a set of candidate tags (from Step 51's gatherTagCandidates),
 * this module:
 *
 *   L4. Assigns ref ids (t01..t20) and assembles the prompt.
 *   L5. Calls GPT-4o-mini with strict JSON schema output.
 *   L6. Resolves selected refs back to real tag UUIDs, silently
 *       dropping any ref that isn't in the candidate set.
 *
 * Pure LLM layer. No DB reads/writes. Never throws — all failures
 * are returned as `{ ok: false, error, modelVersion, ... }` so the
 * orchestrator (Step 53) can branch on them.
 *
 * Step 52 — see handoff/ARCHITECT-BRIEF.md and
 * docs/features/tag-system-design.md §4.
 *
 * Step 61 — prompt externalized to `../prompts/tag-placement/**`;
 *           telemetry wired via `withLLMTelemetry`. See
 *           handoff/ARCHITECT-BRIEF-step60-62.md §Step 61.
 */

// TODO(step63): Semantic rerank of candidates via tag embeddings.
// Depends on a new `tag_embeddings` table (not yet in schema).
// Current candidate order comes from gatherTagCandidates (idf + similar
// listings + ngram overlap) which is acceptable for MVP. See
// handoff/ARCHITECT-BRIEF-step60-62.md §Step 61 decision 2.

import OpenAI from "openai";
import {
  withLLMTelemetry,
  usageExtractors,
} from "../lib/llm-telemetry.js";
import {
  TAG_PLACEMENT_SYSTEM_PROMPT,
  selectFewShots,
  toChatMessages,
} from "../prompts/tag-placement/index.js";
import type { TagCandidate } from "./tag-candidate.service.js";

// ─── Public types ────────────────────────────────────────────────────

export interface LlmPlacementInput {
  title: string;
  description: string;
  category: string | null;
  priceBand?: string | null;
  /** Already capped to 20 by orchestrator L3 (defensive cap here too). */
  candidates: TagCandidate[];
}

export interface LlmPlacementSuccess {
  ok: true;
  selectedTagIds: string[];
  reasoning: string;
  missingTags: string[];
  modelVersion: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LlmPlacementFailure {
  ok: false;
  error: {
    code:
      | "NO_CANDIDATES"
      | "OPENAI_ERROR"
      | "INVALID_JSON"
      | "TIMEOUT"
      | "EMPTY_SELECTION"
      | "ALL_REFS_INVALID";
    message: string;
  };
  modelVersion: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export type LlmPlacementResult = LlmPlacementSuccess | LlmPlacementFailure;

// ─── Constants ───────────────────────────────────────────────────────

export const TAG_PLACEMENT_MODEL_DEFAULT = "gpt-4o-mini-2024-07-18";
export const TAG_PLACEMENT_MAX_CANDIDATES = 20;

// ─── OpenAI client (lazy init, mirrors embedding.service.ts) ────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

/**
 * Minimal structural type for the OpenAI client surface we need.
 * Lets test suites inject a fake client without pulling the full SDK.
 */
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

// ─── Ref id mapping (L4) ─────────────────────────────────────────────

/**
 * Build the ref map: candidates[i] → "t01".."t20".
 * Parent display is only rendered when the parent tag id is itself
 * in the candidate set (LLM cannot pick it otherwise).
 */
export function buildRefMap(candidates: TagCandidate[]): {
  refToId: Map<string, string>;
  idToRef: Map<string, string>;
  lines: string[];
} {
  const limited = candidates.slice(0, TAG_PLACEMENT_MAX_CANDIDATES);
  const refToId = new Map<string, string>();
  const idToRef = new Map<string, string>();

  // First pass — assign refs to all ids so parent lookups can resolve.
  limited.forEach((cand, i) => {
    const ref = `t${String(i + 1).padStart(2, "0")}`;
    refToId.set(ref, cand.id);
    idToRef.set(cand.id, ref);
  });

  // Second pass — format display lines with in-set parent refs.
  const lines: string[] = limited.map((cand, i) => {
    const ref = `t${String(i + 1).padStart(2, "0")}`;
    const parentRefs = cand.parentIds
      .map((pid) => idToRef.get(pid))
      .filter((r): r is string => r !== undefined);
    const parentStr =
      parentRefs.length > 0 ? `, parent=${parentRefs.join(",")}` : "";
    return `${ref} ${cand.label} [idf=${cand.idf.toFixed(1)}${parentStr}]`;
  });

  return { refToId, idToRef, lines };
}

// ─── User message assembly ───────────────────────────────────────────

function buildUserMessage(
  input: LlmPlacementInput,
  refLines: string[],
): string {
  const desc = (input.description ?? "").slice(0, 300);
  const parts: Array<string | null> = [
    "LISTING:",
    `title: ${input.title}`,
    `description: ${desc}`,
    `category_path: ${input.category ?? "(none)"}`,
    input.priceBand ? `price_band: ${input.priceBand}` : null,
    "",
    "CANDIDATES:",
    ...refLines,
    "",
    "Return JSON matching the schema.",
  ];
  return parts.filter((x): x is string => x !== null).join("\n");
}

// ─── Output resolution (L6) — pure function ──────────────────────────

/**
 * Pure, I/O-free normalization of the raw LLM JSON payload. Drops
 * invalid refs silently. Never throws.
 */
export function resolveLlmOutput(
  rawJson: {
    selected_tag_ids: unknown;
    reasoning: unknown;
    missing_tags: unknown;
  },
  refToId: Map<string, string>,
): { selectedTagIds: string[]; reasoning: string; missingTags: string[] } {
  const selectedRefs = Array.isArray(rawJson?.selected_tag_ids)
    ? (rawJson.selected_tag_ids as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];
  const selectedTagIds = selectedRefs
    .map((ref) => refToId.get(ref))
    .filter((id): id is string => id !== undefined);

  const reasoning =
    typeof rawJson?.reasoning === "string" ? (rawJson.reasoning as string) : "";

  const missingTags = Array.isArray(rawJson?.missing_tags)
    ? (rawJson.missing_tags as unknown[])
        .filter((t): t is string => typeof t === "string")
        .slice(0, 2)
    : [];

  return { selectedTagIds, reasoning, missingTags };
}

// ─── Main entry (L5) ─────────────────────────────────────────────────

/**
 * Call GPT-4o-mini with the candidate set, parse and validate.
 *
 * Never throws. All error paths return `LlmPlacementFailure`.
 *
 * @param input  — the listing context + candidate pool
 * @param openai — optional injected client (for tests). Defaults to
 *                 the module-level lazy singleton.
 */
export async function placeTagsWithLlm(
  input: LlmPlacementInput,
  openai?: OpenAIClientLike,
): Promise<LlmPlacementResult> {
  const modelVersion =
    process.env.TAG_PLACEMENT_MODEL || TAG_PLACEMENT_MODEL_DEFAULT;

  if (input.candidates.length === 0) {
    return {
      ok: false,
      error: { code: "NO_CANDIDATES", message: "No candidates provided" },
      modelVersion,
    };
  }

  const { refToId, lines } = buildRefMap(input.candidates);
  const userMessage = buildUserMessage(input, lines);

  const client: OpenAIClientLike = openai ?? (getOpenAI() as OpenAIClientLike);

  const fewShotExamples = selectFewShots(input.category);
  const fewShotMessages = toChatMessages(fewShotExamples);

  const startedAt = Date.now();
  try {
    const resp = await withLLMTelemetry(
      {
        service: "openai.chat",
        model: modelVersion,
        operation: "tag-placement",
        correlationId: null,
      },
      () =>
        client.chat.completions.create({
      model: modelVersion,
      temperature: 0,
      messages: [
        { role: "system", content: TAG_PLACEMENT_SYSTEM_PROMPT },
        ...fewShotMessages,
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tag_selection",
          strict: true,
          schema: {
            type: "object",
            properties: {
              selected_tag_ids: {
                type: "array",
                items: { type: "string", pattern: "^t[0-9]{2}$" },
                minItems: 1,
                maxItems: 6,
              },
              reasoning: { type: "string", maxLength: 200 },
              missing_tags: {
                type: "array",
                items: { type: "string" },
                maxItems: 2,
              },
            },
            required: ["selected_tag_ids", "reasoning", "missing_tags"],
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
        error: { code: "EMPTY_SELECTION", message: "Empty response from LLM" },
        modelVersion,
        tokensIn,
        tokensOut,
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
        tokensIn,
        tokensOut,
        latencyMs,
      };
    }

    const resolved = resolveLlmOutput(
      parsed as {
        selected_tag_ids: unknown;
        reasoning: unknown;
        missing_tags: unknown;
      },
      refToId,
    );

    if (resolved.selectedTagIds.length === 0) {
      return {
        ok: false,
        error: {
          code: "ALL_REFS_INVALID",
          message: "No valid refs in LLM selection",
        },
        modelVersion,
        tokensIn,
        tokensOut,
        latencyMs,
      };
    }

    return {
      ok: true,
      selectedTagIds: resolved.selectedTagIds,
      reasoning: resolved.reasoning,
      missingTags: resolved.missingTags,
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
