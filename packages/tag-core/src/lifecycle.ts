import type { Tag, TagConfig, TagStatus, LifecycleResult } from "./types.js";
import { defaultTagConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Promotion: CANDIDATE -> EMERGING -> OFFICIAL
// ---------------------------------------------------------------------------

/**
 * Attempt to promote a tag based on its use count and the config thresholds.
 * Promotions:
 *   CANDIDATE -> EMERGING  (useCount >= candidateToEmergingUses)
 *   EMERGING  -> OFFICIAL  (useCount >= emergingToOfficialUses)
 *
 * Returns a new tag object (immutable). Does not mutate the input.
 */
export function promote(
  tag: Tag,
  config: TagConfig = defaultTagConfig(),
): LifecycleResult {
  const prev = tag.status;

  if (tag.status === "CANDIDATE" && tag.useCount >= config.candidateToEmergingUses) {
    return {
      tag: { ...tag, status: "EMERGING" },
      previousStatus: prev,
      newStatus: "EMERGING",
      transitioned: true,
      reason: `Use count ${tag.useCount} >= ${config.candidateToEmergingUses} (candidate threshold)`,
    };
  }

  if (tag.status === "EMERGING" && tag.useCount >= config.emergingToOfficialUses) {
    return {
      tag: { ...tag, status: "OFFICIAL" },
      previousStatus: prev,
      newStatus: "OFFICIAL",
      transitioned: true,
      reason: `Use count ${tag.useCount} >= ${config.emergingToOfficialUses} (emerging threshold)`,
    };
  }

  return {
    tag: { ...tag },
    previousStatus: prev,
    newStatus: prev,
    transitioned: false,
    reason: noTransitionReason(tag, config),
  };
}

// ---------------------------------------------------------------------------
// Auto-promotion: evaluate and apply the maximum applicable promotion
// ---------------------------------------------------------------------------

/**
 * Evaluate a tag and apply the highest applicable promotion in one step.
 * A tag at CANDIDATE with useCount >= emergingToOfficialUses will jump
 * through EMERGING straight to OFFICIAL.
 */
export function autoPromote(
  tag: Tag,
  config: TagConfig = defaultTagConfig(),
): LifecycleResult {
  let current = { ...tag };
  let transitioned = false;
  const prev = tag.status;
  let reason = "";

  // First promotion attempt
  const first = promote(current, config);
  if (first.transitioned) {
    current = first.tag;
    transitioned = true;
    reason = first.reason;

    // Second promotion attempt (CANDIDATE -> EMERGING -> OFFICIAL in one call)
    const second = promote(current, config);
    if (second.transitioned) {
      current = second.tag;
      reason = `${reason}; ${second.reason}`;
    }
  }

  if (!transitioned) {
    return {
      tag: current,
      previousStatus: prev,
      newStatus: prev,
      transitioned: false,
      reason: noTransitionReason(tag, config),
    };
  }

  return {
    tag: current,
    previousStatus: prev,
    newStatus: current.status,
    transitioned: true,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Deprecation
// ---------------------------------------------------------------------------

/**
 * Deprecate a tag if it has been unused for longer than the configured
 * deprecationDaysUnused threshold.
 *
 * @param tag The tag to evaluate
 * @param nowIso The current datetime as ISO string
 * @param config Tag configuration
 */
export function deprecate(
  tag: Tag,
  nowIso: string,
  config: TagConfig = defaultTagConfig(),
): LifecycleResult {
  const prev = tag.status;

  if (tag.status === "DEPRECATED") {
    return {
      tag: { ...tag },
      previousStatus: prev,
      newStatus: prev,
      transitioned: false,
      reason: "Tag is already deprecated",
    };
  }

  const lastUsed = new Date(tag.lastUsedAt).getTime();
  if (isNaN(lastUsed)) {
    return {
      tag: { ...tag },
      previousStatus: prev,
      newStatus: prev,
      transitioned: false,
      reason: "Invalid date: lastUsedAt",
    };
  }

  const now = new Date(nowIso).getTime();
  if (isNaN(now)) {
    return {
      tag: { ...tag },
      previousStatus: prev,
      newStatus: prev,
      transitioned: false,
      reason: "Invalid date: nowIso",
    };
  }

  const daysSinceUse = (now - lastUsed) / (1000 * 60 * 60 * 24);

  if (daysSinceUse >= config.deprecationDaysUnused) {
    return {
      tag: { ...tag, status: "DEPRECATED" },
      previousStatus: prev,
      newStatus: "DEPRECATED",
      transitioned: true,
      reason: `Unused for ${Math.floor(daysSinceUse)} days >= ${config.deprecationDaysUnused} day threshold`,
    };
  }

  return {
    tag: { ...tag },
    previousStatus: prev,
    newStatus: prev,
    transitioned: false,
    reason: `Only ${Math.floor(daysSinceUse)} days since last use (threshold: ${config.deprecationDaysUnused})`,
  };
}

// ---------------------------------------------------------------------------
// Reactivation
// ---------------------------------------------------------------------------

/**
 * Reactivate a DEPRECATED tag back to CANDIDATE status.
 * Only DEPRECATED tags can be reactivated.
 */
export function reactivate(tag: Tag): LifecycleResult {
  const prev = tag.status;

  if (tag.status !== "DEPRECATED") {
    return {
      tag: { ...tag },
      previousStatus: prev,
      newStatus: prev,
      transitioned: false,
      reason: `Cannot reactivate tag with status ${tag.status} (must be DEPRECATED)`,
    };
  }

  return {
    tag: { ...tag, status: "CANDIDATE" },
    previousStatus: prev,
    newStatus: "CANDIDATE",
    transitioned: true,
    reason: "Reactivated from DEPRECATED to CANDIDATE",
  };
}

// ---------------------------------------------------------------------------
// Valid transitions map (for external consumers)
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: Record<TagStatus, TagStatus[]> = {
  CANDIDATE: ["EMERGING", "DEPRECATED"],
  EMERGING: ["OFFICIAL", "DEPRECATED"],
  OFFICIAL: ["DEPRECATED"],
  DEPRECATED: ["CANDIDATE"],
};

/**
 * Check if a single-step transition from one status to another is valid.
 * This validates individual transitions only. The `autoPromote` function may
 * perform compound transitions (e.g. CANDIDATE -> OFFICIAL via EMERGING) that
 * span multiple single steps. Do not use this function to validate autoPromote
 * results.
 */
export function isValidTransition(from: TagStatus, to: TagStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function noTransitionReason(tag: Tag, config: TagConfig): string {
  switch (tag.status) {
    case "CANDIDATE":
      return `Use count ${tag.useCount} < ${config.candidateToEmergingUses} (candidate threshold)`;
    case "EMERGING":
      return `Use count ${tag.useCount} < ${config.emergingToOfficialUses} (emerging threshold)`;
    case "OFFICIAL":
      return "OFFICIAL tags cannot be promoted further";
    case "DEPRECATED":
      return "DEPRECATED tags must be reactivated before promotion";
  }
}
