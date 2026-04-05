import { createId } from "./id.js";
import type {
  AuthenticationSkillProvider,
  CreateAuthIntentInput,
  CreateAuthIntentResult,
} from "./provider.js";
import type { AuthEvent, AuthVerdict, LegitAppRawVerdict } from "./types.js";
import { isAuthEventType, isLegitAppRawVerdict } from "./types.js";

/**
 * Deterministic mock adapter for testing authentication flows.
 * Returns predictable data without any network calls.
 */
export class MockAuthAdapter implements AuthenticationSkillProvider {
  readonly provider = "mock_auth";

  async createIntent(input: CreateAuthIntentInput): Promise<CreateAuthIntentResult> {
    const caseId = `case_mock_${input.order_id}`;
    const intentId = `intent_mock_${input.order_id}`;

    return {
      case_id: caseId,
      intent_id: intentId,
      submission_url: `https://mock-auth.test/submit/${intentId}`,
    };
  }

  parseWebhookEvent(raw: Record<string, unknown>): AuthEvent | null {
    const eventType = raw.event_type as string | undefined;
    if (!eventType || !isAuthEventType(eventType)) return null;

    const caseId = raw.case_id as string | undefined;
    if (!caseId) return null;

    return {
      id: createId("aevt"),
      case_id: caseId,
      event_type: eventType,
      status:
        eventType === "authentication.completed"
          ? "COMPLETED"
          : eventType === "photos.requested"
            ? "PHOTOS_REQUESTED"
            : "SUBMITTED",
      verdict:
        eventType === "authentication.completed"
          ? this.resolveVerdict(raw.verdict as string | undefined)
          : undefined,
      certificate_url:
        eventType === "authentication.completed"
          ? (raw.certificate_url as string) ?? `https://mock-auth.test/cert/${caseId}`
          : undefined,
      occurred_at: (raw.occurred_at as string) ?? new Date().toISOString(),
      raw,
    };
  }

  private resolveVerdict(raw: string | undefined): AuthVerdict {
    if (!raw) return "AUTHENTIC";
    if (isLegitAppRawVerdict(raw)) {
      // Mirror the real adapter's mapping: REPLICA → COUNTERFEIT
      if (raw === "REPLICA") return "COUNTERFEIT";
      if (raw === "INCONCLUSIVE") return "INCONCLUSIVE";
      return "AUTHENTIC";
    }
    return "AUTHENTIC";
  }
}
