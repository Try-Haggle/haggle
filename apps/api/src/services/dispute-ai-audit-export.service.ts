import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  canonicalDisputeAuditJson,
  type HashableDisputeAiAssessmentEvent,
} from "./dispute-ai-assessment-event.service.js";

export interface DisputeAiAuditManifest {
  schema: "haggle.dispute-ai-audit.v1";
  dispute_id: string;
  generated_at: string;
  event_count: number;
  events_sha256: string;
  chain_head_event_hash: string | null;
  chain_valid: boolean;
  chain_complete: boolean;
  sealed_events: number;
  legacy_unsealed_events: number;
}

export class DisputeAuditSigningNotConfiguredError extends Error {
  constructor() {
    super("DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is not configured");
    this.name = "DisputeAuditSigningNotConfiguredError";
  }
}

function privateKeyFromBase64(value: string | undefined): KeyObject {
  if (!value?.trim()) throw new DisputeAuditSigningNotConfiguredError();
  return createPrivateKey({ key: Buffer.from(value.trim(), "base64"), format: "der", type: "pkcs8" });
}

export function createSignedDisputeAiAuditExport(input: {
  disputeId: string;
  events: HashableDisputeAiAssessmentEvent[];
  generatedAt: Date;
  chain: {
    valid: boolean;
    complete: boolean;
    headEventHash: string | null;
    sealedEvents: number;
    legacyUnsealedEvents: number;
  };
  privateKey?: KeyObject;
  privateKeyBase64?: string;
}) {
  const eventsJson = canonicalDisputeAuditJson(input.events);
  const manifest: DisputeAiAuditManifest = {
    schema: "haggle.dispute-ai-audit.v1",
    dispute_id: input.disputeId,
    generated_at: input.generatedAt.toISOString(),
    event_count: input.events.length,
    events_sha256: createHash("sha256").update(eventsJson).digest("hex"),
    chain_head_event_hash: input.chain.headEventHash,
    chain_valid: input.chain.valid,
    chain_complete: input.chain.complete,
    sealed_events: input.chain.sealedEvents,
    legacy_unsealed_events: input.chain.legacyUnsealedEvents,
  };
  const privateKey = input.privateKey
    ?? privateKeyFromBase64(input.privateKeyBase64 ?? process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64);
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const manifestBytes = Buffer.from(canonicalDisputeAuditJson(manifest));
  return {
    manifest,
    events: input.events,
    signature: {
      algorithm: "Ed25519",
      key_id: createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24),
      public_key_spki_base64: publicKeyDer.toString("base64"),
      value_base64: sign(null, manifestBytes, privateKey).toString("base64"),
    },
  };
}

export function verifySignedDisputeAiAuditExport(value: ReturnType<typeof createSignedDisputeAiAuditExport>): boolean {
  try {
    if (value.signature.algorithm !== "Ed25519") return false;
    const eventsDigest = createHash("sha256").update(canonicalDisputeAuditJson(value.events)).digest("hex");
    if (eventsDigest !== value.manifest.events_sha256) return false;
    const publicKeyDer = Buffer.from(value.signature.public_key_spki_base64, "base64");
    if (createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24) !== value.signature.key_id) return false;
    const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return verify(null, Buffer.from(canonicalDisputeAuditJson(value.manifest)), publicKey,
      Buffer.from(value.signature.value_base64, "base64"));
  } catch { return false; }
}
