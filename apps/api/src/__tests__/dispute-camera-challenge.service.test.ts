import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCameraChallenge } from "../services/dispute-camera-challenge.service.js";

const originalUrl = process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL;
const originalToken = process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL;
  else process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL = originalUrl;
  if (originalToken === undefined) delete process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_TOKEN;
  else process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_TOKEN = originalToken;
});

describe("camera challenge verification", () => {
  it("keeps camera evidence pending when no verifier is configured", async () => {
    delete process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL;

    await expect(
      verifyCameraChallenge({
        bytes: Buffer.from("camera-image"),
        contentType: "image/jpeg",
        challengeCode: "HAGGLE-VERIFY-123",
        filename: "evidence.jpg",
      }),
    ).resolves.toMatchObject({
      status: "PENDING",
      detail: "CAMERA_CHALLENGE_VERIFIER_NOT_CONFIGURED",
    });
  });

  it("returns the verifier confidence for a matching challenge", async () => {
    process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL = "https://vision.example/verify";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          verified: true,
          confidence: 0.98,
          detected_text: "HAGGLE-VERIFY-123",
          visual_observations: [
            {
              category: "visible_damage",
              observation: "  Dent on the lower-left corner\n",
              confidence: 0.87,
            },
            { category: "unknown", observation: "ignored", confidence: 1 },
            {
              category: "item_condition",
              observation: "ignored invalid confidence",
              confidence: 2,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyCameraChallenge({
      bytes: Buffer.from("camera-image"),
      contentType: "image/jpeg",
      challengeCode: "HAGGLE-VERIFY-123",
      filename: "evidence.jpg",
    });

    expect(result).toMatchObject({
      status: "VERIFIED",
      confidence: 0.98,
      detectedText: "HAGGLE-VERIFY-123",
      visualObservations: [
        {
          category: "visible_damage",
          observation: "Dent on the lower-left corner",
          confidence: 0.87,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vision.example/verify",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-haggle-camera-challenge": "HAGGLE-VERIFY-123",
        }),
      }),
    );
  });

  it("rejects an image when the verifier cannot find the challenge", async () => {
    process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL = "https://vision.example/verify";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            verified: false,
            confidence: 0.91,
            detail: "CHALLENGE_NOT_FOUND",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      verifyCameraChallenge({
        bytes: Buffer.from("camera-image"),
        contentType: "image/jpeg",
        challengeCode: "HAGGLE-VERIFY-123",
        filename: "evidence.jpg",
      }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      detail: "CHALLENGE_NOT_FOUND",
    });
  });

  it("does not trust verified true without matching OCR text", async () => {
    process.env.DISPUTE_CAMERA_CHALLENGE_VERIFIER_URL = "https://vision.example/verify";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            verified: true,
            confidence: 0.99,
            detected_text: "HAGGLE-VERIFY-OTHER",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      verifyCameraChallenge({
        bytes: Buffer.from("camera-image"),
        contentType: "image/jpeg",
        challengeCode: "HAGGLE-VERIFY-123",
        filename: "evidence.jpg",
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      detail: "VERIFIER_CHALLENGE_EVIDENCE_MISSING",
    });
  });
});
