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

function mergeUsage(
  first: DisputeAiProviderResponse["usage"],
  second: DisputeAiProviderResponse["usage"],
): DisputeAiProviderResponse["usage"] | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
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
      derived_artifacts: evidence.derived_artifacts,
      derived_artifacts_integrity: evidence.derived_artifacts_integrity,
      derived_artifacts_integrity_reason: evidence.derived_artifacts_integrity_reason,
    })),
    policy: options.policy,
    locale: options.locale,
  };
}

interface OpenAiCompatibleChatCompletion {
  choices: Array<{
    message: { content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function deepSeekApiBase(): string {
  return (process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com").replace(/\/+$/, "");
}

function deepSeekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY not configured");
  return key;
}

function deepSeekTimeoutMs(): number {
  return parsePositiveInt(process.env.DEEPSEEK_TIMEOUT_MS) ?? 90_000;
}

function disputeAiMaxTokens(
  role: DisputeAiPromptBundle["role"],
  override: number | undefined,
): number {
  if (override !== undefined) return override;
  if (role === "resolution_assessor") {
    return parsePositiveInt(process.env.DISPUTE_AI_RESOLUTION_ASSESSOR_MAX_TOKENS) ?? 4096;
  }
  return parsePositiveInt(process.env.DISPUTE_AI_CASE_GUIDE_MAX_TOKENS) ?? 1600;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createDeepSeekDisputeAiProvider(options: {
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
      const useLowerTemperature = options.reasoning ?? bundle.role === "resolution_assessor";
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: `${bundle.system_prompt}\n\nReturn valid JSON only.` },
          { role: "user", content: bundle.user_prompt },
        ],
        response_format: { type: "json_object" },
        temperature: useLowerTemperature ? 0.3 : 0.5,
        max_tokens: disputeAiMaxTokens(bundle.role, options.maxTokens),
        stream: false,
      };
      const response = await fetchWithTimeout(`${deepSeekApiBase()}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deepSeekApiKey()}`,
        },
        body: JSON.stringify(body),
      }, deepSeekTimeoutMs());

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`DeepSeek API error ${response.status}: ${text}`);
      }

      const data = await response.json() as OpenAiCompatibleChatCompletion;
      const usage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens
          ?? (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0),
      };
      const returnedModel = data.model ?? model;
      return {
        content: data.choices?.[0]?.message?.content ?? "",
        model: returnedModel,
        usage,
        cost: estimateLlmCostUsd(returnedModel, usage),
      };
    },
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
  // Backward-compatible export name. The dispute AI provider now uses DeepSeek.
  return createDeepSeekDisputeAiProvider({
    ...options,
    model: options.model ?? process.env.DISPUTE_AI_MODEL,
  });
}

export function createDisputeAiProvider(options: {
  reasoning?: boolean;
  model?: string;
  caseGuideModel?: string;
  resolutionAssessorModel?: string;
  maxTokens?: number;
  correlationId?: string;
} = {}): DisputeAiProvider {
  return createDeepSeekDisputeAiProvider(options);
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
      ?? process.env.DEEPSEEK_MODEL
      ?? "deepseek-v4-pro";
  }
  return options.caseGuideModel
    ?? options.model
    ?? process.env.DISPUTE_AI_CASE_GUIDE_MODEL
    ?? process.env.DISPUTE_AI_MODEL
    ?? process.env.DEEPSEEK_MODEL
    ?? "deepseek-v4-flash";
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
    try {
      const repairResponse = await provider.completeJson({
        ...bundle,
        system_prompt: [
          `You repair invalid JSON for ${bundle.schema_name}.`,
          "Return valid JSON only. Do not add markdown, comments, or prose.",
        ].join("\n"),
        user_prompt: [
          "The previous model output was invalid JSON.",
          `Parse error: ${error instanceof Error ? error.message : String(error)}`,
          "Repair it into one valid JSON object that satisfies the original schema.",
          "Invalid output:",
          providerResponse.content.slice(0, 12_000),
        ].join("\n\n"),
      });
      providerResponse = {
        ...repairResponse,
        usage: mergeUsage(providerResponse.usage, repairResponse.usage),
      };
      parsed = extractJsonObject(providerResponse.content);
    } catch (repairError) {
      return {
        ok: false,
        role: bundle.role,
        displayName: bundle.display_name,
        schemaName: bundle.schema_name,
        contextHash: bundle.context_hash,
        error: "INVALID_JSON",
        message: repairError instanceof Error ? repairError.message : String(repairError),
        model: providerResponse.model,
        usage: providerResponse.usage,
        cost: providerResponse.cost ?? estimateLlmCostUsd(providerResponse.model, providerResponse.usage),
      };
    }
  }

  let issues = validate(parsed);
  if (issues.length > 0) {
    try {
      const repairResponse = await provider.completeJson({
        ...bundle,
        system_prompt: [
          `You repair a JSON object for ${bundle.schema_name}.`,
          "Return valid JSON only. Keep the same case facts and recommendation unless a field is unsafe.",
          "Fill every required field with the correct type.",
          "Rewrite every field with a Korean-language validation issue in natural Korean.",
        ].join("\n"),
        user_prompt: [
          "The previous JSON object failed schema validation.",
          "Important consistency rule: if confidence is low, escalation_required must be true. If escalation_required is false, confidence must be medium or high.",
          "Validation issues:",
          JSON.stringify(issues),
          "Repair this JSON object so it satisfies the schema:",
          JSON.stringify(parsed).slice(0, 12_000),
        ].join("\n\n"),
      });
      providerResponse = {
        ...repairResponse,
        usage: mergeUsage(providerResponse.usage, repairResponse.usage),
      };
      parsed = extractJsonObject(providerResponse.content);
      issues = validate(parsed);
    } catch (repairError) {
      return {
        ok: false,
        role: bundle.role,
        displayName: bundle.display_name,
        schemaName: bundle.schema_name,
        contextHash: bundle.context_hash,
        error: "INVALID_AI_OUTPUT",
        message: repairError instanceof Error ? repairError.message : String(repairError),
        issues,
        model: providerResponse.model,
        usage: providerResponse.usage,
        cost: providerResponse.cost ?? estimateLlmCostUsd(providerResponse.model, providerResponse.usage),
      };
    }
  }
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
