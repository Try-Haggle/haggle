// Protocol types
export type { HnpMessageType, HnpRole, HnpMessage } from './protocol/types.js';

// Strategy types + assembler
export type { MasterStrategy, RoundData } from './strategy/types.js';
export { assembleContext } from './strategy/assembler.js';

// Session types + state machine
export type {
  SessionStatus,
  NegotiationRound,
  NegotiationSession,
} from './session/types.js';
export { transition } from './session/state-machine.js';
export type { SessionEvent } from './session/state-machine.js';

// Round types + executor + concession
export type { RoundResult, EscalationRequest } from './round/types.js';
export { executeRound } from './round/executor.js';
export { trackConcession } from './round/concession.js';

// Hold expiration handler
export type { HoldSnapshot, HoldExpiredResult } from './round/hold-expired.js';
export { handleHoldExpired } from './round/hold-expired.js';

// Intent types + matching
export type { WaitingIntent, IntentConfig, IntentRole, IntentStatus, MatchCandidate, MatchResult, IntentEvent, MatchOptions, RematchPolicy, SessionTerminalStatus, RematchDecision } from './intent/index.js';
export { defaultIntentConfig, transitionIntent, evaluateMatch, evaluateIntents, evaluateBidirectionalMatch, defaultRematchPolicy, shouldRematchIntent } from './intent/index.js';

// Group types + orchestrator
export type { GroupTopology, GroupStatus, NegotiationGroup, GroupSnapshot, GroupAction } from './group/index.js';
export { computeGroupCompetition, orchestrateGroup, handleSessionTerminal } from './group/index.js';

// Summary — session summary & pattern classification (Doc 30)
export type {
  SessionOutcome, ConcessionPattern, RoundSnapshot,
  SessionSummary, SummarizeInput,
} from './summary/index.js';
export {
  classifyConcessionPattern, extractConcessions, computeConcessionRates,
  classifyOutcome, computeCoachDeviation, toValueRange, summarizeSession,
} from './summary/index.js';

// Integrity — hash chain for tamper-proof records (Doc 31)
export type {
  RoundFactPayload, FactHashResult, ChainVerificationResult,
} from './integrity/index.js';
export {
  canonicalize, sha256, computeFactHash, verifyChain, getSessionChainHash,
} from './integrity/index.js';

// Protocol — HNP Core wire types (P0)
export type {
  HnpCoreRevision, HnpTransport, HnpCompatibilityLevel, HnpErrorCode,
  HnpMoney, HnpIssueValue, HnpActorRole, HnpCoreMessageType,
  HnpProposalPayload, HnpAcceptPayload, HnpRejectPayload,
  HnpEscalatePayload, HnpAckPayload, HnpErrorPayload,
  HnpCorePayload, HnpEnvelope,
} from './protocol/core.js';
export {
  HNP_CORE_REVISIONS, HNP_CORE_CAPABILITY, HNP_TRANSPORTS,
  HNP_COMPATIBILITY_LEVELS, HNP_ERROR_CODES,
  toMinorUnits, fromMinorUnits,
} from './protocol/core.js';

// Protocol — HNP Profile & Discovery
export type {
  HnpCapabilitySupport, HnpTransportEntry, HnpAuthProfile,
  HnpAgentProfile, HnpWellKnownProfile,
} from './protocol/profile.js';
export { createHnpProfile } from './protocol/profile.js';

// Protocol — HNP Versioning
export type {
  HnpCapabilitySelection, HnpNegotiationResult,
} from './protocol/versioning.js';
export {
  negotiateCoreRevision, negotiateCapability, negotiateProfile,
} from './protocol/versioning.js';
