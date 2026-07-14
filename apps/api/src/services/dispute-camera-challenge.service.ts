import { createHash } from "node:crypto";

export type CameraChallengeVerificationStatus = "VERIFIED" | "REJECTED" | "PENDING" | "FAILED";
export const CAMERA_VISUAL_OBSERVATION_CATEGORIES = [
  "item_condition", "packaging_condition", "visible_damage", "item_identity", "quantity", "label_text", "other",
] as const;
export type CameraVisualObservationCategory = typeof CAMERA_VISUAL_OBSERVATION_CATEGORIES[number];
export interface CameraVisualObservation {
  category: CameraVisualObservationCategory;
  observation: string;
  confidence: number;
}

export interface CameraChallengeVerificationResult {
  status: CameraChallengeVerificationStatus;
  provider: string;
  detail: string;
  confidence?: number;
  detectedText?: string;
  visualObservations?: CameraVisualObservation[];
}

function visualObservations(value: unknown): CameraVisualObservation[] {
  if (!Array.isArray(value)) return [];
  const categories = new Set<string>(CAMERA_VISUAL_OBSERVATION_CATEGORIES);
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const category = typeof record.category === "string" && categories.has(record.category)
      ? record.category as CameraVisualObservationCategory : null;
    const observation = typeof record.observation === "string"
      ? record.observation.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) : "";
    const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
      && record.confidence >= 0 && record.confidence <= 1 ? record.confidence : null;
    return category && observation && confidence !== null ? [{ category, observation, confidence }] : [];
  });
}

function normalizedChallenge(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function verifierUrl(): string | null {
  const value = process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL?.trim();
  if (!value) return null;
  const url = new URL(value);
  const production = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (production && url.protocol !== "https:") {
    throw new Error("Camera challenge verifier URL must use HTTPS in production");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Camera challenge verifier URL protocol is unsupported");
  }
  return url.toString();
}

export async function verifyCameraChallenge(input: {
  bytes: Buffer;
  contentType: string;
  challengeCode: string;
  filename: string;
}): Promise<CameraChallengeVerificationResult> {
  const url = verifierUrl();
  if (!url) {
    return {
      status: "PENDING",
      provider: "not-configured",
      detail: "CAMERA_CHALLENGE_VERIFIER_NOT_CONFIGURED",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const provider = new URL(url).hostname;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": input.contentType,
        "x-haggle-content-sha256": createHash("sha256").update(input.bytes).digest("hex"),
        "x-haggle-camera-challenge": encodeURIComponent(input.challengeCode),
        "x-haggle-filename": encodeURIComponent(input.filename),
        ...(process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_TOKEN
          ? { authorization: `Bearer ${process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_TOKEN}` }
          : {}),
      },
      body: input.bytes,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: "FAILED", provider, detail: `VERIFIER_HTTP_${response.status}` };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return { status: "FAILED", provider, detail: "VERIFIER_RESPONSE_TOO_LARGE" };
    }
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > 16_384) {
      return { status: "FAILED", provider, detail: "VERIFIER_RESPONSE_TOO_LARGE" };
    }
    let result: { verified?: unknown; confidence?: unknown; detected_text?: unknown; detail?: unknown;
      visual_observations?: unknown };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      return { status: "FAILED", provider, detail: "INVALID_VERIFIER_RESPONSE" };
    }
    const confidence = typeof result.confidence === "number"
      && Number.isFinite(result.confidence)
      && result.confidence >= 0
      && result.confidence <= 1
      ? result.confidence
      : undefined;
    const detectedText = typeof result.detected_text === "string"
      ? result.detected_text.slice(0, 200)
      : undefined;
    if (result.verified === true) {
      if (!detectedText || !normalizedChallenge(detectedText).includes(normalizedChallenge(input.challengeCode))) {
        return {
          status: "FAILED",
          provider,
          detail: "VERIFIER_CHALLENGE_EVIDENCE_MISSING",
          confidence,
          detectedText,
        };
      }
      return { status: "VERIFIED", provider, detail: "CHALLENGE_VERIFIED", confidence, detectedText,
        visualObservations: visualObservations(result.visual_observations) };
    }
    if (result.verified === false) {
      return {
        status: "REJECTED",
        provider,
        detail: typeof result.detail === "string" ? result.detail.slice(0, 200) : "CHALLENGE_NOT_FOUND",
        confidence,
        detectedText,
      };
    }
    return { status: "FAILED", provider, detail: "INVALID_VERIFIER_RESPONSE" };
  } catch (error) {
    return {
      status: "FAILED",
      provider,
      detail: error instanceof Error && error.name === "AbortError"
        ? "VERIFIER_TIMEOUT"
        : "VERIFIER_UNAVAILABLE",
    };
  } finally {
    clearTimeout(timer);
  }
}
