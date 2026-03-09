// ============================================================
// UCP Capability Negotiation
// Implements the intersection algorithm from UCP spec.
//
// Algorithm:
// 1. Include business caps where a matching platform cap exists
// 2. Prune extensions whose parent is missing from intersection
// 3. Repeat step 2 until stable (transitive extension chains)
// ============================================================

import type { UcpCapabilityEntry } from './types.js';

export interface NegotiatedCapability {
  name: string;
  version: string;
}

export interface NegotiationResult {
  capabilities: NegotiatedCapability[];
  version: string;
}

/**
 * Negotiate capabilities between business and platform.
 * Returns the intersection of supported capabilities,
 * pruning extensions whose parent is not in the result.
 */
export function negotiateCapabilities(
  businessCaps: Record<string, UcpCapabilityEntry[]>,
  platformCaps: Record<string, UcpCapabilityEntry[]>,
  businessVersion: string,
  platformVersion: string,
): NegotiationResult | null {
  // Version check: platform version must be <= business version
  if (platformVersion > businessVersion) {
    return null;
  }

  // Step 1: Find intersection — capabilities present in both
  const intersection = new Map<string, UcpCapabilityEntry>();

  for (const [name, entries] of Object.entries(businessCaps)) {
    if (platformCaps[name]) {
      // Find best matching version
      const businessEntry = entries[0];
      const platformEntry = platformCaps[name][0];

      if (businessEntry && platformEntry) {
        // Use the earlier version (conservative match)
        const matchVersion =
          businessEntry.version <= platformEntry.version
            ? businessEntry.version
            : platformEntry.version;

        intersection.set(name, {
          ...businessEntry,
          version: matchVersion,
        });
      }
    }
  }

  // Steps 2-3: Prune extensions without parent, repeat until stable
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of intersection.entries()) {
      if (entry.extends && !intersection.has(entry.extends)) {
        intersection.delete(name);
        changed = true;
      }
    }
  }

  const negotiatedVersion =
    businessVersion <= platformVersion ? businessVersion : platformVersion;

  return {
    version: negotiatedVersion,
    capabilities: Array.from(intersection.entries()).map(([name, entry]) => ({
      name,
      version: entry.version,
    })),
  };
}
