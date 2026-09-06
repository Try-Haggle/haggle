import { describe, expect, it } from "vitest";
import {
  buildDisputeEvidencePath,
  computeEvidenceRemainingLimits,
  DISPUTE_EVIDENCE_BUCKET,
  EVIDENCE_LIMITS,
  evaluateControlledEvidenceUploadGates,
  evidenceTypeFromContentType,
  qualifyDisputeEvidencePath,
  sanitizeDisputeFilename,
  stripDisputeEvidenceBucket,
  validateDisputeStoragePath,
} from "../lib/dispute-storage-paths.js";

const DISPUTE_ID = "some-id";

describe("dispute controlled evidence storage paths", () => {
  it("sanitizes safe filenames and rejects path separators", () => {
    expect(sanitizeDisputeFilename("battery-health.png")).toBe("battery-health.png");
    expect(() => sanitizeDisputeFilename("foo/bar.png")).toThrow(/disallowed characters/);
    expect(() => sanitizeDisputeFilename("../escape.png")).toThrow(
      /cannot start with a dot|disallowed characters/,
    );
    expect(() => sanitizeDisputeFilename(".hidden.png")).toThrow(/cannot start with a dot/);
    expect(() => sanitizeDisputeFilename("")).toThrow(/length out of range/);
  });

  it("builds an inner object path without the bucket prefix", () => {
    expect(buildDisputeEvidencePath(DISPUTE_ID, "upload_battery.png")).toBe(
      "some-id/upload_battery.png",
    );
  });

  it("qualifies inner paths and is idempotent for already-qualified paths", () => {
    expect(qualifyDisputeEvidencePath("some-id/upload_battery.png")).toBe(
      "dispute-evidence/some-id/upload_battery.png",
    );
    expect(qualifyDisputeEvidencePath("dispute-evidence/some-id/upload_battery.png")).toBe(
      "dispute-evidence/some-id/upload_battery.png",
    );
    expect(() => qualifyDisputeEvidencePath("other-id/../some-id/x.png")).toThrow(
      /traversal rejected/,
    );
  });

  it("validates commit storage paths for this dispute only", () => {
    expect(
      validateDisputeStoragePath(DISPUTE_ID, "dispute-evidence/some-id/upload_battery.png"),
    ).toBe("some-id/upload_battery.png");
    expect(validateDisputeStoragePath(DISPUTE_ID, "some-id/upload_battery.png")).toBe(
      "some-id/upload_battery.png",
    );
    expect(() =>
      validateDisputeStoragePath(DISPUTE_ID, "dispute-evidence/other-id/upload_battery.png"),
    ).toThrow(/does not match disputeId/);
    expect(() =>
      validateDisputeStoragePath(DISPUTE_ID, "dispute-evidence/some-id/../other/x.png"),
    ).toThrow(/traversal rejected/);
    expect(() => validateDisputeStoragePath(DISPUTE_ID, "not-a-path")).toThrow(
      /must be `\{disputeId\}\/\{filename\}`/,
    );
  });

  it("strips the private bucket prefix for storage SDK calls", () => {
    expect(stripDisputeEvidenceBucket("dispute-evidence/some-id/upload_battery.png")).toBe(
      "some-id/upload_battery.png",
    );
    expect(stripDisputeEvidenceBucket("some-id/upload_battery.png")).toBe(
      "some-id/upload_battery.png",
    );
    expect(() => stripDisputeEvidenceBucket("dispute-evidence/some-id/a/b.png")).toThrow(
      /stored object path is invalid/,
    );
  });

  it("keeps the design-doc storage_path shape stable", () => {
    const uploadId = "11111111-1111-1111-1111-111111111111";
    const inner = buildDisputeEvidencePath(DISPUTE_ID, `${uploadId}_battery-health.png`);
    const qualified = qualifyDisputeEvidencePath(inner);
    expect(qualified).toBe(
      `${DISPUTE_EVIDENCE_BUCKET}/${DISPUTE_ID}/${uploadId}_battery-health.png`,
    );
    expect(validateDisputeStoragePath(DISPUTE_ID, qualified)).toBe(inner);
  });
});

describe("controlled evidence mime/size/category gates", () => {
  it("classifies allowlisted mime types and rejects others", () => {
    expect(evidenceTypeFromContentType("image/png")).toBe("image");
    expect(evidenceTypeFromContentType("video/mp4")).toBe("video");
    expect(() => evidenceTypeFromContentType("application/pdf")).toThrow(
      /unsupported evidence content type/,
    );
  });

  it("rejects unsupported mime at the Controlled Evidence gate", () => {
    const gate = evaluateControlledEvidenceUploadGates({
      contentType: "image/gif",
      fileSizeBytes: 1000,
      imageCount: 0,
      videoCount: 0,
      orderAmountCents: 10_000,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("enforces image size and category count caps", () => {
    const tooLarge = evaluateControlledEvidenceUploadGates({
      contentType: "image/jpeg",
      fileSizeBytes: EVIDENCE_LIMITS.image.maxSizeBytes + 1,
      imageCount: 0,
      videoCount: 0,
      orderAmountCents: 10_000,
    });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.error).toBe("FILE_TOO_LARGE");

    const atCap = evaluateControlledEvidenceUploadGates({
      contentType: "image/png",
      fileSizeBytes: 1000,
      imageCount: EVIDENCE_LIMITS.image.maxCount,
      videoCount: 0,
      orderAmountCents: 10_000,
    });
    expect(atCap.ok).toBe(false);
    if (!atCap.ok) expect(atCap.error).toBe("IMAGE_LIMIT_REACHED");
  });

  it("uses the high-value video tier above the $500 threshold", () => {
    const standard = computeEvidenceRemainingLimits(0, 0, 49_999);
    expect(standard.remaining_videos).toBe(EVIDENCE_LIMITS.video_standard.maxCount);
    expect(standard.max_video_size_bytes).toBe(EVIDENCE_LIMITS.video_standard.maxSizeBytes);

    const high = computeEvidenceRemainingLimits(0, 0, EVIDENCE_LIMITS.high_value_threshold_cents);
    expect(high.remaining_videos).toBe(EVIDENCE_LIMITS.video_high_value.maxCount);
    expect(high.max_video_size_bytes).toBe(EVIDENCE_LIMITS.video_high_value.maxSizeBytes);

    const videoTooLarge = evaluateControlledEvidenceUploadGates({
      contentType: "video/mp4",
      fileSizeBytes: EVIDENCE_LIMITS.video_standard.maxSizeBytes + 1,
      imageCount: 0,
      videoCount: 0,
      orderAmountCents: 10_000,
    });
    expect(videoTooLarge.ok).toBe(false);
    if (!videoTooLarge.ok) expect(videoTooLarge.error).toBe("FILE_TOO_LARGE");

    const videoCap = evaluateControlledEvidenceUploadGates({
      contentType: "video/webm",
      fileSizeBytes: 1000,
      imageCount: 0,
      videoCount: EVIDENCE_LIMITS.video_standard.maxCount,
      orderAmountCents: 10_000,
    });
    expect(videoCap.ok).toBe(false);
    if (!videoCap.ok) expect(videoCap.error).toBe("VIDEO_LIMIT_REACHED");
  });

  it("accepts a valid image under the Controlled Evidence policy", () => {
    const gate = evaluateControlledEvidenceUploadGates({
      contentType: "image/webp",
      fileSizeBytes: 420_000,
      imageCount: 1,
      videoCount: 0,
      orderAmountCents: 50_000,
    });
    expect(gate).toEqual(
      expect.objectContaining({
        ok: true,
        evidenceType: "image",
      }),
    );
  });
});
