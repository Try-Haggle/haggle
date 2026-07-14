import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  assessImageSimilarity,
  colorHistogramDistance,
  computeImageDHash,
  computeImageSimilarityFingerprint,
  hammingDistance,
} from "../services/dispute-image-similarity.service.js";

async function fixture(width: number, height: number, quality = 90): Promise<Buffer> {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      data[offset + 1] = y < height / 2 ? 40 : 210;
      data[offset + 2] = x < width / 2 ? 220 : 30;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).jpeg({ quality }).toBuffer();
}

async function distinctFixture(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const block = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      data[offset] = block ? 240 : 10;
      data[offset + 1] = block ? 20 : 235;
      data[offset + 2] = (x * 13 + y * 7) % 256;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

describe("camera image similarity", () => {
  it("produces a stable 64-bit dHash", async () => {
    const hash = await computeImageDHash(await fixture(96, 64));
    expect(hash).toMatch(/^[01]{64}$/);
  });

  it("keeps resized and recompressed copies close", async () => {
    const original = await computeImageDHash(await fixture(96, 64, 95));
    const recompressed = await computeImageDHash(await fixture(192, 128, 45));
    expect(hammingDistance(original, recompressed)).toBeLessThanOrEqual(6);
  });

  it("rejects malformed hashes", () => {
    expect(() => hammingDistance("101", "010")).toThrow("INVALID_DHASH");
  });

  it("computes structural, luminance, and color fingerprints from pixels", async () => {
    const fingerprint = await computeImageSimilarityFingerprint(await fixture(96, 64));
    expect(fingerprint.dHash).toMatch(/^[01]{64}$/);
    expect(fingerprint.aHash).toMatch(/^[01]{64}$/);
    expect(fingerprint.colorHistogram).toHaveLength(12);
    expect(fingerprint.colorHistogram.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
  });

  it("routes resized and recompressed copies to review using multiple signals", async () => {
    const original = await computeImageSimilarityFingerprint(await fixture(96, 64, 95));
    const recompressed = await computeImageSimilarityFingerprint(await fixture(192, 128, 45));
    const assessment = assessImageSimilarity(recompressed, original);
    expect(assessment.reviewRequired).toBe(true);
    expect(assessment.dHashDistance).toBeLessThanOrEqual(6);
    expect(assessment.aHashDistance).toBeLessThanOrEqual(6);
    expect(assessment.matchedSignals).toEqual(expect.arrayContaining(["dhash_near", "ahash_near"]));
  });

  it("routes a modest crop of the same photo to review", async () => {
    const originalBytes = await fixture(96, 64, 95);
    const croppedBytes = await sharp(originalBytes).extract({ left: 6, top: 4, width: 84, height: 56 }).resize(96, 64).jpeg({ quality: 70 }).toBuffer();
    const assessment = assessImageSimilarity(
      await computeImageSimilarityFingerprint(croppedBytes),
      await computeImageSimilarityFingerprint(originalBytes),
    );
    expect(assessment.reviewRequired).toBe(true);
    expect(assessment.matchedSignals.length).toBeGreaterThan(0);
  });

  it("keeps strong recoloring reviewable through structural hashes", async () => {
    const originalBytes = await fixture(96, 64, 95);
    const recoloredBytes = await sharp(originalBytes).tint({ r: 30, g: 220, b: 180 }).jpeg({ quality: 75 }).toBuffer();
    const assessment = assessImageSimilarity(
      await computeImageSimilarityFingerprint(recoloredBytes),
      await computeImageSimilarityFingerprint(originalBytes),
    );
    expect(assessment.reviewRequired).toBe(true);
    expect(assessment.matchedSignals.some((signal) => signal === "dhash_near" || signal === "ahash_near")).toBe(true);
  });

  it("keeps structurally different image pixels clear", async () => {
    const assessment = assessImageSimilarity(
      await computeImageSimilarityFingerprint(await distinctFixture(96, 64)),
      await computeImageSimilarityFingerprint(await fixture(96, 64, 95)),
    );
    expect(assessment.reviewRequired).toBe(false);
    expect(assessment.matchedSignals).toEqual([]);
  });

  it("does not flag color similarity alone without structural agreement", () => {
    const current = { dHash: "0".repeat(64), aHash: "0".repeat(64), colorHistogram: Array(12).fill(64) };
    const candidate = { dHash: "1".repeat(64), aHash: "1".repeat(64), colorHistogram: Array(12).fill(64) };
    expect(assessImageSimilarity(current, candidate)).toMatchObject({ reviewRequired: false, colorDistance: 0, matchedSignals: [] });
  });

  it("does not use aHash as a standalone review trigger", () => {
    const current = { dHash: "0".repeat(64), aHash: "1".repeat(64), colorHistogram: Array(12).fill(0) };
    const candidate = { dHash: "1".repeat(64), aHash: "1".repeat(64), colorHistogram: Array(12).fill(255) };
    const assessment = assessImageSimilarity(current, candidate);
    expect(assessment).toMatchObject({ reviewRequired: false, aHashDistance: 0 });
    expect(assessment.matchedSignals).toContain("ahash_near");
  });

  it("rejects malformed color fingerprints", () => {
    expect(() => colorHistogramDistance([1], [1])).toThrow("INVALID_COLOR_HISTOGRAM");
  });
});
