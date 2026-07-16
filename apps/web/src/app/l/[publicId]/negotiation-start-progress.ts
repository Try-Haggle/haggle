export interface NegotiationProgressPayload {
  session: { status: string };
  rounds: unknown[];
}

export interface NegotiationProgress {
  status: string;
  rounds: number;
  ready: boolean;
}

const READY_STATUSES = new Set([
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "NEAR_DEAL",
  "STALLED",
]);

export async function waitForNegotiationReady({
  load,
  onProgress,
  delay = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  intervalMs = 1_500,
  maxAttempts = 120,
}: {
  load: () => Promise<NegotiationProgressPayload>;
  onProgress?: (progress: NegotiationProgress) => void;
  delay?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxAttempts?: number;
}): Promise<NegotiationProgress> {
  let latest: NegotiationProgress = { status: "CREATED", rounds: 0, ready: false };
  let loadedAtLeastOnce = false;
  let latestError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const payload = await load();
      loadedAtLeastOnce = true;
      latestError = undefined;
      latest = {
        status: payload.session.status,
        rounds: payload.rounds.length,
        ready: READY_STATUSES.has(payload.session.status),
      };
      onProgress?.(latest);
      if (latest.ready) return latest;
    } catch (error) {
      latestError = error;
    }
    if (attempt < maxAttempts - 1) await delay(intervalMs);
  }

  if (!loadedAtLeastOnce && latestError) throw latestError;
  return latest;
}
