export type {
  SessionOutcome,
  ConcessionPattern,
  RoundSnapshot,
  SessionSummary,
} from './types.js';

export type { SummarizeInput } from './summarizer.js';

export {
  classifyConcessionPattern,
  extractConcessions,
  computeConcessionRates,
} from './classifier.js';

export {
  classifyOutcome,
  computeCoachDeviation,
  toValueRange,
  summarizeSession,
} from './summarizer.js';
