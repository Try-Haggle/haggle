/**
 * AI Advisor types for dispute resolution chat system.
 *
 * The advisor provides neutral, fact-based analysis from the user's perspective.
 * It does NOT take sides -- it presents strengths and weaknesses honestly.
 */

export type AdvisorRole = "buyer" | "seller";

export type AdvisorMessageRole = "buyer_advisor" | "seller_advisor" | "buyer_user" | "seller_user";

export interface AdvisorMessageMetadata {
  tokens_used?: number;
  model?: string;
  cost_usd?: number;
  strength?: number;
  blocked?: boolean;
  block_reason?: string;
  precedent_ids?: string[];
  precedent_analysis_versions?: string[];
}

export interface AdvisorMessage {
  id: string;
  dispute_id: string;
  role: AdvisorMessageRole;
  content: string;
  metadata?: AdvisorMessageMetadata;
  created_at: string;
}

export interface AdvisorChatRequest {
  dispute_id: string;
  user_role: AdvisorRole;
  message: string;
}

export interface AdvisorChatResponse {
  reply: AdvisorMessage;
  strength_assessment?: number;
  action_suggestions?: string[];
}

/** Cost per 1M tokens for DeepSeek V4 Pro (cache-miss input). */
export const DEEPSEEK_COST_PER_1M_INPUT = 0.435;
export const DEEPSEEK_COST_PER_1M_OUTPUT = 0.87;

/** Advisor conversation history cap (token budget control) */
export const MAX_HISTORY_TURNS = 10;

/** Maximum user message length */
export const MAX_MESSAGE_LENGTH = 2000;

/** Default response for LLM failure */
export const FALLBACK_RESPONSE =
  "I'm unable to analyze your case at the moment. Please try again shortly. Your dispute status and evidence remain unchanged.";

/** Default response for output guard violation */
export const SANITIZED_RESPONSE =
  "I need to rephrase my response. Let me provide a clearer analysis of your case. Could you please repeat your question?";
