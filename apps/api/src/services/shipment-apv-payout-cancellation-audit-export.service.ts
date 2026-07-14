import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import {
  canonicalShipmentApvCancellationAuditJson,
  type ShipmentApvPayoutCancellationEventRecord,
  verifyShipmentApvCancellationEventChain,
} from "./shipment-apv-payout-cancellation.service.js";

export interface ShipmentApvPayoutCancellationAuditManifest {
  schema: "haggle.shipment-apv-payout-cancellation-audit.v1";
  cancellation_request_id: string;
  generated_at: string;
  event_count: number;
  events_sha256: string;
  chain_head_event_hash: string | null;
  chain_valid: boolean;
  chain_complete: boolean;
  sealed_events: number;
  legacy_unsealed_events: number;
}

export class ShipmentApvCancellationAuditSigningNotConfiguredError extends Error {
  constructor() {
    super("HAGGLE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is not configured");
    this.name = "ShipmentApvCancellationAuditSigningNotConfiguredError";
  }
}

function privateKeyFromBase64(value: string | undefined): KeyObject {
  if (!value?.trim()) throw new ShipmentApvCancellationAuditSigningNotConfiguredError();
  return createPrivateKey({
    key: Buffer.from(value.trim(), "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function createSignedShipmentApvPayoutCancellationAuditExport(input: {
  cancellationRequestId: string;
  events: ShipmentApvPayoutCancellationEventRecord[];
  generatedAt: Date;
  privateKey?: KeyObject;
  privateKeyBase64?: string;
}) {
  const chain = verifyShipmentApvCancellationEventChain(input.events);
  const eventsJson = canonicalShipmentApvCancellationAuditJson(input.events);
  const manifest: ShipmentApvPayoutCancellationAuditManifest = {
    schema: "haggle.shipment-apv-payout-cancellation-audit.v1",
    cancellation_request_id: input.cancellationRequestId,
    generated_at: input.generatedAt.toISOString(),
    event_count: input.events.length,
    events_sha256: createHash("sha256").update(eventsJson).digest("hex"),
    chain_head_event_hash: chain.headEventHash,
    chain_valid: chain.valid,
    chain_complete: chain.complete,
    sealed_events: chain.sealedEvents,
    legacy_unsealed_events: chain.legacyUnsealedEvents,
  };
  const privateKey =
    input.privateKey ??
    privateKeyFromBase64(
      input.privateKeyBase64 ??
        process.env.HAGGLE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 ??
        process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64,
    );
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const manifestBytes = Buffer.from(canonicalShipmentApvCancellationAuditJson(manifest));
  return {
    manifest,
    events: input.events,
    signature: {
      algorithm: "Ed25519" as const,
      key_id: createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24),
      public_key_spki_base64: publicKeyDer.toString("base64"),
      value_base64: sign(null, manifestBytes, privateKey).toString("base64"),
    },
  };
}

export function verifySignedShipmentApvPayoutCancellationAuditExport(
  value: ReturnType<typeof createSignedShipmentApvPayoutCancellationAuditExport>,
) {
  const chain = verifyShipmentApvCancellationEventChain(value.events);
  if (
    !chain.valid ||
    value.manifest.chain_valid !== chain.valid ||
    value.manifest.chain_complete !== chain.complete ||
    value.manifest.sealed_events !== chain.sealedEvents ||
    value.manifest.legacy_unsealed_events !== chain.legacyUnsealedEvents ||
    value.manifest.chain_head_event_hash !== chain.headEventHash ||
    value.manifest.event_count !== value.events.length ||
    value.events.some(
      (event) => event.cancellation_request_id !== value.manifest.cancellation_request_id,
    ) ||
    value.signature.algorithm !== "Ed25519"
  )
    return false;
  const eventsDigest = createHash("sha256")
    .update(canonicalShipmentApvCancellationAuditJson(value.events))
    .digest("hex");
  if (eventsDigest !== value.manifest.events_sha256) return false;
  const publicKey = createPublicKey({
    key: Buffer.from(value.signature.public_key_spki_base64, "base64"),
    format: "der",
    type: "spki",
  });
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  if (
    createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24) !== value.signature.key_id
  )
    return false;
  return verify(
    null,
    Buffer.from(canonicalShipmentApvCancellationAuditJson(value.manifest)),
    publicKey,
    Buffer.from(value.signature.value_base64, "base64"),
  );
}
