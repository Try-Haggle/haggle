import type { TagConfig, TagValidationResult } from "./types.js";
import { defaultTagConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw tag string:
 * 1. Trim leading/trailing whitespace
 * 2. Collapse internal whitespace to single space
 * 3. Lowercase
 * 4. Truncate to maxTagLength
 */
export function normalizeTagName(
  raw: string,
  config: TagConfig = defaultTagConfig(),
): string {
  const trimmed = raw.trim();
  const collapsed = trimmed.replace(/\s+/g, " ");
  const lowered = collapsed.toLowerCase();
  return lowered.slice(0, config.maxTagLength);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a raw tag string and return a structured result.
 * Rules:
 * - Must not be empty after trimming
 * - Must not exceed maxTagLength after normalization
 * - Must contain at least one alphanumeric character
 * - Hierarchical separators `/` are allowed
 */
export function validateTag(
  raw: string,
  config: TagConfig = defaultTagConfig(),
): TagValidationResult {
  const errors: string[] = [];

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push("Tag name must not be empty");
    return { valid: false, normalized: "", errors };
  }

  const normalized = normalizeTagName(raw, config);

  if (!hasAlphanumeric(normalized)) {
    errors.push("Tag name must contain at least one alphanumeric character");
  }

  // Check if original (pre-truncation) was too long
  const collapsedLength = trimmed.replace(/\s+/g, " ").length;
  if (collapsedLength > config.maxTagLength) {
    errors.push(
      `Tag name exceeds maximum length of ${config.maxTagLength} characters`,
    );
  }

  return {
    valid: errors.length === 0,
    normalized,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Hierarchy helpers
// ---------------------------------------------------------------------------

/**
 * Extract hierarchy segments from a normalized tag name.
 * Example: "electronics/phones/iphone" -> ["electronics", "electronics/phones", "electronics/phones/iphone"]
 */
export function extractHierarchy(normalizedName: string): string[] {
  const parts = normalizedName.split("/").filter((p) => p.length > 0);
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(parts.slice(0, i + 1).join("/"));
  }
  return result;
}

/**
 * Get the parent path from a hierarchical tag name.
 * Example: "electronics/phones/iphone" -> "electronics/phones"
 * Returns undefined if there is no parent.
 */
export function getParentPath(normalizedName: string): string | undefined {
  const lastSlash = normalizedName.lastIndexOf("/");
  if (lastSlash <= 0) return undefined;
  return normalizedName.slice(0, lastSlash);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function hasAlphanumeric(s: string): boolean {
  return /[a-z0-9]/i.test(s);
}
