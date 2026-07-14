import { sql, type Database } from "@haggle/db";
import type { ShipmentApvFailureAlertPayloadSigner } from
  "./shipment-apv-chaos-failure-alert-signature.service.js";

type KeyEventType = "REGISTERED" | "RETIRED" | "REVOKED";

type RegistryRow = {
  key_id: unknown;
  algorithm: unknown;
  public_key_spki_base64: unknown;
  registered_by: unknown;
  registered_at: unknown;
  event_id: unknown;
  client_event_id: unknown;
  event_type: unknown;
  reason: unknown;
  changed_by: unknown;
  event_created_at: unknown;
  current_event_type: unknown;
  current_reason: unknown;
  current_event_created_at: unknown;
  inserted: unknown;
};

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicRegistry(row: RegistryRow) {
  return {
    schemaVersion: "shipment-apv-failure-alert-test-key-registry-v1",
    keyId: String(row.key_id),
    algorithm: "Ed25519" as const,
    publicKeySpkiBase64: String(row.public_key_spki_base64),
    eventType: String(row.event_type) as KeyEventType,
    eventReason: String(row.reason),
    status: String(row.current_event_type ?? row.event_type) as KeyEventType,
    lifecycleReason: String(row.current_reason ?? row.reason),
    registeredAt: iso(row.registered_at),
    lastTransitionAt: iso(row.current_event_created_at ?? row.event_created_at),
    replayed: row.inserted === false,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY" as const,
    registry: "DATABASE_TEST_REGISTRY" as const,
    independentTrustAnchor: false,
    privateKeyExposed: false,
  };
}

function registrationMatches(row: RegistryRow, input: {
  clientEventId: string; registeredBy: string; signer: ShipmentApvFailureAlertPayloadSigner;
}) {
  return String(row.client_event_id) === input.clientEventId
    && String(row.changed_by) === input.registeredBy
    && String(row.key_id) === input.signer.keyId
    && String(row.public_key_spki_base64) === input.signer.publicKeySpkiBase64
    && String(row.event_type) === "REGISTERED";
}

async function loadRegistryEvent(db: Pick<Database, "execute">, clientEventId: string) {
  const rows = await db.execute(sql`SELECT key.*, event.id AS event_id,
      event.client_event_id, event.event_type, event.reason, event.changed_by,
      event.created_at AS event_created_at,
      current_event.event_type AS current_event_type,
      current_event.reason AS current_reason,
      current_event.created_at AS current_event_created_at, false AS inserted
    FROM shipment_apv_failure_alert_signing_key_events event
    JOIN shipment_apv_failure_alert_signing_keys key ON key.key_id = event.key_id
    JOIN LATERAL (
      SELECT latest.event_type, latest.reason, latest.created_at
      FROM shipment_apv_failure_alert_signing_key_events latest
      WHERE latest.key_id = key.key_id
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    ) current_event ON true
    WHERE event.client_event_id = ${clientEventId}::uuid LIMIT 1`);
  return (rows as unknown as RegistryRow[])[0];
}

async function loadCurrentRegistryKey(db: Pick<Database, "execute">, keyId: string) {
  const rows = await db.execute(sql`SELECT key.*, event.id AS event_id,
      event.client_event_id, event.event_type, event.reason, event.changed_by,
      event.created_at AS event_created_at, event.event_type AS current_event_type,
      event.reason AS current_reason, event.created_at AS current_event_created_at,
      false AS inserted
    FROM shipment_apv_failure_alert_signing_keys key
    LEFT JOIN LATERAL (
      SELECT key_event.* FROM shipment_apv_failure_alert_signing_key_events key_event
      WHERE key_event.key_id = key.key_id
      ORDER BY key_event.created_at DESC, key_event.id DESC LIMIT 1
    ) event ON true WHERE key.key_id = ${keyId} LIMIT 1`);
  return (rows as unknown as RegistryRow[])[0];
}

export async function registerShipmentApvFailureAlertTestKey(
  db: Pick<Database, "execute">,
  input: { clientEventId: string; registeredBy: string;
    signer: ShipmentApvFailureAlertPayloadSigner; now?: Date },
) {
  const now = input.now ?? new Date();
  const existing = await loadRegistryEvent(db, input.clientEventId);
  if (existing) {
    if (!registrationMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_EVENT_REPLAY_CONFLICT");
    }
    return publicRegistry(existing);
  }

  const current = await loadCurrentRegistryKey(db, input.signer.keyId);
  if (current) {
    if (String(current.public_key_spki_base64) !== input.signer.publicKeySpkiBase64
      || String(current.registered_by) !== input.registeredBy) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_REGISTRY_BINDING_CONFLICT");
    }
    if (String(current.event_type) === "REGISTERED") return publicRegistry(current);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_TERMINAL");
  }

  const rows = await db.execute(sql`WITH inserted_key AS (
      INSERT INTO shipment_apv_failure_alert_signing_keys
        (key_id, algorithm, public_key_spki_base64, registered_by, registered_at)
      VALUES (${input.signer.keyId}, 'Ed25519', ${input.signer.publicKeySpkiBase64},
        ${input.registeredBy}::uuid, ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING *
    ), inserted_event AS (
      INSERT INTO shipment_apv_failure_alert_signing_key_events
        (client_event_id, key_id, event_type, reason, changed_by, created_at)
      SELECT ${input.clientEventId}::uuid, key.key_id, 'REGISTERED',
        'ephemeral_test_key_registered', ${input.registeredBy}::uuid,
        ${now.toISOString()}::timestamptz FROM inserted_key key
      RETURNING *
    ) SELECT key.*, event.id AS event_id, event.client_event_id,
      event.event_type, event.reason, event.changed_by,
      event.created_at AS event_created_at, event.event_type AS current_event_type,
      event.reason AS current_reason, event.created_at AS current_event_created_at,
      true AS inserted
    FROM inserted_key key JOIN inserted_event event ON event.key_id = key.key_id`);
  const row = (rows as unknown as RegistryRow[])[0];
  if (!row) {
    const concurrent = await loadRegistryEvent(db, input.clientEventId);
    if (concurrent) {
      if (registrationMatches(concurrent, input)) return publicRegistry(concurrent);
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_EVENT_REPLAY_CONFLICT");
    }
    const winner = await loadCurrentRegistryKey(db, input.signer.keyId);
    if (winner && String(winner.public_key_spki_base64) === input.signer.publicKeySpkiBase64
      && String(winner.registered_by) === input.registeredBy
      && String(winner.event_type) === "REGISTERED") return publicRegistry(winner);
    if (winner) throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_REGISTRY_BINDING_CONFLICT");
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_REGISTRY_UNAVAILABLE");
  }
  return publicRegistry(row);
}

function transitionMatches(row: RegistryRow, input: {
  keyId: string; clientEventId: string; action: "RETIRE" | "REVOKE"; changedBy: string;
}) {
  const expected = input.action === "RETIRE" ? "RETIRED" : "REVOKED";
  return String(row.client_event_id) === input.clientEventId
    && String(row.key_id) === input.keyId && String(row.changed_by) === input.changedBy
    && String(row.event_type) === expected;
}

export async function transitionShipmentApvFailureAlertTestKey(
  db: Pick<Database, "execute">,
  input: { keyId: string; clientEventId: string; action: "RETIRE" | "REVOKE";
    changedBy: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const existing = await loadRegistryEvent(db, input.clientEventId);
  if (existing) {
    if (!transitionMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_EVENT_REPLAY_CONFLICT");
    }
    return publicRegistry(existing);
  }

  const currentRows = await db.execute(sql`SELECT key.*, event.id AS event_id,
      event.client_event_id, event.event_type, event.reason, event.changed_by,
      event.created_at AS event_created_at, event.event_type AS current_event_type,
      event.reason AS current_reason, event.created_at AS current_event_created_at,
      false AS inserted
    FROM shipment_apv_failure_alert_signing_keys key
    JOIN LATERAL (
      SELECT key_event.* FROM shipment_apv_failure_alert_signing_key_events key_event
      WHERE key_event.key_id = key.key_id
      ORDER BY key_event.created_at DESC, key_event.id DESC LIMIT 1
    ) event ON true WHERE key.key_id = ${input.keyId} LIMIT 1`);
  const current = (currentRows as unknown as RegistryRow[])[0];
  if (!current) throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_FOUND");
  if (String(current.registered_by) !== input.changedBy) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_ACTOR_MISMATCH");
  }
  if (String(current.event_type) !== "REGISTERED") {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_TERMINAL");
  }
  const eventType = input.action === "RETIRE" ? "RETIRED" : "REVOKED";
  const reason = input.action === "RETIRE"
    ? "ephemeral_test_key_retired" : "ephemeral_test_key_revoked";
  const rows = await db.execute(sql`WITH inserted_event AS (
      INSERT INTO shipment_apv_failure_alert_signing_key_events
        (client_event_id, key_id, event_type, reason, changed_by, created_at)
      VALUES (${input.clientEventId}::uuid, ${input.keyId}, ${eventType}, ${reason},
        ${input.changedBy}::uuid, ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING *
    ) SELECT key.*, event.id AS event_id, event.client_event_id,
      event.event_type, event.reason, event.changed_by,
      event.created_at AS event_created_at, event.event_type AS current_event_type,
      event.reason AS current_reason, event.created_at AS current_event_created_at,
      true AS inserted
    FROM inserted_event event JOIN shipment_apv_failure_alert_signing_keys key
      ON key.key_id = event.key_id`);
  const row = (rows as unknown as RegistryRow[])[0];
  if (!row) {
    const concurrent = await loadRegistryEvent(db, input.clientEventId);
    if (concurrent) {
      if (transitionMatches(concurrent, input)) return publicRegistry(concurrent);
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_EVENT_REPLAY_CONFLICT");
    }
    const winner = await loadCurrentRegistryKey(db, input.keyId);
    if (!winner) throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_FOUND");
    if (String(winner.registered_by) !== input.changedBy) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_ACTOR_MISMATCH");
    }
    if (String(winner.event_type) !== "REGISTERED") {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_TERMINAL");
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_KEY_REGISTRY_UNAVAILABLE");
  }
  return publicRegistry(row);
}
