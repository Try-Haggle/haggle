import { describe, expect, it, vi } from "vitest";
import type { DisputeCase } from "@haggle/dispute-core";
import {
  buildDisputeAiCaseContextFromDispute,
  createXaiDisputeAiProvider,
  resolveDisputeAiModel,
  runCaseGuide,
  runResolutionAssessor,
  type DisputeAiProvider,
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
    expect(context.evidence).toHaveLength(2);
  });

  it("runs the Resolution Assessor and validates structured output", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute, {
      policy: { refund_cap_minor: 12_000 },
    });
    const provider = providerWith({
      schema_version: "dispute_ai_resolution_assessor_v1",
      role: "resolution_assessor",
      recommended_outcome: "partial_refund",
      confidence: "medium",
      buyer_score: 68,
      seller_score: 32,
      refund_amount_minor: 8_000,
      rationale: "Buyer evidence supports a condition mismatch but shipment-time state is partially unproven.",
      evidence_findings: [
        {
          evidence_id: "ev_buyer_summary",
          supports: "buyer",
          weight: "medium",
          note: "Buyer statement matches the claimed condition mismatch.",
        },
      ],
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
      schemaName: "dispute_ai_resolution_assessor_v1",
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: null,
    });
    expect(provider.completeJson).toHaveBeenCalledWith(expect.objectContaining({
      system_prompt: expect.stringContaining("Resolution Assessor"),
      user_prompt: expect.stringContaining("<trusted_case_facts>"),
    }));
  });

  it("rejects Resolution Assessor output that exceeds refund cap", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute, {
      policy: { refund_cap_minor: 5_000 },
    });
    const result = await runResolutionAssessor(context, providerWith({
      schema_version: "dispute_ai_resolution_assessor_v1",
      role: "resolution_assessor",
      recommended_outcome: "partial_refund",
      confidence: "medium",
      buyer_score: 70,
      seller_score: 30,
      refund_amount_minor: 8_000,
      rationale: "Partial refund.",
      evidence_findings: [],
      missing_evidence: [],
      risk_flags: [],
      escalation_required: false,
      next_actions: ["Offer refund."],
    }));

    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_AI_OUTPUT",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "refund_amount_minor" }),
      ]),
    });
  });

  it("runs Case Guide for the selected party", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute);
    const result = await runCaseGuide(context, "seller", providerWith({
      schema_version: "dispute_ai_case_guide_v1",
      role: "case_guide",
      party: "seller",
      claim_summary: "Buyer claims a battery condition mismatch.",
      message: "Provide verifiable shipment-time evidence.",
      evidence_requests: ["Pre-shipment diagnostic screenshot"],
      risk_flags: [],
      next_actions: ["Upload diagnostic evidence."],
    }));

    expect(result).toMatchObject({
      ok: true,
      role: "case_guide",
      displayName: "Case Guide",
      output: { party: "seller" },
    });
  });

  it("rejects Case Guide output for the wrong party", async () => {
    const context = buildDisputeAiCaseContextFromDispute(dispute);
    const result = await runCaseGuide(context, "seller", providerWith({
      schema_version: "dispute_ai_case_guide_v1",
      role: "case_guide",
      party: "buyer",
      claim_summary: "Buyer claim.",
      message: "Upload evidence.",
      evidence_requests: [],
      risk_flags: [],
      next_actions: [],
    }));

    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_AI_OUTPUT",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "party" }),
      ]),
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
    expect(resolveDisputeAiModel("resolution_assessor")).toBe("grok-4.3");
    expect(resolveDisputeAiModel("case_guide")).toBe("grok-4-fast");
  });

  it("allows role-specific dispute AI model overrides", async () => {
    const calls: Array<{ role: string; model?: string }> = [];
    const provider = createXaiDisputeAiProvider({
      caseGuideModel: "grok-4-fast",
      resolutionAssessorModel: "grok-4.3",
    });
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.XAI_API_KEY;
    const originalTelemetry = process.env.LLM_TELEMETRY;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { model?: string; messages?: Array<{ content: string }> };
      calls.push({
        role: body.messages?.[0]?.content.includes("Resolution Assessor") ? "resolution_assessor" : "case_guide",
        model: body.model,
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      }), { status: 200 });
    });
    process.env.XAI_API_KEY = "test-key";
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
        schema_name: "dispute_ai_resolution_assessor_v1",
        context_hash: "hash",
        system_prompt: "Role: Resolution Assessor.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = originalApiKey;
      if (originalTelemetry === undefined) delete process.env.LLM_TELEMETRY;
      else process.env.LLM_TELEMETRY = originalTelemetry;
    }

    expect(calls).toEqual([
      { role: "case_guide", model: "grok-4-fast" },
      { role: "resolution_assessor", model: "grok-4.3" },
    ]);
  });

  it("estimates dispute AI provider cost from returned usage", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.XAI_API_KEY;
    const originalTelemetry = process.env.LLM_TELEMETRY;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    }), { status: 200 }));
    process.env.XAI_API_KEY = "test-key";
    process.env.LLM_TELEMETRY = "0";

    try {
      const response = await createXaiDisputeAiProvider({
        resolutionAssessorModel: "grok-4.3",
      }).completeJson({
        role: "resolution_assessor",
        display_name: "Resolution Assessor",
        schema_name: "dispute_ai_resolution_assessor_v1",
        context_hash: "hash",
        system_prompt: "Role: Resolution Assessor.",
        user_prompt: "{}",
        response_schema: {},
        examples: [],
      });

      expect(response.cost).toMatchObject({
        model: "grok-4.3",
        inputUsd: 1.25,
        outputUsd: 2.5,
        totalUsd: 3.75,
        costMinorUsd: 375,
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = originalApiKey;
      if (originalTelemetry === undefined) delete process.env.LLM_TELEMETRY;
      else process.env.LLM_TELEMETRY = originalTelemetry;
    }
  });
});
