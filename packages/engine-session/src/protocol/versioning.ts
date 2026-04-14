// HNP Version Negotiation
// Core revision negotiation, capability matching, and profile compatibility.

import type { HnpCompatibilityLevel, HnpCoreRevision } from './core.js';
import { HNP_COMPATIBILITY_LEVELS } from './core.js';
import type { HnpCapabilitySupport, HnpWellKnownProfile } from './profile.js';

export interface HnpCapabilitySelection {
  name: string;
  version: string;
  required: boolean;
}

export interface HnpNegotiationResult {
  compatibility: HnpCompatibilityLevel;
  selected_core_revision?: HnpCoreRevision;
  selected_capabilities: Record<string, string>;
  disabled_capabilities: string[];
  reason?: string;
}

// ── Internal helpers ────────────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(version: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemVer(left: SemVer, right: SemVer): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function highestVersion(versions: string[]): string | undefined {
  return [...versions]
    .map((version) => ({ version, parsed: parseSemVer(version) }))
    .filter((entry): entry is { version: string; parsed: SemVer } => entry.parsed !== null)
    .sort((a, b) => compareSemVer(b.parsed, a.parsed))[0]?.version;
}

function majorCompatibleVersion(local: string[], remote: string[]): string | undefined {
  const localParsed = local
    .map((version) => ({ version, parsed: parseSemVer(version) }))
    .filter((entry): entry is { version: string; parsed: SemVer } => entry.parsed !== null);

  const remoteParsed = remote
    .map((version) => ({ version, parsed: parseSemVer(version) }))
    .filter((entry): entry is { version: string; parsed: SemVer } => entry.parsed !== null);

  const commonMajors = new Set(
    localParsed
      .map((entry) => entry.parsed.major)
      .filter((major) => remoteParsed.some((candidate) => candidate.parsed.major === major)),
  );

  const sortedMajors = [...commonMajors].sort((a, b) => b - a);

  for (const major of sortedMajors) {
    const localHighest = highestVersion(
      localParsed.filter((entry) => entry.parsed.major === major).map((entry) => entry.version),
    );
    const remoteHighest = highestVersion(
      remoteParsed.filter((entry) => entry.parsed.major === major).map((entry) => entry.version),
    );

    if (!localHighest || !remoteHighest) continue;

    const localSemVer = parseSemVer(localHighest);
    const remoteSemVer = parseSemVer(remoteHighest);
    if (!localSemVer || !remoteSemVer) continue;

    return compareSemVer(localSemVer, remoteSemVer) <= 0 ? localHighest : remoteHighest;
  }

  return undefined;
}

// ── Public API ──────────────────────────────────────────────────

/** Pick the first local-preferred core revision that the remote also supports. */
export function negotiateCoreRevision(
  localPreferredOrder: HnpCoreRevision[],
  remoteSupported: HnpCoreRevision[],
): HnpCoreRevision | undefined {
  for (const revision of localPreferredOrder) {
    if (remoteSupported.includes(revision)) return revision;
  }
  return undefined;
}

/** Find the best mutually-compatible version for a single capability. */
export function negotiateCapability(
  name: string,
  local: HnpCapabilitySupport | undefined,
  remote: HnpCapabilitySupport | undefined,
): HnpCapabilitySelection | undefined {
  if (!local || !remote) return undefined;

  const exactIntersection = local.versions.filter((version) => remote.versions.includes(version));
  const selectedVersion =
    highestVersion(exactIntersection) ?? majorCompatibleVersion(local.versions, remote.versions);

  if (!selectedVersion) return undefined;

  return {
    name,
    version: selectedVersion,
    required: local.required || remote.required,
  };
}

/** Negotiate full profile compatibility between two HNP agents. */
export function negotiateProfile(
  local: HnpWellKnownProfile,
  remote: HnpWellKnownProfile,
): HnpNegotiationResult {
  const selectedCoreRevision = negotiateCoreRevision(
    local.hnp.core_revisions,
    remote.hnp.core_revisions,
  );

  if (!selectedCoreRevision) {
    return {
      compatibility: HNP_COMPATIBILITY_LEVELS[2], // INCOMPATIBLE
      selected_capabilities: {},
      disabled_capabilities: [],
      reason: 'UNSUPPORTED_VERSION',
    };
  }

  const capabilityNames = new Set([
    ...Object.keys(local.hnp.capabilities),
    ...Object.keys(remote.hnp.capabilities),
  ]);

  const selectedCapabilities: Record<string, string> = {};
  const disabledCapabilities: string[] = [];
  let degraded = false;

  for (const capabilityName of capabilityNames) {
    const localCapability = local.hnp.capabilities[capabilityName];
    const remoteCapability = remote.hnp.capabilities[capabilityName];

    const selection = negotiateCapability(capabilityName, localCapability, remoteCapability);

    if (selection) {
      selectedCapabilities[capabilityName] = selection.version;
      continue;
    }

    const required = Boolean(localCapability?.required || remoteCapability?.required);
    if (required) {
      return {
        compatibility: HNP_COMPATIBILITY_LEVELS[2], // INCOMPATIBLE
        selected_core_revision: selectedCoreRevision,
        selected_capabilities: {},
        disabled_capabilities: [],
        reason: `UNSUPPORTED_EXTENSION:${capabilityName}`,
      };
    }

    if (localCapability || remoteCapability) {
      degraded = true;
      disabledCapabilities.push(capabilityName);
    }
  }

  return {
    compatibility: degraded ? HNP_COMPATIBILITY_LEVELS[1] : HNP_COMPATIBILITY_LEVELS[0],
    selected_core_revision: selectedCoreRevision,
    selected_capabilities: selectedCapabilities,
    disabled_capabilities: disabledCapabilities,
  };
}
