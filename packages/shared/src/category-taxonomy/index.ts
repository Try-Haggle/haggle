export type {
  CategoryChoiceQuestion,
  CategoryCriterion,
  CriterionRequirement,
  SellerProductFact,
} from "./criteria.js";
export {
  buildBuyerChoiceQuestions,
  buildCategoryCriteriaScaffold,
  buildSellerChoiceQuestions,
  buyerChoiceOptionsForCheck,
  criterionAnswered,
  requiredCriteria,
  resolveBuyerChoiceOption,
  sellerProductFacts,
  unresolvedSellerRequirements,
} from "./criteria.js";
export type {
  LearnedCheck,
  LearnedCheckObservation,
  LearnedCheckStore,
  PromotionOptions,
} from "./learning.js";
export {
  createInMemoryLearnedCheckStore,
  promoteLearnedChecks,
  recordCheckObservation,
  resolveChecksWithLearned,
} from "./learning.js";
export {
  enrichTagsWithTaxonomy,
  getTaxonomyVocabulary,
  inferTaxonomyTags,
  looksLikeAccessory,
} from "./tag-inference.js";
export {
  CATEGORY_TAXONOMY,
  getCategoryNode,
  isTaxonomyCheckId,
  matchedCategoryPaths,
  resolveChecks,
} from "./taxonomy.js";
export type {
  CategoryNode,
  CheckAnswerOption,
  CheckEnforcement,
  NegotiationCheck,
} from "./types.js";
