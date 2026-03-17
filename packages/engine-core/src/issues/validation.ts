/**
 * Offer Validation against IssueSchema
 *
 * Validates that proposed issue values conform to the schema:
 * - All required negotiable issues are present
 * - Values match expected types (scalar, deadline, enum, boolean)
 * - Scalar/deadline values are within [min, max] bounds
 * - Enum values are in the allowed set
 * - Weights sum to ~1.0 (within tolerance)
 */

import type {
  IssueDefinition,
  IssueSchema,
  IssueValues,
  IssueWeight,
  IssueValue,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
  issue_name: string;
  code: 'MISSING' | 'TYPE_MISMATCH' | 'OUT_OF_RANGE' | 'INVALID_ENUM' | 'UNKNOWN_ISSUE';
  message: string;
}

export interface WeightValidationError {
  code: 'WEIGHT_SUM' | 'MISSING_WEIGHT' | 'NEGATIVE_WEIGHT' | 'NON_FINITE_WEIGHT';
  message: string;
}

export interface OfferValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface WeightValidationResult {
  valid: boolean;
  errors: WeightValidationError[];
  /** Actual weight sum. */
  weight_sum: number;
}

// ---------------------------------------------------------------------------
// Offer Validation
// ---------------------------------------------------------------------------

/**
 * Validate offer values against an IssueSchema.
 */
export function validateOffer(
  values: IssueValues,
  schema: IssueSchema,
): OfferValidationResult {
  const errors: ValidationError[] = [];
  const knownNames = new Set<string>();

  // Check each negotiable issue
  for (const def of schema.negotiable_issues) {
    knownNames.add(def.name);
    const value = values[def.name];

    if (value === undefined) {
      errors.push({
        issue_name: def.name,
        code: 'MISSING',
        message: `Required negotiable issue "${def.name}" is missing`,
      });
      continue;
    }

    const typeError = validateIssueValue(value, def);
    if (typeError) errors.push(typeError);
  }

  // Check informational issues (optional but must match type if present)
  for (const def of schema.informational_issues) {
    knownNames.add(def.name);
    const value = values[def.name];
    if (value === undefined) continue;

    const typeError = validateIssueValue(value, def);
    if (typeError) errors.push(typeError);
  }

  // Check for unknown issues
  for (const name of Object.keys(values)) {
    if (!knownNames.has(name)) {
      errors.push({
        issue_name: name,
        code: 'UNKNOWN_ISSUE',
        message: `Issue "${name}" is not defined in schema "${schema.schema_id}"`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single issue value against its definition.
 */
function validateIssueValue(value: IssueValue, def: IssueDefinition): ValidationError | null {
  switch (def.type) {
    case 'scalar':
    case 'deadline': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {
          issue_name: def.name,
          code: 'TYPE_MISMATCH',
          message: `"${def.name}" expects a finite number, got ${typeof value}`,
        };
      }
      const min = def.min ?? -Infinity;
      const max = def.max ?? Infinity;
      if (value < min || value > max) {
        return {
          issue_name: def.name,
          code: 'OUT_OF_RANGE',
          message: `"${def.name}" value ${value} is outside range [${min}, ${max}]`,
        };
      }
      return null;
    }

    case 'enum': {
      if (typeof value !== 'string') {
        return {
          issue_name: def.name,
          code: 'TYPE_MISMATCH',
          message: `"${def.name}" expects a string, got ${typeof value}`,
        };
      }
      const allowed = def.values ?? [];
      if (allowed.length > 0 && !allowed.includes(value)) {
        return {
          issue_name: def.name,
          code: 'INVALID_ENUM',
          message: `"${def.name}" value "${value}" is not in allowed values [${allowed.join(', ')}]`,
        };
      }
      return null;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        return {
          issue_name: def.name,
          code: 'TYPE_MISMATCH',
          message: `"${def.name}" expects a boolean, got ${typeof value}`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Weight Validation
// ---------------------------------------------------------------------------

const WEIGHT_SUM_TOLERANCE = 0.01;

/**
 * Validate that weights are well-formed and sum to ~1.0.
 */
export function validateWeights(
  weights: IssueWeight[],
  definitions: IssueDefinition[],
): WeightValidationResult {
  const errors: WeightValidationError[] = [];
  let weightSum = 0;

  const defNames = new Set(definitions.map((d) => d.name));

  for (const w of weights) {
    if (!Number.isFinite(w.weight)) {
      errors.push({
        code: 'NON_FINITE_WEIGHT',
        message: `Weight for "${w.issue_name}" is not finite: ${w.weight}`,
      });
      continue;
    }
    if (w.weight < 0) {
      errors.push({
        code: 'NEGATIVE_WEIGHT',
        message: `Weight for "${w.issue_name}" is negative: ${w.weight}`,
      });
    }
    weightSum += w.weight;
  }

  // Check all definitions have weights
  for (const def of definitions) {
    if (!weights.some((w) => w.issue_name === def.name)) {
      errors.push({
        code: 'MISSING_WEIGHT',
        message: `No weight defined for issue "${def.name}"`,
      });
    }
  }

  // Check sum
  if (Math.abs(weightSum - 1.0) > WEIGHT_SUM_TOLERANCE) {
    errors.push({
      code: 'WEIGHT_SUM',
      message: `Weights sum to ${weightSum.toFixed(4)}, expected ~1.0 (tolerance ${WEIGHT_SUM_TOLERANCE})`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    weight_sum: weightSum,
  };
}
