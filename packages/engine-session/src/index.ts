// Protocol legacy compatibility types

// Group types + orchestrator
export type {
  GroupAction,
  GroupSnapshot,
  GroupStatus,
  GroupTopology,
  NegotiationGroup,
} from "./group/index.js";
export { computeGroupCompetition, handleSessionTerminal, orchestrateGroup } from "./group/index.js";
// Integrity — hash chain for tamper-proof records (Doc 31)
export type {
  ChainVerificationResult,
  FactHashResult,
  RoundFactPayload,
} from "./integrity/index.js";
export {
  canonicalize,
  computeFactHash,
  getSessionChainHash,
  sha256,
  verifyChain,
} from "./integrity/index.js";
// Intent types + matching
export type {
  IntentConfig,
  IntentEvent,
  IntentRole,
  IntentStatus,
  MatchCandidate,
  MatchOptions,
  MatchResult,
  RematchDecision,
  RematchPolicy,
  SessionTerminalStatus,
  WaitingIntent,
} from "./intent/index.js";
export {
  defaultIntentConfig,
  defaultRematchPolicy,
  evaluateBidirectionalMatch,
  evaluateIntents,
  evaluateMatch,
  shouldRematchIntent,
  transitionIntent,
} from "./intent/index.js";
export type {
  CreateHnpAgreementInput,
  HnpAgreementIssue,
  HnpAgreementObject,
  HnpAgreementParty,
  HnpAgreementValidationResult,
} from "./protocol/agreement.js";
export {
  computeHnpAgreementHash,
  createHnpAgreementObject,
  validateHnpAgreementObject,
} from "./protocol/agreement.js";
export type {
  CreateHnpPaymentApprovalPolicyInput,
  EvaluateHnpPaymentApprovalInput,
  HnpPaymentApprovalDecision,
  HnpPaymentApprovalPolicy,
  HnpPaymentApprovalPolicyIssue,
  HnpPaymentApprovalPolicyValidationResult,
  HnpPaymentApprovalResult,
} from "./protocol/approval-policy.js";
export {
  computeHnpPaymentApprovalPolicyHash,
  createHnpPaymentApprovalPolicy,
  evaluateHnpPaymentApproval,
  validateHnpPaymentApprovalPolicy,
} from "./protocol/approval-policy.js";
export type { HnpProposalBinding } from "./protocol/binding.js";
export {
  computeHnpProposalHash,
  proposalMatchesAcceptedHash,
} from "./protocol/binding.js";
export type { A2AHnpTaskPart } from "./protocol/bindings/a2a.js";
export {
  A2A_HNP_SKILL,
  a2aTaskPartToHnpEnvelope,
  hnpEnvelopeToA2ATaskPart,
} from "./protocol/bindings/a2a.js";
export type { HnpUcpCheckoutBridge, UcpListingRef } from "./protocol/bindings/ucp.js";
export {
  hnpAgreementToUcpCheckoutBridge,
  UCP_HNP_EXTENSION_ID,
} from "./protocol/bindings/ucp.js";
export type {
  HnpIssueTrack,
  HnpIssueTrackStatus,
  HnpPublicAct,
  HnpPublicActType,
  HnpPublicCompactState,
} from "./protocol/compact-state.js";
export {
  encodeHnpCompactStateForLlm,
  HNP_COMPACT_STATE_CAPABILITY,
  HNP_COMPACT_STATE_LEGEND,
  HNP_COMPACT_STATE_VERSION,
  reduceHnpPublicCompactState,
  sanitizeHnpPublicClaim,
} from "./protocol/compact-state.js";
export type {
  HnpConformanceIssue,
  HnpConformanceOptions,
  HnpConformanceResult,
} from "./protocol/conformance.js";
export { validateHnpEnvelopeConformance } from "./protocol/conformance.js";
// Protocol — HNP Core wire types (P0)
export type {
  HnpAcceptPayload,
  HnpAckPayload,
  HnpActorRole,
  HnpCapabilitiesPayload,
  HnpCompatibilityLevel,
  HnpCoreMessageType,
  HnpCorePayload,
  HnpCoreRevision,
  HnpEnvelope,
  HnpErrorCode,
  HnpErrorPayload,
  HnpEscalatePayload,
  HnpHelloPayload,
  HnpIssueValue,
  HnpMoney,
  HnpProposalPayload,
  HnpRejectPayload,
  HnpTransport,
} from "./protocol/core.js";
export {
  fromMinorUnits,
  HNP_COMPATIBILITY_LEVELS,
  HNP_CORE_CAPABILITY,
  HNP_CORE_REVISIONS,
  HNP_ERROR_CODES,
  HNP_TRANSPORTS,
  toMinorUnits,
} from "./protocol/core.js";
export type {
  CreateHnpDisputeEvidencePacketInput,
  HnpDigitalAccessContent,
  HnpDigitalDisputeEvidenceContent,
  HnpDigitalDisputeEvidenceContentIssue,
  HnpDigitalDisputeEvidenceContentIssueCode,
  HnpDigitalDisputeEvidenceContentValidationResult,
  HnpDigitalDisputeEvidenceKind,
  HnpDigitalFileHashContent,
  HnpDisputeEvidenceItem,
  HnpDisputeEvidenceKind,
  HnpDisputeEvidencePacket,
  HnpDisputeEvidencePacketIssue,
  HnpDisputeEvidencePacketValidationResult,
  HnpDisputeReason,
  HnpDisputeRequestedResolution,
  HnpInspectionFinding,
  HnpLicenseTermsContent,
  HnpOnchainTransferContent,
  HnpPlatformTransferContent,
} from "./protocol/dispute-evidence.js";
export {
  computeHnpDisputeEvidencePacketHash,
  createHnpDisputeEvidencePacket,
  HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS,
  HNP_DISPUTE_EVIDENCE_KINDS,
  isHnpDigitalDisputeEvidenceKind,
  isHnpDisputeEvidenceKind,
  validateDigitalDisputeEvidenceContent,
  validateHnpDisputeEvidencePacket,
} from "./protocol/dispute-evidence.js";
export type { HnpCoreIssueId } from "./protocol/issue-registry.js";
export {
  HNP_CORE_ISSUES,
  isHnpCoreIssueId,
  isSupportedIssueId,
  isVendorIssueId,
} from "./protocol/issue-registry.js";
export type {
  LegacyHnpEnvelope,
  LegacyToEnvelopeOptions,
} from "./protocol/legacy-adapter.js";
export {
  hnpProposalEnvelopeToLegacyMessage,
  isHnpProposalEnvelope,
  legacyMessageToHnpEnvelope,
} from "./protocol/legacy-adapter.js";
export type {
  CreateHnpListingEvidenceBundleInput,
  HnpListingEvidenceBundle,
  HnpListingEvidenceClaim,
  HnpListingEvidenceItem,
  HnpListingEvidenceKind,
  HnpListingEvidenceValidationIssue,
  HnpListingEvidenceValidationResult,
  HnpProductIdentitySubject,
} from "./protocol/listing-evidence.js";
export {
  computeHnpListingEvidenceBundleHash,
  createHnpListingEvidenceBundle,
  HNP_LISTING_EVIDENCE_KINDS,
  validateHnpListingEvidenceBundle,
} from "./protocol/listing-evidence.js";
// Protocol — HNP Profile & Discovery
export type {
  HnpAuthProfile,
  HnpCapabilitySupport,
  HnpNegotiationAgent,
  HnpTransportEntry,
  HnpWellKnownProfile,
} from "./protocol/profile.js";
export { createHnpProfile } from "./protocol/profile.js";
export type {
  CreateHnpShippingTermsInput,
  HnpRiskTransferPoint,
  HnpShippingMethod,
  HnpShippingPayer,
  HnpShippingTerms,
  HnpShippingTermsIssue,
  HnpShippingTermsValidationResult,
  HnpShippingWindow,
} from "./protocol/shipping-terms.js";
export {
  computeHnpShippingTermsHash,
  createHnpShippingTerms,
  validateHnpShippingTerms,
} from "./protocol/shipping-terms.js";
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
} from "./protocol/transaction-handoff.js";
export {
  computeHnpTransactionHandoffChainHash,
  computeHnpTransactionHandoffHash,
  createHnpTransactionHandoff,
  createHnpTransactionHandoffFromSignals,
  deriveHnpTransactionHandoffStatus,
  getHnpTransactionNextAction,
  summarizeHnpTransactionHandoffChain,
  validateHnpTransactionHandoff,
  validateHnpTransactionHandoffChain,
  validateHnpTransactionHandoffTransition,
} from "./protocol/transaction-handoff.js";
export type {
  CreateHnpTrustEventInput,
  HnpTrustEvent,
  HnpTrustEventIssue,
  HnpTrustEventType,
  HnpTrustEventValidationResult,
  HnpTrustScore,
  HnpTrustSubjectRole,
} from "./protocol/trust-graph.js";
export {
  aggregateHnpTrustScore,
  computeHnpTrustEventHash,
  createHnpTrustEvent,
  HNP_TRUST_EVENT_TYPES,
  validateHnpTrustEvent,
} from "./protocol/trust-graph.js";
export type { HnpMessage, HnpMessageType, HnpRole } from "./protocol/types.js";
// Protocol — HNP Versioning
export type {
  HnpCapabilitySelection,
  HnpNegotiationResult,
} from "./protocol/versioning.js";
export {
  negotiateCapability,
  negotiateCoreRevision,
  negotiateProfile,
} from "./protocol/versioning.js";
export { trackConcession } from "./round/concession.js";
export { executeRound } from "./round/executor.js";
// Hold expiration handler
export type { HoldExpiredResult, HoldSnapshot } from "./round/hold-expired.js";
export { handleHoldExpired } from "./round/hold-expired.js";
// Round types + executor + concession
export type { EscalationRequest, RoundResult } from "./round/types.js";
export type { SessionEvent } from "./session/state-machine.js";
export { transition } from "./session/state-machine.js";
// Session types + state machine
export type {
  NegotiationRound,
  NegotiationSession,
  SessionStatus,
} from "./session/types.js";
export { assembleContext } from "./strategy/assembler.js";
export {
  type CompiledNegotiationAgentSnapshot,
  compileNegotiationAgentSnapshot,
  type EngineParamsInput,
  type StrategyCompilerInput,
  type StrategyRole,
} from "./strategy/compiler.js";
export {
  buildTimeValueWindow,
  computeTimeCurvePrice,
  type TimeCurvePriceInput,
  type TimeValueWindow,
} from "./strategy/time-value.js";
// Strategy types + assembler
export type { MasterStrategy, RoundData } from "./strategy/types.js";
// Summary — session summary & pattern classification (Doc 30)
export type {
  ConcessionPattern,
  RoundSnapshot,
  SessionOutcome,
  SessionSummary,
  SummarizeInput,
} from "./summary/index.js";
export {
  classifyConcessionPattern,
  classifyOutcome,
  computeCoachDeviation,
  computeConcessionRates,
  extractConcessions,
  summarizeSession,
  toValueRange,
} from "./summary/index.js";
