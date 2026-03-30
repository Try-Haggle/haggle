import type {
  AuthEvent,
  LegitAppCategory,
  LegitAppTurnaround,
} from "./types.js";

// ---------------------------------------------------------------------------
// Input / Result types
// ---------------------------------------------------------------------------

export interface CreateAuthIntentInput {
  order_id: string;
  listing_id: string;
  category: LegitAppCategory;
  turnaround: LegitAppTurnaround;
  metadata?: Record<string, unknown>;
}

export interface CreateAuthIntentResult {
  case_id: string;
  intent_id: string;
  submission_url: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AuthenticationSkillProvider {
  readonly provider: string;
  createIntent(input: CreateAuthIntentInput): Promise<CreateAuthIntentResult>;
  parseWebhookEvent(raw: Record<string, unknown>): AuthEvent | null;
}
