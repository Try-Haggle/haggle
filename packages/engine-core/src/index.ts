// Types
export type {
  NegotiationContext,
  UtilityWeights,
  PriceContext,
  TimeContext,
  RiskContext,
  RelationshipContext,
  CompetitionContext,
  HoldContext,
  UtilityResult,
} from './types.js';
export { EngineError } from './types.js';

// Term Space types + evaluator
export type { TermType, TermLayer, TermDomain, Term, TermSpace } from './term/types.js';
export { evaluateTerm, computeMultiTermUtility, validateTermSpace } from './term/evaluator.js';

// Decision types
export type {
  DecisionAction,
  Decision,
  DecisionThresholds,
  SessionState,
  FaratinParams,
} from './decision/types.js';

// Batch types
export type {
  ListingInput,
  BatchStrategy,
  BatchEvaluateRequest,
  RankedListing,
  BatchEvaluateResult,
  SessionSnapshot,
  SessionCompareResult,
} from './batch/types.js';

// Core functions
export { computeUtility } from './utility/index.js';
export { computeVp } from './utility/v-price.js';
export { computeVt } from './utility/v-time.js';
export { computeVr } from './utility/v-risk.js';
export { computeVs } from './utility/v-relationship.js';
export { adjustVpForCompetition } from './utility/competition.js';

// Decision functions
export { makeDecision } from './decision/maker.js';
export { computeCounterOffer } from './decision/faratin.js';

// Batch functions
export { batchEvaluate } from './batch/evaluator.js';
export { compareSessions } from './batch/comparator.js';

// Validation
export { validateContext } from './validation.js';

// Utils
export { clamp } from './utils.js';
