// Types
export type {
  NegotiationContext,
  UtilityWeights,
  PriceContext,
  TimeContext,
  RiskContext,
  RelationshipContext,
  CompetitionContext,
  UtilityResult,
} from './types.js';
export { EngineError } from './types.js';

// Decision types
export type {
  DecisionAction,
  Decision,
  DecisionThresholds,
  SessionState,
  FaratinParams,
  DynamicBetaParams,
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
export { invertVp } from './utility/invert-vp.js';
export { computeVt } from './utility/v-time.js';
export { computeVr } from './utility/v-risk.js';
export { computeVs } from './utility/v-relationship.js';
export { adjustVpForCompetition } from './utility/competition.js';

// Decision functions
export { makeDecision } from './decision/maker.js';
export { computeCounterOffer } from './decision/faratin.js';
export { computeDynamicBeta } from './decision/dynamic-beta.js';
export { shouldAcceptNext } from './decision/ac-next.js';
export { computeUtilitySpaceCounterOffer } from './decision/utility-counter.js';
export type { UtilityCounterParams } from './decision/utility-counter.js';

// Batch functions
export { batchEvaluate } from './batch/evaluator.js';
export { compareSessions } from './batch/comparator.js';

// Validation
export { validateContext } from './validation.js';

// Utils
export { clamp } from './utils.js';

// Issue-based negotiation types (HNP vNext)
export type {
  IssueValueType,
  IssueDirection,
  IssueCategory,
  IssueDefinition,
  IssueSchema,
  IssueValue,
  IssueValues,
  IssueWeight,
  IssueUtilityResult,
  MultiIssueUtilityResult,
  RiskCostParams,
  RelationshipBonusParams,
  AcceptanceThresholdParams,
  OfferSearchParams,
  ParallelSessionEval,
  ContractUtilityInput,
  MultiIssueUtilityInput,
} from './issues/index.js';

// Issue-based utility functions
export {
  computeScalarUtility,
  computeDeadlineUtility,
  computeEnumUtility,
  computeBooleanUtility,
  computeIssueUtility,
  computeContractUtility,
  computeRiskCost,
  computeRelationshipBonus,
  computeMultiIssueUtility,
} from './issues/index.js';

// Acceptance threshold
export { computeAcceptanceThreshold } from './issues/index.js';

// Multi-issue decision
export { makeMultiIssueDecision } from './issues/index.js';
export type { MultiIssueDecisionInput, MultiIssueDecision } from './issues/index.js';

// Multi-issue counter-offer
export { computeMultiIssueCounterOffer, computeMoveCost } from './issues/index.js';
export type {
  IssueFaratinParams,
  MultiIssueCounterInput,
  MultiIssueCounterResult,
} from './issues/index.js';

// Domain schemas
export {
  ELECTRONICS_SHIPPING_V1,
  VEHICLE_V1,
  REAL_ESTATE_V1,
  SERVICES_V1,
} from './issues/index.js';

// Offer search (Section 11.4)
export { searchOffer, estimateAcceptanceProbability } from './issues/index.js';
export type { OfferSearchInput, OfferSearchResult } from './issues/index.js';

// Parallel session (Section 11.5)
export {
  computeParallelSessionEU,
  rankParallelSessions,
  computeDynamicBatna,
} from './issues/index.js';

// Offer & weight validation
export { validateOffer, validateWeights } from './issues/index.js';
export type {
  ValidationError,
  WeightValidationError,
  OfferValidationResult,
  WeightValidationResult,
} from './issues/index.js';
