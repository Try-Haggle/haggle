import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface DisputeVideoProbeMetadata {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  hasAudio: boolean;
}

export interface DisputeVideoKeyframePolicy {
  intervalSec: number;
  maxFrames: number;
  scaleWidth: number;
  quality: number;
}

export interface DisputeVideoDerivedArtifact {
  id: string;
  kind: "video_keyframe";
  sourceEvidenceId: string;
  localPath: string;
  offsetSec: number;
  sampleIndex: number;
}

export interface DisputeVideoExtractionResult {
  metadata: DisputeVideoProbeMetadata;
  policy: DisputeVideoKeyframePolicy;
  artifacts: DisputeVideoDerivedArtifact[];
}

const DEFAULT_POLICY: DisputeVideoKeyframePolicy = {
  intervalSec: 1,
  maxFrames: 24,
  scaleWidth: 1280,
  quality: 3,
};

const HIGH_VALUE_POLICY: DisputeVideoKeyframePolicy = {
  ...DEFAULT_POLICY,
  maxFrames: 48,
};

function parsePositiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePositiveInt(raw: string | undefined): number | null {
  const value = parsePositiveNumber(raw);
  return value === null ? null : Math.floor(value);
}

export function resolveDisputeVideoKeyframePolicy(
  options: { amountMinor?: number; highValueThresholdMinor?: number } = {},
): DisputeVideoKeyframePolicy {
  const highValueThreshold = options.highValueThresholdMinor ?? 50_000;
  const base =
    (options.amountMinor ?? 0) >= highValueThreshold ? HIGH_VALUE_POLICY : DEFAULT_POLICY;
  return {
    intervalSec:
      parsePositiveNumber(process.env.DISPUTE_VIDEO_KEYFRAME_INTERVAL_SEC) ?? base.intervalSec,
    maxFrames: Math.min(
      parsePositiveInt(process.env.DISPUTE_VIDEO_KEYFRAME_MAX_FRAMES) ?? base.maxFrames,
      96,
    ),
    scaleWidth: Math.min(
      parsePositiveInt(process.env.DISPUTE_VIDEO_KEYFRAME_SCALE_WIDTH) ?? base.scaleWidth,
      1920,
    ),
    quality: Math.min(
      Math.max(
        parsePositiveInt(process.env.DISPUTE_VIDEO_KEYFRAME_JPEG_QUALITY) ?? base.quality,
        2,
      ),
      8,
    ),
  };
}

function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, options.timeoutMs ?? 30_000);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(
        new Error(
          `${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 500)}`,
        ),
      );
    });
  });
}

function parseFps(raw: string | undefined): number | null {
  if (!raw) return null;
  const [num, den] = raw.split("/").map(Number);
  if (!Number.isFinite(num)) return null;
  if (!Number.isFinite(den) || den === 0) return num;
  return num / den;
}

export async function probeDisputeVideoMetadata(
  inputPath: string,
  options: { ffprobePath?: string; timeoutMs?: number } = {},
): Promise<DisputeVideoProbeMetadata> {
  const output = await runCommand(
    options.ffprobePath ?? "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", inputPath],
    { timeoutMs: options.timeoutMs ?? 15_000 },
  );
  const parsed = JSON.parse(output) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const hasAudio = parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false;
  const duration =
    typeof parsed.format?.duration === "string" ? Number(parsed.format.duration) : null;
  return {
    durationSec: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null,
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    fps: parseFps(typeof video?.avg_frame_rate === "string" ? video.avg_frame_rate : undefined),
    codec: typeof video?.codec_name === "string" ? video.codec_name : null,
    hasAudio,
  };
}

export function buildDisputeVideoKeyframeOffsets(
  metadata: DisputeVideoProbeMetadata,
  policy: DisputeVideoKeyframePolicy,
): number[] {
  const duration = metadata.durationSec;
  const maxFrames = Math.max(1, policy.maxFrames);
  if (!duration || duration <= 0) {
    return Array.from({ length: maxFrames }, (_, index) =>
      Number((index * policy.intervalSec).toFixed(3)),
    );
  }
  const denseCount = Math.floor(duration / policy.intervalSec) + 1;
  const count = Math.min(maxFrames, Math.max(1, denseCount));
  if (count === 1) return [0];
  if (denseCount <= maxFrames) {
    return Array.from({ length: count }, (_, index) =>
      Number(Math.min(index * policy.intervalSec, duration).toFixed(3)),
    );
  }
  const step = duration / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    Number(Math.min(index * step, duration).toFixed(3)),
  );
}

export function buildDisputeVideoSingleKeyframeFfmpegArgs(params: {
  inputPath: string;
  outputPath: string;
  offsetSec: number;
  policy: DisputeVideoKeyframePolicy;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(params.offsetSec),
    "-i",
    params.inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale='min(${params.policy.scaleWidth},iw)':-2`,
    "-q:v",
    String(params.policy.quality),
    params.outputPath,
  ];
}

export async function extractDisputeVideoKeyframes(params: {
  inputPath: string;
  outputDir: string;
  sourceEvidenceId: string;
  amountMinor?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}): Promise<DisputeVideoExtractionResult> {
  const policy = resolveDisputeVideoKeyframePolicy({ amountMinor: params.amountMinor });
  const metadata = await probeDisputeVideoMetadata(params.inputPath, {
    ffprobePath: params.ffprobePath,
    timeoutMs: params.timeoutMs,
  });
  await mkdir(params.outputDir, { recursive: true });

  const offsets = buildDisputeVideoKeyframeOffsets(metadata, policy);
  const frameTimeoutMs = params.timeoutMs ?? 30_000;
  for (const [index, offsetSec] of offsets.entries()) {
    await runCommand(
      params.ffmpegPath ?? "ffmpeg",
      buildDisputeVideoSingleKeyframeFfmpegArgs({
        inputPath: params.inputPath,
        outputPath: join(params.outputDir, `frame_${String(index + 1).padStart(3, "0")}.jpg`),
        offsetSec,
        policy,
      }),
      { timeoutMs: frameTimeoutMs },
    );
  }

  return {
    metadata,
    policy,
    artifacts: offsets.map((offsetSec, index) => ({
      id: `${params.sourceEvidenceId}:frame:${String(index + 1).padStart(3, "0")}`,
      kind: "video_keyframe",
      sourceEvidenceId: params.sourceEvidenceId,
      localPath: join(params.outputDir, `frame_${String(index + 1).padStart(3, "0")}.jpg`),
      offsetSec,
      sampleIndex: index + 1,
    })),
  };
}
