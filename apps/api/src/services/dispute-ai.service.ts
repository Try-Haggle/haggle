import type {
  CaseGuideOutput,
  DisputeAiCaseContext,
  DisputeAiParty,
  DisputeAiPromptBundle,
  DisputeAiValidationIssue,
  DisputeCase,
  DisputeTier,
  ResolutionAssessorOutput,
} from "@haggle/dispute-core";
import {
  buildCaseGuidePrompt,
  buildResolutionAssessorPrompt,
  validateCaseGuideOutput,
  validateResolutionAssessorOutput,
} from "@haggle/dispute-core";
import { callLLM } from "../negotiation/adapters/xai-client.js";
import { estimateLlmCostUsd, type LlmCostEstimate } from "../lib/llm-cost.js";

export interface DisputeAiProviderResponse {
  content: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost?: LlmCostEstimate | null;
}

export interface DisputeAiProvider {
  completeJson(bundle: DisputeAiPromptBundle): Promise<DisputeAiProviderResponse>;
}

export type DisputeAiRunResult<TOutput> =
  | {
      ok: true;
      role: DisputeAiPromptBundle["role"];
      displayName: DisputeAiPromptBundle["display_name"];
      schemaName: string;
      contextHash: string;
      output: TOutput;
      model?: string;
      usage?: DisputeAiProviderResponse["usage"];
      cost?: LlmCostEstimate | null;
    }
  | {
      ok: false;
      role: DisputeAiPromptBundle["role"];
      displayName: DisputeAiPromptBundle["display_name"];
      schemaName: string;
      contextHash: string;
      error: "PROVIDER_ERROR" | "INVALID_JSON" | "INVALID_AI_OUTPUT";
      message: string;
      issues?: DisputeAiValidationIssue[];
      model?: string;
      usage?: DisputeAiProviderResponse["usage"];
      cost?: LlmCostEstimate | null;
    };

export interface BuildDisputeAiContextOptions {
  tier?: DisputeTier;
  platformId?: string;
  externalOrderId?: string;
  transaction?: Partial<DisputeAiCaseContext["transaction"]>;
  policy?: DisputeAiCaseContext["policy"];
  locale?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("empty model output");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) return JSON.parse(fenced[1]) as unknown;
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error("model output was not valid JSON");
  }
}

function metadataRecord(dispute: DisputeCase): Record<string, unknown> {
  return isRecord(dispute.metadata) ? dispute.metadata : {};
}

function transactionSnapshot(dispute: DisputeCase): Record<string, unknown> {
  const metadata = metadataRecord(dispute);
  return isRecord(metadata.transaction_snapshot) ? metadata.transaction_snapshot : {};
}

export function buildDisputeAiCaseContextFromDispute(
  dispute: DisputeCase,
  options: BuildDisputeAiContextOptions = {},
): DisputeAiCaseContext {
  const metadata = metadataRecord(dispute);
  const snapshot = transactionSnapshot(dispute);
  const firstBuyerText = dispute.evidence.find((evidence) => evidence.submitted_by === "buyer" && evidence.text)?.text;
  const firstSellerText = dispute.evidence.find((evidence) => evidence.submitted_by === "seller" && evidence.text)?.text;

  return {
    dispute_id: dispute.id,
    platform_id: options.platformId ?? stringValue(metadata.platform_id) ?? stringValue(snapshot.platform_id),
    external_order_id: options.externalOrderId
      ?? stringValue(metadata.external_order_id)
      ?? stringValue(snapshot.external_order_id),
    tier: options.tier ?? 1,
    opened_by: dispute.opened_by,
    reason_code: dispute.reason_code,
    transaction: {
      amount_minor: options.transaction?.amount_minor ?? numberValue(snapshot.amount_minor) ?? 0,
      currency: options.transaction?.currency ?? stringValue(snapshot.currency) ?? "USD",
      status: options.transaction?.status ?? stringValue(snapshot.status) ?? "UNKNOWN",
      item_title: options.transaction?.item_title
        ?? stringValue(snapshot.item_title)
        ?? (isRecord(snapshot.metadata) ? stringValue(snapshot.metadata.item_title) : undefined),
      listed_condition: options.transaction?.listed_condition
        ?? stringValue(snapshot.listed_condition)
        ?? (isRecord(snapshot.metadata) ? stringValue(snapshot.metadata.listed_condition) : undefined),
      delivered_at: options.transaction?.delivered_at
        ?? stringValue(snapshot.delivered_at)
        ?? (isRecord(snapshot.metadata) ? stringValue(snapshot.metadata.delivered_at) : undefined),
    },
    party_statements: {
      buyer: firstBuyerText,
      seller: firstSellerText,
    },
    evidence: dispute.evidence.map((evidence) => ({
      id: evidence.id,
      submitted_by: evidence.submitted_by,
      type: evidence.type,
      text: evidence.text,
      uri: evidence.uri,
      created_at: evidence.created_at,
    })),
    policy: options.policy,
    locale: options.locale,
  };
}

export function createXaiDisputeAiProvider(options: {
  reasoning?: boolean;
  model?: string;
  caseGuideModel?: string;
  resolutionAssessorModel?: string;
  maxTokens?: number;
  correlationId?: string;
} = {}): DisputeAiProvider {
  return {
    async completeJson(bundle) {
      const model = resolveDisputeAiModel(bundle.role, options);
      const response = await callLLM(bundle.system_prompt, bundle.user_prompt, {
        reasoning: options.reasoning ?? bundle.role === "resolution_assessor",
        model,
        maxTokens: options.maxTokens ?? 1600,
        correlationId: options.correlationId ?? `dispute-ai:${bundle.role}:${bundle.context_hash}`,
      });
      return {
        content: response.content,
        model: response.model,
        usage: {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.prompt_tokens + response.usage.completion_tokens,
        },
        cost: estimateLlmCostUsd(response.model, {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.prompt_tokens + response.usage.completion_tokens,
        }),
      };
    },
  };
}

export function resolveDisputeAiModel(
  role: DisputeAiPromptBundle["role"],
  options: {
    model?: string;
    caseGuideModel?: string;
    resolutionAssessorModel?: string;
  } = {},
): string {
  if (role === "resolution_assessor") {
    return options.resolutionAssessorModel
      ?? options.model
      ?? process.env.DISPUTE_AI_RESOLUTION_ASSESSOR_MODEL
      ?? process.env.DISPUTE_AI_MODEL
      ?? "grok-4.3";
  }
  return options.caseGuideModel
    ?? options.model
    ?? process.env.DISPUTE_AI_CASE_GUIDE_MODEL
    ?? process.env.DISPUTE_AI_MODEL
    ?? process.env.XAI_MODEL
    ?? "grok-4-fast";
}

async function completeAndValidate<TOutput>(
  bundle: DisputeAiPromptBundle,
  provider: DisputeAiProvider,
  validate: (output: unknown) => DisputeAiValidationIssue[],
): Promise<DisputeAiRunResult<TOutput>> {
  let providerResponse: DisputeAiProviderResponse;
  try {
    providerResponse = await provider.completeJson(bundle);
  } catch (error) {
    return {
      ok: false,
      role: bundle.role,
      displayName: bundle.display_name,
      schemaName: bundle.schema_name,
      contextHash: bundle.context_hash,
      error: "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(providerResponse.content);
  } catch (error) {
    return {
      ok: false,
      role: bundle.role,
      displayName: bundle.display_name,
      schemaName: bundle.schema_name,
      contextHash: bundle.context_hash,
      error: "INVALID_JSON",
      message: error instanceof Error ? error.message : String(error),
      model: providerResponse.model,
      usage: providerResponse.usage,
      cost: providerResponse.cost ?? estimateLlmCostUsd(providerResponse.model, providerResponse.usage),
    };
  }

  const issues = validate(parsed);
  if (issues.length > 0) {
    return {
      ok: false,
      role: bundle.role,
      displayName: bundle.display_name,
      schemaName: bundle.schema_name,
      contextHash: bundle.context_hash,
      error: "INVALID_AI_OUTPUT",
      message: "Dispute AI output failed schema or platform safety validation",
      issues,
      model: providerResponse.model,
      usage: providerResponse.usage,
      cost: providerResponse.cost ?? estimateLlmCostUsd(providerResponse.model, providerResponse.usage),
    };
  }

  return {
    ok: true,
    role: bundle.role,
    displayName: bundle.display_name,
    schemaName: bundle.schema_name,
    contextHash: bundle.context_hash,
    output: parsed as TOutput,
    model: providerResponse.model,
    usage: providerResponse.usage,
    cost: providerResponse.cost ?? estimateLlmCostUsd(providerResponse.model, providerResponse.usage),
  };
}

export async function runResolutionAssessor(
  context: DisputeAiCaseContext,
  provider: DisputeAiProvider,
): Promise<DisputeAiRunResult<ResolutionAssessorOutput>> {
  const bundle = buildResolutionAssessorPrompt(context);
  return completeAndValidate<ResolutionAssessorOutput>(
    bundle,
    provider,
    (output) => validateResolutionAssessorOutput(output, context),
  );
}

export async function runCaseGuide(
  context: DisputeAiCaseContext,
  party: DisputeAiParty,
  provider: DisputeAiProvider,
): Promise<DisputeAiRunResult<CaseGuideOutput>> {
  const bundle = buildCaseGuidePrompt(context, party);
  return completeAndValidate<CaseGuideOutput>(
    bundle,
    provider,
    (output) => validateCaseGuideOutput(output, party),
  );
}
