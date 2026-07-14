import { describe, expect, it } from "vitest";
import {
  buildDisputeAiAssessmentEventHash,
  disputeAiAuditAdvisoryLockKey,
  legacyDisputeAiAssessmentEventAnchor,
  verifyDisputeAiAssessmentEventChain,
  type HashableDisputeAiAssessmentEvent,
} from "../services/dispute-ai-assessment-event.service.js";

function event(overrides: Partial<HashableDisputeAiAssessmentEvent> = {}): HashableDisputeAiAssessmentEvent {
  return {
    id: "event-1",
    disputeId: "11111111-1111-4111-8111-111111111111",
    eventType: "COMPLETED",
    revision: 1,
    versionId: "version-1",
    evidenceSnapshotHash: "evidence-1",
    policyVersion: "policy-1",
    model: "deepseek-v4-pro",
    contextHash: "context-1",
    requestedBy: "admin-1",
    forced: false,
    payload: { conclusion: "buyer_favor", scores: { buyer: 0.8, seller: 0.2 } },
    createdAt: "2026-07-12T03:00:00.000Z",
    ...overrides,
  };
}

describe("dispute AI assessment event hash chain", () => {
  it("scopes the transaction lock to one dispute audit chain", () => {
    expect(disputeAiAuditAdvisoryLockKey("11111111-1111-4111-8111-111111111111"))
      .toBe("dispute-ai-audit:11111111-1111-4111-8111-111111111111");
  });
  it("builds and verifies a sealed two-event chain", () => {
    const first = event();
    first.eventHash = buildDisputeAiAssessmentEventHash(first, null);
    const second = event({
      id: "event-2",
      eventType: "FAILED",
      revision: null,
      versionId: null,
      contextHash: "context-2",
      payload: { error: "PROVIDER_ERROR" },
      createdAt: "2026-07-12T03:01:00.000Z",
      previousEventHash: first.eventHash,
    });
    second.eventHash = buildDisputeAiAssessmentEventHash(second, first.eventHash);

    expect(verifyDisputeAiAssessmentEventChain([first, second])).toEqual({
      valid: true,
      sealed_events: 2,
      legacy_unsealed_events: 0,
      head_event_hash: second.eventHash,
    });
  });

  it("detects payload mutation and broken predecessor links", () => {
    const first = event();
    first.eventHash = buildDisputeAiAssessmentEventHash(first, null);
    const second = event({
      id: "event-2",
      previousEventHash: "wrong-previous-hash",
      payload: { conclusion: "seller_favor" },
      createdAt: "2026-07-12T03:01:00.000Z",
    });
    second.eventHash = buildDisputeAiAssessmentEventHash(second, second.previousEventHash!);
    second.payload = { conclusion: "buyer_favor" };

    expect(verifyDisputeAiAssessmentEventChain([first, second]).valid).toBe(false);
  });

  it("anchors a legacy event without claiming it was sealed", () => {
    const legacy = event({ eventHash: null });
    const anchor = legacyDisputeAiAssessmentEventAnchor(legacy);
    const sealed = event({
      id: "event-2",
      revision: 2,
      previousEventHash: anchor,
      createdAt: "2026-07-12T03:01:00.000Z",
    });
    sealed.eventHash = buildDisputeAiAssessmentEventHash(sealed, anchor);

    expect(verifyDisputeAiAssessmentEventChain([legacy, sealed])).toEqual({
      valid: true,
      sealed_events: 1,
      legacy_unsealed_events: 1,
      head_event_hash: sealed.eventHash,
    });
  });
});
