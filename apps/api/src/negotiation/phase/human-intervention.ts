import type {
  EngineDecision,
  NegotiationPhase,
  HumanInterventionMode,
  HybridModeConfig,
} from '../types.js';

export interface InterventionResult {
  /** Whether the decision can proceed automatically */
  autoApproved: boolean;
  /** If not auto-approved, what the user needs to review */
  pendingReview?: {
    decision: EngineDecision;
    phase: NegotiationPhase;
    reason: string;
  };
}

const DEFAULT_HYBRID_CONFIG: HybridModeConfig = {
  DISCOVERY: 'auto',
  OPENING: 'manual',
  BARGAINING: 'auto',
  CLOSING: 'manual',
  SETTLEMENT: 'auto',
};

/**
 * Determine if a decision needs human approval based on intervention mode.
 */
export function checkIntervention(
  decision: EngineDecision,
  phase: NegotiationPhase,
  mode: HumanInterventionMode,
  hybridConfig?: HybridModeConfig,
): InterventionResult {
  switch (mode) {
    case 'FULL_AUTO':
      return { autoApproved: true };

    case 'MANUAL':
      return {
        autoApproved: false,
        pendingReview: {
          decision,
          phase,
          reason: 'Manual mode — all decisions require approval.',
        },
      };

    case 'APPROVE_ONLY':
      // Only ACCEPT and CONFIRM need approval
      if (decision.action === 'ACCEPT' || decision.action === 'CONFIRM') {
        return {
          autoApproved: false,
          pendingReview: {
            decision,
            phase,
            reason: `${decision.action} requires your approval.`,
          },
        };
      }
      return { autoApproved: true };

    case 'HYBRID': {
      const config = hybridConfig ?? DEFAULT_HYBRID_CONFIG;
      const phaseMode = config[phase] ?? 'auto';
      if (phaseMode === 'manual') {
        return {
          autoApproved: false,
          pendingReview: {
            decision,
            phase,
            reason: `Phase ${phase} is set to manual in hybrid mode.`,
          },
        };
      }
      return { autoApproved: true };
    }

    default:
      return { autoApproved: true };
  }
}

/**
 * Apply human modifications to a decision.
 * Merges user overrides into the original decision.
 */
export function applyHumanOverride(
  original: EngineDecision,
  override: Partial<EngineDecision>,
): EngineDecision {
  return {
    ...original,
    ...override,
    reasoning: override.reasoning
      ? `[Human Override] ${override.reasoning}`
      : `[Human Override] ${original.reasoning}`,
  };
}
