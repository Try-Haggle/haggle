// Protocol types (legacy v1)
export type { HnpMessageType, HnpRole, HnpMessage } from './protocol/types.js';

// HNP v2 lifecycle state machine
export {
  transitionHnp,
  isTerminalState,
  isFrozenState,
  getValidEvents,
  messageToEvent,
} from './protocol/hnp-lifecycle.js';
export type { HnpLifecycleEvent } from './protocol/hnp-lifecycle.js';

// Protocol types (HNP v2 unified model)
export type {
  AgentCapability,
  HnpAgent,
  HnpAgentRole,
  SessionOrigin,
  ListingRef,
  NegotiationIntent,
  HnpSessionState,
  HnpSession,
  SessionMessageType,
  NegotiationMessageType,
  DiscoveryMessageType,
  SettlementMessageType,
  HnpV2MessageType,
  OfferSender,
  OfferPayload,
  OfferMeta,
  HnpOfferMessage,
  RemedyType,
  ClauseRemedy,
  ContingentClause,
  ShippingTerms,
  ShippingVerificationResult,
  BatnaRef,
  AgentPreferences,
  OpponentSignals,
  SettlementMethod,
  SettlementHook,
  HnpV2Message,
} from './protocol/hnp-types.js';

// Strategy types + assembler
export type {
  MasterStrategy,
  RoundData,
  MultiIssueMasterStrategy,
  MultiIssueRoundData,
} from './strategy/types.js';
export { assembleContext } from './strategy/assembler.js';

// Session types + state machine
export type {
  SessionStatus,
  NegotiationRound,
  NegotiationSession,
} from './session/types.js';
export { transition } from './session/state-machine.js';
export type { SessionEvent } from './session/state-machine.js';

// Round types + executor + concession + opponent modeling
export type {
  RoundResult,
  EscalationRequest,
  OpponentMoveType,
  OpponentMove,
  OpponentModel,
  NegotiationRange,
} from './round/types.js';
export { executeRound } from './round/executor.js';
export { trackConcession } from './round/concession.js';
export { classifyMove } from './round/classify-move.js';
export { createOpponentModel, updateOpponentModel } from './round/opponent-model.js';

// Multi-issue round executor (vNext pipeline)
export { executeMultiIssueRound } from './round/multi-issue-executor.js';
export type { MultiIssueRoundResult } from './round/multi-issue-executor.js';

// Multi-issue opponent model
export {
  createMultiIssueOpponentModel,
  updateMultiIssueOpponentModel,
  estimateReservation,
} from './round/multi-issue-opponent.js';
export type {
  IssueConcesssionTracker,
  MultiIssueOpponentModel,
  MultiIssueMoveObservation,
} from './round/multi-issue-opponent.js';

// Contingent clauses & shipping verification
export {
  evaluateClause,
  evaluateClauses,
  verifyShipping,
} from './clauses/index.js';
export type {
  ClauseEvent,
  ClauseEvalResult,
  RemedyResult,
  ShippingEvent,
} from './clauses/index.js';

// Settlement hooks
export {
  buildSettlementConditions,
  createSmartContractHook,
  createEscrowHook,
  computeAgreementHash,
  transitionSettlement,
  settlementToSessionState,
} from './settlement/index.js';
export type {
  SettlementCondition,
  SettlementStatus,
  SettlementRecord,
  SettlementEvent,
} from './settlement/index.js';

// NegotiationEngine interface
export type {
  NegotiationEngine,
  EngineContext,
  EngineEvaluation,
  EngineCounterOffer,
} from './engine-interface.js';

// Errors
export { SessionError } from './errors/types.js';

// Session factory + timeout
export { createSession } from './session/factory.js';
export type { CreateSessionOptions } from './session/factory.js';
export { checkTimeout } from './session/timeout.js';

// Strategy validation
export { validateStrategy, validateRoundData } from './strategy/validation.js';
