// Protocol legacy compatibility types
export type { HnpMessageType, HnpRole, HnpMessage } from './protocol/types.js';

// Strategy types + assembler
export type { MasterStrategy, RoundData } from './strategy/types.js';
export { assembleContext } from './strategy/assembler.js';
export {
  buildTimeValueWindow,
  computeTimeCurvePrice,
  type TimeCurvePriceInput,
  type TimeValueWindow,
} from './strategy/time-value.js';
export {
  compileStrategySnapshot,
  normalizeAgentStats,
  type AgentStats,
  type CompiledStrategySnapshot,
  type StrategyCompilerInput,
  type StrategyRole,
} from './strategy/compiler.js';

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
  HnpCapabilitiesPayload, HnpHelloPayload, HnpCorePayload, HnpEnvelope,
} from './protocol/core.js';
export {
  HNP_CORE_REVISIONS, HNP_CORE_CAPABILITY, HNP_TRANSPORTS,
  HNP_COMPATIBILITY_LEVELS, HNP_ERROR_CODES,
  toMinorUnits, fromMinorUnits,
} from './protocol/core.js';
export type { HnpCoreIssueId } from './protocol/issue-registry.js';
export {
  HNP_CORE_ISSUES,
  isHnpCoreIssueId,
  isVendorIssueId,
  isSupportedIssueId,
} from './protocol/issue-registry.js';
export type {
  LegacyToEnvelopeOptions,
  LegacyHnpEnvelope,
} from './protocol/legacy-adapter.js';
export {
  legacyMessageToHnpEnvelope,
  hnpProposalEnvelopeToLegacyMessage,
  isHnpProposalEnvelope,
} from './protocol/legacy-adapter.js';
export type { HnpProposalBinding } from './protocol/binding.js';
export {
  computeHnpProposalHash,
  proposalMatchesAcceptedHash,
} from './protocol/binding.js';
export type {
  HnpConformanceIssue,
  HnpConformanceOptions,
  HnpConformanceResult,
} from './protocol/conformance.js';
export { validateHnpEnvelopeConformance } from './protocol/conformance.js';
export type {
  CreateHnpAgreementInput,
  HnpAgreementIssue,
  HnpAgreementObject,
  HnpAgreementParty,
  HnpAgreementValidationResult,
} from './protocol/agreement.js';
export {
  computeHnpAgreementHash,
  createHnpAgreementObject,
  validateHnpAgreementObject,
} from './protocol/agreement.js';
export type {
  CreateHnpListingEvidenceBundleInput,
  HnpListingEvidenceBundle,
  HnpListingEvidenceClaim,
  HnpListingEvidenceItem,
  HnpListingEvidenceKind,
  HnpListingEvidenceValidationIssue,
  HnpListingEvidenceValidationResult,
  HnpProductIdentitySubject,
} from './protocol/listing-evidence.js';
export {
  HNP_LISTING_EVIDENCE_KINDS,
  computeHnpListingEvidenceBundleHash,
  createHnpListingEvidenceBundle,
  validateHnpListingEvidenceBundle,
} from './protocol/listing-evidence.js';
export type {
  CreateHnpPaymentApprovalPolicyInput,
  EvaluateHnpPaymentApprovalInput,
  HnpPaymentApprovalDecision,
  HnpPaymentApprovalPolicy,
  HnpPaymentApprovalPolicyIssue,
  HnpPaymentApprovalPolicyValidationResult,
  HnpPaymentApprovalResult,
} from './protocol/approval-policy.js';
export {
  computeHnpPaymentApprovalPolicyHash,
  createHnpPaymentApprovalPolicy,
  evaluateHnpPaymentApproval,
  validateHnpPaymentApprovalPolicy,
} from './protocol/approval-policy.js';
export type {
  CreateHnpShippingTermsInput,
  HnpRiskTransferPoint,
  HnpShippingMethod,
  HnpShippingPayer,
  HnpShippingTerms,
  HnpShippingTermsIssue,
  HnpShippingTermsValidationResult,
  HnpShippingWindow,
} from './protocol/shipping-terms.js';
export {
  computeHnpShippingTermsHash,
  createHnpShippingTerms,
  validateHnpShippingTerms,
} from './protocol/shipping-terms.js';
export type {
  CreateHnpDisputeEvidencePacketInput,
  HnpDisputeEvidenceItem,
  HnpDisputeEvidenceKind,
  HnpDisputeEvidencePacket,
  HnpDisputeEvidencePacketIssue,
  HnpDisputeEvidencePacketValidationResult,
  HnpDisputeReason,
  HnpDisputeRequestedResolution,
  HnpInspectionFinding,
} from './protocol/dispute-evidence.js';
export {
  HNP_DISPUTE_EVIDENCE_KINDS,
  computeHnpDisputeEvidencePacketHash,
  createHnpDisputeEvidencePacket,
  validateHnpDisputeEvidencePacket,
} from './protocol/dispute-evidence.js';
export type {
  CreateHnpTrustEventInput,
  HnpTrustEvent,
  HnpTrustEventIssue,
  HnpTrustEventType,
  HnpTrustEventValidationResult,
  HnpTrustScore,
  HnpTrustSubjectRole,
} from './protocol/trust-graph.js';
export {
  HNP_TRUST_EVENT_TYPES,
  aggregateHnpTrustScore,
  computeHnpTrustEventHash,
  createHnpTrustEvent,
  validateHnpTrustEvent,
} from './protocol/trust-graph.js';
export type {
  CreateHnpTransactionHandoffFromSignalsInput,
  CreateHnpTransactionHandoffInput,
  DeriveHnpTransactionHandoffStatusInput,
  HnpTransactionHandoff,
  HnpTransactionHandoffChainIssue,
  HnpTransactionHandoffChainResult,
  HnpTransactionHandoffChainSummary,
  HnpTransactionHandoffIssue,
  HnpTransactionHandoffStatus,
  HnpTransactionHandoffTransitionIssue,
  HnpTransactionHandoffTransitionResult,
  HnpTransactionHandoffValidationResult,
  HnpTransactionNextAction,
} from './protocol/transaction-handoff.js';
export {
  computeHnpTransactionHandoffChainHash,
  computeHnpTransactionHandoffHash,
  createHnpTransactionHandoff,
  createHnpTransactionHandoffFromSignals,
  deriveHnpTransactionHandoffStatus,
  getHnpTransactionNextAction,
  summarizeHnpTransactionHandoffChain,
  validateHnpTransactionHandoffChain,
  validateHnpTransactionHandoff,
  validateHnpTransactionHandoffTransition,
} from './protocol/transaction-handoff.js';

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
