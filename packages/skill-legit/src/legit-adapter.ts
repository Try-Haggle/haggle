import { createId } from "./id.js";
import type {
  AuthenticationSkillProvider,
  CreateAuthIntentInput,
  CreateAuthIntentResult,
} from "./provider.js";
import type {
  AuthEvent,
  AuthEventType,
  AuthStatus,
  AuthVerdict,
  LegitAppRawVerdict,
} from "./types.js";
import { isAuthEventType, isLegitAppRawVerdict } from "./types.js";

// ---------------------------------------------------------------------------
// Verdict mapping
// ---------------------------------------------------------------------------

/**
 * Map LegitApp's raw verdict to Haggle's canonical AuthVerdict.
 * REPLICA → COUNTERFEIT to align with dispute-core's COUNTERFEIT_CLAIM.
 */
export function mapLegitVerdict(raw: LegitAppRawVerdict): AuthVerdict {
  switch (raw) {
    case "AUTHENTIC":
      return "AUTHENTIC";
    case "REPLICA":
      return "COUNTERFEIT";
    case "INCONCLUSIVE":
      return "INCONCLUSIVE";
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LegitAppConfig {
  api_key: string;
  /** Base URL for the LegitApp API. Defaults to production. */
  base_url?: string;
}

const DEFAULT_BASE_URL = "https://api.legitapp.com/v1";

// ---------------------------------------------------------------------------
// Event type → AuthStatus mapping
// ---------------------------------------------------------------------------

const EVENT_TYPE_TO_STATUS: Record<AuthEventType, AuthStatus> = {
  "submission.received": "SUBMITTED",
  "photos.requested": "PHOTOS_REQUESTED",
  "authentication.completed": "COMPLETED",
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class LegitAuthAdapter implements AuthenticationSkillProvider {
  readonly provider = "legitapp";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: LegitAppConfig) {
    this.apiKey = config.api_key;
    this.baseUrl = (config.base_url ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  /**
   * Create an authentication intent via LegitApp API.
   * The customer will upload photos on the returned `submission_url`.
   */
  async createIntent(input: CreateAuthIntentInput): Promise<CreateAuthIntentResult> {
    const url = `${this.baseUrl}/intents`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          category: input.category,
          turnaround: input.turnaround,
          external_id: input.order_id,
          metadata: {
            listing_id: input.listing_id,
            ...input.metadata,
          },
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown network error";
      throw new Error(
        `LegitApp createIntent failed for ${input.order_id}: ${message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `LegitApp createIntent failed for ${input.order_id}: HTTP ${response.status} — ${body}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      case_id: (data.case_id as string) ?? (data.id as string) ?? "",
      intent_id: (data.intent_id as string) ?? (data.id as string) ?? "",
      submission_url: (data.submission_url as string) ?? "",
    };
  }

  /**
   * Parse a LegitApp webhook event into our normalised AuthEvent.
   * Returns `null` for unrecognised payloads — never throws.
   */
  parseWebhookEvent(raw: Record<string, unknown>): AuthEvent | null {
    try {
      const eventType = raw.event_type as string | undefined;
      if (!eventType || !isAuthEventType(eventType)) return null;

      const caseId = (raw.case_id as string) ?? (raw.id as string);
      if (!caseId) return null;

      const status = EVENT_TYPE_TO_STATUS[eventType];

      let verdict: AuthVerdict | undefined;
      let certificateUrl: string | undefined;

      if (eventType === "authentication.completed") {
        const rawVerdict = raw.verdict as string | undefined;
        if (rawVerdict && isLegitAppRawVerdict(rawVerdict)) {
          verdict = mapLegitVerdict(rawVerdict);
        }
        certificateUrl = (raw.certificate_url as string) ?? undefined;
      }

      return {
        id: createId("aevt"),
        case_id: caseId,
        event_type: eventType,
        status,
        verdict,
        certificate_url: certificateUrl,
        occurred_at: (raw.occurred_at as string) ?? new Date().toISOString(),
        raw,
      };
    } catch {
      return null;
    }
  }
}
