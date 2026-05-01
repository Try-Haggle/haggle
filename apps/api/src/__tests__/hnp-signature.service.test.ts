import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  validateHnpDetachedSignature,
  type HnpSignedEnvelope,
} from "../services/hnp-signature.service.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

describe("validateHnpDetachedSignature", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.HNP_TRUSTED_JWKS;
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("allows unsigned HNP messages when signatures are not required", () => {
    const result = validateHnpDetachedSignature(baseEnvelope());

    expect(result).toEqual({ ok: true, verified: false });
  });

  it("rejects unsigned HNP messages when signatures are required", () => {
    process.env.HNP_REQUIRE_SIGNATURE = "true";

    const result = validateHnpDetachedSignature(baseEnvelope());

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: "INVALID_SIGNATURE",
      relatedMessageId: "msg-1",
    });
  });

  it("requires unsigned HNP messages in production unless explicitly disabled", () => {
    process.env.NODE_ENV = "production";
    delete process.env.HNP_REQUIRE_SIGNATURE;

    const result = validateHnpDetachedSignature(baseEnvelope());

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: "INVALID_SIGNATURE",
    });
  });

  it("allows unsigned HNP messages in production only with explicit override", () => {
    process.env.NODE_ENV = "production";
    process.env.HNP_REQUIRE_SIGNATURE = "false";

    const result = validateHnpDetachedSignature(baseEnvelope());

    expect(result).toEqual({ ok: true, verified: false });
  });

  it("verifies a valid compact detached RS256 JWS", () => {
    process.env.HNP_TRUSTED_JWKS = JSON.stringify({
      keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }],
    });
    const envelope = signedEnvelope(baseEnvelope());

    const result = validateHnpDetachedSignature(envelope);

    expect(result).toEqual({ ok: true, verified: true });
  });

  it("verifies an RFC 7797 b64=false detached JWS", () => {
    process.env.HNP_TRUSTED_JWKS = JSON.stringify({
      keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }],
    });
    const envelope = signedEnvelope(baseEnvelope(), { b64: false });

    const result = validateHnpDetachedSignature(envelope);

    expect(result).toEqual({ ok: true, verified: true });
  });

  it("rejects a signature when the signed envelope is changed", () => {
    process.env.HNP_TRUSTED_JWKS = JSON.stringify({
      keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }],
    });
    const envelope = signedEnvelope(baseEnvelope());

    const result = validateHnpDetachedSignature({
      ...envelope,
      payload: { proposal_id: "proposal-1", total_price: { currency: "USD", units_minor: 9999 }, issues: [] },
    });

    expect(result).toMatchObject({ ok: false, status: 401, error: "INVALID_SIGNATURE" });
  });
});

function baseEnvelope(): HnpSignedEnvelope {
  return {
    spec_version: "2026-03-09",
    capability: "hnp.core.negotiation",
    session_id: "00000000-0000-4000-a000-000000000099",
    message_id: "msg-1",
    idempotency_key: "idem-1",
    sequence: 1,
    sent_at_ms: 1_777_000_000_000,
    expires_at_ms: 1_777_000_060_000,
    sender_agent_id: "buyer-001",
    sender_role: "BUYER",
    type: "OFFER",
    payload: {
      proposal_id: "proposal-1",
      issues: [],
      total_price: { currency: "USD", units_minor: 10000 },
    },
  };
}

function signedEnvelope(envelope: HnpSignedEnvelope, options: { b64?: false } = {}): HnpSignedEnvelope {
  const header = options.b64 === false
    ? { alg: "RS256", kid: "test-key", b64: false, crit: ["b64"] }
    : { alg: "RS256", kid: "test-key" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const canonicalPayload = canonicalJson(envelope);
  const payload = options.b64 === false
    ? canonicalPayload
    : Buffer.from(canonicalPayload).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${payload}`);
  signer.end();

  return {
    ...envelope,
    detached_signature: `${encodedHeader}..${signer.sign(privateKey).toString("base64url")}`,
  };
}
