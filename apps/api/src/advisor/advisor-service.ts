/**
 * AI Advisor Service — main orchestration for dispute advisor chat.
 *
 * Flow:
 *   1. Guard input
 *   2. Assemble case context
 *   3. Generate canary token
 *   4. Build system prompt
 *   5. Format messages (system + history + user)
 *   6. Call LLM (text mode)
 *   7. Guard output
 *   8. Extract strength + action suggestions
 *   9. Save messages to DB
 *   10. Return response
 */

import type { Database } from "@haggle/db";
import { advisorMessages, eq, and, desc, sql } from "@haggle/db";
import { generateCanary, buildCanaryInstruction } from "../negotiation/guards/prompt-guard.js";
import { assembleAdvisorContext } from "./advisor-context.js";
import { buildAdvisorSystemPrompt } from "./advisor-prompts.js";
import { guardAdvisorInput, guardAdvisorOutput } from "./advisor-guard.js";
import { callAdvisorLLM } from "./advisor-llm.js";
import type {
  AdvisorRole,
  AdvisorMessageRole,
  AdvisorChatRequest,
  AdvisorChatResponse,
  AdvisorMessage,
  AdvisorMessageMetadata,
} from "./advisor-types.js";
import {
  MAX_HISTORY_TURNS,
  FALLBACK_RESPONSE,
  GROK4_FAST_COST_PER_1M_INPUT,
  GROK4_FAST_COST_PER_1M_OUTPUT,
} from "./advisor-types.js";

// ─── Helpers ────────────────────────────────────────────────────────────

function advisorRole(userRole: AdvisorRole): AdvisorMessageRole {
  return userRole === "buyer" ? "buyer_advisor" : "seller_advisor";
}

function userMessageRole(userRole: AdvisorRole): AdvisorMessageRole {
  return userRole === "buyer" ? "buyer_user" : "seller_user";
}

/** Roles visible to a given user (isolation enforcement) */
function visibleRoles(userRole: AdvisorRole): AdvisorMessageRole[] {
  return userRole === "buyer"
    ? ["buyer_advisor", "buyer_user"]
    : ["seller_advisor", "seller_user"];
}

function computeCostUsd(promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * GROK4_FAST_COST_PER_1M_INPUT;
  const outputCost = (completionTokens / 1_000_000) * GROK4_FAST_COST_PER_1M_OUTPUT;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/** Extract strength assessment from LLM response */
function extractStrength(text: string): number | undefined {
  // Match patterns like "Case Strength: 65%" or "strength: 45%"
  const patterns = [
    /case\s+strength\s*:\s*(\d{1,3})\s*%/i,
    /strength\s*(?:assessment|rating|score)?\s*:\s*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*(?:case\s+)?strength/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseInt(match[1]!, 10);
      if (value >= 0 && value <= 100) return value;
    }
  }
  return undefined;
}

/** Extract action suggestions from LLM response */
function extractActions(text: string): string[] {
  const actions: string[] = [];

  // Match "Available Actions:" section with numbered items
  const actionsMatch = text.match(
    /available\s+(?:actions?|options?)\s*:([\s\S]*?)(?:\n\n|\n[A-Z]|$)/i,
  );
  if (actionsMatch) {
    const lines = actionsMatch[1]!.split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\s*(?:\d+\.|[-*])\s*/, "").trim();
      if (cleaned.length > 5 && cleaned.length < 200) {
        actions.push(cleaned);
      }
    }
  }

  return actions.slice(0, 5); // Cap at 5 suggestions
}

// ─── DB Operations ──────────────────────────────────────────────────────

async function saveMessage(
  db: Database,
  disputeId: string,
  role: AdvisorMessageRole,
  content: string,
  metadata?: AdvisorMessageMetadata,
): Promise<AdvisorMessage> {
  const [row] = await db
    .insert(advisorMessages)
    .values({
      disputeId,
      role,
      content,
      metadata: metadata ?? null,
    })
    .returning();

  return {
    id: row.id,
    dispute_id: row.disputeId,
    role: row.role as AdvisorMessageRole,
    content: row.content,
    metadata: row.metadata as AdvisorMessageMetadata | undefined,
    created_at: row.createdAt.toISOString(),
  };
}

async function loadHistory(
  db: Database,
  disputeId: string,
  userRole: AdvisorRole,
  limit: number = MAX_HISTORY_TURNS,
): Promise<AdvisorMessage[]> {
  const roles = visibleRoles(userRole);
  const rows = await db
    .select()
    .from(advisorMessages)
    .where(
      and(
        eq(advisorMessages.disputeId, disputeId),
        sql`${advisorMessages.role} = ANY(${roles})`,
      ),
    )
    .orderBy(desc(advisorMessages.createdAt))
    .limit(limit);

  // Reverse to chronological order
  return rows.reverse().map((row) => ({
    id: row.id,
    dispute_id: row.disputeId,
    role: row.role as AdvisorMessageRole,
    content: row.content,
    metadata: row.metadata as AdvisorMessageMetadata | undefined,
    created_at: row.createdAt.toISOString(),
  }));
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Process a chat message from the user and return the advisor's response.
 */
export async function chat(
  db: Database,
  request: AdvisorChatRequest,
): Promise<AdvisorChatResponse> {
  const { dispute_id, user_role, message } = request;

  // 1. Guard input
  const inputGuard = guardAdvisorInput(message);
  if (!inputGuard.safe) {
    // Never persist raw malicious input — store only a placeholder
    const blocked = await saveMessage(
      db,
      dispute_id,
      userMessageRole(user_role),
      "[blocked]",
      { blocked: true, block_reason: inputGuard.reason },
    );
    return {
      reply: {
        id: blocked.id,
        dispute_id,
        role: advisorRole(user_role),
        content:
          "Your message could not be processed. Please rephrase your question about the dispute.",
        created_at: blocked.created_at,
        metadata: { blocked: true, block_reason: inputGuard.reason },
      },
    };
  }

  // 2. Load conversation history (last N messages for this user's role)
  const history = await loadHistory(db, dispute_id, user_role);

  // 3. Assemble case context
  let context;
  try {
    context = await assembleAdvisorContext(db, dispute_id, user_role);
  } catch (err) {
    return {
      reply: {
        id: "",
        dispute_id,
        role: advisorRole(user_role),
        content: FALLBACK_RESPONSE,
        created_at: new Date().toISOString(),
      },
    };
  }

  // 4. Generate canary token
  const canarySecret = process.env.CANARY_SECRET;
  if (!canarySecret) {
    throw new Error(
      "CANARY_SECRET environment variable is required for advisor service",
    );
  }
  const canaryToken = generateCanary(dispute_id, canarySecret);
  const canaryInstruction = buildCanaryInstruction(canaryToken);

  // 5. Build system prompt
  const systemPrompt = buildAdvisorSystemPrompt(
    user_role,
    context.contextString,
    canaryInstruction,
  );

  // 6. Format messages array: [system, ...history, user_message]
  const llmMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  for (const msg of history) {
    const isAdvisor =
      msg.role === "buyer_advisor" || msg.role === "seller_advisor";
    llmMessages.push({
      role: isAdvisor ? "assistant" : "user",
      content: msg.content,
    });
  }

  llmMessages.push({ role: "user", content: message });

  // 7. Call LLM
  let llmResponse;
  try {
    llmResponse = await callAdvisorLLM(llmMessages, {
      correlationId: dispute_id,
    });
  } catch (err) {
    // Save user message even on LLM failure
    await saveMessage(db, dispute_id, userMessageRole(user_role), message);
    const fallback = await saveMessage(
      db,
      dispute_id,
      advisorRole(user_role),
      FALLBACK_RESPONSE,
      { model: "fallback" },
    );
    return { reply: fallback };
  }

  // 8. Guard output
  const outputGuard = guardAdvisorOutput(llmResponse.content, canaryToken);
  const finalContent = outputGuard.safe
    ? llmResponse.content
    : outputGuard.sanitized;

  // 9. Extract strength + action suggestions
  const strength = extractStrength(finalContent);
  const actions = extractActions(finalContent);

  // 10. Compute cost
  const costUsd = computeCostUsd(
    llmResponse.usage.prompt_tokens,
    llmResponse.usage.completion_tokens,
  );

  // 11. Save both messages to DB
  await saveMessage(db, dispute_id, userMessageRole(user_role), message);

  const advisorMsg = await saveMessage(
    db,
    dispute_id,
    advisorRole(user_role),
    finalContent,
    {
      tokens_used:
        llmResponse.usage.prompt_tokens +
        llmResponse.usage.completion_tokens,
      model: process.env.XAI_MODEL ?? "grok-4-fast",
      cost_usd: costUsd,
      strength,
      blocked: !outputGuard.safe,
      block_reason: outputGuard.violations.length > 0
        ? outputGuard.violations.join(", ")
        : undefined,
    },
  );

  return {
    reply: advisorMsg,
    strength_assessment: strength,
    action_suggestions: actions.length > 0 ? actions : undefined,
  };
}

/**
 * Trigger initial case analysis when a dispute is first opened.
 * Uses a predefined user message to request a comprehensive analysis.
 *
 * Rate-limited: only one initial analysis per dispute per role.
 * If an analysis already exists, returns the existing one instead of calling the LLM.
 */
export async function analyzeCase(
  db: Database,
  disputeId: string,
  userRole: AdvisorRole,
): Promise<AdvisorChatResponse> {
  // Check if an initial analysis already exists for this dispute+role
  const existingAdvisorRole = advisorRole(userRole);
  const existing = await db
    .select()
    .from(advisorMessages)
    .where(
      and(
        eq(advisorMessages.disputeId, disputeId),
        eq(advisorMessages.role, existingAdvisorRole),
      ),
    )
    .orderBy(advisorMessages.createdAt)
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    const metadata = row.metadata as AdvisorMessageMetadata | undefined;
    return {
      reply: {
        id: row.id,
        dispute_id: row.disputeId,
        role: row.role as AdvisorMessageRole,
        content: row.content,
        metadata,
        created_at: row.createdAt.toISOString(),
      },
      strength_assessment: metadata?.strength,
      action_suggestions: extractActions(row.content).length > 0
        ? extractActions(row.content)
        : undefined,
    };
  }

  return chat(db, {
    dispute_id: disputeId,
    user_role: userRole,
    message:
      "Please analyze my current case and provide an initial assessment. Include the case strength percentage and available actions.",
  });
}

/**
 * Load message history for a user's advisor conversation.
 * Enforces role isolation: buyer sees only buyer_* messages,
 * seller sees only seller_* messages.
 */
export async function getHistory(
  db: Database,
  disputeId: string,
  userRole: AdvisorRole,
  limit: number = 50,
  offset: number = 0,
): Promise<AdvisorMessage[]> {
  const roles = visibleRoles(userRole);
  const rows = await db
    .select()
    .from(advisorMessages)
    .where(
      and(
        eq(advisorMessages.disputeId, disputeId),
        sql`${advisorMessages.role} = ANY(${roles})`,
      ),
    )
    .orderBy(advisorMessages.createdAt)
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    dispute_id: row.disputeId,
    role: row.role as AdvisorMessageRole,
    content: row.content,
    metadata: row.metadata as AdvisorMessageMetadata | undefined,
    created_at: row.createdAt.toISOString(),
  }));
}
