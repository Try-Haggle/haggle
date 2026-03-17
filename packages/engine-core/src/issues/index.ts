// Types
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
} from './types.js';

// Multi-issue utility computation
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
} from './utility.js';
export type { ContractUtilityInput, MultiIssueUtilityInput } from './utility.js';

// Acceptance threshold
export { computeAcceptanceThreshold } from './acceptance.js';

// Multi-issue decision
export { makeMultiIssueDecision } from './decision.js';
export type { MultiIssueDecisionInput, MultiIssueDecision } from './decision.js';

// Multi-issue counter-offer
export { computeMultiIssueCounterOffer, computeMoveCost } from './counter-offer.js';
export type {
  IssueFaratinParams,
  MultiIssueCounterInput,
  MultiIssueCounterResult,
} from './counter-offer.js';

// Domain schemas
export {
  ELECTRONICS_SHIPPING_V1,
  VEHICLE_V1,
  REAL_ESTATE_V1,
  SERVICES_V1,
} from './schemas.js';

// Offer search (Section 11.4)
export { searchOffer, estimateAcceptanceProbability } from './offer-search.js';
export type { OfferSearchInput, OfferSearchResult } from './offer-search.js';

// Parallel session (Section 11.5)
export {
  computeParallelSessionEU,
  rankParallelSessions,
  computeDynamicBatna,
} from './parallel-session.js';

// Validation
export { validateOffer, validateWeights } from './validation.js';
export type {
  ValidationError,
  WeightValidationError,
  OfferValidationResult,
  WeightValidationResult,
} from './validation.js';
