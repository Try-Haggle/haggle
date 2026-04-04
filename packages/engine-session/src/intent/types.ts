import type { MasterStrategy } from '../strategy/types.js';

export type IntentRole = "BUYER" | "SELLER";

export type IntentStatus = "ACTIVE" | "MATCHED" | "FULFILLED" | "EXPIRED" | "CANCELLED";

export interface WaitingIntent {
  intentId: string;
  userId: string;
  role: IntentRole;
  category: string;
  keywords: string[];
  strategy: MasterStrategy;
  minUtotal: number;
  maxActiveSessions: number;
  currentActiveSessions: number;
  createdAt: string;
  expiresAt: string;
  status: IntentStatus;
}

export interface IntentConfig {
  defaultMinUtotal: number;
  defaultMaxActiveSessions: number;
  defaultExpiryDays: number;
}

export function defaultIntentConfig(): IntentConfig {
  return {
    defaultMinUtotal: 0.3,
    defaultMaxActiveSessions: 5,
    defaultExpiryDays: 30,
  };
}

export interface MatchCandidate {
  intent: WaitingIntent;
  utotal: number;
  listingId?: string;
  counterIntentId?: string;
}

export interface MatchResult {
  matched: MatchCandidate[];
  rejected: MatchCandidate[];
  totalEvaluated: number;
}
