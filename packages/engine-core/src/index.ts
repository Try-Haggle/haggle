// Types

export { compareSessions } from "./batch/comparator.js";
// Batch functions
export { batchEvaluate } from "./batch/evaluator.js";
// Batch types
export type {
  BatchEvaluateRequest,
  BatchEvaluateResult,
  BatchStrategy,
  ListingInput,
  RankedListing,
  SessionCompareResult,
  SessionSnapshot,
} from "./batch/types.js";
export { computeCounterOffer } from "./decision/faratin.js";
// Decision functions
export { makeDecision } from "./decision/maker.js";
// Decision types
export type {
  Decision,
  DecisionAction,
  DecisionThresholds,
  FaratinParams,
  SessionState,
} from "./decision/types.js";
export { applyFeatures } from "./features/apply.js";
// Feature contract (sensor ↔ engine seam) — backlog H4/H5/H6
export type {
  CategoryFeatureRule,
  ExtractedFeature,
  FeatureAdjustment,
  FeatureApplication,
  FeatureRouting,
} from "./features/types.js";
export { computeMultiTermUtility, evaluateTerm, validateTermSpace } from "./term/evaluator.js";
// Term Space types + evaluator
export type { Term, TermDomain, TermLayer, TermSpace, TermType } from "./term/types.js";
export type {
  CompetitionContext,
  HoldContext,
  NegotiationContext,
  PriceContext,
  RelationshipContext,
  RiskContext,
  TimeContext,
  UtilityResult,
  UtilityWeights,
} from "./types.js";
export { EngineError } from "./types.js";
export { adjustVpForCompetition } from "./utility/competition.js";
export { adjustVpForFeatures } from "./utility/features.js";
// Core functions
export { computeUtility } from "./utility/index.js";
export { computeVp } from "./utility/v-price.js";
export { computeVs } from "./utility/v-relationship.js";
export { computeVr } from "./utility/v-risk.js";
export { computeVt } from "./utility/v-time.js";
// Utils
export { clamp } from "./utils.js";
// Validation
export { validateContext } from "./validation.js";
