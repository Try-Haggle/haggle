/**
 * Unit tests for tag-placement-llm.service (Step 52).
 *
 * Covers the 16 cases listed in handoff/ARCHITECT-BRIEF.md §Tests.
 *
 * The OpenAI SDK is mocked at the module level via `vi.mock("openai", ...)`
 * so no real API calls happen. In addition, `placeTagsWithLlm` accepts an
 * optional `openai` argument (OpenAIClientLike) which tests use to inject
 * per-case fake responses.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock the openai SDK at module load time ─────────────────────────
// The service only reads OPENAI_API_KEY at lazy-init time; we stub the
// default export to a class whose instances expose the same chat shape
// the service expects. Tests inject their own client via the optional
// 2nd arg, but this guarantees the module-level singleton can never
// make a real network call if it were ever invoked.
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockRejectedValue(
          new Error("module-level fake client must not be used in tests"),
        ),
      },
    };
    constructor(_opts?: unknown) {}
  }
  return { default: FakeOpenAI };
});

// Override @haggle/db mock from setup.ts (service doesn't use it, but
// setup.ts mocks it globally, so no additional stubbing is needed).

import {
  buildRefMap,
  placeTagsWithLlm,
  resolveLlmOutput,
  TAG_PLACEMENT_MAX_CANDIDATES,
  TAG_PLACEMENT_MODEL_DEFAULT,
  type OpenAIClientLike,
} from "../services/tag-placement-llm.service.js";
import type { TagCandidate } from "../services/tag-candidate.service.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function cand(
  partial: Partial<TagCandidate> & { id: string; label: string },
): TagCandidate {
  return {
    id: partial.id,
    label: partial.label,
    normalizedLabel: partial.normalizedLabel ?? partial.label.toLowerCase(),
    idf: partial.idf ?? 1.0,
    parentIds: partial.parentIds ?? [],
    source: partial.source ?? ["idf"],
  };
}

function makeFakeClient(
  response: {
    content?: string | null;
    tokensIn?: number;
    tokensOut?: number;
    throwError?: Error;
  } = {},
): { client: OpenAIClientLike; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => {
    if (response.throwError) throw response.throwError;
    return {
      choices: [
        { message: { content: response.content ?? null } },
      ],
      usage: {
        prompt_tokens: response.tokensIn ?? 100,
        completion_tokens: response.tokensOut ?? 20,
      },
    };
  });
  const client: OpenAIClientLike = {
    chat: { completions: { create } },
  };
  return { client, create };
}

const baseInput = {
  title: "Test Listing",
  description: "A test listing for tag placement",
  category: "electronics",
};

// ─── buildRefMap ─────────────────────────────────────────────────────

describe("buildRefMap", () => {
  it("maps 3 candidates to t01/t02/t03 with bidirectional lookup", () => {
    const candidates = [
      cand({ id: "id-a", label: "apple", idf: 3.2 }),
      cand({ id: "id-b", label: "banana", idf: 2.1 }),
      cand({ id: "id-c", label: "cherry", idf: 1.5 }),
    ];
    const { refToId, idToRef, lines } = buildRefMap(candidates);

    expect(refToId.get("t01")).toBe("id-a");
    expect(refToId.get("t02")).toBe("id-b");
    expect(refToId.get("t03")).toBe("id-c");
    expect(idToRef.get("id-a")).toBe("t01");
    expect(idToRef.get("id-b")).toBe("t02");
    expect(idToRef.get("id-c")).toBe("t03");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("t01 apple");
  });

  it("caps at TAG_PLACEMENT_MAX_CANDIDATES (20)", () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      cand({ id: `id-${i}`, label: `tag-${i}`, idf: i }),
    );
    const { refToId, lines } = buildRefMap(candidates);

    expect(refToId.size).toBe(TAG_PLACEMENT_MAX_CANDIDATES);
    expect(lines).toHaveLength(TAG_PLACEMENT_MAX_CANDIDATES);
    expect(refToId.get("t20")).toBe("id-19");
    expect(refToId.get("t21")).toBeUndefined();
  });

  it("renders parent refs only when the parent is in the same candidate set", () => {
    const candidates = [
      cand({
        id: "id-child",
        label: "iphone-17-pro",
        idf: 4.2,
        parentIds: ["id-parent-in", "id-parent-out"],
      }),
      cand({ id: "id-parent-in", label: "iphone-17", idf: 3.8 }),
      cand({ id: "id-other", label: "sealed", idf: 3.5 }),
    ];
    const { lines } = buildRefMap(candidates);

    // id-parent-in is t02; id-parent-out is NOT in the set, so it must
    // not show up in the display.
    expect(lines[0]).toContain("parent=t02");
    expect(lines[0]).not.toContain("id-parent-out");
    // The parent-less entry must not carry a parent= suffix.
    expect(lines[2]).not.toContain("parent=");
  });

  it("formats idf with exactly one decimal place", () => {
    const candidates = [
      cand({ id: "id-a", label: "alpha", idf: 3.17 }),
      cand({ id: "id-b", label: "beta", idf: 2 }),
      cand({ id: "id-c", label: "gamma", idf: 0.456 }),
    ];
    const { lines } = buildRefMap(candidates);

    expect(lines[0]).toContain("idf=3.2");
    expect(lines[1]).toContain("idf=2.0");
    expect(lines[2]).toContain("idf=0.5");
  });
});

// ─── resolveLlmOutput ────────────────────────────────────────────────

describe("resolveLlmOutput", () => {
  const refToId = new Map<string, string>([
    ["t01", "uuid-a"],
    ["t02", "uuid-b"],
    ["t03", "uuid-c"],
  ]);

  it("maps a well-formed payload correctly", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01", "t02"],
        reasoning: "because reasons",
        proposed_tags: [
          { label: "extra-tag", category: "feature", reason: "needed" },
        ],
      },
      refToId,
    );
    expect(out.selectedTagIds).toEqual(["uuid-a", "uuid-b"]);
    expect(out.reasoning).toBe("because reasons");
    expect(out.proposedTags).toEqual([
      { label: "extra-tag", category: "feature", reason: "needed" },
    ]);
  });

  it("drops invalid refs while keeping the valid ones", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01", "t99", "t02"],
        reasoning: "x",
        proposed_tags: [],
      },
      refToId,
    );
    expect(out.selectedTagIds).toEqual(["uuid-a", "uuid-b"]);
  });

  it("returns [] when selected_tag_ids is not an array", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: "t01",
        reasoning: "x",
        proposed_tags: [],
      },
      refToId,
    );
    expect(out.selectedTagIds).toEqual([]);
  });

  it("truncates proposed_tags to max 3 entries", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: "x",
        proposed_tags: [
          { label: "a", category: "feature", reason: "r1" },
          { label: "b", category: "style", reason: "r2" },
          { label: "c", category: "size", reason: "r3" },
          { label: "d", category: "other", reason: "r4" },
        ],
      },
      refToId,
    );
    expect(out.proposedTags).toHaveLength(3);
  });

  it("coerces non-string reasoning to empty string", () => {
    const out = resolveLlmOutput(
      {
        selected_tag_ids: ["t01"],
        reasoning: 42,
        proposed_tags: [],
      },
      refToId,
    );
    expect(out.reasoning).toBe("");
  });
});

// ─── placeTagsWithLlm ────────────────────────────────────────────────

describe("placeTagsWithLlm", () => {
  beforeEach(() => {
    delete process.env.TAG_PLACEMENT_MODEL;
  });

  const threeCandidates: TagCandidate[] = [
    cand({ id: "uuid-a", label: "apple", idf: 3.2 }),
    cand({ id: "uuid-b", label: "banana", idf: 2.1 }),
    cand({ id: "uuid-c", label: "cherry", idf: 1.5 }),
  ];

  it("returns NO_CANDIDATES when the candidate list is empty", async () => {
    const { client, create } = makeFakeClient();
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: [] },
      client,
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("NO_CANDIDATES");
      expect(res.modelVersion).toBe(TAG_PLACEMENT_MODEL_DEFAULT);
    }
    // Mock API must not have been called.
    expect(create).not.toHaveBeenCalled();
  });

  it("returns ok:true with resolved uuids on a valid LLM response", async () => {
    const { client, create } = makeFakeClient({
      content: JSON.stringify({
        selected_tag_ids: ["t01", "t03"],
        reasoning: "picked most specific",
        proposed_tags: [],
      }),
      tokensIn: 250,
      tokensOut: 30,
    });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok === true) {
      expect(res.selectedTagIds).toEqual(["uuid-a", "uuid-c"]);
      expect(res.reasoning).toBe("picked most specific");
      expect(res.modelVersion).toBe(TAG_PLACEMENT_MODEL_DEFAULT);
    }

    // Verify strict JSON schema + temperature are set on the call.
    const callArg = create.mock.calls[0][0] as {
      temperature: number;
      response_format: {
        type: string;
        json_schema: { strict: boolean };
      };
      messages: Array<{ role: string }>;
    };
    expect(callArg.temperature).toBe(0);
    expect(callArg.response_format.type).toBe("json_schema");
    expect(callArg.response_format.json_schema.strict).toBe(true);
    // System → few-shot → user ordering.
    expect(callArg.messages[0].role).toBe("system");
    expect(callArg.messages[callArg.messages.length - 1].role).toBe("user");
  });

  it("returns OPENAI_ERROR when the client throws a generic error", async () => {
    const { client } = makeFakeClient({
      throwError: new Error("network boom"),
    });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("OPENAI_ERROR");
      expect(res.error.message).toContain("network boom");
      expect(res.modelVersion).toBe(TAG_PLACEMENT_MODEL_DEFAULT);
    }
  });

  it("returns TIMEOUT when the thrown error message mentions timeout", async () => {
    const { client } = makeFakeClient({
      throwError: new Error("Request timed out after 30s"),
    });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("TIMEOUT");
    }
  });

  it("returns EMPTY_SELECTION when the response content is nullish", async () => {
    const { client } = makeFakeClient({ content: null });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("EMPTY_SELECTION");
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns INVALID_JSON when the response content is malformed", async () => {
    const { client } = makeFakeClient({
      content: "{not-json",
      tokensIn: 200,
      tokensOut: 5,
    });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("INVALID_JSON");
      expect(res.tokensIn).toBe(200);
      expect(res.tokensOut).toBe(5);
    }
  });

  it("returns ALL_REFS_INVALID when every returned ref is outside the candidate set", async () => {
    const { client } = makeFakeClient({
      content: JSON.stringify({
        selected_tag_ids: ["t88", "t99"],
        reasoning: "ghost refs",
        proposed_tags: [],
      }),
    });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.error.code).toBe("ALL_REFS_INVALID");
    }
  });

  it("records tokensIn, tokensOut, and latencyMs on success", async () => {
    const { client } = makeFakeClient({
      content: JSON.stringify({
        selected_tag_ids: ["t02"],
        reasoning: "r",
        proposed_tags: [],
      }),
      tokensIn: 512,
      tokensOut: 17,
    });
    const res = await placeTagsWithLlm(
      { ...baseInput, candidates: threeCandidates },
      client,
    );
    expect(res.ok).toBe(true);
    if (res.ok === true) {
      expect(res.tokensIn).toBe(512);
      expect(res.tokensOut).toBe(17);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(res.modelVersion).toBe(TAG_PLACEMENT_MODEL_DEFAULT);
    }
  });
});
