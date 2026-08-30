import type { DisputeCase } from "@haggle/dispute-core";
import { describe, expect, it, vi } from "vitest";
import {
  buildDisputeAiCaseContextFromDispute,
  createDeepSeekDisputeAiProvider,
  type DisputeAiProvider,
  resolveDisputeAiModel,
  runCaseGuide,
  runResolutionAssessor,
} from "../services/dispute-ai.service.js";

const dispute: DisputeCase = {
  id: "dsp_1",
  order_id: "order_1",
  reason_code: "ITEM_NOT_AS_DESCRIBED",
  status: "UNDER_REVIEW",
  opened_by: "buyer",
  opened_at: "2026-05-05T00:00:00.000Z",
  evidence: [
    {
      id: "ev_buyer_summary",
      dispute_id: "dsp_1",
      submitted_by: "buyer",
      type: "text",
      text: "Battery was listed as 95% but arrived at 82%.",
      created_at: "2026-05-05T00:01:00.000Z",
    },
    {
      id: "ev_seller_summary",
      dispute_id: "dsp_1",
      submitted_by: "seller",
      type: "text",
      text: "It matched the listing at shipment.",
      created_at: "2026-05-05T00:02:00.000Z",
    },
    {
      id: "ev_buyer_camera",
      dispute_id: "dsp_1",
      submitted_by: "buyer",
      type: "image",
      text: "Camera evidence fixture",
      derived_artifacts: [
        {
          id: "ev_buyer_camera:visual:1",
          kind: "image_visual_observation",
          source_evidence_id: "ev_buyer_camera",
          text: "Battery health screen visibly reads 82%.",
          metadata: { category: "label_text", confidence: 0.94, provider: "vision.example" },
        },
      ],
      created_at: "2026-05-05T00:03:00.000Z",
    },
  ],
  metadata: {
    platform_id: "platform_1",
    external_order_id: "ext_1",
    transaction_snapshot: {
      amount_minor: 50_000,
      currency: "USD",
      status: "DELIVERED",
      metadata: {
        item_title: "Used phone",
        listed_condition: "Battery 95%",
      },
    },
  },
};

function providerWith(content: unknown): DisputeAiProvider {
  return {
    completeJson: vi.fn().mockResolvedValue({
      content: typeof content === "string" ? content : JSON.stringify(content),
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: null,
    }),
  };
}

describe("dispute AI API service", () => {
  it("builds dispute AI context from dispute metadata and evidence", () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute, {
      policy: { refund_cap_minor: 12_000 },
    });

    expect(context).toMatchObject({
      dispute_id: "dsp_1",
      platform_id: "platform_1",
      external_order_id: "ext_1",
      tier: 1,
      opened_by: "buyer",
      transaction: {
        amount_minor: 50_000,
        currency: "USD",
        status: "DELIVERED",
        item_title: "Used phone",
        listed_condition: "Battery 95%",
      },
      party_statements: {
        buyer: "Battery was listed as 95% but arrived at 82%.",
        seller: "It matched the listing at shipment.",
      },
      policy: { refund_cap_minor: 12_000 },
    });
    expect(context.evidence).toHaveLength(3);
    expect(context.evidence[2]?.derived_artifacts?.[0]).toMatchObject({
      kind: "image_visual_observation",
      text: "Battery health screen visibly reads 82%.",
    });
  });

  it("runs the Resolution Assessor and validates structured output", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute, {
      policy: { refund_cap_minor: 12_000 },
    });
    const provider = providerWith({
      schema_version: "dispute_ai_resolution_assessor_v2",
      role: "resolution_assessor",
      recommended_outcome: "partial_refund",
      confidence: "medium",
      buyer_score: 68,
      seller_score: 32,
      refund_amount_minor: 8_000,
      rationale:
        "구매자 증거는 상태 불일치를 뒷받침하지만 배송 당시 상태는 일부 입증되지 않았습니다.",
      evidence_findings: [
        {
          evidence_id: "ev_buyer_summary",
          supports: "buyer",
          weight: "medium",
          note: "구매자 진술은 주장된 상태 불일치와 일치합니다.",
        },
        {
          evidence_id: "ev_buyer_camera:visual:1",
          supports: "buyer",
          weight: "medium",
          note: "기계 시각 관찰은 배터리 화면의 82% 표시를 신뢰도 0.94로 확인했습니다.",
        },
      ],
      precedent_comparisons: [],
      missing_evidence: ["Timestamped device diagnostic"],
      risk_flags: [],
      escalation_required: false,
      next_actions: ["Offer a partial refund candidate."],
    });

    const result = await runResolutionAssessor(context, provider);

    expect(result).toMatchObject({
      ok: true,
      role: "resolution_assessor",
      displayName: "Resolution Assessor",
      schemaName: "dispute_ai_resolution_assessor_v2",
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: null,
    });
    expect(provider.completeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        system_prompt: expect.stringContaining("Resolution Assessor"),
        user_prompt: expect.stringContaining("<trusted_case_facts>"),
      }),
    );
  });

  it("repairs an otherwise valid English decision into an operator-facing Korean judgment", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute, {
      policy: { refund_cap_minor: 12_000 },
    });
    const base = {
      schema_version: "dispute_ai_resolution_assessor_v2",
      role: "resolution_assessor",
      recommended_outcome: "partial_refund",
      confidence: "medium",
      buyer_score: 68,
      seller_score: 32,
      refund_amount_minor: 8_000,
      evidence_findings: [
        {
          evidence_id: "ev_buyer_summary",
          supports: "buyer",
          weight: "medium",
          note: "Buyer statement supports the mismatch.",
        },
        {
          evidence_id: "ev_buyer_camera:visual:1",
          supports: "buyer",
          weight: "medium",
          note: "Machine observation reads 82 percent.",
        },
      ],
      precedent_comparisons: [],
      missing_evidence: [],
      risk_flags: [],
      escalation_required: false,
      next_actions: ["Offer a partial refund candidate."],
    };
    const provider: DisputeAiProvider = {
      completeJson: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({ ...base, rationale: "Buyer evidence supports a mismatch." }),
          model: "mock-model",
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            ...base,
            rationale: "구매자 증거가 상품 상태 불일치를 뒷받침합니다.",
            evidence_findings: [
              { ...base.evidence_findings[0], note: "구매자 진술이 상태 불일치를 뒷받침합니다." },
              {
                ...base.evidence_findings[1],
                note: "기계 시각 관찰은 82% 표시를 신뢰도 0.94로 확인했습니다.",
              },
            ],
          }),
          model: "mock-model",
        }),
    };
    const result = await runResolutionAssessor(context, provider);
    expect(result).toMatchObject({
      ok: true,
      output: {
        rationale: "구매자 증거가 상품 상태 불일치를 뒷받침합니다.",
      },
    });
    expect(provider.completeJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(provider.completeJson).mock.calls[1]?.[0].system_prompt).toContain(
      "Korean-language validation issue",
    );
  });

  it("rejects Resolution Assessor output that exceeds refund cap", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute, {
      policy: { refund_cap_minor: 5_000 },
    });
    const result = await runResolutionAssessor(
      context,
      providerWith({
        schema_version: "dispute_ai_resolution_assessor_v2",
        role: "resolution_assessor",
        recommended_outcome: "partial_refund",
        confidence: "medium",
        buyer_score: 70,
        seller_score: 30,
        refund_amount_minor: 8_000,
        rationale: "Partial refund.",
        evidence_findings: [],
        precedent_comparisons: [],
        missing_evidence: [],
        risk_flags: [],
        escalation_required: false,
        next_actions: ["Offer refund."],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_AI_OUTPUT",
      issues: expect.arrayContaining([expect.objectContaining({ path: "refund_amount_minor" })]),
    });
  });

  it("runs Case Guide for the selected party", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute);
    const result = await runCaseGuide(
      context,
      "seller",
      providerWith({
        schema_version: "dispute_ai_case_guide_v1",
        role: "case_guide",
        party: "seller",
        claim_summary: "Buyer claims a battery condition mismatch.",
        message: "Provide verifiable shipment-time evidence.",
        evidence_requests: ["Pre-shipment diagnostic screenshot"],
        risk_flags: [],
        next_actions: ["Upload diagnostic evidence."],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      role: "case_guide",
      displayName: "Case Guide",
      output: { party: "seller" },
    });
  });

  it("rejects Case Guide output for the wrong party", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute);
    const result = await runCaseGuide(
      context,
      "seller",
      providerWith({
        schema_version: "dispute_ai_case_guide_v1",
        role: "case_guide",
        party: "buyer",
        claim_summary: "Buyer claim.",
        message: "Upload evidence.",
        evidence_requests: [],
        risk_flags: [],
        next_actions: [],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_AI_OUTPUT",
      issues: expect.arrayContaining([expect.objectContaining({ path: "party" })]),
    });
  });

  it("returns INVALID_JSON when the provider emits malformed content", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute);
    const result = await runCaseGuide(context, "buyer", providerWith("not json"));

    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_JSON",
    });
    expect(result).not.toHaveProperty("rawContent");
  });

  it("returns PROVIDER_ERROR when the provider fails", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute);
    const provider: DisputeAiProvider = {
      completeJson: vi.fn().mockRejectedValue(new Error("model unavailable")),
    };

    await expect(runCaseGuide(context, "buyer", provider)).resolves.toMatchObject({
      ok: false,
      error: "PROVIDER_ERROR",
      message: "model unavailable",
    });
  });

  it("uses a stronger default model for Resolution Assessor than Case Guide", () => {
    expect(resolveDisputeAiModel("resolution_assessor")).toBe("deepseek-v4-pro");
    expect(resolveDisputeAiModel("case_guide")).toBe("deepseek-v4-flash");
  });

  it("allows role-specific dispute AI model overrides", async () => {
    const calls: Array<{
      role: string;
      model?: string;
      maxTokens?: number;
      thinking?: unknown;
      reasoningEffort?: unknown;
    }> = [];
    const provider = createDeepSeekDisputeAiProvider({
      caseGuideModel: "deepseek-v4-flash",
      resolutionAssessorModel: "deepseek-v4-pro",
    });
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.DEEPSEEK_API_KEY;
    const originalTelemetry = process.env.LLM_TELEMETRY;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        model?: string;
        messages?: Array<{ content: string }>;
      };
      calls.push({
        role: body.messages?.[0]?.content.includes("Resolution Assessor")
          ? "resolution_assessor"
          : "case_guide",
        model: body.model,
        maxTokens: (body as Record<string, unknown>).max_tokens as number | undefined,
        thinking: (body as Record<string, unknown>).thinking,
        reasoningEffort: (body as Record<string, unknown>).reasoning_effort,
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
        }),
        { status: 200 },
      );
    });
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.LLM_TELEMETRY = "0";

    try {
      await provider.completeJson({
        role: "case_guide",
        display_name: "Case Guide",
        schema_name: "dispute_ai_case_guide_v1",
        context_hash: "hash",
        system_prompt: "Role: Case Guide.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });
      await provider.completeJson({
        role: "resolution_assessor",
        display_name: "Resolution Assessor",
        schema_name: "dispute_ai_resolution_assessor_v2",
        context_hash: "hash",
        system_prompt: "Role: Resolution Assessor.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalApiKey;
      if (originalTelemetry === undefined) delete process.env.LLM_TELEMETRY;
      else process.env.LLM_TELEMETRY = originalTelemetry;
    }

    expect(calls).toEqual([
      {
        role: "case_guide",
        model: "deepseek-v4-flash",
        maxTokens: 1600,
        thinking: undefined,
        reasoningEffort: undefined,
      },
      {
        role: "resolution_assessor",
        model: "deepseek-v4-pro",
        maxTokens: 4096,
        thinking: undefined,
        reasoningEffort: undefined,
      },
    ]);
  });

  it("allows role-specific dispute AI token limit overrides", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.DEEPSEEK_API_KEY;
    const originalCaseGuideLimit = process.env.DISPUTE_AI_CASE_GUIDE_MAX_TOKENS;
    const originalResolutionLimit = process.env.DISPUTE_AI_RESOLUTION_ASSESSOR_MAX_TOKENS;
    const tokenLimits: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { max_tokens: number };
      tokenLimits.push(body.max_tokens);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      );
    });
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DISPUTE_AI_CASE_GUIDE_MAX_TOKENS = "2000";
    process.env.DISPUTE_AI_RESOLUTION_ASSESSOR_MAX_TOKENS = "5000";

    try {
      const provider = createDeepSeekDisputeAiProvider();
      await provider.completeJson({
        role: "case_guide",
        display_name: "Case Guide",
        schema_name: "dispute_ai_case_guide_v1",
        context_hash: "hash",
        system_prompt: "Role: Case Guide.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });
      await provider.completeJson({
        role: "resolution_assessor",
        display_name: "Resolution Assessor",
        schema_name: "dispute_ai_resolution_assessor_v2",
        context_hash: "hash",
        system_prompt: "Role: Resolution Assessor.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalApiKey;
      if (originalCaseGuideLimit === undefined) delete process.env.DISPUTE_AI_CASE_GUIDE_MAX_TOKENS;
      else process.env.DISPUTE_AI_CASE_GUIDE_MAX_TOKENS = originalCaseGuideLimit;
      if (originalResolutionLimit === undefined)
        delete process.env.DISPUTE_AI_RESOLUTION_ASSESSOR_MAX_TOKENS;
      else process.env.DISPUTE_AI_RESOLUTION_ASSESSOR_MAX_TOKENS = originalResolutionLimit;
    }

    expect(tokenLimits).toEqual([2000, 5000]);
  });

  it("estimates dispute AI provider cost from returned usage", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.DEEPSEEK_API_KEY;
    const originalTelemetry = process.env.LLM_TELEMETRY;
    const originalInputPrice = process.env.LLM_PRICE_DEEPSEEK_V4_PRO_INPUT_PER_1M_USD;
    const originalOutputPrice = process.env.LLM_PRICE_DEEPSEEK_V4_PRO_OUTPUT_PER_1M_USD;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
        }),
        { status: 200 },
      ),
    );
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.LLM_TELEMETRY = "0";
    process.env.LLM_PRICE_DEEPSEEK_V4_PRO_INPUT_PER_1M_USD = "0.55";
    process.env.LLM_PRICE_DEEPSEEK_V4_PRO_OUTPUT_PER_1M_USD = "2.19";

    try {
      const response = await createDeepSeekDisputeAiProvider({
        resolutionAssessorModel: "deepseek-v4-pro",
      }).completeJson({
        role: "resolution_assessor",
        display_name: "Resolution Assessor",
        schema_name: "dispute_ai_resolution_assessor_v2",
        context_hash: "hash",
        system_prompt: "Role: Resolution Assessor.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });

      expect(response.cost.model).toBe("deepseek-v4-pro");
      expect(response.cost.outputUsd).toBeCloseTo(2.19);
      expect(response.cost.totalUsd).toBeGreaterThan(0);
      expect(response.cost.costMinorUsd).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalApiKey;
      if (originalTelemetry === undefined) delete process.env.LLM_TELEMETRY;
      else process.env.LLM_TELEMETRY = originalTelemetry;
      if (originalInputPrice === undefined)
        delete process.env.LLM_PRICE_DEEPSEEK_V4_PRO_INPUT_PER_1M_USD;
      else process.env.LLM_PRICE_DEEPSEEK_V4_PRO_INPUT_PER_1M_USD = originalInputPrice;
      if (originalOutputPrice === undefined)
        delete process.env.LLM_PRICE_DEEPSEEK_V4_PRO_OUTPUT_PER_1M_USD;
      else process.env.LLM_PRICE_DEEPSEEK_V4_PRO_OUTPUT_PER_1M_USD = originalOutputPrice;
    }
  });
});
