import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { getShipmentApvChaosFailureAlertPreview } from "./shipment-apv-chaos-failure-alert-preview.service.js";

const SIGNING_DOMAIN = "haggle.shipment-apv-failure-alert.payload-sha256.v1";

type SignatureRow = {
  id: unknown;
  client_signature_id: unknown;
  payload_outbox_id: unknown;
  payload_sha256: unknown;
  signing_domain: unknown;
  algorithm: unknown;
  key_id: unknown;
  public_key_spki_base64: unknown;
  signature_base64: unknown;
  status: unknown;
  signed_by: unknown;
  signed_at: unknown;
  inserted: unknown;
};

type BindingRow = {
  outbox_id: unknown;
  payload_sha256: unknown;
  state_fingerprint: unknown;
  created_by: unknown;
  cooldown_expires_at: unknown;
  signature_id: unknown;
  client_signature_id: unknown;
  signing_domain: unknown;
  algorithm: unknown;
  key_id: unknown;
  public_key_spki_base64: unknown;
  signature_base64: unknown;
  signature_status: unknown;
  signed_by: unknown;
  signed_at: unknown;
};

type RegistryRow = {
  key_id: unknown;
  public_key_spki_base64: unknown;
  event_type: unknown;
};

export type ShipmentApvFailureAlertPayloadSigner = {
  keyId: string;
  publicKeySpkiBase64: string;
  signMessage(message: Buffer): string;
};

function signingMessage(payloadSha256: string) {
  return Buffer.from(`${SIGNING_DOMAIN}:${payloadSha256}`, "utf8");
}

function keyId(publicKeyDer: Buffer) {
  return createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24);
}

export function createShipmentApvFailureAlertTestSigner(
  privateKey?: KeyObject,
): ShipmentApvFailureAlertPayloadSigner {
  const signingKey = privateKey ?? generateKeyPairSync("ed25519").privateKey;
  if (signingKey.asymmetricKeyType !== "ed25519") {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_INVALID");
  }
  const publicKeyDer = createPublicKey(signingKey).export({ format: "der", type: "spki" });
  return {
    keyId: keyId(publicKeyDer),
    publicKeySpkiBase64: publicKeyDer.toString("base64"),
    signMessage: (message) => sign(null, message, signingKey).toString("base64"),
  };
}

let testSigner: ShipmentApvFailureAlertPayloadSigner | undefined;

export function getShipmentApvFailureAlertTestSigner() {
  testSigner ??= createShipmentApvFailureAlertTestSigner();
  return testSigner;
}

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function signatureMatches(
  row: SignatureRow,
  input: {
    clientSignatureId: string;
    payloadOutboxId: string;
    signedBy: string;
  },
) {
  return (
    String(row.client_signature_id) === input.clientSignatureId &&
    String(row.payload_outbox_id) === input.payloadOutboxId &&
    String(row.signed_by) === input.signedBy
  );
}

export function verifyShipmentApvFailureAlertPayloadSignature(value: {
  payloadSha256: string;
  signingDomain: string;
  algorithm: string;
  keyId: string;
  publicKeySpkiBase64: string;
  signatureBase64: string;
}) {
  try {
    if (
      value.signingDomain !== SIGNING_DOMAIN ||
      value.algorithm !== "Ed25519" ||
      !/^[0-9a-f]{64}$/.test(value.payloadSha256) ||
      !/^[0-9a-f]{24}$/.test(value.keyId)
    )
      return false;
    const publicKeyDer = Buffer.from(value.publicKeySpkiBase64, "base64");
    const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519" || keyId(publicKeyDer) !== value.keyId) {
      return false;
    }
    return verify(
      null,
      signingMessage(value.payloadSha256),
      publicKey,
      Buffer.from(value.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

function publicSignature(row: SignatureRow) {
  const receipt = {
    schemaVersion: "shipment-apv-failure-alert-payload-signature-v1",
    id: String(row.id),
    clientSignatureId: String(row.client_signature_id),
    payloadOutboxId: String(row.payload_outbox_id),
    payloadSha256: String(row.payload_sha256),
    signingDomain: String(row.signing_domain),
    algorithm: String(row.algorithm),
    keyId: String(row.key_id),
    publicKeySpkiBase64: String(row.public_key_spki_base64),
    signatureBase64: String(row.signature_base64),
    status: "SIGNED_DRY_RUN" as const,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY" as const,
    registryBound: true,
    registryStatusAtSigning: "ACTIVE" as const,
    independentTrustAnchor: false,
    trustAnchored: false,
    signedAt: iso(row.signed_at),
    replayed: row.inserted === false,
    signatureVerified: false,
    privateKeyExposed: false,
    delivery: { enabled: false, attempted: false },
  };
  if (!verifyShipmentApvFailureAlertPayloadSignature(receipt)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_INTEGRITY_FAILED");
  }
  return { ...receipt, signatureVerified: true };
}

function signatureFromBinding(row: BindingRow): SignatureRow | null {
  if (!row.signature_id) return null;
  return {
    id: row.signature_id,
    client_signature_id: row.client_signature_id,
    payload_outbox_id: row.outbox_id,
    payload_sha256: row.payload_sha256,
    signing_domain: row.signing_domain,
    algorithm: row.algorithm,
    key_id: row.key_id,
    public_key_spki_base64: row.public_key_spki_base64,
    signature_base64: row.signature_base64,
    status: row.signature_status,
    signed_by: row.signed_by,
    signed_at: row.signed_at,
    inserted: false,
  };
}

export async function createShipmentApvFailureAlertPayloadSignature(
  db: Pick<Database, "execute">,
  input: {
    payloadOutboxId: string;
    clientSignatureId: string;
    signedBy: string;
    signer: ShipmentApvFailureAlertPayloadSigner;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_payload_signatures
    WHERE client_signature_id = ${input.clientSignatureId}::uuid LIMIT 1`);
  const existing = (existingRows as unknown as SignatureRow[])[0];
  if (existing) {
    if (!signatureMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_REPLAY_CONFLICT");
    }
    return publicSignature(existing);
  }

  const bindingRows = await db.execute(sql`SELECT outbox.id AS outbox_id,
      outbox.payload_sha256, outbox.state_fingerprint, outbox.created_by,
      delivery_grant.cooldown_expires_at,
      signature.id AS signature_id, signature.client_signature_id,
      signature.signing_domain, signature.algorithm, signature.key_id,
      signature.public_key_spki_base64, signature.signature_base64,
      signature.status AS signature_status, signature.signed_by, signature.signed_at
    FROM shipment_apv_failure_alert_payload_outbox outbox
    JOIN shipment_apv_failure_alert_delivery_grants delivery_grant
      ON delivery_grant.id = outbox.delivery_grant_id
    LEFT JOIN shipment_apv_failure_alert_payload_signatures signature
      ON signature.payload_outbox_id = outbox.id
    WHERE outbox.id = ${input.payloadOutboxId}::uuid LIMIT 1`);
  const binding = (bindingRows as unknown as BindingRow[])[0];
  if (!binding) throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_OUTBOX_NOT_FOUND");
  if (String(binding.created_by) !== input.signedBy) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_ACTOR_MISMATCH");
  }
  const prior = signatureFromBinding(binding);
  if (prior) {
    if (signatureMatches(prior, input)) return publicSignature(prior);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ALREADY_SIGNED");
  }
  if (Date.parse(String(binding.cooldown_expires_at)) <= now.getTime()) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_EXPIRED");
  }
  const registryRows = await db.execute(sql`SELECT key.key_id,
      key.public_key_spki_base64, event.event_type
    FROM shipment_apv_failure_alert_signing_keys key
    JOIN LATERAL (
      SELECT key_event.event_type
      FROM shipment_apv_failure_alert_signing_key_events key_event
      WHERE key_event.key_id = key.key_id
      ORDER BY key_event.created_at DESC, key_event.id DESC LIMIT 1
    ) event ON true
    WHERE key.key_id = ${input.signer.keyId} LIMIT 1`);
  const registry = (registryRows as unknown as RegistryRow[])[0];
  if (
    !registry ||
    String(registry.event_type) !== "REGISTERED" ||
    String(registry.public_key_spki_base64) !== input.signer.publicKeySpkiBase64
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_ACTIVE");
  }
  const preview = await getShipmentApvChaosFailureAlertPreview(db, now);
  if (
    preview.action === "none" ||
    !preview.approval.required ||
    preview.stateFingerprint !== String(binding.state_fingerprint)
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  }

  const payloadSha256 = String(binding.payload_sha256);
  const signatureBase64 = input.signer.signMessage(signingMessage(payloadSha256));
  const candidate = {
    payloadSha256,
    signingDomain: SIGNING_DOMAIN,
    algorithm: "Ed25519",
    keyId: input.signer.keyId,
    publicKeySpkiBase64: input.signer.publicKeySpkiBase64,
    signatureBase64,
  };
  if (!verifyShipmentApvFailureAlertPayloadSignature(candidate)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNER_VERIFICATION_FAILED");
  }

  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_failure_alert_payload_signatures
        (client_signature_id, payload_outbox_id, payload_sha256, signing_domain,
          algorithm, key_id, public_key_spki_base64, signature_base64,
          status, signed_by, signed_at)
      VALUES (${input.clientSignatureId}::uuid, ${input.payloadOutboxId}::uuid,
        ${payloadSha256}, ${SIGNING_DOMAIN}, 'Ed25519', ${input.signer.keyId},
        ${input.signer.publicKeySpkiBase64}, ${signatureBase64}, 'SIGNED_DRY_RUN',
        ${input.signedBy}::uuid, ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING *, true AS inserted
    ) SELECT * FROM inserted
    UNION ALL
    SELECT existing.*, false AS inserted
    FROM shipment_apv_failure_alert_payload_signatures existing
    WHERE (existing.client_signature_id = ${input.clientSignatureId}::uuid
      OR existing.payload_outbox_id = ${input.payloadOutboxId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1`);
  const row = (rows as unknown as SignatureRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_UNAVAILABLE");
  if (!signatureMatches(row, input)) {
    if (String(row.payload_outbox_id) === input.payloadOutboxId) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ALREADY_SIGNED");
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_REPLAY_CONFLICT");
  }
  return publicSignature(row);
}
