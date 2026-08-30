/**
 * What a session GET may show.
 *
 * Guests (shared playback) see the public transcript: status, prices, messages.
 * Engine scores stay on the authenticated participant path.
 */

export type SessionViewer = "guest" | "participant";

export function projectLastUtility(lastUtility: unknown, viewer: SessionViewer): unknown {
  return viewer === "participant" ? lastUtility : undefined;
}

export function projectRoundEngineFields(
  viewer: SessionViewer,
  fields: {
    utility?: unknown;
    tactic_used?: unknown;
    concession_rate?: unknown;
  },
): {
  utility?: unknown;
  tactic_used?: unknown;
  concession_rate?: unknown;
} {
  if (viewer === "participant") return fields;
  return {};
}
