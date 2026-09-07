/**
 * F2 goldens: upload/confirm → content_hash fixed; tamper detectable.
 * Chain submit / ANCHORED persistence is out of scope (status enum only).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  advanceEvidenceAnchorStatus,
  buildEvidenceHashAnchor,
  canAdvanceEvidenceAnchorStatus,
  hashEvidenceBytes,
  hashEvidenceTextPayload,
  initialEvidenceHashAnchor,
  verifyEvidenceContentHash,
} from "../evidence-hash-anchor.js";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("F2 evidence hash anchor goldens", () => {
  it("upload/confirm bytes → fixed content_hash + HASHED", () => {
    const payload = utf8("buyer-photo-bytes-v1");
    const expected = createHash("sha256").update(payload).digest("hex");

    const meta = buildEvidenceHashAnchor({
      type: "image",
      bytes: payload,
      knownContentHash: expected,
    });

    expect(meta).toEqual({ content_hash: expected, anchor_status: "HASHED" });
    expect(hashEvidenceBytes(payload)).toBe(expected);
    expect(initialEvidenceHashAnchor(expected).anchor_status).toBe("HASHED");
  });

  it("same bytes always produce the same content_hash (fixed)", () => {
    const payload = utf8("fixed-evidence-payload");
    const again = utf8("fixed-evidence-payload");
    expect(hashEvidenceBytes(payload)).toBe(hashEvidenceBytes(again));
    expect(buildEvidenceHashAnchor({ type: "image", bytes: payload }).content_hash).toBe(
      hashEvidenceBytes(payload),
    );
  });

  it("tamper detectable: mutated bytes fail verifyEvidenceContentHash", () => {
    const original = utf8("clean-evidence");
    const stored = hashEvidenceBytes(original);
    expect(verifyEvidenceContentHash(stored, original)).toEqual({ ok: true });

    const tampered = utf8("clean-evidence!");
    const result = verifyEvidenceContentHash(stored, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.expected).toBe(stored);
      expect(result.actual).toBe(hashEvidenceBytes(tampered));
      expect(result.actual).not.toBe(stored);
    }
  });

  it("text evidence hash is schema-versioned and stable", () => {
    const a = hashEvidenceTextPayload({
      type: "text",
      text: "Battery was 95% at listing",
      uri: null,
    });
    const b = hashEvidenceTextPayload({
      type: "text",
      text: "Battery was 95% at listing",
      uri: undefined,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);

    const changed = hashEvidenceTextPayload({
      type: "text",
      text: "Battery was 94% at listing",
    });
    expect(changed).not.toBe(a);

    const meta = buildEvidenceHashAnchor({
      type: "text",
      text: "Battery was 95% at listing",
    });
    expect(meta).toEqual({ content_hash: a, anchor_status: "HASHED" });
  });

  it("anchor_status advances HASHED → PENDING_CHAIN → ANCHORED without forcing TX", () => {
    expect(canAdvanceEvidenceAnchorStatus("HASHED", "PENDING_CHAIN")).toBe(true);
    expect(canAdvanceEvidenceAnchorStatus("PENDING_CHAIN", "ANCHORED")).toBe(true);
    expect(canAdvanceEvidenceAnchorStatus("HASHED", "ANCHORED")).toBe(false);
    expect(canAdvanceEvidenceAnchorStatus("ANCHORED", "HASHED")).toBe(false);

    expect(advanceEvidenceAnchorStatus("HASHED", "PENDING_CHAIN")).toBe("PENDING_CHAIN");
    expect(advanceEvidenceAnchorStatus("PENDING_CHAIN", "ANCHORED")).toBe("ANCHORED");
    expect(() => advanceEvidenceAnchorStatus("HASHED", "ANCHORED")).toThrow(
      /invalid evidence anchor_status transition/,
    );
  });
});
