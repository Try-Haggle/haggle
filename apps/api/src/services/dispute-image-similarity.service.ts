import sharp from "sharp";

export const CAMERA_SIMILARITY_REVIEW_DISTANCE = 6;
export const CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE = 14;
export const CAMERA_SIMILARITY_COLOR_DISTANCE = 20;

export interface ImageSimilarityFingerprint {
  dHash: string;
  aHash: string;
  colorHistogram: number[];
}

export interface ImageSimilarityAssessment {
  reviewRequired: boolean;
  dHashDistance: number;
  aHashDistance: number | null;
  colorDistance: number | null;
  matchedSignals: string[];
  score: number;
}

export async function computeImageDHash(bytes: Buffer): Promise<string> {
  const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 9 || info.height !== 8 || info.channels !== 1 || data.length !== 72) {
    throw new Error("INVALID_DHASH_IMAGE_BUFFER");
  }
  let hash = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      hash += data[y * 9 + x]! > data[y * 9 + x + 1]! ? "1" : "0";
    }
  }
  return hash;
}

export function hammingDistance(left: string, right: string): number {
  if (!/^[01]{64}$/.test(left) || !/^[01]{64}$/.test(right)) {
    throw new Error("INVALID_DHASH");
  }
  let distance = 0;
  for (let index = 0; index < 64; index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance;
}

export async function computeImageSimilarityFingerprint(
  bytes: Buffer,
): Promise<ImageSimilarityFingerprint> {
  const image = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  const [{ data: averageData, info: averageInfo }, { data: colorData, info: colorInfo }, dHash] =
    await Promise.all([
      image
        .clone()
        .resize(8, 8, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      image
        .clone()
        .resize(32, 32, { fit: "cover" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      computeImageDHash(bytes),
    ]);
  if (
    averageInfo.width !== 8 ||
    averageInfo.height !== 8 ||
    averageInfo.channels !== 1 ||
    averageData.length !== 64
  ) {
    throw new Error("INVALID_AHASH_IMAGE_BUFFER");
  }
  if (
    colorInfo.width !== 32 ||
    colorInfo.height !== 32 ||
    colorInfo.channels !== 3 ||
    colorData.length !== 3072
  ) {
    throw new Error("INVALID_COLOR_HISTOGRAM_IMAGE_BUFFER");
  }
  const average = averageData.reduce((sum, value) => sum + value, 0) / averageData.length;
  const aHash = Array.from(averageData, (value) => (value >= average ? "1" : "0")).join("");
  const bins = Array.from({ length: 12 }, () => 0);
  for (let index = 0; index < colorData.length; index += 3) {
    bins[Math.min(3, Math.floor(colorData[index]! / 64))]! += 1;
    bins[4 + Math.min(3, Math.floor(colorData[index + 1]! / 64))]! += 1;
    bins[8 + Math.min(3, Math.floor(colorData[index + 2]! / 64))]! += 1;
  }
  const colorHistogram = bins.map((count) => Math.round((count / 1024) * 255));
  return { dHash, aHash, colorHistogram };
}

function validColorHistogram(value: number[] | null | undefined): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 12 &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  );
}

export function colorHistogramDistance(left: number[], right: number[]): number {
  if (!validColorHistogram(left) || !validColorHistogram(right))
    throw new Error("INVALID_COLOR_HISTOGRAM");
  const distance = left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0);
  return Math.round((distance / 1530) * 1000) / 10;
}

export function assessImageSimilarity(
  current: ImageSimilarityFingerprint,
  candidate: { dHash: string; aHash?: string | null; colorHistogram?: number[] | null },
): ImageSimilarityAssessment {
  const dHashDistance = hammingDistance(current.dHash, candidate.dHash);
  const aHashDistance = candidate.aHash ? hammingDistance(current.aHash, candidate.aHash) : null;
  const colorDistance = validColorHistogram(candidate.colorHistogram)
    ? colorHistogramDistance(current.colorHistogram, candidate.colorHistogram)
    : null;
  const observedSignals = [
    ...(dHashDistance <= CAMERA_SIMILARITY_REVIEW_DISTANCE ? ["dhash_near"] : []),
    ...(aHashDistance !== null && aHashDistance <= CAMERA_SIMILARITY_REVIEW_DISTANCE
      ? ["ahash_near"]
      : []),
  ];
  const structuralDual =
    aHashDistance !== null &&
    dHashDistance <= 10 &&
    aHashDistance <= CAMERA_SIMILARITY_REVIEW_DISTANCE;
  if (structuralDual) observedSignals.push("structure_dual_hash");
  const combined =
    aHashDistance !== null &&
    colorDistance !== null &&
    dHashDistance <= CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE &&
    aHashDistance <= CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE &&
    colorDistance <= CAMERA_SIMILARITY_COLOR_DISTANCE;
  if (combined) observedSignals.push("structure_color_combined");
  const normalized = [
    dHashDistance / CAMERA_SIMILARITY_REVIEW_DISTANCE,
    ...(aHashDistance === null
      ? []
      : [(dHashDistance / 10 + aHashDistance / CAMERA_SIMILARITY_REVIEW_DISTANCE) / 2]),
    ...(combined && colorDistance !== null
      ? [
          (dHashDistance / CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE +
            aHashDistance! / CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE +
            colorDistance / CAMERA_SIMILARITY_COLOR_DISTANCE) /
            3,
        ]
      : []),
  ];
  return {
    reviewRequired:
      dHashDistance <= CAMERA_SIMILARITY_REVIEW_DISTANCE || structuralDual || combined,
    dHashDistance,
    aHashDistance,
    colorDistance,
    matchedSignals: observedSignals,
    score: Math.round(Math.min(...normalized) * 1000) / 1000,
  };
}
