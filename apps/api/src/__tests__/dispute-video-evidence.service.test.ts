import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDisputeVideoKeyframeOffsets,
  buildDisputeVideoSingleKeyframeFfmpegArgs,
  resolveDisputeVideoKeyframePolicy,
  type DisputeVideoProbeMetadata,
} from "../services/dispute-video-evidence.service.js";

const metadata: DisputeVideoProbeMetadata = {
  durationSec: 12,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "h264",
  hasAudio: true,
};

describe("dispute video evidence extraction policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses dense 1-second sampling up to 24 frames by default", () => {
    const policy = resolveDisputeVideoKeyframePolicy({ amountMinor: 10_000 });

    expect(policy).toEqual({
      intervalSec: 1,
      maxFrames: 24,
      scaleWidth: 1280,
      quality: 3,
    });
    expect(buildDisputeVideoKeyframeOffsets(metadata, policy)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("raises high-value disputes to 48 frames", () => {
    expect(resolveDisputeVideoKeyframePolicy({ amountMinor: 50_000 }).maxFrames).toBe(48);
  });

  it("spreads offsets across long videos when dense sampling exceeds the cap", () => {
    const offsets = buildDisputeVideoKeyframeOffsets({
      ...metadata,
      durationSec: 120,
    }, {
      intervalSec: 1,
      maxFrames: 24,
      scaleWidth: 1280,
      quality: 3,
    });

    expect(offsets).toHaveLength(24);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(120);
    expect(offsets[1]).toBeGreaterThan(1);
  });

  it("allows bounded env overrides for denser sampling", () => {
    vi.stubEnv("DISPUTE_VIDEO_KEYFRAME_INTERVAL_SEC", "0.5");
    vi.stubEnv("DISPUTE_VIDEO_KEYFRAME_MAX_FRAMES", "60");
    vi.stubEnv("DISPUTE_VIDEO_KEYFRAME_SCALE_WIDTH", "1600");
    vi.stubEnv("DISPUTE_VIDEO_KEYFRAME_JPEG_QUALITY", "4");

    expect(resolveDisputeVideoKeyframePolicy()).toEqual({
      intervalSec: 0.5,
      maxFrames: 60,
      scaleWidth: 1600,
      quality: 4,
    });
  });

  it("builds ffmpeg args for a precise single-frame extraction", () => {
    expect(buildDisputeVideoSingleKeyframeFfmpegArgs({
      inputPath: "/tmp/evidence.mp4",
      outputPath: "/tmp/frames/frame_001.jpg",
      offsetSec: 37.5,
      policy: {
        intervalSec: 0.5,
        maxFrames: 60,
        scaleWidth: 1600,
        quality: 4,
      },
    })).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "37.5",
      "-i",
      "/tmp/evidence.mp4",
      "-frames:v",
      "1",
      "-vf",
      "scale='min(1600,iw)':-2",
      "-q:v",
      "4",
      "/tmp/frames/frame_001.jpg",
    ]);
  });
});
