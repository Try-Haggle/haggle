import { generateKeyPairSync } from "node:crypto";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  registerShipmentApvFailureAlertTestKey,
  transitionShipmentApvFailureAlertTestKey,
} from "../services/shipment-apv-chaos-failure-alert-key-registry.service.js";
import { createShipmentApvFailureAlertTestSigner } from "../services/shipment-apv-chaos-failure-alert-signature.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T18:00:00.000Z");
const actor = "66666666-6666-4666-8666-666666666666";
const clientEventId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const signer = createShipmentApvFailureAlertTestSigner(generateKeyPairSync("ed25519").privateKey);

function registryRow(overrides: Record<string, unknown> = {}) {
  return {
    key_id: signer.keyId,
    algorithm: "Ed25519",
    public_key_spki_base64: signer.publicKeySpkiBase64,
    registered_by: actor,
    registered_at: now.toISOString(),
    event_id: eventId,
    client_event_id: clientEventId,
    event_type: "REGISTERED",
    reason: "ephemeral_test_key_registered",
    changed_by: actor,
    event_created_at: now.toISOString(),
    current_event_type: "REGISTERED",
    current_reason: "ephemeral_test_key_registered",
    current_event_created_at: now.toISOString(),
    inserted: true,
    ...overrides,
  };
}

describe("shipment APV failure alert test key registry", () => {
  it("registers an ephemeral public key without exposing its private key", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow()]);
    const result = await registerShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { clientEventId, registeredBy: actor, signer, now },
    );
    expect(result).toMatchObject({
      status: "REGISTERED",
      algorithm: "Ed25519",
      eventType: "REGISTERED",
      eventReason: "ephemeral_test_key_registered",
      keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
      registry: "DATABASE_TEST_REGISTRY",
      independentTrustAnchor: false,
      privateKeyExposed: false,
      replayed: false,
    });
    expect(result).not.toHaveProperty("privateKey");
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[2]![0]);
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_signing_keys",
    );
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_signing_key_events",
    );
  });

  it("returns exact registration replay before current registry lookup", async () => {
    const execute = vi.fn().mockResolvedValueOnce([registryRow({ inserted: false })]);
    const result = await registerShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { clientEventId, registeredBy: actor, signer, now },
    );
    expect(result).toMatchObject({ status: "REGISTERED", replayed: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("shows the current terminal state when replaying the old registration event", async () => {
    const execute = vi.fn().mockResolvedValueOnce([
      registryRow({
        inserted: false,
        current_event_type: "RETIRED",
        current_reason: "ephemeral_test_key_retired",
        current_event_created_at: "2026-07-13T18:05:00.000Z",
      }),
    ]);
    const result = await registerShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { clientEventId, registeredBy: actor, signer, now },
    );
    expect(result).toMatchObject({
      eventType: "REGISTERED",
      status: "RETIRED",
      lifecycleReason: "ephemeral_test_key_retired",
      replayed: true,
    });
  });

  it("returns an already-active identical key without duplicating registration", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow({ inserted: false })]);
    const result = await registerShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { clientEventId: "33333333-3333-4333-8333-333333333333", registeredBy: actor, signer, now },
    );
    expect(result).toMatchObject({ status: "REGISTERED", replayed: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects client rebinding, key binding conflict, and terminal reuse", async () => {
    const rebound = vi.fn().mockResolvedValueOnce([
      registryRow({
        changed_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        inserted: false,
      }),
    ]);
    await expect(
      registerShipmentApvFailureAlertTestKey(
        { execute: rebound } as unknown as Pick<Database, "execute">,
        { clientEventId, registeredBy: actor, signer, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_KEY_EVENT_REPLAY_CONFLICT");

    const conflict = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        registryRow({ registered_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      ]);
    await expect(
      registerShipmentApvFailureAlertTestKey(
        { execute: conflict } as unknown as Pick<Database, "execute">,
        { clientEventId, registeredBy: actor, signer, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_KEY_REGISTRY_BINDING_CONFLICT");

    const terminal = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        registryRow({ event_type: "REVOKED", reason: "ephemeral_test_key_revoked" }),
      ]);
    await expect(
      registerShipmentApvFailureAlertTestKey(
        { execute: terminal } as unknown as Pick<Database, "execute">,
        { clientEventId, registeredBy: actor, signer, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_TERMINAL");
  });

  it("appends one RETIRED lifecycle event", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow({ inserted: false })])
      .mockResolvedValueOnce([
        registryRow({
          event_type: "RETIRED",
          reason: "ephemeral_test_key_retired",
          current_event_type: "RETIRED",
          current_reason: "ephemeral_test_key_retired",
          inserted: true,
        }),
      ]);
    const result = await transitionShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { keyId: signer.keyId, clientEventId, action: "RETIRE", changedBy: actor, now },
    );
    expect(result).toMatchObject({
      status: "RETIRED",
      lifecycleReason: "ephemeral_test_key_retired",
      replayed: false,
    });
  });

  it("returns exact terminal replay and rejects opposite rebinding", async () => {
    const replay = vi.fn().mockResolvedValueOnce([
      registryRow({
        event_type: "REVOKED",
        reason: "ephemeral_test_key_revoked",
        current_event_type: "REVOKED",
        current_reason: "ephemeral_test_key_revoked",
        inserted: false,
      }),
    ]);
    const result = await transitionShipmentApvFailureAlertTestKey(
      { execute: replay } as unknown as Pick<Database, "execute">,
      { keyId: signer.keyId, clientEventId, action: "REVOKE", changedBy: actor, now },
    );
    expect(result).toMatchObject({ status: "REVOKED", replayed: true });
    expect(replay).toHaveBeenCalledOnce();

    const opposite = vi.fn().mockResolvedValueOnce([
      registryRow({
        event_type: "RETIRED",
        reason: "ephemeral_test_key_retired",
        inserted: false,
      }),
    ]);
    await expect(
      transitionShipmentApvFailureAlertTestKey(
        { execute: opposite } as unknown as Pick<Database, "execute">,
        { keyId: signer.keyId, clientEventId, action: "REVOKE", changedBy: actor, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_KEY_EVENT_REPLAY_CONFLICT");
  });

  it("requires the registering actor and an active key for transition", async () => {
    const actorMismatch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow({ inserted: false })]);
    await expect(
      transitionShipmentApvFailureAlertTestKey(
        { execute: actorMismatch } as unknown as Pick<Database, "execute">,
        {
          keyId: signer.keyId,
          clientEventId,
          action: "REVOKE",
          changedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          now,
        },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_KEY_ACTOR_MISMATCH");

    const terminal = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow({ event_type: "RETIRED", inserted: false })]);
    await expect(
      transitionShipmentApvFailureAlertTestKey(
        { execute: terminal } as unknown as Pick<Database, "execute">,
        { keyId: signer.keyId, clientEventId, action: "REVOKE", changedBy: actor, now },
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_TERMINAL");
  });

  it("recovers an exact registration after losing a concurrent insert race", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow({ inserted: false })]);
    const result = await registerShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { clientEventId, registeredBy: actor, signer, now },
    );
    expect(result).toMatchObject({ status: "REGISTERED", replayed: true });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("recovers an exact transition after losing a concurrent insert race", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registryRow({ inserted: false })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        registryRow({
          event_type: "REVOKED",
          reason: "ephemeral_test_key_revoked",
          current_event_type: "REVOKED",
          current_reason: "ephemeral_test_key_revoked",
          inserted: false,
        }),
      ]);
    const result = await transitionShipmentApvFailureAlertTestKey(
      { execute } as unknown as Pick<Database, "execute">,
      { keyId: signer.keyId, clientEventId, action: "REVOKE", changedBy: actor, now },
    );
    expect(result).toMatchObject({ status: "REVOKED", replayed: true });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
