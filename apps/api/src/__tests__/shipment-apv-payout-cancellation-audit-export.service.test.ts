import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildShipmentApvCancellationEventHash,
  type ShipmentApvPayoutCancellationEventRecord,
  verifyShipmentApvCancellationEventChain,
} from "../services/shipment-apv-payout-cancellation.service.js";
import {
  createSignedShipmentApvPayoutCancellationAuditExport,
  verifySignedShipmentApvPayoutCancellationAuditExport,
} from "../services/shipment-apv-payout-cancellation-audit-export.service.js";

function sealedEvents() {
  const requested: ShipmentApvPayoutCancellationEventRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    cancellation_request_id: "22222222-2222-4222-8222-222222222222",
    event_type: "REQUESTED",
    actor_id: "33333333-3333-4333-8333-333333333333",
    request_version: 0,
    metadata: { payout_offset_id: "44444444-4444-4444-8444-444444444444" },
    previous_event_hash: null,
    event_hash: null,
    created_at: "2026-07-12T00:00:00.000Z",
  };
  requested.event_hash = buildShipmentApvCancellationEventHash(requested, null);
  const rejected: ShipmentApvPayoutCancellationEventRecord = {
    id: "55555555-5555-4555-8555-555555555555",
    cancellation_request_id: requested.cancellation_request_id,
    event_type: "REJECTED",
    actor_id: "66666666-6666-4666-8666-666666666666",
    request_version: 1,
    metadata: {
      decision_request_id: "77777777-7777-4777-8777-777777777777",
      onchain_state: "NONE",
    },
    previous_event_hash: requested.event_hash,
    event_hash: null,
    created_at: "2026-07-12T00:01:00.000Z",
  };
  rejected.event_hash = buildShipmentApvCancellationEventHash(
    rejected,
    rejected.previous_event_hash,
  );
  return [requested, rejected];
}

describe("shipment APV payout cancellation audit export", () => {
  it("verifies a complete lifecycle chain and detects payload tampering", () => {
    const events = sealedEvents();
    expect(verifyShipmentApvCancellationEventChain(events)).toMatchObject({
      valid: true,
      complete: true,
      sealedEvents: 2,
      legacyUnsealedEvents: 0,
    });
    const tampered = structuredClone(events);
    tampered[1]!.metadata.onchain_state = "FUNDED";
    expect(verifyShipmentApvCancellationEventChain(tampered).valid).toBe(false);
  });

  it("signs the manifest and rejects modified exported events", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const auditExport = createSignedShipmentApvPayoutCancellationAuditExport({
      cancellationRequestId: "22222222-2222-4222-8222-222222222222",
      events: sealedEvents(),
      generatedAt: new Date("2026-07-12T00:02:00.000Z"),
      privateKey,
    });
    expect(auditExport.manifest).toMatchObject({
      schema: "haggle.shipment-apv-payout-cancellation-audit.v1",
      event_count: 2,
      chain_valid: true,
      chain_complete: true,
    });
    expect(verifySignedShipmentApvPayoutCancellationAuditExport(auditExport)).toBe(true);
    auditExport.events[0]!.metadata.payout_offset_id = "tampered";
    expect(verifySignedShipmentApvPayoutCancellationAuditExport(auditExport)).toBe(false);
  });
});
