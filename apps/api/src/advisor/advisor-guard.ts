/**
 * Input/output security guard for the AI Advisor.
 *
 * Input guard (L0-L2): Reuses existing prompt-guard.ts + dispute-specific checks.
 * Output guard (L3-L4): Validates LLM response for policy violations.
 *
 * If violations are found, the response is replaced with a safe fallback.
 */

import {
  runPromptGuard,
  checkCanaryLeak,
  type PromptGuardResult,
} from "../negotiation/guards/prompt-guard.js";
import { MAX_MESSAGE_LENGTH, SANITIZED_RESPONSE } from "./advisor-types.js";

// ─── Input Guard ────────────────────────────────────────────────────────

export interface InputGuardResult {
  safe: boolean;
  reason?: string;
}

/**
 * Guard user input before sending to LLM.
 * Layers:
 *   L0: Length check (2000 chars)
 *   L1: Pattern scan (reused from prompt-guard)
 *   L2: Structure validation (reused from prompt-guard)
 *   + Dispute-specific: impersonation detection
 */
export function guardAdvisorInput(message: string): InputGuardResult {
  // L0: Length check
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      safe: false,
      reason: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
    };
  }

  if (message.trim().length === 0) {
    return { safe: false, reason: "Message cannot be empty" };
  }

  // L1 + L2: Reuse existing prompt guard
  const guardResult: PromptGuardResult = runPromptGuard(message, "message");
  if (!guardResult.safe) {
    return {
      safe: false,
      reason: `Message blocked: ${guardResult.threat_type ?? "security concern"}`,
    };
  }

  // Dispute-specific: impersonation attempt detection
  const impersonationPatterns = [
    /(?:i(?:'m| am) the (?:buyer|seller|admin|system|advisor))/i,
    /(?:the (?:buyer|seller)(?:'s)? advisor (?:says?|told|said|recommends?))/i,
    /(?:speaking (?:as|for) the (?:other|opposing) (?:party|side))/i,
    /(?:on behalf of (?:the )?(buyer|seller|admin))/i,
  ];

  for (const pattern of impersonationPatterns) {
    if (pattern.test(message)) {
      return {
        safe: false,
        reason: "Message appears to attempt role impersonation",
      };
    }
  }

  return { safe: true };
}

// ─── Output Guard ───────────────────────────────────────────────────────

export interface OutputGuardResult {
  safe: boolean;
  sanitized: string;
  violations: string[];
}

// Legal terms that must never appear in advisor output
const LEGAL_TERM_PATTERN =
  /\b(?:legal\s+advice|lawsuit|attorney|court\s+order|verdict|judge|litigation|sue|counsel|deposition|subpoena|lawyer)\b/i;

const LEGAL_TERM_PATTERN_KO =
  /(?:법적\s*조언|소송|변호사|판사|법원|재판|고소|고발|법률\s*상담)/;

// System info leak patterns
const SYSTEM_INFO_PATTERN =
  /(?:api[_-]?key|private[_-]?key|system\s+prompt|HAGGLE_|SUPABASE_|XAI_API|DATABASE_URL|SECRET_KEY)/i;

// Wallet address pattern (Ethereum 0x addresses)
const WALLET_PATTERN = /0x[a-fA-F0-9]{40}/g;

/**
 * Guard LLM output for policy violations.
 * Layers:
 *   L3: Canary token leak detection
 *   L4: Output content validation
 *     - Legal terms
 *     - System info leaks
 *     - PII (wallet addresses)
 */
export function guardAdvisorOutput(
  response: string,
  canaryToken: string,
): OutputGuardResult {
  const violations: string[] = [];

  // L3: Canary leak check
  if (checkCanaryLeak(response, canaryToken)) {
    violations.push("canary_token_leak");
  }

  // L4a: Legal term check
  if (LEGAL_TERM_PATTERN.test(response)) {
    violations.push("legal_terminology");
  }
  if (LEGAL_TERM_PATTERN_KO.test(response)) {
    violations.push("legal_terminology_ko");
  }

  // L4b: System info leak check
  if (SYSTEM_INFO_PATTERN.test(response)) {
    violations.push("system_info_leak");
  }

  // L4c: Wallet address leak check (any 0x address in output is suspicious)
  const walletMatches = response.match(WALLET_PATTERN);
  if (walletMatches && walletMatches.length > 0) {
    violations.push("wallet_address_leak");
  }

  if (violations.length > 0) {
    return {
      safe: false,
      sanitized: SANITIZED_RESPONSE,
      violations,
    };
  }

  return {
    safe: true,
    sanitized: response,
    violations: [],
  };
}
