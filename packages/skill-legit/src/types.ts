// ---------------------------------------------------------------------------
// LegitApp raw types
// ---------------------------------------------------------------------------

export type LegitAppCategory =
  | "sneakers"
  | "streetwear"
  | "handbags"
  | "watches"
  | "jewelry"
  | "accessories"
  | "collectibles"
  | "trading_cards"
  | "wine_spirits"
  | "art"
  | "memorabilia";

export type LegitAppTurnaround = "ultra_fast" | "fast" | "standard";

export type LegitAppRawVerdict = "AUTHENTIC" | "REPLICA" | "INCONCLUSIVE";

// ---------------------------------------------------------------------------
// Haggle canonical types
// ---------------------------------------------------------------------------

/** Canonical Haggle verdict. REPLICA is mapped to COUNTERFEIT for dispute-core alignment. */
export type AuthVerdict = "AUTHENTIC" | "COUNTERFEIT" | "INCONCLUSIVE";

export type AuthStatus =
  | "INTENT_CREATED"
  | "PHOTOS_REQUESTED"
  | "SUBMITTED"
  | "COMPLETED"
  | "EXPIRED";

export type AuthEventType =
  | "submission.received"
  | "photos.requested"
  | "authentication.completed";

// ---------------------------------------------------------------------------
// Webhook event (normalised)
// ---------------------------------------------------------------------------

export interface AuthEvent {
  id: string;
  case_id: string;
  event_type: AuthEventType;
  status: AuthStatus;
  verdict?: AuthVerdict;
  certificate_url?: string;
  occurred_at: string;
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Authentication record (lifecycle entity)
// ---------------------------------------------------------------------------

export interface AuthenticationRecord {
  id: string;
  order_id: string;
  listing_id: string;
  case_id: string;
  intent_id: string;
  submission_url: string;
  provider: string;
  category: LegitAppCategory;
  turnaround: LegitAppTurnaround;
  status: AuthStatus;
  verdict?: AuthVerdict;
  certificate_url?: string;
  requested_by: "buyer" | "seller";
  cost_minor: number;
  created_at: string;
  updated_at: string;
  events: AuthEvent[];
}

// ---------------------------------------------------------------------------
// Cost allocation
// ---------------------------------------------------------------------------

export interface SkillCostAllocation {
  paid_by: "buyer" | "seller";
  cost_minor: number;
  chargeback_on_dispute_loss: boolean;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

const LEGIT_APP_CATEGORIES = new Set<string>([
  "sneakers", "streetwear", "handbags", "watches", "jewelry",
  "accessories", "collectibles", "trading_cards", "wine_spirits",
  "art", "memorabilia",
]);

const LEGIT_APP_TURNAROUNDS = new Set<string>([
  "ultra_fast", "fast", "standard",
]);

const AUTH_VERDICTS = new Set<string>([
  "AUTHENTIC", "COUNTERFEIT", "INCONCLUSIVE",
]);

const AUTH_STATUSES = new Set<string>([
  "INTENT_CREATED", "PHOTOS_REQUESTED", "SUBMITTED", "COMPLETED", "EXPIRED",
]);

const AUTH_EVENT_TYPES = new Set<string>([
  "submission.received", "photos.requested", "authentication.completed",
]);

const LEGIT_RAW_VERDICTS = new Set<string>([
  "AUTHENTIC", "REPLICA", "INCONCLUSIVE",
]);

export function isLegitAppCategory(v: unknown): v is LegitAppCategory {
  return typeof v === "string" && LEGIT_APP_CATEGORIES.has(v);
}

export function isLegitAppTurnaround(v: unknown): v is LegitAppTurnaround {
  return typeof v === "string" && LEGIT_APP_TURNAROUNDS.has(v);
}

export function isAuthVerdict(v: unknown): v is AuthVerdict {
  return typeof v === "string" && AUTH_VERDICTS.has(v);
}

export function isAuthStatus(v: unknown): v is AuthStatus {
  return typeof v === "string" && AUTH_STATUSES.has(v);
}

export function isAuthEventType(v: unknown): v is AuthEventType {
  return typeof v === "string" && AUTH_EVENT_TYPES.has(v);
}

export function isLegitAppRawVerdict(v: unknown): v is LegitAppRawVerdict {
  return typeof v === "string" && LEGIT_RAW_VERDICTS.has(v);
}
