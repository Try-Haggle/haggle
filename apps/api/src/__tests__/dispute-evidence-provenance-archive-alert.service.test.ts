import { describe, expect, it, vi } from "vitest";
import {
  evaluateDisputeEvidenceProvenanceArchiveAlert,
  sendDisputeEvidenceProvenanceArchiveAlert,
} from "../services/dispute-evidence-provenance-archive-alert.service.js";
import { verifyDisputeEvidenceProvenanceArchiveAlert } from "../services/dispute-evidence-provenance-archive-alert-verifier.service.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";

const health = {
  status: "critical" as const,
  pending: 0,
  processing: 0,
  failed: 0,
  deadLetter: 1,
  delivered: 2,
  staleProcessing: 0,
  retryReady: 0,
  eligibleEvidence: 3,
  archivedEvidence: 2,
  coverageGap: 1,
  coveragePercent: 66.67,
  recordedAt: "2026-07-12T00:00:00.000Z",
};
const config = {
  url: "https://ops.example/alerts",
  secret: "provenance-alert-secret",
  timeoutMs: 5000,
  cooldownMinutes: 15,
  coverageGapThreshold: 1,
  staleThreshold: 1,
  retryReadyThreshold: 5,
  deadLetterThreshold: 1,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};
const deliveryId = `health_${"a".repeat(64)}`;

describe("evidence provenance archive alerts", () => {
  it("classifies coverage gaps and dead letters as critical", () => {
    expect(evaluateDisputeEvidenceProvenanceArchiveAlert(health, config)).toEqual({
      wouldAlert: true,
      severity: "critical",
      reasons: [
        "evidence_provenance_archive_coverage_gap",
        "evidence_provenance_archive_dead_letter",
      ],
    });
    expect(
      evaluateDisputeEvidenceProvenanceArchiveAlert(
        { ...health, coverageGap: 0, deadLetter: 0, staleProcessing: 1, status: "attention" },
        config,
      ),
    ).toMatchObject({
      severity: "warning",
      reasons: ["evidence_provenance_archive_stale_processing"],
    });
  });

  it("sends an HMAC-signed aggregate payload without evidence or archive identifiers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const assessment = evaluateDisputeEvidenceProvenanceArchiveAlert(health, config);
    await expect(
      sendDisputeEvidenceProvenanceArchiveAlert(health, assessment, {
        config,
        deliveryId,
        fetchImpl,
        now: new Date(health.recordedAt),
      }),
    ).resolves.toMatchObject({ status: "delivered" });
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({
      "x-haggle-alert-type": "dispute_evidence_provenance_archive.health",
      "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
    });
    expect(String(request.body)).not.toMatch(
      /evidence_id|dispute_id|archive_id|payload_sha256|receipt_id/,
    );
  });

  it("verifies raw-body HMAC and rejects stale or mutated payloads", () => {
    const timestamp = health.recordedAt;
    const body = JSON.stringify({
      type: "dispute_evidence_provenance_archive.health",
      delivery_id: deliveryId,
      state: "firing",
      created_at: timestamp,
      severity: "critical",
      reasons: ["evidence_provenance_archive_coverage_gap"],
      health,
    });
    const signature = signWebhookClaimAlertPayload(config.secret, timestamp, body);
    expect(
      verifyDisputeEvidenceProvenanceArchiveAlert({
        rawBody: body,
        timestamp,
        signature,
        deliveryId,
        secret: config.secret,
        nowMs: Date.parse(timestamp),
      }),
    ).toMatchObject({ ok: true, state: "firing" });
    expect(
      verifyDisputeEvidenceProvenanceArchiveAlert({
        rawBody: `${body} `,
        timestamp,
        signature,
        deliveryId,
        secret: config.secret,
        nowMs: Date.parse(timestamp),
      }),
    ).toMatchObject({ ok: false });
    expect(
      verifyDisputeEvidenceProvenanceArchiveAlert({
        rawBody: body,
        timestamp,
        signature,
        deliveryId,
        secret: config.secret,
        nowMs: Date.parse(timestamp) + 301_000,
      }),
    ).toMatchObject({
      ok: false,
      error: "ALERT_TIMESTAMP_OUT_OF_RANGE",
    });
  });
});
