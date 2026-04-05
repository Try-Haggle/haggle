import type { TrustTriggerEvent } from "@haggle/commerce-core";
import type { DisputeEvidence } from "@haggle/dispute-core";
import { createId } from "./id.js";
import type { AuthenticationSkillProvider } from "./provider.js";
import type {
  AuthenticationRecord,
  AuthEvent,
  AuthStatus,
  AuthVerdict,
  LegitAppTurnaround,
  SkillCostAllocation,
} from "./types.js";
import type { HaggleCategory } from "./category-map.js";
import { mapToLegitCategory } from "./category-map.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface RequestAuthenticationInput {
  order_id: string;
  listing_id: string;
  category: HaggleCategory;
  turnaround?: LegitAppTurnaround;
  requester: "buyer" | "seller";
  cost_minor: number;
  now?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AuthenticationServiceResult {
  record: AuthenticationRecord;
  trust_triggers: TrustTriggerEvent[];
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<AuthStatus, AuthStatus[]> = {
  INTENT_CREATED: ["PHOTOS_REQUESTED", "SUBMITTED", "COMPLETED", "EXPIRED"],
  PHOTOS_REQUESTED: ["SUBMITTED", "COMPLETED", "EXPIRED"],
  SUBMITTED: ["COMPLETED", "EXPIRED"],
  COMPLETED: [],
  EXPIRED: [],
};

function canTransition(from: AuthStatus, to: AuthStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

/**
 * AuthenticationService — orchestrator for authentication skill.
 *
 * Opt-in design: this service only runs when explicitly called.
 * It does NOT auto-insert into the transaction flow.
 */
export class AuthenticationService {
  constructor(
    private readonly providers: Partial<Record<string, AuthenticationSkillProvider>>,
  ) {}

  /**
   * Request authentication for a listing. Creates an intent with the provider
   * and returns a new AuthenticationRecord in INTENT_CREATED status.
   */
  async requestAuthentication(
    input: RequestAuthenticationInput,
    providerName = "legitapp",
  ): Promise<AuthenticationServiceResult> {
    const provider = this.resolveProvider(providerName);
    const legitCategory = mapToLegitCategory(input.category);
    const turnaround = input.turnaround ?? "standard";
    const ts = nowIso(input.now);

    const result = await provider.createIntent({
      order_id: input.order_id,
      listing_id: input.listing_id,
      category: legitCategory,
      turnaround,
    });

    const record: AuthenticationRecord = {
      id: createId("auth"),
      order_id: input.order_id,
      listing_id: input.listing_id,
      case_id: result.case_id,
      intent_id: result.intent_id,
      submission_url: result.submission_url,
      provider: providerName,
      category: legitCategory,
      turnaround,
      status: "INTENT_CREATED",
      requested_by: input.requester,
      cost_minor: input.cost_minor,
      created_at: ts,
      updated_at: ts,
      events: [],
    };

    return { record, trust_triggers: [] };
  }

  /**
   * Process a webhook event and advance the record's state.
   * Returns null if the event is unrecognised or the transition is invalid.
   */
  processWebhook(
    record: AuthenticationRecord,
    raw: Record<string, unknown>,
    now?: string,
  ): AuthenticationServiceResult | null {
    const provider = this.providers[record.provider];
    if (!provider) return null;

    const event = provider.parseWebhookEvent(raw);
    if (!event) return null;

    if (event.case_id !== record.case_id) return null;

    if (!canTransition(record.status, event.status)) return null;

    const ts = nowIso(now);
    const trustTriggers: TrustTriggerEvent[] = [];

    const updatedRecord: AuthenticationRecord = {
      ...record,
      status: event.status,
      verdict: event.verdict ?? record.verdict,
      certificate_url: event.certificate_url ?? record.certificate_url,
      updated_at: ts,
      events: [...record.events, event],
    };

    return { record: updatedRecord, trust_triggers: trustTriggers };
  }

  /**
   * Convert a completed authentication record into DisputeEvidence entries
   * for use in dispute-core. Only produces evidence for COMPLETED records.
   */
  toDisputeEvidence(
    record: AuthenticationRecord,
    disputeId: string,
  ): DisputeEvidence[] {
    if (record.status !== "COMPLETED" || !record.verdict) return [];

    const evidence: DisputeEvidence[] = [];

    // Verdict evidence
    evidence.push({
      id: createId("evi"),
      dispute_id: disputeId,
      submitted_by: "system",
      type: "other",
      text: `Authentication verdict: ${record.verdict} (provider: ${record.provider}, case: ${record.case_id})`,
      created_at: record.updated_at,
    });

    // Certificate link
    if (record.certificate_url) {
      evidence.push({
        id: createId("evi"),
        dispute_id: disputeId,
        submitted_by: "system",
        type: "other",
        uri: record.certificate_url,
        text: `Authentication certificate from ${record.provider}`,
        created_at: record.updated_at,
      });
    }

    return evidence;
  }

  /**
   * Build a SkillCostAllocation for this authentication request.
   * Cost is paid by the requester; on dispute loss the other party may be charged.
   */
  buildCostAllocation(record: AuthenticationRecord): SkillCostAllocation {
    return {
      paid_by: record.requested_by,
      cost_minor: record.cost_minor,
      chargeback_on_dispute_loss: true,
    };
  }

  private resolveProvider(name: string): AuthenticationSkillProvider {
    const provider = this.providers[name];
    if (!provider) {
      throw new Error(`no authentication provider registered: ${name}`);
    }
    return provider;
  }
}
