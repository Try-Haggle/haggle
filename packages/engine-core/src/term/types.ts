/**
 * Multi-term negotiation space types.
 *
 * Term Space enables negotiation over multiple dimensions beyond price,
 * such as warranty, delivery time, bundled items, etc.
 */

/** Whether the term can be negotiated or is purely informational. */
export type TermType = 'NEGOTIABLE' | 'INFORMATIONAL';

/** Precedence layer for term defaults and overrides. */
export type TermLayer = 'GLOBAL' | 'CATEGORY' | 'CUSTOM';

/** Defines the valid range and optimization direction for a negotiable term. */
export interface TermDomain {
  min: number;
  max: number;
  /** Which direction is better for the evaluating party. */
  direction: 'lower_is_better' | 'higher_is_better';
}

/**
 * A single negotiation term.
 *
 * NEGOTIABLE terms must have a domain.
 * INFORMATIONAL terms must NOT have a domain — their current_value
 * is used directly as utility contribution in [0,1].
 */
export interface Term {
  id: string;
  type: TermType;
  layer: TermLayer;
  /** Relative importance weight. All NEGOTIABLE term weights should sum to ~1. */
  weight: number;
  /** Required for NEGOTIABLE terms, forbidden for INFORMATIONAL. */
  domain?: TermDomain;
  description?: string;
  /** Estimated proposed value (for pre-negotiation evaluation). */
  proposed_value_estimate?: number;
}

/**
 * The complete term space for a negotiation session.
 *
 * `terms` defines the structure; `current_values` holds the latest
 * negotiated or proposed values keyed by term.id.
 */
export interface TermSpace {
  terms: Term[];
  current_values: Record<string, number>;
}
