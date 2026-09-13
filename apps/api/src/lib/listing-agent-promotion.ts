import { getNegotiationAgentPreset, normalizeAgentAccent } from "@haggle/shared";

/**
 * What publishing a listing does to the seller's agent library.
 *
 * Two places used to answer this, and both acted: the publish service created
 * a row named "<title> agent" from the snapshot, and the listing wizard then
 * created its own "<Preset> · <title>" copy. One publish left two agents, and
 * the server's copy predated avatars, so it had no face. Picking a saved agent
 * and changing nothing still minted a copy on every publish, because a saved
 * agent's tuning reads as "customized".
 *
 * This is now the only answer, and it is pure so every case is testable:
 *   - an owned saved agent, published as it was  → reference that agent
 *   - anything tuned in the wizard                → exactly one new agent
 *   - an untouched preset, or no owner            → reference the preset id
 */

export type ListingAgentPromotion =
  | { kind: "preset"; presetId: string | null }
  | { kind: "existing"; agentId: string }
  | { kind: "create"; name: string; config: Record<string, unknown> };

/** A saved agent the snapshot says it came from, already checked to be the owner's. */
export interface SourceAgent {
  id: string;
  name: string;
  negotiationAgentConfig: Record<string, unknown> | null;
}

const NAME_MAX = 100;
const EPSILON = 1e-9;

type Knobs = Record<string, unknown>;

function asRecord(value: unknown): Knobs {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Knobs) : {};
}

function sameNumbers(a: Knobs, b: Knobs): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (typeof x !== "number" || typeof y !== "number") {
      if (x !== y) return false;
    } else if (Math.abs(x - y) > EPSILON) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the snapshot is the saved agent as it was — same strategy and same
 * look. Compared on effective values (the archetype with the agent's own
 * overrides on top), because the snapshot always carries every knob while a
 * saved row may carry only the ones it changed. The briefing is deliberately
 * not compared: it is about this listing, and it stays on the listing.
 */
function isUnchanged(snapshot: Knobs, source: SourceAgent): boolean {
  const config = asRecord(source.negotiationAgentConfig);
  const presetId =
    (typeof config.negotiationAgentPresetId === "string" && config.negotiationAgentPresetId) ||
    (typeof config.basePresetId === "string" && config.basePresetId) ||
    (typeof snapshot.preset === "string" ? snapshot.preset : "");
  const preset = getNegotiationAgentPreset(presetId);
  if (!preset) return false;

  const savedKnobs: Knobs = {};
  for (const key of Object.keys(asRecord(snapshot.engineParams))) {
    savedKnobs[key] = asRecord(config.engineParams)[key] ?? (preset as unknown as Knobs)[key];
  }
  const savedWeights = config.weights ? asRecord(config.weights) : asRecord(preset.weights);

  const savedEmoji = typeof config.emoji === "string" ? config.emoji : preset.emoji;
  const savedAccent =
    normalizeAgentAccent(config.accentColor) ?? normalizeAgentAccent(preset.accentColor);

  return (
    sameNumbers(asRecord(snapshot.weights), savedWeights) &&
    sameNumbers(asRecord(snapshot.engineParams), savedKnobs) &&
    (snapshot.emoji ?? preset.emoji) === savedEmoji &&
    (normalizeAgentAccent(snapshot.accentColor) ?? normalizeAgentAccent(preset.accentColor)) ===
      savedAccent
  );
}

function nameFor(prefix: string, title: string | null): string {
  const listing = title?.trim();
  const name = listing ? `${prefix} · ${listing}` : prefix;
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

export function planListingAgentPromotion(input: {
  snapshot: Record<string, unknown> | null;
  /** The listing has an owner. Guests' listings never touch a library. */
  owned: boolean;
  /** The saved agent named by `snapshot.sourceId`, when it exists and is the owner's. */
  sourceAgent: SourceAgent | null;
  title: string | null;
}): ListingAgentPromotion {
  const { snapshot, owned, sourceAgent, title } = input;
  if (!snapshot) return { kind: "preset", presetId: null };
  const presetId = typeof snapshot.preset === "string" ? snapshot.preset : null;
  if (!owned) return { kind: "preset", presetId };

  if (sourceAgent && isUnchanged(snapshot, sourceAgent)) {
    return { kind: "existing", agentId: sourceAgent.id };
  }
  if (!sourceAgent && snapshot.customized !== true) {
    return { kind: "preset", presetId };
  }

  const preset = presetId ? getNegotiationAgentPreset(presetId) : undefined;
  const prefix = sourceAgent?.name ?? preset?.copy.seller.name ?? "Listing agent";
  const accentColor = normalizeAgentAccent(snapshot.accentColor);
  return {
    kind: "create",
    name: nameFor(prefix, title),
    config: {
      basePresetId: presetId,
      negotiationAgentPresetId: presetId,
      weights: snapshot.weights,
      engineParams: snapshot.engineParams,
      ...(typeof snapshot.emoji === "string" ? { emoji: snapshot.emoji } : {}),
      ...(accentColor ? { accentColor } : {}),
    },
  };
}
