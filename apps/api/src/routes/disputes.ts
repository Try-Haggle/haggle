import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Database } from "@haggle/db";
import { and, disputeEvidence as disputeEvidenceTable, eq, sql } from "@haggle/db";
import type {
  DisputeCase,
  DisputeEvidence,
  DisputeReasonCode,
  DisputeTier,
  ResolutionAssessorOutput,
} from "@haggle/dispute-core";
import {
  computeDisputeCost,
  createDepositRequirement,
  DisputeService,
  REASON_CODE_REGISTRY,
  validateEvidenceForReasonCode,
} from "@haggle/dispute-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAddress } from "viem";
import { z } from "zod";
import { runDisputeEvidenceRetention } from "../jobs/dispute-evidence-retention.js";
import {
  ALLOWED_EVIDENCE_TYPES,
  buildDisputeEvidencePath,
  DISPUTE_EVIDENCE_BUCKET,
  DISPUTE_VIEW_URL_TTL_SECONDS,
  EVIDENCE_LIMITS,
  isImageType,
  isVideoType,
  validateDisputeStoragePath,
} from "../lib/dispute-storage-paths.js";
import { INPUT_LIMITS } from "../lib/input-limits.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import { confirmUsdcDeposit, initiateDepositCollection } from "../payments/deposit-collector.js";
import { writeAuditLog } from "../services/admin-action-log.service.js";
import {
  buildDisputeAiCaseContextFromDispute,
  createDisputeAiProvider,
  resolveDisputeAiModel,
  runResolutionAssessor,
} from "../services/dispute-ai.service.js";
import {
  appendDisputeAiAssessmentEvent,
  listDisputeAiAssessmentEvents,
  verifyDisputeAiAssessmentEventChain,
} from "../services/dispute-ai-assessment-event.service.js";
import {
  acquireDisputeAiAssessmentLease,
  releaseDisputeAiAssessmentLease,
} from "../services/dispute-ai-assessment-lease.service.js";
import {
  enqueueDisputeAiAuditArchive,
  getDisputeAiAuditArchiveCoverage,
  getDisputeAiAuditArchiveHealth,
  getDisputeAiAuditArchivePolicyStatus,
  getDisputeAiAuditDiscoveryFailureHealth,
  getLatestDisputeAiAuditArchive,
  listDisputeAiAuditArchiveFailures,
  listDisputeAiAuditDiscoveryFailures,
  requeueDisputeAiAuditArchive,
  retryDisputeAiAuditDiscoveryFailure,
} from "../services/dispute-ai-audit-archive.service.js";
import {
  evaluateDisputeAiAuditArchiveAlert,
  getDisputeAiAuditArchiveAlertDeliveryState,
  getDisputeAiAuditArchiveAlertPolicyStatus,
} from "../services/dispute-ai-audit-archive-alert.service.js";
import {
  createSignedDisputeAiAuditExport,
  DisputeAuditSigningNotConfiguredError,
} from "../services/dispute-ai-audit-export.service.js";
import {
  resolveDisputeAuditPublicKeyRegistryFromEnv,
  verifyTrustedSignedDisputeAiAuditExport,
} from "../services/dispute-audit-public-key-registry.service.js";
import {
  type CameraChallengeVerificationResult,
  verifyCameraChallenge,
} from "../services/dispute-camera-challenge.service.js";
import {
  createDeposit,
  getDepositByDisputeId,
  getPendingExpiredDeposits,
  updateDepositMetadata,
  updateDepositStatus,
} from "../services/dispute-deposit.service.js";
import {
  resolveStagingDisputeFixtureParty,
  stagingDisputeFixturePlatformRules,
} from "../services/dispute-evidence-fixture-policy.service.js";
import { createSignedDisputeEvidenceProvenance } from "../services/dispute-evidence-provenance.service.js";
import {
  enqueueDisputeEvidenceProvenanceArchive,
  getDisputeEvidenceProvenanceArchiveHealth,
  getDisputeEvidenceProvenanceArchivePolicyStatus,
  listDisputeEvidenceProvenanceArchiveFailures,
  requeueDisputeEvidenceProvenanceArchive,
} from "../services/dispute-evidence-provenance-archive.service.js";
import {
  getDisputeEvidenceProvenanceArchiveAlertDeliveryState,
  getDisputeEvidenceProvenanceArchiveAlertPolicyStatus,
} from "../services/dispute-evidence-provenance-archive-alert.service.js";
import {
  evidenceRetentionPolicy,
  getDisputeEvidenceRetentionSummary,
  setDisputeEvidenceLegalHold,
} from "../services/dispute-evidence-retention.service.js";
import { scanDisputeEvidence } from "../services/dispute-evidence-scan.service.js";
import {
  CAMERA_SIMILARITY_COLOR_DISTANCE,
  CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE,
  CAMERA_SIMILARITY_REVIEW_DISTANCE,
  computeImageSimilarityFingerprint,
} from "../services/dispute-image-similarity.service.js";
import { evaluateDisputeOpeningEligibility } from "../services/dispute-opening-eligibility.service.js";
import type { DisputeOperation } from "../services/dispute-operation-lease.service.js";
import {
  acquireDisputeOperationLease,
  disputeOperationLeaseKey,
  releaseDisputeOperationLease,
} from "../services/dispute-operation-lease.service.js";
import {
  describeDisputeOrderGate,
  isDisputableOrderStatus,
} from "../services/dispute-order-gate.service.js";
import {
  buildDisputePrecedentSnapshot,
  listApprovedDisputePrecedents,
  toResolutionAssessorPrecedentExamples,
} from "../services/dispute-precedent.service.js";
import {
  addDisputeEvidenceRecord,
  createDisputeEvidenceUploadRecord,
  createDisputeRecord,
  decideDisputeEvidenceSimilarityReview,
  findNearestCommittedCameraEvidence,
  getDisputeById,
  getDisputeByOrderId,
  getDisputeEvidenceSimilarityReviewHealth,
  getDisputeEvidenceUploadByEvidenceId,
  getDisputeEvidenceUploadById,
  getDisputeEvidenceUploadByPath,
  hasCommittedCameraEvidenceSha256,
  listBlockingDisputeEvidenceUploads,
  listDisputeEvidenceSimilarityReviews,
  markDisputeEvidenceUploadCommitted,
  rejectDisputeEvidenceUpload,
  updateDisputeEvidenceUploadScan,
  updateDisputeEvidenceUploadSimilarity,
  updateDisputeRecord,
} from "../services/dispute-record.service.js";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";
import { getDisputeSimilarityReviewAlertPolicyStatus } from "../services/dispute-similarity-review-alert.service.js";
import {
  getDisputeSimilarityReviewAuditArchiveHealth,
  getDisputeSimilarityReviewAuditArchivePolicyStatus,
  listDisputeSimilarityReviewAuditArchiveFailures,
  requeueDisputeSimilarityReviewAuditArchive,
} from "../services/dispute-similarity-review-audit-archive.service.js";
import {
  evaluateDisputeSimilarityReviewAuditArchiveAlert,
  getDisputeSimilarityReviewAuditArchiveAlertDeliveryState,
  getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus,
} from "../services/dispute-similarity-review-audit-archive-alert.service.js";
import {
  createSignedDisputeSimilarityReviewAuditExport,
  DisputeSimilarityReviewAuditSigningNotConfiguredError,
} from "../services/dispute-similarity-review-audit-export.service.js";
import {
  disputeSimilarityReviewExpiryPolicy,
  getDisputeSimilarityReviewExpiryEventById,
  listDisputeSimilarityReviewExpiryEvents,
} from "../services/dispute-similarity-review-expiry.service.js";
import {
  createDisputeUploadUrl,
  createDisputeViewUrl,
  disputeEvidenceExists,
  downloadDisputeEvidence,
} from "../services/dispute-storage.service.js";
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import { getShipmentByOrderId } from "../services/shipment-record.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import { assignReviewersToDispute } from "./reviewer.js";

function disputeAiArchiveTrustSummary(payload: Record<string, unknown>) {
  try {
    const result = verifyTrustedSignedDisputeAiAuditExport(
      payload as any,
      resolveDisputeAuditPublicKeyRegistryFromEnv(),
    );
    return {
      trust_valid: result.valid,
      trust_reason: result.reason,
      key_id:
        typeof (payload as any)?.signature?.key_id === "string"
          ? (payload as any).signature.key_id
          : null,
    };
  } catch {
    return { trust_valid: false, trust_reason: "KEY_REGISTRY_INVALID", key_id: null };
  }
}

function storedImageSimilaritySignals(value: Record<string, unknown> | null | undefined) {
  const rawDistances = value?.distances;
  const distances =
    rawDistances && typeof rawDistances === "object" && !Array.isArray(rawDistances)
      ? (rawDistances as Record<string, unknown>)
      : null;
  const numberOrNull = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : null;
  return {
    distances: distances
      ? {
          dhash: numberOrNull(distances.dhash) ?? 64,
          ahash: numberOrNull(distances.ahash),
          color: numberOrNull(distances.color),
        }
      : undefined,
    matchedSignals: Array.isArray(value?.matched_signals)
      ? value.matched_signals
          .filter((item): item is string => typeof item === "string")
          .slice(0, 10)
      : undefined,
  };
}

const openDisputeSchema = z.object({
  order_id: z.string().max(INPUT_LIMITS.shortTextChars),
  reason_code: z.string().max(INPUT_LIMITS.shortTextChars),
  opened_by: z.enum(["buyer", "seller", "system"]),
  evidence: z
    .array(
      z.object({
        submitted_by: z.enum(["buyer", "seller", "system"]),
        type: z.enum(["text", "image", "video", "tracking_snapshot", "payment_proof", "other"]),
        uri: z.string().url().max(INPUT_LIMITS.uriChars).optional(),
        text: z.string().max(INPUT_LIMITS.longTextChars).optional(),
      }),
    )
    .max(10)
    .optional(),
});

function labelDisputeOutcome(outcome: string | undefined): string {
  switch (outcome) {
    case "buyer_favor":
      return "구매자 청구 인용";
    case "seller_favor":
      return "구매자 청구 기각";
    case "partial_refund":
      return "구매자 청구 부분 인용";
    case "no_action":
      return "조치 없음";
    case "escalate":
      return "추가 검토";
    default:
      return "판정 보류";
  }
}

function describeDisputeOrder(output: ResolutionAssessorOutput): string {
  switch (output.recommended_outcome) {
    case "buyer_favor":
      return "제출된 증거 기준상 구매자의 청구를 인용한다. MVP 테스트에서는 검증된 증거 범위 안에서 환불 처리 가능성을 검토하고, 판매자 정산은 운영자 확인 전까지 보류한다.";
    case "seller_favor":
      return "제출된 증거 기준상 구매자의 청구를 기각한다. MVP 테스트에서는 반대 증거가 추가 제출되지 않는 한 판매자 정산 진행 가능성을 검토한다.";
    case "partial_refund":
      return `제출된 증거 기준상 구매자의 청구를 일부 인용한다. 환불 권고액은 ${output.refund_amount_minor ?? 0} minor unit이며, 잔여 금액은 계약 이행분으로 본다.`;
    case "no_action":
      return "추가 금전 조치는 하지 않는다. MVP 테스트에서는 구매자 측 구제가 인정되지 않은 것으로 보아 정산 해제를 검토한다.";
    case "escalate":
      return "L1 자동 판정으로 종결하지 않는다. 추가 증거 제출 또는 사람 검토 단계로 이관한다.";
    default:
      return "현재 증거만으로는 주문을 확정할 수 없다.";
  }
}

function describeDisputeRemedy(output: ResolutionAssessorOutput): string {
  if (output.recommended_outcome === "partial_refund") {
    return `부분 환불 ${output.refund_amount_minor ?? 0} minor unit을 권고한다.`;
  }
  if (output.recommended_outcome === "buyer_favor")
    return "검증된 증거에 근거해 구매자 환불 처리를 권고한다.";
  if (output.recommended_outcome === "seller_favor" || output.recommended_outcome === "no_action") {
    return "구매자 청구가 입증되지 않은 범위에서 판매자 정산 진행을 권고한다.";
  }
  return "자동 환불이나 자동 정산 없이 분쟁을 추가 검토로 유지한다.";
}

function labelEvidenceSupport(supports: string | undefined): string {
  if (supports === "buyer") return "구매자 측 주장";
  if (supports === "seller") return "판매자 측 주장";
  return "어느 한쪽으로 확정되지 않은 주장";
}

function labelEvidenceWeight(weight: string | undefined): string {
  if (weight === "high") return "높은";
  if (weight === "medium") return "중간";
  if (weight === "low") return "낮은";
  return "확인되지 않은";
}

function describeEvidenceFinding(
  finding: ResolutionAssessorOutput["evidence_findings"][number],
): string {
  return `${labelEvidenceSupport(finding.supports)}과 관련된 증거로 ${labelEvidenceWeight(finding.weight)} 증거력으로 반영한다. 이 평가는 증거의 출처, 직접성, 검증 가능성, 계약 조건과의 관련성을 기준으로 한다.`;
}

function describeNeutralReasons(output: ResolutionAssessorOutput): string {
  switch (output.recommended_outcome) {
    case "buyer_favor":
      return "검증 가능성과 직접성이 높은 증거가 구매자의 핵심 청구를 더 강하게 뒷받침하고, 판매자 측 반박은 상대적으로 보강 증거가 부족하다고 평가했다. 이 판단은 구매자에게 유리하게 하려는 것이 아니라, 동일한 증거 기준에서 검증된 자료와 일반 진술의 증거력을 구분한 결과다.";
    case "seller_favor":
      return "현재 제출된 자료만으로는 구매자의 핵심 청구가 충분히 입증되지 않았고, 판매자 측 자료 또는 기존 거래 조건이 상대적으로 더 설득력 있다고 평가했다. 이 판단은 판매자에게 유리하게 하려는 것이 아니라, 청구를 제기한 쪽의 입증 정도와 반대 자료의 증거력을 같은 기준으로 비교한 결과다.";
    case "partial_refund":
      return "구매자의 문제 제기는 일부 입증되지만, 상품 가치 또는 판매자 이행분도 함께 인정된다. 따라서 전액 환불이나 전액 정산 중 하나로 치우치지 않고, 입증된 불일치 범위에 맞춰 부분 환불이 더 균형 잡힌 처리라고 평가했다.";
    case "no_action":
      return "현재 자료만으로는 추가 금전 조치를 정당화할 만큼의 증거가 부족하다고 평가했다. 이 판단은 어느 한쪽을 선호한 것이 아니라, 조치를 발생시키기 위해 필요한 입증 기준을 충족했는지 확인한 결과다.";
    case "escalate":
      return "현재 증거만으로는 L1 자동 판정이 공정하다고 보기 어렵다. 증거가 부족하거나 서로 충돌하거나 조작 가능성을 배제하기 어려우므로, 자동 환불이나 자동 정산 대신 추가 증거 또는 운영자 검토가 필요하다.";
    default:
      return "현재 자료만으로는 한쪽 청구를 확정하기 어렵다. 추가 증거 또는 운영자 검토가 필요하다.";
  }
}

function buildReadableDisputeJudgment(output: ResolutionAssessorOutput) {
  const evidenceSummary = output.evidence_findings.map((finding) => ({
    evidence_id: finding.evidence_id,
    supports: finding.supports,
    weight: finding.weight,
    finding: describeEvidenceFinding(finding),
    model_note: finding.note,
  }));
  return {
    title: `L1 분쟁 판결문 - ${labelDisputeOutcome(output.recommended_outcome)}`,
    order: describeDisputeOrder(output),
    holding: labelDisputeOutcome(output.recommended_outcome),
    confidence: output.confidence,
    scores: {
      buyer: output.buyer_score,
      seller: output.seller_score,
    },
    remedy: describeDisputeRemedy(output),
    reasons: describeNeutralReasons(output),
    model_rationale: output.rationale,
    standard_of_review:
      "양 당사자를 동일한 증거 기준으로 심사한다. 결론은 당사자 선호가 아니라 검증 가능성, 증거의 직접성, 조작 가능성, 계약 조건과의 관련성에 따라 정한다.",
    evidence_summary: evidenceSummary,
    next_action: output.escalation_required
      ? "추가 증거 제출 또는 운영자 검토가 필요하다."
      : "MVP에서는 운영자 확인 후 이 판정 방향을 정산/환불 처리에 적용할 수 있다.",
  };
}

const publicOpenDisputeSchema = z.object({
  reason_code: z.string().max(INPUT_LIMITS.shortTextChars),
  summary: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars),
  client_request_id: z.string().min(1).max(128).optional(),
  evidence: z
    .array(
      z.object({
        type: z.enum(["text", "tracking_snapshot", "payment_proof", "other"]),
        text: z.string().max(INPUT_LIMITS.longTextChars).optional(),
      }),
    )
    .max(10)
    .optional(),
});

const addEvidenceSchema = z.object({
  submitted_by: z.enum(["buyer", "seller", "system"]),
  type: z.enum(["text", "image", "video", "tracking_snapshot", "payment_proof", "other"]),
  uri: z.string().url().max(INPUT_LIMITS.uriChars).optional(),
  text: z.string().max(INPUT_LIMITS.longTextChars).optional(),
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(128),
  content_type: z.string().max(INPUT_LIMITS.shortTextChars),
  file_size_bytes: z.number().int().min(1),
  camera_session_id: z.string().min(1).max(128).optional(),
  camera_capture_token: z.string().min(32).max(128).optional(),
  capture_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  fixture_party: z.enum(["buyer", "seller"]).optional(),
});

const commitEvidenceSchema = z.object({
  storage_path: z.string().min(1).max(INPUT_LIMITS.uriChars),
  type: z.enum(["image", "video"]),
  description: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  camera_session_id: z.string().min(1).max(128).optional(),
  camera_capture_token: z.string().min(32).max(128).optional(),
  captured_at: z.string().datetime({ offset: true }).optional(),
  fixture_party: z.enum(["buyer", "seller"]).optional(),
});

const cameraCaptureSessionSchema = z.object({
  device_mode: z.enum(["mobile", "qr"]).default("mobile"),
  expires_in_seconds: z.number().int().min(60).max(1800).default(600),
  test_only: z.boolean().default(false),
});

const similarityReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
});
const similarityReviewQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1024).optional(),
});
const similarityArchiveRequeueSchema = z.object({
  reason: z.string().min(12).max(500),
});
const aiAuditDiscoveryRetrySchema = z.object({
  event_count: z.number().int().min(1),
  reason: z.string().min(12).max(500),
});

const evidenceLegalHoldSchema = z.object({
  active: z.boolean(),
  reason: z.string().min(3).max(INPUT_LIMITS.mediumTextChars),
});

const evidenceRetentionRunSchema = z.object({
  dry_run: z.boolean().default(true),
});

function evidenceRetentionPolicyResponse() {
  const policy = evidenceRetentionPolicy();
  return {
    committed_days_after_resolution: policy.committedDays,
    orphan_days_after_expiry: policy.orphanDays,
    batch_size: policy.batchSize,
    deletion_job_enabled: process.env.ENABLE_DISPUTE_EVIDENCE_RETENTION_JOB === "true",
  };
}

const aiAssessmentSchema = z
  .object({
    force: z.boolean().default(false),
    reassessment_reason: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars).optional(),
  })
  .superRefine((value, context) => {
    if (value.force && !value.reassessment_reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reassessment_reason"],
        message: "reassessment_reason is required when force is true",
      });
    }
  });

const aiAssessmentHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const DISPUTE_AI_POLICY_VERSION = "l1-resolution-policy-v2";

const disputeAppealSchema = z.object({
  reason: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars),
  client_request_id: z.string().min(1).max(128),
  evidence_ids: z.array(z.string().min(1).max(128)).max(10).default([]),
});

const disputeAppealReviewSchema = z.object({
  decision: z.enum(["dismiss", "reopen_review"]),
  notes: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars),
});

const disputeAppealAssignmentSchema = z.object({
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  sla_hours: z.number().int().min(1).max(72).optional(),
  expected_appeal_id: z.string().min(1).max(128),
});

const disputeAppealQueueQuerySchema = z.object({
  status: z.enum(["all", "open", "assigned", "completed"]).default("open"),
  sla: z.enum(["all", "unassigned", "on_track", "due_soon", "overdue"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const APPEAL_DEFAULT_SLA_HOURS = 24;
const APPEAL_REOPENED_SLA_HOURS = 8;
const APPEAL_DUE_SOON_HOURS = 4;

function hoursFromNowIso(hours: number, nowMs = Date.now()): string {
  return new Date(nowMs + hours * 60 * 60 * 1000).toISOString();
}

type AppealSlaState = "UNASSIGNED" | "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "COMPLETED";

export function deriveAppealSlaState(
  appeal: { status?: string; assigned_to?: string; sla_due_at?: string },
  nowMs = Date.now(),
): AppealSlaState {
  if (appeal.status === "DISMISSED" || appeal.status === "REASSESSED") return "COMPLETED";
  const dueAt = appeal.sla_due_at ? Date.parse(appeal.sla_due_at) : Number.NaN;
  if (!Number.isFinite(dueAt)) return "OVERDUE";
  const remainingMs = dueAt - nowMs;
  if (remainingMs <= 0) return "OVERDUE";
  if (!appeal.assigned_to) return "UNASSIGNED";
  if (remainingMs <= APPEAL_DUE_SOON_HOURS * 60 * 60 * 1000) return "DUE_SOON";
  return "ON_TRACK";
}

const disputeAiInFlight = new Set<string>();
const disputeAppealInFlight = new Set<string>();
const disputeAppealAssignmentInFlight = new Set<string>();

const depositSchema = z.object({
  rail: z.enum(["usdc", "stripe", "mock"]).optional(),
  wallet_address: z.string().optional(),
});

const confirmUsdcSchema = z.object({
  wallet_address: z.string().min(1),
});

const escalateSchema = z.object({
  escalated_by: z.enum(["buyer", "seller", "system"]),
  reason: z.string().max(INPUT_LIMITS.disputeSummaryChars).optional(),
});

const resolveDisputeSchema = z.object({
  outcome: z.enum(["buyer_favor", "seller_favor", "partial_refund"]),
  summary: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars),
  refund_amount_minor: z.number().optional(),
});

const listDisputesQuerySchema = z.object({
  role: z.enum(["buyer", "seller", "all"]).default("all"),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const VERIFIED_CAMERA_EVIDENCE_MARKER = "[Verified Haggle Camera Evidence]";

function containsVerifiedCameraEvidenceMarker(value: string | undefined): boolean {
  return typeof value === "string" && value.includes(VERIFIED_CAMERA_EVIDENCE_MARKER);
}

export function registerDisputeRoutes(app: FastifyInstance, db: Database) {
  const disputeService = new DisputeService();
  const { requireDisputeParty } = createOwnershipMiddleware(db);

  const buyerDisputeReasonCodes: DisputeReasonCode[] = [
    "ITEM_NOT_RECEIVED",
    "ITEM_NOT_AS_DESCRIBED",
    "DELIVERY_EXCEPTION",
    "SELLER_NO_FULFILLMENT",
    "REFUND_DISPUTE",
    "PARTIAL_REFUND_DISPUTE",
    "COUNTERFEIT_CLAIM",
    "OTHER",
  ];
  const sellerDisputeReasonCodes: DisputeReasonCode[] = [
    "PAYMENT_NOT_COMPLETED",
    "REFUND_DISPUTE",
    "PARTIAL_REFUND_DISPUTE",
  ];

  function isActiveDispute(status: string): boolean {
    return !["RESOLVED_BUYER_FAVOR", "RESOLVED_SELLER_FAVOR", "PARTIAL_REFUND", "CLOSED"].includes(
      status,
    );
  }

  function sameClientRequest(dispute: DisputeCase, clientRequestId?: string): boolean {
    if (!clientRequestId) return false;
    return (
      (dispute.metadata as Record<string, unknown> | null)?.client_request_id === clientRequestId
    );
  }

  async function getOpeningEligibility(
    orderId: string,
    orderStatus: string,
    reasonCode: DisputeReasonCode,
    openedBy: "buyer" | "seller" | "system",
  ) {
    const shipment = await getShipmentByOrderId(db, orderId);
    return evaluateDisputeOpeningEligibility({
      reasonCode,
      openedBy,
      orderStatus,
      shipment,
    });
  }

  async function writeDisputeOpen(dispute: DisputeCase, orderId: string): Promise<void> {
    const persist = async (tx: unknown) => {
      const txDb = tx as Database;
      await createDisputeRecord(txDb, dispute);
      await updateCommerceOrderStatus(txDb, orderId, "IN_DISPUTE");
    };

    if (typeof db.transaction === "function") {
      await db.transaction(persist);
      return;
    }
    await persist(db);
  }

  function createUuid(): string {
    return typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function evidenceTypeFromContentType(contentType: string): "image" | "video" {
    if (isImageType(contentType)) return "image";
    if (isVideoType(contentType)) return "video";
    throw new Error("unsupported evidence content type");
  }

  function qualifiedDisputeStoragePath(objectPath: string): string {
    return `${DISPUTE_EVIDENCE_BUCKET}/${objectPath}`;
  }

  function isExpired(value: Date | string): boolean {
    return new Date(value).getTime() <= Date.now();
  }

  function activePartyForOrder(
    requestUser: { id: string; role?: string } | undefined,
    order: { buyerId: string; sellerId: string } | null | undefined,
  ): "buyer" | "seller" | "system" | null {
    if (!requestUser) return null;
    if (requestUser.role === "admin") return "system";
    if (order && requestUser.id === order.buyerId) return "buyer";
    if (order && requestUser.id === order.sellerId) return "seller";
    return null;
  }

  type CameraCaptureSessionStatus = "PENDING" | "UPLOAD_URL_ISSUED" | "COMMITTED";

  interface CameraCaptureSession {
    id: string;
    dispute_id: string;
    party: "buyer" | "seller" | "system";
    user_id: string;
    device_mode: "mobile" | "qr";
    test_only?: boolean;
    challenge_code: string;
    status: CameraCaptureSessionStatus;
    created_at: string;
    expires_at: string;
    capture_url: string;
    qr_payload: string;
    capture_token_hash?: string;
    upload_id?: string;
    storage_path?: string;
    content_type?: string;
    file_size_bytes?: number;
    upload_url_issued_at?: string;
    captured_at?: string;
    challenge_verification?: CameraChallengeVerificationResult;
    capture_declared_sha256?: string;
    committed_evidence_id?: string;
    committed_at?: string;
  }

  type CameraCaptureSessionMap = Record<string, CameraCaptureSession>;

  function disputeMetadata(dispute: DisputeCase): Record<string, unknown> {
    return dispute.metadata &&
      typeof dispute.metadata === "object" &&
      !Array.isArray(dispute.metadata)
      ? dispute.metadata
      : {};
  }

  type AppealStatus = "OPEN" | "DISMISSED" | "REOPENED" | "REASSESSED";

  interface DisputeAppealReview {
    id: string;
    status: AppealStatus;
    appealed_by: "buyer" | "seller";
    appealed_by_user_id: string;
    reason: string;
    evidence_ids: string[];
    client_request_id: string;
    created_at: string;
    reviewed_by?: string;
    reviewed_at?: string;
    review_notes?: string;
    reassessed_at?: string;
    assigned_to?: string;
    assigned_by?: string;
    assigned_at?: string;
    priority?: "normal" | "high" | "urgent";
    sla_due_at?: string;
  }

  function appealReviewFor(dispute: DisputeCase): DisputeAppealReview | null {
    const value = disputeMetadata(dispute).appeal_review;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as DisputeAppealReview)
      : null;
  }

  function appealHistoryFor(dispute: DisputeCase): Record<string, unknown>[] {
    const value = disputeMetadata(dispute).appeal_history;
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
  }

  function aiAssessmentHistoryFor(dispute: DisputeCase): Record<string, unknown>[] {
    const value = disputeMetadata(dispute).ai_resolution_assessment_history;
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
  }

  function evidenceSnapshotHash(dispute: DisputeCase): string {
    const snapshot = dispute.evidence
      .map((evidence) => ({
        id: evidence.id,
        submitted_by: evidence.submitted_by,
        type: evidence.type,
        uri: evidence.uri ?? null,
        text: evidence.text ?? null,
        derived_artifacts: evidence.derived_artifacts ?? [],
        created_at: evidence.created_at,
      }))
      .sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
      );
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }

  function withStaleAiAssessment(
    dispute: DisputeCase,
    reason: "EVIDENCE_ADDED" | "CAMERA_EVIDENCE_COMMITTED",
  ): DisputeCase {
    const metadata = disputeMetadata(dispute);
    const assessment = metadata.ai_resolution_assessor;
    if (
      !assessment ||
      typeof assessment !== "object" ||
      Array.isArray(assessment) ||
      (assessment as Record<string, unknown>).status !== "COMPLETED"
    ) {
      return dispute;
    }

    const currentEvidenceHash = evidenceSnapshotHash(dispute);
    const assessedEvidenceHash = (assessment as Record<string, unknown>).evidence_snapshot_hash;
    if (assessedEvidenceHash === currentEvidenceHash) {
      return dispute;
    }

    return {
      ...dispute,
      metadata: {
        ...metadata,
        ai_assessment_stale: true,
        ai_assessment_stale_reason: reason,
        ai_assessment_stale_at: new Date().toISOString(),
        ai_assessment_previous_evidence_snapshot_hash:
          typeof assessedEvidenceHash === "string" ? assessedEvidenceHash : null,
        ai_assessment_current_evidence_snapshot_hash: currentEvidenceHash,
      },
    };
  }

  function aiAssessmentState(dispute: DisputeCase) {
    const metadata = disputeMetadata(dispute);
    return {
      stale: metadata.ai_assessment_stale === true,
      stale_reason: metadata.ai_assessment_stale_reason ?? null,
      stale_at: metadata.ai_assessment_stale_at ?? null,
      previous_evidence_snapshot_hash:
        metadata.ai_assessment_previous_evidence_snapshot_hash ?? null,
      current_evidence_snapshot_hash:
        metadata.ai_assessment_current_evidence_snapshot_hash ?? evidenceSnapshotHash(dispute),
    };
  }

  function appealBlocksResolution(dispute: DisputeCase): boolean {
    const appeal = appealReviewFor(dispute);
    return appeal?.status === "OPEN" || appeal?.status === "REOPENED";
  }

  function cameraSessionsFor(dispute: DisputeCase): CameraCaptureSessionMap {
    const sessions = disputeMetadata(dispute).camera_capture_sessions;
    return sessions && typeof sessions === "object" && !Array.isArray(sessions)
      ? (sessions as CameraCaptureSessionMap)
      : {};
  }

  function sessionIsExpired(session: CameraCaptureSession): boolean {
    return new Date(session.expires_at).getTime() <= Date.now();
  }

  function cameraSessionResponse(session: CameraCaptureSession, captureToken?: string) {
    const tokenFragment = captureToken ? `#capture_token=${encodeURIComponent(captureToken)}` : "";
    return {
      id: session.id,
      party: session.party,
      device_mode: session.device_mode,
      test_only: session.test_only === true,
      used_for_dispute: session.test_only !== true,
      challenge_code: session.challenge_code,
      status:
        session.status === "COMMITTED" || !sessionIsExpired(session) ? session.status : "EXPIRED",
      expires_at: session.expires_at,
      capture_url: `${session.capture_url}${tokenFragment}`,
      qr_payload: `${session.qr_payload}${tokenFragment}`,
      storage_path: session.storage_path,
      committed_evidence_id: session.committed_evidence_id,
      captured_at: session.captured_at,
      challenge_verification: session.challenge_verification,
      capture_binding: session.capture_declared_sha256
        ? { status: "BOUND", declared_sha256: session.capture_declared_sha256 }
        : undefined,
    };
  }

  function activeCameraSessions(dispute: DisputeCase): CameraCaptureSession[] {
    return Object.values(cameraSessionsFor(dispute)).filter(
      (session) => session.status !== "COMMITTED" && !sessionIsExpired(session),
    );
  }

  function createChallengeCode(): string {
    const words = ["ANGLE", "FOCUS", "LIGHT", "VERIFY", "HAGGLE"];
    const word = words[randomInt(words.length)] ?? "HAGGLE";
    const numeric = randomInt(100, 1000);
    return `HAGGLE-${word}-${numeric}`;
  }

  function createCameraCaptureToken(): string {
    return randomBytes(32).toString("base64url");
  }

  function cameraCaptureTokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  function validCameraCaptureToken(
    session: CameraCaptureSession,
    token: string | undefined,
  ): boolean {
    if (!session.capture_token_hash) return true;
    if (!token) return false;
    const received = Buffer.from(cameraCaptureTokenHash(token), "hex");
    const expected = Buffer.from(session.capture_token_hash, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  function originForRequest(request: {
    headers: Record<string, string | string[] | undefined>;
  }): string {
    const configuredOrigin = process.env.PUBLIC_API_URL?.trim();
    if (configuredOrigin) {
      try {
        const url = new URL(configuredOrigin);
        if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
      } catch {
        return "";
      }
    }

    const host = Array.isArray(request.headers.host)
      ? request.headers.host[0]
      : request.headers.host;
    const forwardedProto = Array.isArray(request.headers["x-forwarded-proto"])
      ? request.headers["x-forwarded-proto"][0]
      : request.headers["x-forwarded-proto"];
    const protocol = forwardedProto ?? "http";
    if (
      !host ||
      !/^[A-Za-z0-9.:[\]-]+$/.test(host) ||
      (protocol !== "http" && protocol !== "https")
    ) {
      return "";
    }
    return `${protocol}://${host}`;
  }

  async function saveCameraSession(
    dispute: DisputeCase,
    session: CameraCaptureSession,
  ): Promise<void> {
    const metadata = disputeMetadata(dispute);
    await updateDisputeRecord(db, {
      ...dispute,
      metadata: {
        ...metadata,
        camera_capture_sessions: {
          ...cameraSessionsFor(dispute),
          [session.id]: session,
        },
      },
    });
  }

  function getCameraSession(
    dispute: DisputeCase,
    sessionId: string | undefined,
  ): CameraCaptureSession | null {
    if (!sessionId) return null;
    return cameraSessionsFor(dispute)[sessionId] ?? null;
  }

  function verifiedCameraEvidenceText(options: {
    description?: string;
    session: CameraCaptureSession;
    capturedAt?: string;
    challengeVerification: CameraChallengeVerificationResult;
  }): string {
    const lines = [
      "[Verified Haggle Camera Evidence]",
      `Description: ${options.description ?? "none"}`,
      `Camera session: ${options.session.id}`,
      `Challenge code: ${options.session.challenge_code}`,
      `Challenge verification: ${options.challengeVerification.status}`,
      `Challenge verifier: ${options.challengeVerification.provider}`,
      `Challenge confidence: ${options.challengeVerification.confidence ?? "not provided"}`,
      `Captured at: ${options.capturedAt ?? "not provided"}`,
      `Device mode: ${options.session.device_mode}`,
      `Submitted by: ${options.session.party}`,
    ];
    return lines.join("\n");
  }

  async function acquireOperationLeaseGuard(options: {
    request: FastifyRequest;
    reply: FastifyReply;
    disputeId: string;
    operation: DisputeOperation;
    conflictError: string;
    conflictMessage: string;
    processLock?: Set<string>;
  }): Promise<boolean> {
    const leaseId = createUuid();
    const lease = await acquireDisputeOperationLease(db, {
      disputeId: options.disputeId,
      operation: options.operation,
      leaseId,
      ownerId: options.request.user!.id,
    });
    if (!lease) {
      options.reply.code(409).send({
        error: options.conflictError,
        message: options.conflictMessage,
      });
      return false;
    }

    options.processLock?.add(options.disputeId);
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      options.processLock?.delete(options.disputeId);
      try {
        await releaseDisputeOperationLease(
          db,
          disputeOperationLeaseKey(options.disputeId, options.operation),
          leaseId,
        );
      } catch (error) {
        options.request.log.error(
          {
            error,
            dispute_id: options.disputeId,
            operation: options.operation,
            lease_id: leaseId,
          },
          "Failed to release dispute operation lease",
        );
      }
    };
    options.reply.raw.once("finish", () => void release());
    options.reply.raw.once("close", () => void release());
    return true;
  }

  function htmlEscape(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cameraCapturePage(options: {
    disputeId: string;
    session: CameraCaptureSession;
  }): string {
    const disputeIdJson = JSON.stringify(options.disputeId);
    const sessionIdJson = JSON.stringify(options.session.id);
    const challenge = htmlEscape(options.session.challenge_code);
    const expiresAt = htmlEscape(options.session.expires_at);
    const capturePurpose = options.session.test_only
      ? "Camera test only. This photo will not be used by the dispute judge."
      : "This photo will be submitted as dispute evidence.";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Haggle Camera Evidence</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f2e9; color: #14213d; }
    main { max-width: 720px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 24px; margin: 0 0 16px; }
    label { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #7d6f5c; }
    input, textarea, button { width: 100%; box-sizing: border-box; border: 1px solid #d7c8b1; border-radius: 8px; font: inherit; }
    input, textarea { padding: 12px; background: #fffaf2; color: #14213d; }
    textarea { min-height: 84px; resize: vertical; }
    button { margin-top: 12px; padding: 12px 14px; background: #c9872c; color: #fff; border: 0; font-weight: 800; }
    button.secondary { background: #24324f; }
    button:disabled { opacity: .55; }
    video, canvas, img { width: 100%; border-radius: 8px; background: #1b1b1b; margin-top: 12px; }
    .panel { background: #fffaf2; border: 1px solid #eadfcf; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .challenge { font-size: 22px; font-weight: 900; letter-spacing: .08em; }
    .status { white-space: pre-wrap; font-size: 14px; color: #4b5563; }
  </style>
</head>
<body>
  <main>
    <h1>Haggle Camera Evidence</h1>
    <section class="panel">
      <label>Challenge Code</label>
      <div class="challenge">${challenge}</div>
      <label>Expires At</label>
      <div>${expiresAt}</div>
      <label>Capture Purpose</label>
      <div>${htmlEscape(capturePurpose)}</div>
    </section>
    <section class="panel">
      <label>Bearer Token</label>
      <input id="token" type="password" autocomplete="off" placeholder="Paste your Haggle bearer token">
      <label>Description</label>
      <textarea id="description" placeholder="Describe what this photo proves"></textarea>
      <button id="start" type="button">Start Camera</button>
      <video id="video" playsinline autoplay muted></video>
      <canvas id="canvas" hidden></canvas>
      <img id="preview" alt="" hidden>
      <button id="capture" class="secondary" type="button" disabled>Capture Photo</button>
      <button id="submit" type="button" disabled>Submit Evidence</button>
      <p id="status" class="status"></p>
    </section>
  </main>
  <script>
    const disputeId = ${disputeIdJson};
    const sessionId = ${sessionIdJson};
    const tokenInput = document.getElementById("token");
    const descriptionInput = document.getElementById("description");
    const startButton = document.getElementById("start");
    const captureButton = document.getElementById("capture");
    const submitButton = document.getElementById("submit");
    const video = document.getElementById("video");
    const canvas = document.getElementById("canvas");
    const preview = document.getElementById("preview");
    const statusEl = document.getElementById("status");
    let latestBlob = null;

    async function blobSha256(blob) {
      if (!window.crypto || !window.crypto.subtle) throw new Error("Secure capture hashing is unavailable");
      const digest = await window.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    const fragmentParams = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = fragmentParams.get("token");
    const cameraCaptureToken = fragmentParams.get("capture_token");
    let cameraCommitToken = cameraCaptureToken;
    if (fragmentToken) {
      tokenInput.value = fragmentToken;
      tokenInput.closest("section").querySelector("label").textContent = "Test Session Authentication";
      tokenInput.hidden = true;
    }
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);

    function setStatus(message) {
      statusEl.textContent = message;
    }

    function authHeaders(extra = {}) {
      const token = tokenInput.value.trim();
      return token ? { ...extra, authorization: "Bearer " + token } : extra;
    }

    startButton.addEventListener("click", async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        video.srcObject = stream;
        captureButton.disabled = false;
        setStatus("Camera ready. Include the challenge code in the photo when it is relevant.");
      } catch (error) {
        setStatus("Camera failed: " + (error && error.message ? error.message : String(error)));
      }
    });

    captureButton.addEventListener("click", async () => {
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      latestBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      preview.src = URL.createObjectURL(latestBlob);
      preview.hidden = false;
      submitButton.disabled = !latestBlob;
      setStatus("Photo captured. Submit before the capture window expires.");
    });

    submitButton.addEventListener("click", async () => {
      if (!latestBlob) return;
      submitButton.disabled = true;
      try {
        setStatus("Requesting upload URL...");
        const captureSha256 = await blobSha256(latestBlob);
        const uploadRes = await fetch("/disputes/" + encodeURIComponent(disputeId) + "/evidence/upload-url", {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            filename: "haggle-camera-evidence.jpg",
            content_type: "image/jpeg",
            file_size_bytes: latestBlob.size,
            camera_session_id: sessionId,
            camera_capture_token: cameraCaptureToken,
            capture_sha256: captureSha256
          })
        });
        const uploadBody = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadBody.error || "upload-url failed");
        cameraCommitToken = uploadBody.camera_commit_token || cameraCommitToken;

        setStatus("Uploading image...");
        const objectUpload = await fetch(uploadBody.upload_url, {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: latestBlob
        });
        if (!objectUpload.ok) throw new Error("object upload failed: " + objectUpload.status);

        setStatus("Committing evidence...");
        const commitRes = await fetch("/disputes/" + encodeURIComponent(disputeId) + "/evidence/commit", {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            storage_path: uploadBody.storage_path,
            type: "image",
            description: descriptionInput.value,
            camera_session_id: sessionId,
            camera_capture_token: cameraCommitToken,
            captured_at: new Date().toISOString(),
          })
        });
        const commitBody = await commitRes.json();
        if (!commitRes.ok) throw new Error(commitBody.error || "commit failed");
        setStatus(commitBody.test_capture
          ? "Camera test completed. This photo was not added to the dispute evidence. Capture ID: " + commitBody.test_capture.id
          : "Evidence submitted. Evidence ID: " + commitBody.evidence.id);
      } catch (error) {
        submitButton.disabled = false;
        setStatus("Submit failed: " + (error && error.message ? error.message : String(error)));
      }
    });
  </script>
</body>
</html>`;
  }

  // GET /orders/:orderId/dispute-eligibility — reason-level opening policy for the order UI.
  app.get<{ Params: { orderId: string } }>(
    "/orders/:orderId/dispute-eligibility",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { orderId } = request.params;
      const order = await getCommerceOrderByOrderId(db, orderId);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      const userId = request.user!.id;
      const openedBy =
        userId === order.buyerId ? "buyer" : userId === order.sellerId ? "seller" : null;
      if (!openedBy) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "You are not a party to this order" });
      }

      const shipment = await getShipmentByOrderId(db, orderId);
      const reasonCodes = openedBy === "buyer" ? buyerDisputeReasonCodes : sellerDisputeReasonCodes;
      const reasons = reasonCodes.map((reasonCode) => {
        const eligibility = isDisputableOrderStatus(order.status)
          ? evaluateDisputeOpeningEligibility({
              reasonCode,
              openedBy,
              orderStatus: order.status,
              shipment,
            })
          : (() => {
              const gate = describeDisputeOrderGate(order.status);
              return {
                eligible: false,
                error: "ORDER_NOT_DISPUTABLE",
                blocking_gate: gate.blocking_gate,
                message: gate.message,
                hint: gate.hint,
                staging_fixture: gate.staging_fixture,
              };
            })();
        return {
          code: reasonCode,
          label: REASON_CODE_REGISTRY[reasonCode].label,
          ...eligibility,
        };
      });

      return reply.send({
        order_id: orderId,
        order_status: order.status,
        opened_by: openedBy,
        shipment_status: shipment?.status ?? null,
        reasons,
      });
    },
  );

  // POST /orders/:orderId/disputes — production-safe public dispute opening path.
  app.post<{ Params: { orderId: string } }>(
    "/orders/:orderId/disputes",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { orderId } = request.params;
      const parsed = publicOpenDisputeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_DISPUTE_REQUEST", issues: parsed.error.issues });
      }
      const hasReservedInitialMarker =
        containsVerifiedCameraEvidenceMarker(parsed.data.summary) ||
        (parsed.data.evidence ?? []).some((evidence) =>
          containsVerifiedCameraEvidenceMarker(evidence.text),
        );
      if (hasReservedInitialMarker) {
        return reply.code(400).send({
          error: "RESERVED_EVIDENCE_MARKER",
          message:
            "Verified camera evidence markers can only be created by the Haggle camera capture flow.",
        });
      }

      const order = await getCommerceOrderByOrderId(db, orderId);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      const userId = request.user!.id;
      let openedBy: "buyer" | "seller";
      if (userId === order.buyerId) {
        openedBy = "buyer";
      } else if (userId === order.sellerId) {
        openedBy = "seller";
      } else {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "You are not a party to this order" });
      }

      const existing = await getDisputeByOrderId(db, orderId);
      if (existing && isActiveDispute(existing.status)) {
        if (sameClientRequest(existing, parsed.data.client_request_id)) {
          return reply.send({
            dispute: existing,
            opened_by: existing.opened_by,
            order_status: "IN_DISPUTE",
            idempotent: true,
          });
        }
        return reply.code(409).send({
          error: "ACTIVE_DISPUTE_EXISTS",
          dispute_id: existing.id,
          message: "This order already has an active dispute",
        });
      }

      if (!isDisputableOrderStatus(order.status)) {
        const gate = describeDisputeOrderGate(order.status);
        return reply.code(409).send({
          error: "ORDER_NOT_DISPUTABLE",
          order_status: gate.order_status,
          blocking_gate: gate.blocking_gate,
          message: gate.message,
          hint: gate.hint,
          staging_fixture: gate.staging_fixture,
        });
      }

      const reasonCode = parsed.data.reason_code as DisputeReasonCode;
      if (!(reasonCode in REASON_CODE_REGISTRY)) {
        return reply
          .code(400)
          .send({ error: "INVALID_REASON_CODE", reason_code: parsed.data.reason_code });
      }
      const openingEligibility = await getOpeningEligibility(
        orderId,
        order.status,
        reasonCode,
        openedBy,
      );
      if (!openingEligibility.eligible) {
        return reply.code(409).send({
          ...openingEligibility,
          reason_code: reasonCode,
          order_status: order.status,
        });
      }

      const initialEvidence = [
        { submitted_by: openedBy, type: "text" as const, text: parsed.data.summary },
        ...(parsed.data.evidence ?? []).map((e) => ({
          submitted_by: openedBy,
          type: e.type,
          text: e.text,
        })),
      ];

      const result = disputeService.openCase({
        order_id: orderId,
        reason_code: reasonCode,
        opened_by: openedBy,
        initial_evidence: initialEvidence,
      });
      result.dispute.metadata = {
        tier: 1,
        opened_by_user_id: userId,
        client_request_id: parsed.data.client_request_id ?? null,
        source: "public_order_dispute_api",
        order_status_at_open: order.status,
      };

      try {
        await writeDisputeOpen(result.dispute, orderId);
      } catch (error) {
        if (
          error instanceof Error &&
          /dispute_cases_active_order_uidx|unique/i.test(error.message)
        ) {
          const replay = await getDisputeByOrderId(db, orderId);
          if (replay && sameClientRequest(replay, parsed.data.client_request_id)) {
            return reply.send({
              dispute: replay,
              opened_by: replay.opened_by,
              order_status: "IN_DISPUTE",
              idempotent: true,
            });
          }
          return reply.code(409).send({
            error: "ACTIVE_DISPUTE_EXISTS",
            message: "This order already has an active dispute",
          });
        }
        throw error;
      }

      return reply.code(201).send({
        dispute: result.dispute,
        opened_by: openedBy,
        order_status: "IN_DISPUTE",
        idempotent: false,
      });
    },
  );

  // GET /disputes — list authenticated user's disputes
  app.get("/disputes", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = listDisputesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const { role, status, limit, offset } = parsed.data;
    const userId = request.user!.id;

    // Build raw SQL query joining dispute_cases → commerce_orders → settlement_approvals
    // to get item info and determine user role
    const statusFilter = status ? sql`AND dc.status = ${status}` : sql``;

    let roleFilter = sql``;
    if (role === "buyer") {
      roleFilter = sql`AND co.buyer_id = ${userId}`;
    } else if (role === "seller") {
      roleFilter = sql`AND co.seller_id = ${userId}`;
    }

    // Count total
    const countRaw = await db.execute(sql`
      SELECT COUNT(*)::text AS total
      FROM dispute_cases dc
      JOIN commerce_orders co ON co.id = dc.order_id
      WHERE (co.buyer_id = ${userId} OR co.seller_id = ${userId})
      ${statusFilter}
      ${roleFilter}
    `);
    const countRows = (countRaw as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
    const total = parseInt((countRows[0]?.total as string) ?? "0", 10);

    // Needs-action ordering: WAITING states first, then OPEN, UNDER_REVIEW, then resolved/closed
    interface DisputeListRow {
      id: string;
      order_id: string;
      reason_code: string;
      status: string;
      opened_by: string;
      opened_at: string;
      metadata: Record<string, unknown> | null;
      resolution_summary: string | null;
      buyer_id: string;
      seller_id: string;
      amount_minor: string | null;
      order_snapshot: Record<string, unknown> | null;
      final_amount_minor: string | null;
      terms_snapshot: Record<string, unknown> | null;
      refund_amount_minor: string | null;
      resolution_outcome: string | null;
    }

    const rawResult = await db.execute(sql`
      SELECT
        dc.id,
        dc.order_id,
        dc.reason_code,
        dc.status,
        dc.opened_by,
        dc.opened_at::text AS opened_at,
        dc.metadata,
        dc.resolution_summary,
        co.buyer_id,
        co.seller_id,
        co.amount_minor,
        co.order_snapshot,
        sa.final_amount_minor,
        sa.terms_snapshot,
        dr.refund_amount_minor,
        dr.outcome AS resolution_outcome
      FROM dispute_cases dc
      JOIN commerce_orders co ON co.id = dc.order_id
      LEFT JOIN settlement_approvals sa ON sa.id = co.settlement_approval_id
      LEFT JOIN dispute_resolutions dr ON dr.dispute_id = dc.id
      WHERE (co.buyer_id = ${userId} OR co.seller_id = ${userId})
      ${statusFilter}
      ${roleFilter}
      ORDER BY
        CASE dc.status
          WHEN 'WAITING_FOR_BUYER' THEN 1
          WHEN 'WAITING_FOR_SELLER' THEN 2
          WHEN 'OPEN' THEN 3
          WHEN 'UNDER_REVIEW' THEN 4
          WHEN 'RESOLVED_BUYER_FAVOR' THEN 5
          WHEN 'RESOLVED_SELLER_FAVOR' THEN 5
          WHEN 'PARTIAL_REFUND' THEN 5
          WHEN 'CLOSED' THEN 6
          ELSE 5
        END,
        dc.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    const dataRows = (rawResult as unknown as { rows?: DisputeListRow[] }).rows ?? [];

    const disputes = dataRows.map((row) => {
      const isBuyer = row.buyer_id === userId;
      const userRole = isBuyer ? "buyer" : "seller";

      // Determine needs_action based on status and role
      let needsAction = false;
      if (row.status === "WAITING_FOR_BUYER" && isBuyer) needsAction = true;
      if (row.status === "WAITING_FOR_SELLER" && !isBuyer) needsAction = true;
      if (row.status === "OPEN" && row.opened_by !== userRole) needsAction = true;

      // Extract item title from terms_snapshot or order_snapshot
      const terms = row.terms_snapshot as Record<string, unknown> | null;
      const orderSnap = row.order_snapshot as Record<string, unknown> | null;
      const orderTerms = orderSnap?.terms as Record<string, unknown> | undefined;
      const itemTitle =
        (terms?.item_name as string | undefined) ??
        (orderTerms?.item_name as string | undefined) ??
        (orderTerms?.listing_id as string | undefined) ??
        null;

      const amountMinor = row.final_amount_minor
        ? parseInt(row.final_amount_minor, 10)
        : row.amount_minor
          ? parseInt(row.amount_minor, 10)
          : null;

      const tier = row.metadata
        ? (((row.metadata as Record<string, unknown>).tier as number | null) ?? null)
        : null;

      return {
        id: row.id,
        order_id: row.order_id,
        reason_code: row.reason_code,
        status: row.status,
        tier,
        opened_by: row.opened_by,
        opened_at: row.opened_at,
        user_role: userRole as "buyer" | "seller",
        counterparty_name: null as string | null, // User names not available in current schema
        item_title: itemTitle,
        amount_minor: amountMinor,
        needs_action: needsAction,
        resolution_outcome: row.resolution_outcome ?? null,
        refund_amount_minor: row.refund_amount_minor ? parseInt(row.refund_amount_minor, 10) : null,
      };
    });

    return reply.send({ disputes, total, limit, offset });
  });

  // POST /disputes — open a new dispute
  app.post("/disputes", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = openDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_DISPUTE_REQUEST", issues: parsed.error.issues });
    }
    const initialFileEvidence = (parsed.data.evidence ?? []).some(
      (evidence) =>
        evidence.uri !== undefined || evidence.type === "image" || evidence.type === "video",
    );
    if (initialFileEvidence) {
      return reply.code(400).send({
        error: "FILE_EVIDENCE_UPLOAD_REQUIRED",
        message:
          "Initial file evidence must use the quarantined upload and commit flow after opening the dispute",
      });
    }

    // Verify requester is buyer or seller of the order — derive opened_by from role
    const order = await getCommerceOrderByOrderId(db, parsed.data.order_id);
    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    const userId = request.user!.id;
    let derivedOpenedBy: "buyer" | "seller" | "system";
    if (request.user?.role === "admin") {
      derivedOpenedBy = parsed.data.opened_by; // admin can specify
    } else if (userId === order.buyerId) {
      derivedOpenedBy = "buyer";
    } else if (userId === order.sellerId) {
      derivedOpenedBy = "seller";
    } else {
      return reply
        .code(403)
        .send({ error: "FORBIDDEN", message: "You are not a party to this order" });
    }
    const hasReservedInitialMarker = (parsed.data.evidence ?? []).some((evidence) =>
      containsVerifiedCameraEvidenceMarker(evidence.text),
    );
    if (request.user?.role !== "admin" && hasReservedInitialMarker) {
      return reply.code(400).send({
        error: "RESERVED_EVIDENCE_MARKER",
        message:
          "Verified camera evidence markers can only be created by the Haggle camera capture flow.",
      });
    }

    const reasonCode = parsed.data.reason_code as DisputeReasonCode;
    if (!(reasonCode in REASON_CODE_REGISTRY)) {
      return reply
        .code(400)
        .send({ error: "INVALID_REASON_CODE", reason_code: parsed.data.reason_code });
    }
    if (!isDisputableOrderStatus(order.status)) {
      const gate = describeDisputeOrderGate(order.status);
      return reply.code(409).send({
        error: "ORDER_NOT_DISPUTABLE",
        order_status: gate.order_status,
        blocking_gate: gate.blocking_gate,
        message: gate.message,
        hint: gate.hint,
        staging_fixture: gate.staging_fixture,
      });
    }
    const openingEligibility = await getOpeningEligibility(
      parsed.data.order_id,
      order.status,
      reasonCode,
      derivedOpenedBy,
    );
    if (!openingEligibility.eligible) {
      return reply.code(409).send({
        ...openingEligibility,
        reason_code: reasonCode,
        order_status: order.status,
      });
    }

    const evidence = (parsed.data.evidence ?? []).map((e) => ({
      submitted_by: request.user?.role === "admin" ? e.submitted_by : derivedOpenedBy,
      type: e.type,
      uri: e.uri,
      text: e.text,
    }));

    const result = disputeService.openCase({
      order_id: parsed.data.order_id,
      reason_code: reasonCode,
      opened_by: derivedOpenedBy,
      initial_evidence: evidence,
    });

    try {
      await writeDisputeOpen(result.dispute, parsed.data.order_id);
    } catch (error) {
      if (error instanceof Error && /dispute_cases_active_order_uidx|unique/i.test(error.message)) {
        return reply.code(409).send({
          error: "ACTIVE_DISPUTE_EXISTS",
          message: "This order already has an active dispute",
        });
      }
      throw error;
    }

    return reply.code(201).send(result);
  });

  // POST /disputes/deposits/expire — admin/cron: forfeit expired deposits
  // Registered BEFORE /:id routes to avoid route collision
  app.post("/disputes/deposits/expire", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const expired = await getPendingExpiredDeposits(db);
    let forfeited = 0;
    for (const deposit of expired) {
      await updateDepositStatus(db, deposit.id, "FORFEITED", { resolvedAt: new Date() });
      forfeited++;
    }
    return reply.send({ forfeited_count: forfeited });
  });

  // POST /disputes/:id/escalate — escalate T1→T2→T3 with auto deposit
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/escalate",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = escalateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_ESCALATE_REQUEST", issues: parsed.error.issues });
      }

      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      // Order already loaded by ownership middleware
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as
          | { id: string; buyerId: string; sellerId: string; amountMinor?: unknown }
          | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));
      const escalatedBy =
        request.user?.role === "admin"
          ? parsed.data.escalated_by
          : activePartyForOrder(request.user, order);
      if (!escalatedBy) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Cannot determine party role" });
      }
      if (request.user?.role !== "admin" && parsed.data.escalated_by !== escalatedBy) {
        return reply.code(403).send({
          error: "ESCALATION_PARTY_MISMATCH",
          message: "escalated_by must match the authenticated party",
        });
      }

      // Determine current tier from metadata or default to T1
      const currentTier = ((dispute.metadata as Record<string, unknown>)?.tier as number) ?? 1;
      if (currentTier >= 3) {
        return reply
          .code(400)
          .send({ error: "MAX_TIER_REACHED", message: "Cannot escalate beyond T3" });
      }

      const nextTier = (currentTier + 1) as DisputeTier;

      // Compute cost for next tier using dispute-core — use order amount as GMV basis
      const amountCents = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;

      if (amountCents <= 0) {
        return reply.code(400).send({
          error: "INVALID_DISPUTE_AMOUNT",
          message: "Order must have a positive amount for escalation",
        });
      }

      const cost = computeDisputeCost(amountCents, nextTier);

      // Update dispute metadata with new tier
      await updateDisputeRecord(db, {
        ...dispute,
        metadata: {
          ...(dispute.metadata as Record<string, unknown>),
          tier: nextTier,
          escalated_by: escalatedBy,
          escalated_reason: parsed.data.reason ?? null,
        },
      });

      // For T2/T3: create deposit requirement (seller-only deposit)
      let deposit = null;
      if (nextTier >= 2) {
        const depositReq = createDepositRequirement(id, nextTier as 2 | 3, amountCents);
        deposit = await createDeposit(db, {
          disputeId: id,
          tier: nextTier,
          amountCents: depositReq.amount_cents,
          deadlineHours: depositReq.deadline_hours,
          deadlineAt: new Date(Date.now() + depositReq.deadline_hours * 60 * 60 * 1000),
        });
      }

      // Auto-assign reviewers for T2/T3 escalation
      let reviewerAssignment = null;
      if (nextTier >= 2 && order) {
        try {
          reviewerAssignment = await assignReviewersToDispute(
            db,
            id,
            nextTier,
            amountCents,
            order.buyerId,
            order.sellerId,
          );
        } catch (assignErr) {
          console.error(
            "[disputes] Auto-assign reviewers failed:",
            assignErr instanceof Error ? assignErr.message : String(assignErr),
          );
        }
      }

      return reply.send({
        dispute_id: id,
        previous_tier: currentTier,
        new_tier: nextTier,
        cost,
        deposit,
        reviewer_assignment: reviewerAssignment,
      });
    },
  );

  // GET /disputes/:id
  app.get(
    "/disputes/:id",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, (request.params as { id: string }).id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      return reply.send({ dispute });
    },
  );

  // GET /disputes/by-order/:orderId
  app.get("/disputes/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const dispute = await getDisputeByOrderId(db, (request.params as { orderId: string }).orderId);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    // Ownership check: requireDisputeParty reads :id param which this route lacks.
    // Inline check instead — admin always passes.
    if (request.user?.role !== "admin") {
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }
      const userId = request.user!.id;
      if (userId !== order.buyerId && userId !== order.sellerId) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }

    return reply.send({ dispute });
  });

  // POST /disputes/:id/review — start review
  app.post("/disputes/:id/review", { preHandler: [requireAdmin] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.startReview(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REVIEW_START_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-buyer-evidence
  app.post(
    "/disputes/:id/request-buyer-evidence",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, (request.params as { id: string }).id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      try {
        const result = disputeService.requestBuyerEvidence(dispute);
        await updateDisputeRecord(db, result.dispute);
        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: "REQUEST_EVIDENCE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /disputes/:id/request-seller-evidence
  app.post(
    "/disputes/:id/request-seller-evidence",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, (request.params as { id: string }).id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      try {
        const result = disputeService.requestSellerEvidence(dispute);
        await updateDisputeRecord(db, result.dispute);
        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: "REQUEST_EVIDENCE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /disputes/:id/evidence — add evidence
  app.post(
    "/disputes/:id/evidence",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, (request.params as { id: string }).id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      const parsed = addEvidenceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_EVIDENCE", issues: parsed.error.issues });
      }
      if (
        parsed.data.uri !== undefined ||
        parsed.data.type === "image" ||
        parsed.data.type === "video"
      ) {
        return reply.code(400).send({
          error: "FILE_EVIDENCE_UPLOAD_REQUIRED",
          message: "Image and video evidence must use the quarantined upload and commit flow",
        });
      }
      if (
        request.user?.role !== "admin" &&
        containsVerifiedCameraEvidenceMarker(parsed.data.text)
      ) {
        return reply.code(400).send({
          error: "RESERVED_EVIDENCE_MARKER",
          message:
            "Verified camera evidence markers can only be created by the Haggle camera capture flow.",
        });
      }

      try {
        const order =
          ((request as unknown as Record<string, unknown>).orderResource as
            | {
                id: string;
                buyerId: string;
                sellerId: string;
              }
            | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

        if (!order) {
          return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
        }

        let submittedBy: "buyer" | "seller" | "system";
        if (request.user?.role === "admin") {
          submittedBy = parsed.data.submitted_by;
        } else if (request.user!.id === order.buyerId) {
          submittedBy = "buyer";
        } else if (request.user!.id === order.sellerId) {
          submittedBy = "seller";
        } else {
          return reply
            .code(403)
            .send({ error: "FORBIDDEN", message: "You are not a party to this order" });
        }

        const result = disputeService.addEvidence(dispute, {
          ...parsed.data,
          submitted_by: submittedBy,
        });
        const persistedDispute = withStaleAiAssessment(result.dispute, "EVIDENCE_ADDED");
        const persist = async (tx: unknown) => {
          const txDb = tx as Database;
          await updateDisputeRecord(txDb, persistedDispute);
          if (result.value) {
            await addDisputeEvidenceRecord(txDb, result.value);
          }
        };
        if (typeof db.transaction === "function") {
          await db.transaction(persist);
        } else {
          await persist(db);
        }

        // Validate evidence completeness
        const validation = validateEvidenceForReasonCode(
          dispute.reason_code as DisputeReasonCode,
          result.dispute.evidence,
        );

        return reply.send({
          ...result,
          dispute: persistedDispute,
          ai_assessment_state: aiAssessmentState(persistedDispute),
          evidence_validation: validation,
        });
      } catch (error) {
        return reply.code(400).send({
          error: "ADD_EVIDENCE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /disputes/:id/resolve — resolve the dispute
  app.post(
    "/disputes/:id/appeal",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const disputeId = (request.params as { id: string }).id;
      if (disputeAppealInFlight.has(disputeId)) {
        return reply.code(409).send({
          error: "APPEAL_SUBMISSION_IN_PROGRESS",
          message: "An appeal submission is already in progress for this dispute",
        });
      }
      if (
        !(await acquireOperationLeaseGuard({
          request,
          reply,
          disputeId,
          operation: "appeal_submission",
          conflictError: "APPEAL_SUBMISSION_IN_PROGRESS",
          conflictMessage: "Another API instance is already submitting an appeal for this dispute",
          processLock: disputeAppealInFlight,
        }))
      )
        return;

      const dispute = await getDisputeById(db, disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      const parsed = disputeAppealSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_APPEAL", issues: parsed.error.issues });
      }

      const existingAppeal = appealReviewFor(dispute);
      if (existingAppeal?.client_request_id === parsed.data.client_request_id) {
        return reply.send({ dispute_id: dispute.id, appeal: existingAppeal, idempotent: true });
      }
      if (existingAppeal) {
        return reply.code(409).send({
          error: "APPEAL_ALREADY_USED",
          message:
            "The MVP permits one appeal per dispute; the existing appeal record is retained for audit",
          appeal: existingAppeal,
        });
      }
      if (dispute.status !== "UNDER_REVIEW") {
        return reply.code(409).send({
          error: "DISPUTE_NOT_APPEALABLE",
          message: "An appeal can be filed only while the dispute is under review",
        });
      }

      const metadata = disputeMetadata(dispute);
      const assessment = metadata.ai_resolution_assessor;
      if (
        !assessment ||
        typeof assessment !== "object" ||
        Array.isArray(assessment) ||
        (assessment as Record<string, unknown>).status !== "COMPLETED"
      ) {
        return reply.code(409).send({
          error: "AI_ASSESSMENT_REQUIRED",
          message: "An appeal requires a completed AI recommendation to challenge",
        });
      }

      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      const party = activePartyForOrder(request.user, order);
      if (party !== "buyer" && party !== "seller") {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "Only the buyer or seller may appeal" });
      }
      const disputeEvidenceIds = new Set(dispute.evidence.map((evidence) => evidence.id));
      const unknownEvidenceIds = parsed.data.evidence_ids.filter(
        (evidenceId) => !disputeEvidenceIds.has(evidenceId),
      );
      if (unknownEvidenceIds.length > 0) {
        return reply.code(400).send({
          error: "INVALID_APPEAL_EVIDENCE",
          message: "Every cited evidence id must belong to this dispute",
          unknown_evidence_ids: unknownEvidenceIds,
        });
      }

      const now = new Date().toISOString();
      const appeal: DisputeAppealReview = {
        id: createUuid(),
        status: "OPEN",
        appealed_by: party,
        appealed_by_user_id: request.user!.id,
        reason: parsed.data.reason,
        evidence_ids: parsed.data.evidence_ids,
        client_request_id: parsed.data.client_request_id,
        created_at: now,
        priority: "normal",
        sla_due_at: hoursFromNowIso(APPEAL_DEFAULT_SLA_HOURS),
      };
      await updateDisputeRecord(db, {
        ...dispute,
        metadata: {
          ...metadata,
          appeal_review: appeal,
          appeal_history: [
            ...appealHistoryFor(dispute),
            {
              event: "APPEAL_SUBMITTED",
              at: now,
              actor_id: request.user!.id,
              party,
              appeal_id: appeal.id,
              client_request_id: appeal.client_request_id,
              reason: appeal.reason,
              evidence_ids: appeal.evidence_ids,
            },
          ],
        },
      });

      return reply.code(201).send({ dispute_id: dispute.id, appeal, idempotent: false });
    },
  );

  app.patch(
    "/disputes/:id/appeal/review",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const disputeId = (request.params as { id: string }).id;
      if (
        !(await acquireOperationLeaseGuard({
          request,
          reply,
          disputeId,
          operation: "appeal_review",
          conflictError: "APPEAL_REVIEW_IN_PROGRESS",
          conflictMessage: "Another API instance is already reviewing this dispute appeal",
        }))
      )
        return;
      const dispute = await getDisputeById(db, disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      const parsed = disputeAppealReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_APPEAL_REVIEW", issues: parsed.error.issues });
      }

      const appeal = appealReviewFor(dispute);
      if (!appeal) {
        return reply.code(404).send({ error: "APPEAL_NOT_FOUND" });
      }
      if (appeal.status !== "OPEN") {
        return reply.code(409).send({
          error: "APPEAL_ALREADY_REVIEWED",
          message: "Only an open appeal can receive an operator decision",
          appeal,
        });
      }

      const now = new Date().toISOString();
      const nextStatus: AppealStatus =
        parsed.data.decision === "dismiss" ? "DISMISSED" : "REOPENED";
      const reviewedAppeal: DisputeAppealReview = {
        ...appeal,
        status: nextStatus,
        reviewed_by: request.user!.id,
        reviewed_at: now,
        review_notes: parsed.data.notes,
        ...(nextStatus === "REOPENED"
          ? {
              assigned_to: appeal.assigned_to ?? request.user!.id,
              assigned_by: appeal.assigned_by ?? request.user!.id,
              assigned_at: appeal.assigned_at ?? now,
              priority: appeal.priority === "urgent" ? "urgent" : "high",
              sla_due_at: hoursFromNowIso(APPEAL_REOPENED_SLA_HOURS),
            }
          : {}),
      };
      const metadata = disputeMetadata(dispute);
      const persistReview = async (tx: unknown) => {
        const txDb = tx as Database;
        await updateDisputeRecord(txDb, {
          ...dispute,
          metadata: {
            ...metadata,
            appeal_review: reviewedAppeal,
            ai_assessment_stale: nextStatus === "REOPENED",
            appeal_history: [
              ...appealHistoryFor(dispute),
              {
                event: nextStatus === "DISMISSED" ? "APPEAL_DISMISSED" : "APPEAL_REOPENED",
                at: now,
                actor_id: request.user!.id,
                appeal_id: appeal.id,
                notes: parsed.data.notes,
              },
            ],
          },
        });
        await writeAuditLog(txDb, {
          actorId: request.user!.id,
          actionType: "dispute.appeal_review",
          targetType: "dispute",
          targetId: dispute.id,
          payload: {
            appeal_id: appeal.id,
            decision: parsed.data.decision,
            notes: parsed.data.notes,
          },
        });
      };
      if (typeof db.transaction === "function") {
        await db.transaction(persistReview);
      } else {
        await persistReview(db);
      }

      return reply.send({
        dispute_id: dispute.id,
        appeal: reviewedAppeal,
        requires_new_ai_assessment: nextStatus === "REOPENED",
      });
    },
  );

  app.get("/admin/disputes/appeals", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = disputeAppealQueueQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_APPEAL_QUEUE_QUERY", issues: parsed.error.issues });
    }

    interface AppealQueueRow {
      id: string;
      order_id: string;
      status: string;
      reason_code: string;
      opened_at: string;
      amount_minor: string | null;
      metadata: Record<string, unknown> | null;
    }

    const rawResult = await db.execute(sql`
      SELECT
        dc.id,
        dc.order_id,
        dc.status,
        dc.reason_code,
        dc.opened_at::text AS opened_at,
        co.amount_minor,
        dc.metadata
      FROM dispute_cases dc
      JOIN commerce_orders co ON co.id = dc.order_id
      WHERE dc.metadata->'appeal_review' IS NOT NULL
      ORDER BY dc.updated_at ASC
      LIMIT 200
    `);
    const rows = (rawResult as unknown as { rows?: AppealQueueRow[] }).rows ?? [];
    const nowMs = Date.now();
    const allItems = rows.flatMap((row) => {
      const appealValue = row.metadata?.appeal_review;
      if (!appealValue || typeof appealValue !== "object" || Array.isArray(appealValue)) return [];
      const appeal = appealValue as DisputeAppealReview;
      const slaState = deriveAppealSlaState(appeal, nowMs);
      return [
        {
          dispute_id: row.id,
          order_id: row.order_id,
          dispute_status: row.status,
          reason_code: row.reason_code,
          opened_at: row.opened_at,
          amount_minor: row.amount_minor ? parseInt(row.amount_minor, 10) : null,
          appeal,
          assignment: {
            operator_user_id: appeal.assigned_to ?? null,
            assigned_at: appeal.assigned_at ?? null,
            priority: appeal.priority ?? "normal",
          },
          sla: {
            state: slaState,
            due_at: appeal.sla_due_at ?? null,
            remaining_seconds: appeal.sla_due_at
              ? Math.floor((Date.parse(appeal.sla_due_at) - nowMs) / 1000)
              : null,
          },
        },
      ];
    });

    const statusMatches = (item: (typeof allItems)[number]) => {
      if (parsed.data.status === "all") return true;
      const active = item.appeal.status === "OPEN" || item.appeal.status === "REOPENED";
      if (parsed.data.status === "open") return active;
      if (parsed.data.status === "assigned")
        return active && Boolean(item.assignment.operator_user_id);
      return !active;
    };
    const slaMatches = (item: (typeof allItems)[number]) =>
      parsed.data.sla === "all" || item.sla.state.toLowerCase() === parsed.data.sla;
    const priorityRank = { urgent: 0, high: 1, normal: 2 };
    const items = allItems
      .filter((item) => statusMatches(item) && slaMatches(item))
      .sort((left, right) => {
        const leftOverdue = left.sla.state === "OVERDUE" ? 0 : 1;
        const rightOverdue = right.sla.state === "OVERDUE" ? 0 : 1;
        if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
        const priorityDifference =
          priorityRank[left.assignment.priority] - priorityRank[right.assignment.priority];
        if (priorityDifference !== 0) return priorityDifference;
        return (left.sla.due_at ?? "").localeCompare(right.sla.due_at ?? "");
      })
      .slice(0, parsed.data.limit);

    return reply.send({
      generated_at: new Date(nowMs).toISOString(),
      items,
      summary: {
        total: allItems.length,
        open: allItems.filter(
          (item) => item.appeal.status === "OPEN" || item.appeal.status === "REOPENED",
        ).length,
        unassigned: allItems.filter((item) => item.sla.state === "UNASSIGNED").length,
        due_soon: allItems.filter((item) => item.sla.state === "DUE_SOON").length,
        overdue: allItems.filter((item) => item.sla.state === "OVERDUE").length,
      },
    });
  });

  app.patch(
    "/disputes/:id/appeal/assignment",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const disputeId = (request.params as { id: string }).id;
      if (disputeAppealAssignmentInFlight.has(disputeId)) {
        return reply.code(409).send({
          error: "APPEAL_ASSIGNMENT_IN_PROGRESS",
          message: "Another operator assignment is already in progress for this dispute",
        });
      }
      if (
        !(await acquireOperationLeaseGuard({
          request,
          reply,
          disputeId,
          operation: "appeal_assignment",
          conflictError: "APPEAL_ASSIGNMENT_IN_PROGRESS",
          conflictMessage: "Another API instance is already assigning this dispute appeal",
          processLock: disputeAppealAssignmentInFlight,
        }))
      )
        return;

      const dispute = await getDisputeById(db, disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      const parsed = disputeAppealAssignmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_APPEAL_ASSIGNMENT", issues: parsed.error.issues });
      }
      const appeal = appealReviewFor(dispute);
      if (!appeal) {
        return reply.code(404).send({ error: "APPEAL_NOT_FOUND" });
      }
      if (appeal.id !== parsed.data.expected_appeal_id) {
        return reply.code(409).send({
          error: "STALE_APPEAL_ASSIGNMENT",
          message: "The appeal changed after the queue item was loaded",
          current_appeal_id: appeal.id,
        });
      }
      if (appeal.status !== "OPEN" && appeal.status !== "REOPENED") {
        return reply.code(409).send({
          error: "APPEAL_NOT_ASSIGNABLE",
          message: "Only an active appeal can be assigned",
          appeal,
        });
      }

      const operatorUserId = request.user!.id;
      if (
        appeal.assigned_to === operatorUserId &&
        appeal.priority === parsed.data.priority &&
        parsed.data.sla_hours === undefined
      ) {
        return reply.send({
          dispute_id: dispute.id,
          appeal,
          sla_state: deriveAppealSlaState(appeal),
          idempotent: true,
        });
      }

      const slaHours =
        parsed.data.sla_hours ??
        (parsed.data.priority === "urgent"
          ? 4
          : parsed.data.priority === "high"
            ? 8
            : APPEAL_DEFAULT_SLA_HOURS);
      const now = new Date().toISOString();
      const assignedAppeal: DisputeAppealReview = {
        ...appeal,
        assigned_to: operatorUserId,
        assigned_by: request.user!.id,
        assigned_at: now,
        priority: parsed.data.priority,
        sla_due_at: hoursFromNowIso(slaHours),
      };
      const metadata = disputeMetadata(dispute);
      const persistAssignment = async (tx: unknown) => {
        const txDb = tx as Database;
        await updateDisputeRecord(txDb, {
          ...dispute,
          metadata: {
            ...metadata,
            appeal_review: assignedAppeal,
            appeal_history: [
              ...appealHistoryFor(dispute),
              {
                event: "APPEAL_ASSIGNED",
                at: now,
                actor_id: request.user!.id,
                operator_user_id: operatorUserId,
                appeal_id: appeal.id,
                priority: parsed.data.priority,
                sla_due_at: assignedAppeal.sla_due_at,
              },
            ],
          },
        });
        await writeAuditLog(txDb, {
          actorId: request.user!.id,
          actionType: "dispute.appeal_assign",
          targetType: "dispute",
          targetId: dispute.id,
          payload: {
            appeal_id: appeal.id,
            operator_user_id: operatorUserId,
            priority: parsed.data.priority,
            sla_due_at: assignedAppeal.sla_due_at,
          },
        });
      };
      if (typeof db.transaction === "function") {
        await db.transaction(persistAssignment);
      } else {
        await persistAssignment(db);
      }

      return reply.send({
        dispute_id: dispute.id,
        appeal: assignedAppeal,
        sla_state: deriveAppealSlaState(assignedAppeal),
        idempotent: false,
      });
    },
  );

  app.post("/disputes/:id/resolve", { preHandler: [requireAdmin] }, async (request, reply) => {
    const disputeId = (request.params as { id: string }).id;
    if (
      !(await acquireOperationLeaseGuard({
        request,
        reply,
        disputeId,
        operation: "dispute_resolution",
        conflictError: "DISPUTE_RESOLUTION_IN_PROGRESS",
        conflictMessage: "Another API instance is already resolving this dispute",
      }))
    )
      return;
    const dispute = await getDisputeById(db, disputeId);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = resolveDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RESOLUTION", issues: parsed.error.issues });
    }

    if (appealBlocksResolution(dispute)) {
      return reply.code(409).send({
        error: "APPEAL_REVIEW_REQUIRED",
        message:
          "Resolve is blocked until the open appeal is dismissed or a reopened case is reassessed",
        appeal: appealReviewFor(dispute),
      });
    }

    try {
      const result = disputeService.resolve(dispute, parsed.data);
      if (!result.value) {
        return reply
          .code(400)
          .send({ error: "RESOLUTION_FAILED", message: "Resolution result missing" });
      }

      const finalization = await finalizeDisputeResolution(
        db,
        dispute,
        result.value,
        result.dispute,
      );

      // Resolve buyer/seller from the commerce order
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);

      if (result.trust_triggers.length > 0) {
        await applyTrustTriggers(db, {
          order_id: dispute.order_id,
          buyer_id: order?.buyerId ?? "",
          seller_id: order?.sellerId ?? "",
          triggers: result.trust_triggers,
        });
      }

      return reply.send({
        ...result,
        dispute: finalization.dispute,
        auto_refund: finalization.auto_refund,
        deposit_refund: finalization.deposit_refund,
      });
    } catch (error) {
      return reply.code(400).send({
        error: "RESOLUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/close — close the dispute
  app.post(
    "/disputes/:id/close",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, (request.params as { id: string }).id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (
        (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") &&
        request.user?.role !== "admin"
      ) {
        const order = await getCommerceOrderByOrderId(db, dispute.order_id);
        const openerUserId = dispute.opened_by === "buyer" ? order?.buyerId : order?.sellerId;
        if (!openerUserId || request.user?.id !== openerUserId) {
          return reply.code(403).send({
            error: "FORBIDDEN",
            message: "Only the party who opened the dispute can close it in production",
          });
        }
      }

      try {
        const result = disputeService.closeCase(dispute);
        await updateDisputeRecord(db, result.dispute);
        return reply.send(result);
      } catch (error) {
        return reply.code(400).send({
          error: "CLOSE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /disputes/:id/deposit — initiate deposit payment collection
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/deposit",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = depositSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_DEPOSIT_REQUEST", issues: parsed.error.issues });
      }

      // 1. Validate deposit exists and is PENDING
      const deposit = await getDepositByDisputeId(db, id);
      if (!deposit) {
        return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
      }

      if (deposit.status !== "PENDING") {
        return reply.code(400).send({
          error: "DEPOSIT_ALREADY_PROCESSED",
          message: `Deposit status is ${deposit.status}`,
        });
      }

      // 2. Validate caller is the seller (deposits are seller-only)
      const order = (request as unknown as Record<string, unknown>).orderResource as
        | { id: string; buyerId: string; sellerId: string; amountMinor?: unknown }
        | undefined;
      const userId = request.user!.id;
      if (order && userId !== order.sellerId) {
        return reply
          .code(403)
          .send({ error: "SELLER_ONLY", message: "Only the seller can post a deposit" });
      }

      // 3. Validate wallet address if provided (for USDC rail)
      if (parsed.data.wallet_address && !isAddress(parsed.data.wallet_address)) {
        return reply.code(400).send({
          error: "INVALID_WALLET_ADDRESS",
          message: "wallet_address must be a valid Ethereum address",
        });
      }

      // 4. Amount is ALWAYS server-computed — never trust client
      const amountCents = deposit.amountCents;

      // 5. Initiate deposit collection
      try {
        const result = await initiateDepositCollection({
          deposit_id: deposit.id,
          dispute_id: id,
          amount_cents: amountCents,
          seller_wallet_address: parsed.data.wallet_address,
          seller_user_id: userId,
          rail: parsed.data.rail,
        });

        const rail = result.rail;

        if (rail === "mock") {
          // Mock: immediately mark as DEPOSITED
          const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
            depositedAt: new Date(),
            metadata: {
              ...(deposit.metadata ?? {}),
              rail,
              mock_tx_id: result.mock_tx_id,
            },
          });
          return reply.send({ deposit: updated, collection: result });
        }

        if (rail === "usdc") {
          // USDC: update metadata with approval instructions, status stays PENDING
          await updateDepositMetadata(db, deposit.id, {
            ...(deposit.metadata ?? {}),
            rail,
            wallet_address: parsed.data.wallet_address,
            usdc_approval: result.usdc_approval,
          });
          return reply.send({
            deposit: { ...deposit, metadata: { ...(deposit.metadata ?? {}), rail } },
            collection: result,
          });
        }

        if (rail === "stripe") {
          // Stripe: update metadata with session info, status stays PENDING
          await updateDepositMetadata(db, deposit.id, {
            ...(deposit.metadata ?? {}),
            rail,
            stripe_payment_intent_id: result.stripe_payment_intent_id,
          });
          return reply.send({
            deposit: { ...deposit, metadata: { ...(deposit.metadata ?? {}), rail } },
            collection: result,
          });
        }

        // Should not reach here
        return reply.send({ deposit, collection: result });
      } catch (error) {
        return reply.code(500).send({
          error: "DEPOSIT_COLLECTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /disputes/:id/deposit/confirm-usdc — confirm USDC deposit after seller approved spend
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/deposit/confirm-usdc",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = confirmUsdcSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONFIRM_REQUEST", issues: parsed.error.issues });
      }

      // 1. Validate wallet address
      if (!isAddress(parsed.data.wallet_address)) {
        return reply.code(400).send({
          error: "INVALID_WALLET_ADDRESS",
          message: "wallet_address must be a valid Ethereum address",
        });
      }

      // 2. Validate deposit exists and is PENDING
      const deposit = await getDepositByDisputeId(db, id);
      if (!deposit) {
        return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
      }

      if (deposit.status !== "PENDING") {
        return reply.code(400).send({
          error: "DEPOSIT_ALREADY_PROCESSED",
          message: `Deposit status is ${deposit.status}`,
        });
      }

      // 3. Validate the deposit was initiated with USDC rail
      const depositMeta = deposit.metadata as Record<string, unknown> | null;
      if (depositMeta?.rail !== "usdc") {
        return reply
          .code(400)
          .send({ error: "WRONG_RAIL", message: "This deposit was not initiated with USDC rail" });
      }

      // 4. Validate caller is the seller
      const order = (request as unknown as Record<string, unknown>).orderResource as
        | { id: string; buyerId: string; sellerId: string; amountMinor?: unknown }
        | undefined;
      const userId = request.user!.id;
      if (order && userId !== order.sellerId) {
        return reply
          .code(403)
          .send({ error: "SELLER_ONLY", message: "Only the seller can confirm a deposit" });
      }

      // 5. Amount is server-computed — use the stored deposit amount
      const amountCents = deposit.amountCents;

      try {
        // 6. Execute transferFrom via gas relayer (verifies allowance on-chain)
        const { tx_hash } = await confirmUsdcDeposit({
          deposit_id: deposit.id,
          seller_wallet_address: parsed.data.wallet_address,
          amount_cents: amountCents,
        });

        // 7. Mark deposit as DEPOSITED
        const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
          depositedAt: new Date(),
          metadata: {
            ...(depositMeta ?? {}),
            tx_hash,
            confirmed_at: new Date().toISOString(),
          },
        });

        return reply.send({ deposit: updated, tx_hash });
      } catch (error) {
        return reply.code(500).send({
          error: "USDC_DEPOSIT_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // GET /disputes/:id/deposit — get deposit for a dispute
  app.get<{ Params: { id: string } }>(
    "/disputes/:id/deposit",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;
      const deposit = await getDepositByDisputeId(db, id);
      if (!deposit) {
        return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
      }
      return reply.send({ deposit });
    },
  );

  // ---------------------------------------------------------------------------
  // Evidence file upload endpoints
  // ---------------------------------------------------------------------------

  /** States in which evidence submission is still accepted. */
  const EVIDENCE_ACCEPTING_STATES = new Set([
    "OPEN",
    "UNDER_REVIEW",
    "WAITING_FOR_BUYER",
    "WAITING_FOR_SELLER",
  ]);

  /**
   * Count existing evidence records for a dispute, grouped by media category.
   */
  async function countEvidenceByType(
    disputeId: string,
  ): Promise<{ imageCount: number; videoCount: number }> {
    const rows = await db.query.disputeEvidence.findMany({
      where: (fields, ops) => ops.eq(fields.disputeId, disputeId),
    });

    let imageCount = 0;
    let videoCount = 0;
    for (const row of rows) {
      if (row.type === "image") imageCount++;
      if (row.type === "video") videoCount++;
    }
    return { imageCount, videoCount };
  }

  async function countPendingUploadsByType(
    disputeId: string,
  ): Promise<{ imageCount: number; videoCount: number }> {
    const rows = await db.query.disputeEvidenceUploads.findMany({
      where: (fields, ops) =>
        ops.and(ops.eq(fields.disputeId, disputeId), ops.eq(fields.status, "PENDING")),
    });

    let imageCount = 0;
    let videoCount = 0;
    for (const row of rows) {
      if (isExpired(row.expiresAt)) continue;
      if (row.evidenceType === "image") imageCount++;
      if (row.evidenceType === "video") videoCount++;
    }
    return { imageCount, videoCount };
  }

  /**
   * Compute remaining upload limits for a dispute given its current evidence
   * and the associated order amount.
   */
  function computeRemainingLimits(
    imageCount: number,
    videoCount: number,
    orderAmountCents: number,
  ) {
    const isHighValue = orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
    const videoLimits = isHighValue
      ? EVIDENCE_LIMITS.video_high_value
      : EVIDENCE_LIMITS.video_standard;

    return {
      remaining_images: Math.max(0, EVIDENCE_LIMITS.image.maxCount - imageCount),
      remaining_videos: Math.max(0, videoLimits.maxCount - videoCount),
      max_video_size_bytes: videoLimits.maxSizeBytes,
      max_video_duration_sec: videoLimits.maxDurationSec,
    };
  }

  // GET /disputes/:id/camera-capture — Minimal mobile camera capture page for QR handoff
  app.get<{ Params: { id: string }; Querystring: { session_id?: string } }>(
    "/disputes/:id/camera-capture",
    async (request, reply) => {
      const { id } = request.params;
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      const session = getCameraSession(dispute, request.query.session_id);
      if (!session) {
        return reply.code(404).send({ error: "CAMERA_SESSION_NOT_FOUND" });
      }
      if (session.status === "COMMITTED") {
        return reply.code(409).send({ error: "CAMERA_SESSION_ALREADY_COMMITTED" });
      }
      if (sessionIsExpired(session)) {
        return reply.code(400).send({ error: "CAMERA_SESSION_EXPIRED" });
      }

      return reply
        .header("Cache-Control", "no-store")
        .header(
          "Content-Security-Policy",
          "default-src 'self'; connect-src 'self' https:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        )
        .header("Referrer-Policy", "no-referrer")
        .header("X-Frame-Options", "DENY")
        .header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        .type("text/html; charset=utf-8")
        .send(cameraCapturePage({ disputeId: id, session }));
    },
  );

  // POST /disputes/:id/evidence/camera-session — Start a camera-only evidence capture window
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/camera-session",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = cameraCaptureSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_CAMERA_SESSION_REQUEST",
          issues: parsed.error.issues,
        });
      }
      if (parsed.data.test_only && process.env.NODE_ENV === "production") {
        return reply.code(403).send({
          error: "TEST_CAMERA_SESSION_DISABLED",
          message: "test_only camera sessions are disabled in production",
        });
      }

      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }

      const order =
        ((request as unknown as Record<string, unknown>).orderResource as
          | {
              id: string;
              buyerId: string;
              sellerId: string;
              amountMinor?: unknown;
            }
          | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));
      const party = activePartyForOrder(request.user, order);
      if (!party) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Cannot determine party role",
        });
      }

      const now = new Date();
      const sessionId = createUuid();
      const captureToken = createCameraCaptureToken();
      const capturePath = `/disputes/${id}/camera-capture?session_id=${encodeURIComponent(sessionId)}`;
      const origin = originForRequest(request);
      const captureUrl = origin ? `${origin}${capturePath}` : capturePath;
      const session: CameraCaptureSession = {
        id: sessionId,
        dispute_id: id,
        party,
        user_id: request.user!.id,
        device_mode: parsed.data.device_mode,
        test_only: parsed.data.test_only,
        challenge_code: createChallengeCode(),
        status: "PENDING",
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + parsed.data.expires_in_seconds * 1000).toISOString(),
        capture_url: captureUrl,
        qr_payload: captureUrl,
        capture_token_hash: cameraCaptureTokenHash(captureToken),
      };

      await saveCameraSession(dispute, session);

      return reply.code(201).send({
        camera_session: cameraSessionResponse(session, captureToken),
        policy: {
          accepted_evidence_source: "haggle_camera_only",
          video_allowed: false,
          challenge_required: true,
          scoped_capture_token: true,
          capture_token_rotates_before_commit: true,
          used_for_dispute: !parsed.data.test_only,
          expires_in_seconds: parsed.data.expires_in_seconds,
        },
      });
    },
  );

  // POST /disputes/:id/evidence/upload-url — Get a presigned upload URL
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/upload-url",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = uploadUrlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_UPLOAD_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const {
        filename,
        content_type,
        file_size_bytes,
        camera_session_id,
        camera_capture_token,
        capture_sha256,
        fixture_party,
      } = parsed.data;

      // 1. Validate dispute exists and is in an evidence-accepting state
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }

      // 2. Validate content_type
      if (!(ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(content_type)) {
        return reply.code(400).send({
          error: "UNSUPPORTED_CONTENT_TYPE",
          message: `Allowed: ${ALLOWED_EVIDENCE_TYPES.join(", ")}`,
        });
      }

      // 3. Determine media category
      const isImage = isImageType(content_type);
      const isVideo = isVideoType(content_type);
      const evidenceType = evidenceTypeFromContentType(content_type);

      let cameraSession = getCameraSession(dispute, camera_session_id);
      let cameraCommitToken: string | undefined;
      if (camera_session_id && fixture_party) {
        return reply.code(400).send({
          error: "FIXTURE_CAMERA_SESSION_CONFLICT",
          message: "Prepared fixture evidence cannot be submitted as camera evidence",
        });
      }
      if (camera_session_id) {
        if (!cameraSession) {
          return reply.code(404).send({ error: "CAMERA_SESSION_NOT_FOUND" });
        }
        if (!isImage || isVideo) {
          return reply.code(400).send({
            error: "CAMERA_SESSION_IMAGE_ONLY",
            message: "Camera evidence MVP accepts still images only",
          });
        }
        if (cameraSession.status === "COMMITTED") {
          return reply.code(409).send({ error: "CAMERA_SESSION_ALREADY_COMMITTED" });
        }
        if (sessionIsExpired(cameraSession)) {
          return reply.code(400).send({ error: "CAMERA_SESSION_EXPIRED" });
        }
        if (!validCameraCaptureToken(cameraSession, camera_capture_token)) {
          return reply.code(403).send({
            error: "INVALID_CAMERA_CAPTURE_TOKEN",
            message: "The camera capture token is missing, invalid, or no longer usable",
          });
        }
        if (!cameraSession.test_only && !capture_sha256) {
          return reply.code(400).send({
            error: "CAMERA_CAPTURE_HASH_REQUIRED",
            message: "Real camera evidence must bind the captured bytes before upload",
          });
        }
      } else if (capture_sha256) {
        return reply.code(400).send({
          error: "CAMERA_SESSION_REQUIRED_FOR_CAPTURE_HASH",
          message: "A capture hash is only accepted for an active camera session",
        });
      }

      // 4. Get order amount for video tier determination
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as
          | {
              id: string;
              buyerId: string;
              sellerId: string;
              amountMinor?: unknown;
            }
          | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));
      const fixtureParty = resolveStagingDisputeFixtureParty(request.user?.role, fixture_party);
      if (fixture_party && !fixtureParty) {
        return reply.code(403).send({
          error: "FIXTURE_EVIDENCE_FORBIDDEN",
          message: "Party fixture uploads are limited to enabled staging admin tests",
        });
      }
      const uploadedBy = fixtureParty ?? activePartyForOrder(request.user, order);
      if (!uploadedBy) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Cannot determine party role",
        });
      }
      if (
        cameraSession &&
        (cameraSession.party !== uploadedBy || cameraSession.user_id !== request.user!.id)
      ) {
        return reply.code(403).send({
          error: "CAMERA_SESSION_PARTY_MISMATCH",
          message: "Only the party that opened the camera session can use it",
        });
      }

      const orderAmountCents = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;

      // 5. Count existing evidence and check limits
      const { imageCount, videoCount } = await countEvidenceByType(id);
      const pendingCounts = await countPendingUploadsByType(id);
      const limits = computeRemainingLimits(
        imageCount + pendingCounts.imageCount,
        videoCount + pendingCounts.videoCount,
        orderAmountCents,
      );

      if (isImage) {
        if (limits.remaining_images <= 0) {
          return reply.code(400).send({
            error: "IMAGE_LIMIT_REACHED",
            message: `Maximum ${EVIDENCE_LIMITS.image.maxCount} images allowed`,
          });
        }
        if (file_size_bytes > EVIDENCE_LIMITS.image.maxSizeBytes) {
          return reply.code(400).send({
            error: "FILE_TOO_LARGE",
            message: `Image max size: ${EVIDENCE_LIMITS.image.maxSizeBytes} bytes`,
          });
        }
      }

      if (isVideo) {
        if (limits.remaining_videos <= 0) {
          const isHighValue = orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
          const maxCount = isHighValue
            ? EVIDENCE_LIMITS.video_high_value.maxCount
            : EVIDENCE_LIMITS.video_standard.maxCount;
          return reply.code(400).send({
            error: "VIDEO_LIMIT_REACHED",
            message: `Maximum ${maxCount} video(s) allowed for this transaction`,
          });
        }
        if (file_size_bytes > limits.max_video_size_bytes) {
          return reply.code(400).send({
            error: "FILE_TOO_LARGE",
            message: `Video max size: ${limits.max_video_size_bytes} bytes`,
          });
        }
      }

      // 6. Generate presigned upload URL
      const uploadId = createUuid();

      const objectPath = buildDisputeEvidencePath(id, `${uploadId}_${filename}`);
      const result = await createDisputeUploadUrl(objectPath);
      await createDisputeEvidenceUploadRecord(db, {
        id: uploadId,
        disputeId: id,
        uploadedBy,
        evidenceType,
        contentType: content_type,
        fileSizeBytes: file_size_bytes,
        storagePath: result.storagePath,
        expiresAt: new Date(Date.now() + result.expiresIn * 1000),
        cameraSessionId: cameraSession?.id,
        captureDeclaredSha256: capture_sha256,
      });
      if (cameraSession) {
        cameraCommitToken = createCameraCaptureToken();
        cameraSession = {
          ...cameraSession,
          status: "UPLOAD_URL_ISSUED",
          upload_id: uploadId,
          storage_path: result.storagePath,
          content_type,
          file_size_bytes,
          upload_url_issued_at: new Date().toISOString(),
          capture_declared_sha256: capture_sha256,
          capture_token_hash: cameraCaptureTokenHash(cameraCommitToken),
        };
        await saveCameraSession(dispute, cameraSession);
      }

      // Recompute limits after this upload (optimistic)
      const newLimits = computeRemainingLimits(
        imageCount + pendingCounts.imageCount + (isImage ? 1 : 0),
        videoCount + pendingCounts.videoCount + (isVideo ? 1 : 0),
        orderAmountCents,
      );

      return reply.send({
        upload_url: result.uploadUrl,
        storage_path: result.storagePath,
        upload_id: uploadId,
        evidence_type: evidenceType,
        token: result.token,
        expires_in: result.expiresIn,
        limits: newLimits,
        camera_session: cameraSession ? cameraSessionResponse(cameraSession) : undefined,
        camera_commit_token: cameraSession ? cameraCommitToken : undefined,
      });
    },
  );

  // POST /disputes/:id/evidence/commit — Commit an uploaded file as evidence
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/commit",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = commitEvidenceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_COMMIT_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const {
        storage_path,
        type,
        description,
        camera_session_id,
        captured_at,
        camera_capture_token,
        fixture_party,
      } = parsed.data;

      // 1. Validate dispute
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }
      let cameraSession = getCameraSession(dispute, camera_session_id);
      if (camera_session_id && fixture_party) {
        return reply.code(400).send({
          error: "FIXTURE_CAMERA_SESSION_CONFLICT",
          message: "Prepared fixture evidence cannot be submitted as camera evidence",
        });
      }
      if (camera_session_id) {
        if (!cameraSession) {
          return reply.code(404).send({ error: "CAMERA_SESSION_NOT_FOUND" });
        }
        if (type !== "image") {
          return reply.code(400).send({
            error: "CAMERA_SESSION_IMAGE_ONLY",
            message: "Camera evidence MVP accepts still images only",
          });
        }
        if (cameraSession.status === "COMMITTED") {
          return reply.code(409).send({ error: "CAMERA_SESSION_ALREADY_COMMITTED" });
        }
        if (sessionIsExpired(cameraSession)) {
          return reply.code(400).send({ error: "CAMERA_SESSION_EXPIRED" });
        }
        if (!validCameraCaptureToken(cameraSession, camera_capture_token)) {
          return reply.code(403).send({
            error: "INVALID_CAMERA_CAPTURE_TOKEN",
            message: "The camera capture token is missing, invalid, or no longer usable",
          });
        }
      }
      if (!cameraSession && containsVerifiedCameraEvidenceMarker(description)) {
        return reply.code(400).send({
          error: "RESERVED_EVIDENCE_MARKER",
          message:
            "Verified camera evidence markers can only be created by the Haggle camera capture flow.",
        });
      }

      // 2. Validate & normalize the storage path
      let normalizedPath: string;
      try {
        normalizedPath = validateDisputeStoragePath(id, storage_path);
      } catch (err) {
        return reply.code(400).send({
          error: "INVALID_STORAGE_PATH",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const qualifiedStoragePath = qualifiedDisputeStoragePath(normalizedPath);

      // 3. Validate the upload intent created by the upload-url endpoint
      const upload = await getDisputeEvidenceUploadByPath(db, id, qualifiedStoragePath);
      if (!upload) {
        return reply.code(400).send({
          error: "UPLOAD_INTENT_NOT_FOUND",
          message: "No pending upload intent exists for this storage path",
        });
      }
      if (upload.status === "REJECTED") {
        return reply.code(422).send({
          error: "EVIDENCE_FILE_REJECTED",
          message: "The uploaded file failed evidence security checks",
          scan_status: upload.scanStatus,
        });
      }
      if (upload.status !== "PENDING" && upload.status !== "QUARANTINED") {
        return reply.code(409).send({
          error: "UPLOAD_ALREADY_PROCESSED",
          status: upload.status,
        });
      }
      if (upload.scanStatus === "SCANNING") {
        return reply.code(202).send({
          status: "EVIDENCE_QUARANTINED",
          message: "The evidence scanner retry worker is processing this file",
          upload_id: upload.id,
          scan_status: "SCANNING",
          retryable: true,
        });
      }
      if (isExpired(upload.expiresAt)) {
        return reply.code(400).send({
          error: "UPLOAD_INTENT_EXPIRED",
          message: "Upload intent has expired. Request a new upload URL.",
        });
      }
      if (upload.evidenceType !== type) {
        return reply.code(400).send({
          error: "EVIDENCE_TYPE_MISMATCH",
          expected: upload.evidenceType,
          received: type,
        });
      }

      // 4. Verify file exists in storage
      const exists = await disputeEvidenceExists(normalizedPath);
      if (!exists) {
        return reply.code(400).send({
          error: "FILE_NOT_FOUND",
          message: "File does not exist in storage. Upload it first.",
        });
      }

      // 5. Determine submitted_by from user's role on the order
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as
          | {
              id: string;
              buyerId: string;
              sellerId: string;
              amountMinor?: unknown;
            }
          | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

      const fixtureParty = resolveStagingDisputeFixtureParty(request.user?.role, fixture_party);
      if (fixture_party && !fixtureParty) {
        return reply.code(403).send({
          error: "FIXTURE_EVIDENCE_FORBIDDEN",
          message: "Party fixture commits are limited to enabled staging admin tests",
        });
      }
      const submittedBy = fixtureParty ?? activePartyForOrder(request.user, order);
      if (!submittedBy) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Cannot determine party role",
        });
      }
      if (upload.uploadedBy !== submittedBy) {
        return reply.code(403).send({
          error: "UPLOAD_PARTY_MISMATCH",
          message: "Only the party that requested the upload URL can commit it",
        });
      }
      if (cameraSession) {
        if (cameraSession.party !== submittedBy || cameraSession.user_id !== request.user!.id) {
          return reply.code(403).send({
            error: "CAMERA_SESSION_PARTY_MISMATCH",
            message: "Only the party that opened the camera session can commit it",
          });
        }
        if (cameraSession.storage_path && cameraSession.storage_path !== qualifiedStoragePath) {
          return reply.code(400).send({
            error: "CAMERA_SESSION_STORAGE_MISMATCH",
            message: "The upload path does not belong to this camera session",
          });
        }
      }

      let evidenceBytes: Buffer | undefined;
      let scanResult:
        | Awaited<ReturnType<typeof scanDisputeEvidence>>
        | {
            status: "SKIPPED";
            sha256?: string;
            provider: string;
            detail: string;
          };
      if (cameraSession?.test_only) {
        scanResult = {
          status: "SKIPPED",
          provider: "haggle-test-only",
          detail: "NOT_USED_FOR_DISPUTE",
        };
      } else if (upload.scanStatus === "CLEAN" && upload.contentSha256 && upload.scanProvider) {
        scanResult = {
          status: "CLEAN",
          sha256: upload.contentSha256,
          provider: upload.scanProvider,
          detail: upload.scanDetail ?? "CLEAN",
        };
        if (cameraSession) {
          try {
            evidenceBytes = await downloadDisputeEvidence(normalizedPath, upload.fileSizeBytes);
          } catch {
            return reply.code(202).send({
              status: "EVIDENCE_QUARANTINED",
              message: "The previously scanned camera file could not be read",
              upload_id: upload.id,
              scan_status: "FAILED",
              scan_detail: "STORAGE_DOWNLOAD_FAILED",
              retryable: true,
            });
          }
          const currentSha256 = createHash("sha256").update(evidenceBytes).digest("hex");
          if (currentSha256 !== upload.contentSha256) {
            await rejectDisputeEvidenceUpload(
              db,
              upload.id,
              "haggle-post-scan-integrity",
              "POST_SCAN_CONTENT_CHANGED",
            );
            return reply.code(422).send({
              error: "EVIDENCE_FILE_REJECTED",
              message: "The uploaded file changed after malware scanning",
              scan_status: "INFECTED",
              scan_detail: "POST_SCAN_CONTENT_CHANGED",
            });
          }
        }
      } else {
        try {
          evidenceBytes = await downloadDisputeEvidence(normalizedPath, upload.fileSizeBytes);
          scanResult = await scanDisputeEvidence(
            {
              bytes: evidenceBytes,
              contentType: upload.contentType,
              expectedSizeBytes: upload.fileSizeBytes,
              filename: normalizedPath.split("/").at(-1) ?? "evidence",
            },
            { db, trustedStagingFixture: fixtureParty !== null },
          );
        } catch (error) {
          scanResult = {
            status: "FAILED",
            provider: "haggle-storage",
            detail:
              error instanceof Error && error.message.includes("download")
                ? "STORAGE_DOWNLOAD_FAILED"
                : "EVIDENCE_SCAN_FAILED",
            sha256: undefined,
          };
        }
      }
      if (upload.scanStatus !== "CLEAN" || scanResult.status !== "CLEAN") {
        await updateDisputeEvidenceUploadScan(db, upload.id, scanResult);
      }
      if (scanResult.status === "INFECTED") {
        return reply.code(422).send({
          error: "EVIDENCE_FILE_REJECTED",
          message: "The uploaded file failed evidence security checks",
          scan_status: scanResult.status,
          scan_detail: scanResult.detail,
        });
      }
      if (scanResult.status !== "CLEAN" && scanResult.status !== "SKIPPED") {
        return reply.code(202).send({
          status: "EVIDENCE_QUARANTINED",
          message: "The file remains quarantined until evidence scanning succeeds",
          upload_id: upload.id,
          scan_status: scanResult.status,
          scan_detail: scanResult.detail,
          retryable: true,
        });
      }
      if (
        cameraSession &&
        !cameraSession.test_only &&
        (!upload.captureDeclaredSha256 || scanResult.sha256 !== upload.captureDeclaredSha256)
      ) {
        await rejectDisputeEvidenceUpload(
          db,
          upload.id,
          "haggle-capture-binding",
          "CAMERA_CAPTURE_HASH_MISMATCH",
        );
        return reply.code(422).send({
          error: "CAMERA_CAPTURE_HASH_MISMATCH",
          message: "The uploaded image does not match the bytes bound by the camera capture page",
        });
      }

      let challengeVerification: CameraChallengeVerificationResult | undefined;
      if (cameraSession?.test_only) {
        challengeVerification = {
          status: "VERIFIED",
          provider: "haggle-test-only",
          detail: "NOT_USED_FOR_DISPUTE",
        };
      } else if (cameraSession) {
        if (!evidenceBytes) {
          return reply.code(202).send({
            status: "CAMERA_CHALLENGE_VERIFICATION_PENDING",
            message: "Camera evidence remains quarantined until its challenge is verified",
            retryable: true,
          });
        }
        challengeVerification = await verifyCameraChallenge({
          bytes: evidenceBytes,
          contentType: upload.contentType,
          challengeCode: cameraSession.challenge_code,
          filename: normalizedPath.split("/").at(-1) ?? "camera-evidence",
        });
        cameraSession = { ...cameraSession, challenge_verification: challengeVerification };
        await saveCameraSession(dispute, cameraSession);
        if (challengeVerification.status === "REJECTED") {
          await rejectDisputeEvidenceUpload(
            db,
            upload.id,
            challengeVerification.provider,
            challengeVerification.detail,
          );
          return reply.code(422).send({
            error: "CAMERA_CHALLENGE_REJECTED",
            message: "The session challenge was not verified in the uploaded image",
            challenge_verification: challengeVerification,
          });
        }
        if (challengeVerification.status !== "VERIFIED") {
          return reply.code(202).send({
            status: "CAMERA_CHALLENGE_VERIFICATION_PENDING",
            message: "Camera evidence remains quarantined until its challenge is verified",
            challenge_verification: challengeVerification,
            retryable: true,
          });
        }
      }

      if (
        cameraSession &&
        !cameraSession.test_only &&
        scanResult.sha256 &&
        (await hasCommittedCameraEvidenceSha256(db, scanResult.sha256))
      ) {
        await rejectDisputeEvidenceUpload(
          db,
          upload.id,
          "haggle-exact-reuse",
          "CAMERA_EVIDENCE_REUSED",
        );
        return reply.code(409).send({
          error: "CAMERA_EVIDENCE_REUSED",
          message: "This exact camera image was already committed and cannot be reused",
        });
      }

      let similarity:
        | {
            status: "CLEAR" | "REVIEW_REQUIRED" | "APPROVED" | "SKIPPED";
            perceptual_hash?: string;
            distance?: number;
            threshold: number;
            distances?: { dhash: number; ahash: number | null; color: number | null };
            matched_signals?: string[];
            thresholds?: { near_hash: number; combined_hash: number; color: number };
          }
        | undefined;
      if (cameraSession?.test_only) {
        similarity = { status: "SKIPPED", threshold: CAMERA_SIMILARITY_REVIEW_DISTANCE };
        await updateDisputeEvidenceUploadSimilarity(db, upload.id, { status: "SKIPPED" });
      } else if (cameraSession) {
        if (upload.similarityStatus === "REJECTED") {
          return reply.code(422).send({
            error: "CAMERA_SIMILARITY_REJECTED",
            message: "An operator rejected this camera image after similarity review",
          });
        }
        if (upload.similarityStatus === "REVIEW_REQUIRED") {
          const storedSignals = storedImageSimilaritySignals(upload.similaritySignals);
          return reply.code(202).send({
            status: "CAMERA_SIMILARITY_REVIEW_REQUIRED",
            message: "A similar prior camera image requires operator review",
            upload_id: upload.id,
            similarity: {
              status: upload.similarityStatus,
              distance: upload.similarityDistance,
              threshold: CAMERA_SIMILARITY_REVIEW_DISTANCE,
              distances: storedSignals.distances,
              matched_signals: storedSignals.matchedSignals,
            },
            retryable: false,
          });
        }
        if (upload.similarityStatus === "APPROVED") {
          const storedSignals = storedImageSimilaritySignals(upload.similaritySignals);
          similarity = {
            status: "APPROVED",
            perceptual_hash: upload.perceptualHash ?? undefined,
            distance: upload.similarityDistance ?? undefined,
            threshold: CAMERA_SIMILARITY_REVIEW_DISTANCE,
            distances: storedSignals.distances,
            matched_signals: storedSignals.matchedSignals,
          };
        } else {
          let fingerprint: Awaited<ReturnType<typeof computeImageSimilarityFingerprint>>;
          try {
            fingerprint = await computeImageSimilarityFingerprint(evidenceBytes!);
          } catch {
            await updateDisputeEvidenceUploadSimilarity(db, upload.id, { status: "FAILED" });
            return reply.code(202).send({
              status: "CAMERA_SIMILARITY_CHECK_PENDING",
              message:
                "Camera evidence remains quarantined until image similarity processing succeeds",
              upload_id: upload.id,
              retryable: true,
            });
          }
          const nearest = await findNearestCommittedCameraEvidence(db, fingerprint);
          const signals = nearest
            ? {
                candidate_upload_id: nearest.uploadId,
                distances: {
                  dhash: nearest.assessment.dHashDistance,
                  ahash: nearest.assessment.aHashDistance,
                  color: nearest.assessment.colorDistance,
                },
                matched_signals: nearest.assessment.matchedSignals,
                score: nearest.assessment.score,
              }
            : { distances: null, matched_signals: [], score: null };
          if (nearest?.assessment.reviewRequired) {
            await updateDisputeEvidenceUploadSimilarity(db, upload.id, {
              perceptualHash: fingerprint.dHash,
              averageHash: fingerprint.aHash,
              colorHistogram: fingerprint.colorHistogram,
              signals,
              status: "REVIEW_REQUIRED",
              distance: nearest.assessment.dHashDistance,
            });
            return reply.code(202).send({
              status: "CAMERA_SIMILARITY_REVIEW_REQUIRED",
              message: "A similar prior camera image requires operator review",
              upload_id: upload.id,
              similarity: {
                status: "REVIEW_REQUIRED",
                distance: nearest.assessment.dHashDistance,
                threshold: CAMERA_SIMILARITY_REVIEW_DISTANCE,
                distances: signals.distances,
                matched_signals: signals.matched_signals,
                thresholds: {
                  near_hash: CAMERA_SIMILARITY_REVIEW_DISTANCE,
                  combined_hash: CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE,
                  color: CAMERA_SIMILARITY_COLOR_DISTANCE,
                },
              },
              retryable: false,
            });
          }
          await updateDisputeEvidenceUploadSimilarity(db, upload.id, {
            perceptualHash: fingerprint.dHash,
            averageHash: fingerprint.aHash,
            colorHistogram: fingerprint.colorHistogram,
            signals,
            status: "CLEAR",
            distance: nearest?.assessment.dHashDistance,
          });
          similarity = {
            status: "CLEAR",
            perceptual_hash: fingerprint.dHash,
            distance: nearest?.assessment.dHashDistance,
            threshold: CAMERA_SIMILARITY_REVIEW_DISTANCE,
            distances: signals.distances ?? undefined,
            matched_signals: signals.matched_signals,
            thresholds: {
              near_hash: CAMERA_SIMILARITY_REVIEW_DISTANCE,
              combined_hash: CAMERA_SIMILARITY_COMBINED_HASH_DISTANCE,
              color: CAMERA_SIMILARITY_COLOR_DISTANCE,
            },
          };
        }
      }

      // 6. Create evidence record and mark upload as committed
      const evidenceId = createUuid();
      const evidenceCreatedAt = new Date();
      const unsignedDerivedArtifacts =
        cameraSession && challengeVerification?.status === "VERIFIED"
          ? (challengeVerification.visualObservations ?? []).map((observation, index) => ({
              id: `${evidenceId}:visual:${index + 1}`,
              kind: "image_visual_observation" as const,
              source_evidence_id: evidenceId,
              text: observation.observation,
              metadata: {
                category: observation.category,
                confidence: observation.confidence,
                provider: challengeVerification.provider,
                source: "camera_challenge_verifier",
              },
              created_at: evidenceCreatedAt.toISOString(),
            }))
          : [];
      let derivedArtifacts =
        unsignedDerivedArtifacts.length > 0 ? unsignedDerivedArtifacts : undefined;
      let derivedArtifactsProvenance: DisputeEvidence["derived_artifacts_provenance"];
      let visualObservationStatus: "SIGNED" | "SKIPPED_UNSIGNED" | "NONE" = derivedArtifacts
        ? "SIGNED"
        : "NONE";
      if (derivedArtifacts) {
        try {
          derivedArtifactsProvenance = createSignedDisputeEvidenceProvenance({
            disputeId: id,
            evidenceId,
            sourceContentSha256: scanResult.sha256 ?? "",
            verifierProvider: challengeVerification!.provider,
            artifacts: derivedArtifacts,
            generatedAt: evidenceCreatedAt,
          });
        } catch (error) {
          if (!(error instanceof DisputeAuditSigningNotConfiguredError)) throw error;
          derivedArtifacts = undefined;
          visualObservationStatus = "SKIPPED_UNSIGNED";
        }
      }

      const evidence: DisputeEvidence = {
        id: evidenceId,
        dispute_id: id,
        submitted_by: submittedBy,
        type,
        uri: qualifiedStoragePath,
        text: cameraSession
          ? verifiedCameraEvidenceText({
              description,
              session: cameraSession,
              capturedAt: captured_at,
              challengeVerification: challengeVerification!,
            })
          : description,
        derived_artifacts: derivedArtifacts,
        source_content_sha256: derivedArtifacts ? scanResult.sha256 : undefined,
        derived_artifacts_provenance: derivedArtifactsProvenance,
        derived_artifacts_integrity: derivedArtifacts ? "valid" : undefined,
        created_at: evidenceCreatedAt.toISOString(),
      };

      let provenanceArchiveOutcome: "enqueued" | "duplicate" | "not_applicable" = "not_applicable";

      const persist = async (tx: unknown) => {
        const txDb = tx as Database;
        if (!cameraSession?.test_only) {
          await addDisputeEvidenceRecord(txDb, evidence);
          if (evidence.derived_artifacts_provenance) {
            const archive = await enqueueDisputeEvidenceProvenanceArchive(txDb, {
              evidence,
              now: evidenceCreatedAt,
            });
            provenanceArchiveOutcome = archive.outcome;
          }
        }
        const committed = await markDisputeEvidenceUploadCommitted(
          txDb,
          upload.id,
          evidence.id,
          cameraSession?.test_only === true,
        );
        if (!committed) throw new Error("EVIDENCE_UPLOAD_COMMIT_CONFLICT");
      };
      try {
        if (typeof db.transaction === "function") {
          await db.transaction(persist);
        } else {
          await persist(db);
        }
      } catch (error) {
        const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown };
        const cause = candidate.cause as { code?: unknown; constraint?: unknown } | undefined;
        const duplicateCameraHash =
          (candidate.code === "23505" || cause?.code === "23505") &&
          (candidate.constraint === "dispute_evidence_uploads_committed_camera_sha256_unique" ||
            cause?.constraint === "dispute_evidence_uploads_committed_camera_sha256_unique");
        if (duplicateCameraHash) {
          await rejectDisputeEvidenceUpload(
            db,
            upload.id,
            "haggle-exact-reuse",
            "CAMERA_EVIDENCE_REUSED",
          );
          return reply.code(409).send({
            error: "CAMERA_EVIDENCE_REUSED",
            message: "This exact camera image was already committed and cannot be reused",
          });
        }
        if (error instanceof Error && error.message === "EVIDENCE_UPLOAD_COMMIT_CONFLICT") {
          return reply.code(409).send({
            error: "EVIDENCE_UPLOAD_COMMIT_CONFLICT",
            message: "The upload was already committed or its clean scan state changed",
          });
        }
        throw error;
      }
      const disputeAfterCommit = cameraSession?.test_only
        ? dispute
        : withStaleAiAssessment(
            { ...dispute, evidence: [...dispute.evidence, evidence] },
            cameraSession ? "CAMERA_EVIDENCE_COMMITTED" : "EVIDENCE_ADDED",
          );
      if (cameraSession) {
        cameraSession = {
          ...cameraSession,
          status: "COMMITTED",
          captured_at,
          challenge_verification: challengeVerification,
          committed_evidence_id: cameraSession.test_only ? undefined : evidence.id,
          committed_at: new Date().toISOString(),
        };
        await saveCameraSession(disputeAfterCommit, cameraSession);
      } else if (disputeAfterCommit !== dispute) {
        await updateDisputeRecord(db, disputeAfterCommit);
      }

      // 7. Run evidence validation
      const allEvidence = cameraSession?.test_only
        ? dispute.evidence
        : [...dispute.evidence, evidence];
      const validation = validateEvidenceForReasonCode(
        dispute.reason_code as DisputeReasonCode,
        allEvidence,
      );

      // 8. Compute remaining limits
      const orderAmountCents = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;
      const { imageCount, videoCount } = await countEvidenceByType(id);
      const limits = computeRemainingLimits(imageCount, videoCount, orderAmountCents);

      return reply.code(201).send({
        evidence: cameraSession?.test_only ? null : evidence,
        test_capture: cameraSession?.test_only
          ? {
              id: evidenceId,
              storage_path: qualifiedStoragePath,
              captured_at,
              used_for_dispute: false,
            }
          : undefined,
        evidence_validation: validation,
        limits,
        camera_session: cameraSession ? cameraSessionResponse(cameraSession) : undefined,
        evidence_security: {
          status: scanResult.status,
          provider: scanResult.provider,
          sha256: scanResult.sha256 ?? null,
          detail: scanResult.detail,
          used_for_dispute: cameraSession?.test_only !== true,
        },
        capture_binding: cameraSession
          ? {
              status: cameraSession.test_only ? "TEST_ONLY" : "VERIFIED",
              declared_sha256: upload.captureDeclaredSha256,
              content_sha256: scanResult.sha256 ?? null,
              exact_reuse_checked: cameraSession.test_only !== true,
            }
          : undefined,
        image_similarity: similarity,
        visual_observation_provenance: {
          status: visualObservationStatus,
          artifact_count: derivedArtifacts?.length ?? 0,
          key_id: derivedArtifactsProvenance?.signature.key_id ?? null,
          external_archive: provenanceArchiveOutcome,
        },
        ai_assessment_state: aiAssessmentState(disputeAfterCommit),
      });
    },
  );

  app.get(
    "/admin/disputes/evidence-provenance-archives/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) =>
      reply.send({
        provenance_archive_health: await getDisputeEvidenceProvenanceArchiveHealth(db),
        provenance_archive_policy: getDisputeEvidenceProvenanceArchivePolicyStatus(),
        provenance_archive_alert_policy: getDisputeEvidenceProvenanceArchiveAlertPolicyStatus(),
        provenance_archive_alert_state:
          await getDisputeEvidenceProvenanceArchiveAlertDeliveryState(db),
      }),
  );

  app.get(
    "/admin/disputes/evidence-provenance-archives/failures",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_EVIDENCE_PROVENANCE_ARCHIVE_FAILURE_QUERY" });
      try {
        const queue = await listDisputeEvidenceProvenanceArchiveFailures(db, parsed.data);
        return reply.send({
          provenance_archive_failures: {
            items: queue.items.map((item) => ({
              archive_id: item.archiveId,
              evidence_id: item.evidenceId,
              dispute_id: item.disputeId,
              payload_sha256: item.payloadSha256,
              status: item.status,
              attempt_count: item.attemptCount,
              next_attempt_at: item.nextAttemptAt,
              last_error: item.lastError,
              http_status: item.httpStatus,
              failure_age_seconds: item.failureAgeSeconds,
            })),
            next_cursor: queue.nextCursor,
            recorded_at: queue.recordedAt,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "INVALID_EVIDENCE_PROVENANCE_ARCHIVE_FAILURE_CURSOR"
        ) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { archiveId: string } }>(
    "/admin/disputes/evidence-provenance-archives/:archiveId/requeue",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const archiveId = z.string().uuid().safeParse(request.params.archiveId);
      if (!archiveId.success)
        return reply.code(400).send({ error: "INVALID_EVIDENCE_PROVENANCE_ARCHIVE_ID" });
      const parsed = similarityArchiveRequeueSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_EVIDENCE_PROVENANCE_ARCHIVE_REQUEUE" });
      const result = await requeueDisputeEvidenceProvenanceArchive(db, {
        archiveId: archiveId.data,
        actorId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "EVIDENCE_PROVENANCE_ARCHIVE_NOT_FOUND" });
      if (result.outcome === "already_delivered")
        return reply.code(409).send({ error: "EVIDENCE_PROVENANCE_ARCHIVE_ALREADY_DELIVERED" });
      if (result.outcome === "invalid_reason")
        return reply.code(400).send({ error: "INVALID_EVIDENCE_PROVENANCE_ARCHIVE_REQUEUE" });
      return reply.send({
        archive_id: archiveId.data,
        outcome: result.outcome,
        status: result.archive.status,
      });
    },
  );

  app.get(
    "/admin/disputes/evidence-similarity-reviews",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_SIMILARITY_REVIEW_QUEUE_QUERY" });
      try {
        const queue = await listDisputeEvidenceSimilarityReviews(db, parsed.data);
        const items = await Promise.all(
          queue.items.map(async (item) => {
            let previewUrl: string | null = null;
            let previewStatus: "ready" | "unavailable" = "ready";
            try {
              previewUrl = await createDisputeViewUrl(item.storagePath);
            } catch {
              previewStatus = "unavailable";
            }
            let referencePreviewUrl: string | null = null;
            let referencePreviewStatus: "ready" | "unavailable" | "not_available" =
              item.matchedStoragePath ? "ready" : "not_available";
            if (item.matchedStoragePath) {
              try {
                referencePreviewUrl = await createDisputeViewUrl(item.matchedStoragePath);
              } catch {
                referencePreviewStatus = "unavailable";
              }
            }
            const signals = storedImageSimilaritySignals(item.similaritySignals);
            return {
              upload_id: item.uploadId,
              dispute_id: item.disputeId,
              uploaded_by: item.uploadedBy,
              content_type: item.contentType,
              file_size_bytes: item.fileSizeBytes,
              distance: item.similarityDistance,
              distances: signals.distances,
              matched_signals: signals.matchedSignals,
              waiting_age_seconds: item.waitingAgeSeconds,
              due_in_seconds: item.dueInSeconds,
              preview_url: previewUrl,
              preview_status: previewStatus,
              reference_preview_url: referencePreviewUrl,
              reference_preview_status: referencePreviewStatus,
            };
          }),
        );
        return reply.send({
          similarity_review_queue: {
            items,
            next_cursor: queue.nextCursor,
            recorded_at: queue.recordedAt,
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_SIMILARITY_REVIEW_CURSOR") {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/disputes/evidence-similarity-reviews/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const policy = getDisputeSimilarityReviewAlertPolicyStatus();
      const health = await getDisputeEvidenceSimilarityReviewHealth(db, {
        slaMinutes: policy.slaMinutes,
        dueSoonMinutes: policy.dueSoonMinutes,
      });
      return reply.send({
        similarity_review_health: health,
        alert_policy: policy,
        expiry_policy: {
          ...disputeSimilarityReviewExpiryPolicy(),
          archive_job_enabled:
            process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB === "true",
          archive_configured: Boolean(
            process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim() &&
              process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim(),
          ),
        },
      });
    },
  );

  app.get(
    "/admin/disputes/evidence-similarity-review-events",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_SIMILARITY_REVIEW_EXPIRY_QUERY" });
      try {
        const history = await listDisputeSimilarityReviewExpiryEvents(db, parsed.data);
        return reply.send({
          similarity_review_expiry_events: {
            items: history.items.map((item) => ({
              event_id: item.eventId,
              upload_id: item.uploadId,
              dispute_id: item.disputeId,
              event_type: item.eventType,
              actor_kind: item.actorKind,
              reason: item.reason,
              review_expires_at: item.reviewExpiresAt,
              created_at: item.createdAt,
              event_hash: item.eventHash,
              integrity: item.integrity,
            })),
            next_cursor: history.nextCursor,
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_SIMILARITY_REVIEW_EXPIRY_CURSOR") {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { eventId: string } }>(
    "/admin/disputes/evidence-similarity-review-events/:eventId/export",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const event = await getDisputeSimilarityReviewExpiryEventById(db, request.params.eventId);
      if (!event)
        return reply.code(404).send({ error: "SIMILARITY_REVIEW_EXPIRY_EVENT_NOT_FOUND" });
      if (event.integrity !== "valid" || !event.eventHash) {
        return reply
          .code(409)
          .send({ error: "SIMILARITY_REVIEW_AUDIT_INTEGRITY_INVALID", integrity: event.integrity });
      }
      try {
        return reply.send({
          similarity_review_audit_export: createSignedDisputeSimilarityReviewAuditExport({
            event: event.hashable,
            storedEventHash: event.eventHash,
            generatedAt: new Date(),
          }),
        });
      } catch (error) {
        if (error instanceof DisputeSimilarityReviewAuditSigningNotConfiguredError) {
          return reply.code(503).send({ error: "SIMILARITY_REVIEW_AUDIT_SIGNING_NOT_CONFIGURED" });
        }
        if (
          error instanceof Error &&
          error.message === "SIMILARITY_REVIEW_AUDIT_INTEGRITY_INVALID"
        ) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/disputes/evidence-similarity-review-audit-archives/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const health = await getDisputeSimilarityReviewAuditArchiveHealth(db);
      const alertPolicy = getDisputeSimilarityReviewAuditArchiveAlertPolicyStatus();
      return reply.send({
        similarity_review_audit_archive_health: health,
        archive_policy: getDisputeSimilarityReviewAuditArchivePolicyStatus(),
        alerting: {
          ...alertPolicy,
          ...evaluateDisputeSimilarityReviewAuditArchiveAlert(health, alertPolicy),
          deliveryState: await getDisputeSimilarityReviewAuditArchiveAlertDeliveryState(db),
        },
      });
    },
  );

  app.get(
    "/admin/disputes/evidence-similarity-review-audit-archives/failures",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_FAILURE_QUERY" });
      try {
        const queue = await listDisputeSimilarityReviewAuditArchiveFailures(db, parsed.data);
        return reply.send({
          similarity_review_audit_archive_failures: {
            items: queue.items.map((item) => ({
              event_id: item.eventId,
              status: item.status,
              payload_sha256: item.payloadSha256,
              attempt_count: item.attemptCount,
              next_attempt_at: item.nextAttemptAt,
              last_error: item.lastError,
              http_status: item.httpStatus,
              failure_age_seconds: item.failureAgeSeconds,
            })),
            next_cursor: queue.nextCursor,
            recorded_at: queue.recordedAt,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_FAILURE_CURSOR"
        ) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { eventId: string } }>(
    "/admin/disputes/evidence-similarity-review-audit-archives/:eventId/requeue",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityArchiveRequeueSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_REQUEUE" });
      const result = await requeueDisputeSimilarityReviewAuditArchive(db, {
        eventId: request.params.eventId,
        actorId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "SIMILARITY_REVIEW_AUDIT_ARCHIVE_NOT_FOUND" });
      if (result.outcome === "already_delivered")
        return reply.code(409).send({ error: "SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALREADY_DELIVERED" });
      if (result.outcome === "invalid_reason")
        return reply.code(400).send({ error: "INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_REQUEUE" });
      return reply.send({
        event_id: request.params.eventId,
        outcome: result.outcome,
        status: result.archive.status,
      });
    },
  );

  app.patch<{ Params: { id: string; uploadId: string } }>(
    "/admin/disputes/:id/evidence-uploads/:uploadId/similarity-review",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_SIMILARITY_REVIEW", issues: parsed.error.issues });
      }
      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      const upload = await getDisputeEvidenceUploadById(
        db,
        request.params.id,
        request.params.uploadId,
      );
      if (!upload) return reply.code(404).send({ error: "EVIDENCE_UPLOAD_NOT_FOUND" });
      if (upload.status !== "QUARANTINED" || upload.similarityStatus !== "REVIEW_REQUIRED") {
        return reply.code(409).send({
          error: "SIMILARITY_REVIEW_NOT_PENDING",
          status: upload.status,
          similarity_status: upload.similarityStatus,
        });
      }
      const result = await decideDisputeEvidenceSimilarityReview(db, {
        disputeId: dispute.id,
        uploadId: upload.id,
        reviewerId: request.user!.id,
        decision: parsed.data.decision,
        note: parsed.data.note,
      });
      if (result.outcome === "not_pending")
        return reply.code(409).send({ error: "SIMILARITY_REVIEW_NOT_PENDING" });
      const approved = result.outcome === "approved";
      return reply.send({
        upload_id: upload.id,
        similarity_status: approved ? "APPROVED" : "REJECTED",
        next_action: approved ? "retry_evidence_commit" : "capture_new_photo",
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/disputes/:id/evidence-retention",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const summary = await getDisputeEvidenceRetentionSummary(db, request.params.id);
      if (!summary) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      return reply.send({
        dispute_id: request.params.id,
        policy: evidenceRetentionPolicyResponse(),
        retention: summary,
      });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/disputes/:id/evidence-legal-hold",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = evidenceLegalHoldSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_EVIDENCE_LEGAL_HOLD", issues: parsed.error.issues });
      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      const updated = await setDisputeEvidenceLegalHold(db, {
        disputeId: dispute.id,
        active: parsed.data.active,
        reason: parsed.data.reason,
        actorId: request.user!.id,
      });
      if (!updated) {
        return reply.code(409).send({
          error: "EVIDENCE_DELETION_IN_PROGRESS",
          message: "A legal hold cannot be started after evidence deletion has been claimed",
        });
      }
      await writeAuditLog(db, {
        actorId: request.user!.id,
        actionType: "dispute.evidence_legal_hold",
        targetType: "dispute",
        targetId: dispute.id,
        payload: { active: parsed.data.active, reason: parsed.data.reason },
      });
      return reply.send({
        dispute_id: dispute.id,
        legal_hold: parsed.data.active,
        reason: parsed.data.reason,
      });
    },
  );

  app.post(
    "/admin/disputes/evidence-retention/run",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = evidenceRetentionRunSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_EVIDENCE_RETENTION_RUN", issues: parsed.error.issues });
      const result = await runDisputeEvidenceRetention(db, { dryRun: parsed.data.dry_run });
      await writeAuditLog(db, {
        actorId: request.user!.id,
        actionType: "dispute.evidence_retention_run",
        targetType: "dispute_evidence",
        payload: result,
      });
      return reply.send({ policy: evidenceRetentionPolicyResponse(), result });
    },
  );

  // POST /disputes/:id/ai/assess — Run AI judge recommendation after capture windows close
  app.get<{ Params: { id: string } }>(
    "/disputes/:id/ai/assessments/export",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });

      const maxExportEvents = 10_000;
      const newestFirst = await listDisputeAiAssessmentEvents(
        db,
        request.params.id,
        maxExportEvents + 1,
      );
      if (newestFirst.length > maxExportEvents) {
        return reply.code(409).send({
          error: "AI_AUDIT_EXPORT_TOO_LARGE",
          message: `Audit export exceeds ${maxExportEvents} events`,
        });
      }
      const events = [...newestFirst].reverse();
      const chain = verifyDisputeAiAssessmentEventChain(events);
      const genesisVerified =
        events.length === 0 || !events[0]?.eventHash || events[0].previousEventHash === null;
      if (!chain.valid || !genesisVerified) {
        return reply.code(409).send({
          error: "AI_AUDIT_CHAIN_INVALID",
          message: "The AI assessment event chain must be valid before export",
        });
      }

      try {
        const auditExport = createSignedDisputeAiAuditExport({
          disputeId: request.params.id,
          events,
          generatedAt: new Date(),
          chain: {
            valid: true,
            complete: true,
            headEventHash: chain.head_event_hash,
            sealedEvents: chain.sealed_events,
            legacyUnsealedEvents: chain.legacy_unsealed_events,
          },
        });
        reply.header(
          "Content-Disposition",
          `attachment; filename="haggle-dispute-${request.params.id}-ai-audit.json"`,
        );
        return reply.send(auditExport);
      } catch (error) {
        if (error instanceof DisputeAuditSigningNotConfiguredError) {
          return reply.code(503).send({
            error: "AI_AUDIT_SIGNING_NOT_CONFIGURED",
            message: error.message,
          });
        }
        request.log.error(
          { error, dispute_id: request.params.id },
          "Failed to sign dispute AI audit export",
        );
        return reply.code(500).send({
          error: "AI_AUDIT_SIGNING_FAILED",
          message: "The audit export could not be signed",
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/disputes/:id/ai/assessments/archive",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      try {
        const result = await enqueueDisputeAiAuditArchive(db, { disputeId: request.params.id });
        return reply.code(result.outcome === "enqueued" ? 202 : 200).send({
          outcome: result.outcome,
          ai_audit_archive: {
            status: result.archive.status,
            event_count: result.archive.eventCount,
            events_sha256: result.archive.eventsSha256,
            chain_head_event_hash: result.archive.chainHeadEventHash,
            payload_sha256: result.archive.payloadSha256,
            attempt_count: result.archive.attemptCount,
            receipt_id: result.archive.receiptId,
            receipt_sha256: result.archive.receiptSha256,
            receipt_matches:
              result.archive.receiptSha256 !== null &&
              result.archive.receiptSha256 === result.archive.payloadSha256,
            delivered_at: result.archive.deliveredAt,
            ...disputeAiArchiveTrustSummary(result.archive.payload),
          },
          archive_policy: getDisputeAiAuditArchivePolicyStatus(),
        });
      } catch (error) {
        if (error instanceof DisputeAuditSigningNotConfiguredError)
          return reply.code(503).send({ error: "AI_AUDIT_SIGNING_NOT_CONFIGURED" });
        const code = error instanceof Error ? error.message : "AI_AUDIT_ARCHIVE_FAILED";
        if (
          [
            "AI_AUDIT_ARCHIVE_NO_EVENTS",
            "AI_AUDIT_ARCHIVE_TOO_LARGE",
            "AI_AUDIT_CHAIN_INVALID",
            "AI_AUDIT_CHAIN_UNSEALED",
          ].includes(code)
        ) {
          return reply.code(409).send({ error: code });
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/disputes/ai-assessment-audit-archives/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const health = await getDisputeAiAuditArchiveHealth(db);
      const coverage = await getDisputeAiAuditArchiveCoverage(db);
      const discoveryFailures = await getDisputeAiAuditDiscoveryFailureHealth(db);
      const alertPolicy = getDisputeAiAuditArchiveAlertPolicyStatus();
      return reply.send({
        ai_audit_archive_health: health,
        ai_audit_archive_coverage: coverage,
        ai_audit_discovery_failure_health: discoveryFailures,
        archive_policy: getDisputeAiAuditArchivePolicyStatus(),
        alerting: {
          ...alertPolicy,
          ...evaluateDisputeAiAuditArchiveAlert(health, alertPolicy, discoveryFailures),
          deliveryState: await getDisputeAiAuditArchiveAlertDeliveryState(db),
        },
      });
    },
  );

  app.get(
    "/admin/disputes/ai-assessment-audit-archives/discovery-failures",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_AI_AUDIT_DISCOVERY_FAILURE_QUERY" });
      try {
        const queue = await listDisputeAiAuditDiscoveryFailures(db, parsed.data);
        return reply.send({
          ai_audit_discovery_failures: {
            items: queue.items.map((item) => ({
              dispute_id: item.disputeId,
              event_count: item.eventCount,
              failure_code: item.failureCode,
              status: item.status,
              attempt_count: item.attemptCount,
              first_failed_at: item.firstFailedAt,
              last_failed_at: item.lastFailedAt,
              age_seconds: item.ageSeconds,
            })),
            next_cursor: queue.nextCursor,
            recorded_at: queue.recordedAt,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "INVALID_AI_AUDIT_DISCOVERY_FAILURE_CURSOR"
        ) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { disputeId: string } }>(
    "/admin/disputes/ai-assessment-audit-archives/discovery-failures/:disputeId/retry",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const disputeId = z.string().uuid().safeParse(request.params.disputeId);
      if (!disputeId.success) return reply.code(400).send({ error: "INVALID_DISPUTE_ID" });
      const parsed = aiAuditDiscoveryRetrySchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_AI_AUDIT_DISCOVERY_RETRY" });
      const result = await retryDisputeAiAuditDiscoveryFailure(db, {
        disputeId: disputeId.data,
        eventCount: parsed.data.event_count,
        actorId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "AI_AUDIT_DISCOVERY_FAILURE_NOT_FOUND" });
      if (result.outcome === "already_resolved")
        return reply.code(409).send({ error: "AI_AUDIT_DISCOVERY_FAILURE_ALREADY_RESOLVED" });
      if (result.outcome === "retry_already_requested")
        return reply.code(409).send({ error: "AI_AUDIT_DISCOVERY_RETRY_ALREADY_REQUESTED" });
      if (result.outcome === "invalid_reason")
        return reply.code(400).send({ error: "INVALID_AI_AUDIT_DISCOVERY_RETRY" });
      return reply.send({
        dispute_id: disputeId.data,
        event_count: parsed.data.event_count,
        outcome: result.outcome,
      });
    },
  );

  app.get(
    "/admin/disputes/ai-assessment-audit-archives/failures",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = similarityReviewQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_AI_AUDIT_ARCHIVE_FAILURE_QUERY" });
      try {
        const queue = await listDisputeAiAuditArchiveFailures(db, parsed.data);
        return reply.send({
          ai_audit_archive_failures: {
            items: queue.items.map((item) => ({
              archive_id: item.id,
              dispute_id: item.disputeId,
              event_count: item.eventCount,
              events_sha256: item.eventsSha256,
              payload_sha256: item.payloadSha256,
              status: item.status,
              attempt_count: item.attemptCount,
              next_attempt_at: item.nextAttemptAt,
              last_error: item.lastError,
              http_status: item.httpStatus,
              failure_age_seconds: item.failureAgeSeconds,
            })),
            next_cursor: queue.nextCursor,
            recorded_at: queue.recordedAt,
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_AI_AUDIT_ARCHIVE_FAILURE_CURSOR") {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { archiveId: string } }>(
    "/admin/disputes/ai-assessment-audit-archives/:archiveId/requeue",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const archiveId = z.string().uuid().safeParse(request.params.archiveId);
      if (!archiveId.success) return reply.code(400).send({ error: "INVALID_AI_AUDIT_ARCHIVE_ID" });
      const parsed = similarityArchiveRequeueSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_AI_AUDIT_ARCHIVE_REQUEUE" });
      const result = await requeueDisputeAiAuditArchive(db, {
        archiveId: archiveId.data,
        actorId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "AI_AUDIT_ARCHIVE_NOT_FOUND" });
      if (result.outcome === "already_delivered")
        return reply.code(409).send({ error: "AI_AUDIT_ARCHIVE_ALREADY_DELIVERED" });
      if (result.outcome === "invalid_reason")
        return reply.code(400).send({ error: "INVALID_AI_AUDIT_ARCHIVE_REQUEUE" });
      return reply.send({
        archive_id: archiveId.data,
        outcome: result.outcome,
        status: result.archive.status,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/disputes/:id/ai/assessments/archive",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      const archive = await getLatestDisputeAiAuditArchive(db, request.params.id);
      if (!archive) return reply.code(404).send({ error: "AI_AUDIT_ARCHIVE_NOT_FOUND" });
      return reply.send({
        ai_audit_archive: {
          status: archive.status,
          event_count: archive.eventCount,
          events_sha256: archive.eventsSha256,
          chain_head_event_hash: archive.chainHeadEventHash,
          payload_sha256: archive.payloadSha256,
          attempt_count: archive.attemptCount,
          last_error: archive.lastError,
          http_status: archive.httpStatus,
          receipt_id: archive.receiptId,
          receipt_sha256: archive.receiptSha256,
          receipt_matches:
            archive.receiptSha256 !== null && archive.receiptSha256 === archive.payloadSha256,
          delivered_at: archive.deliveredAt,
          created_at: archive.createdAt,
          updated_at: archive.updatedAt,
          ...disputeAiArchiveTrustSummary(archive.payload),
        },
        archive_policy: getDisputeAiAuditArchivePolicyStatus(),
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/disputes/:id/ai/assessments",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = aiAssessmentHistoryQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_AI_ASSESSMENT_HISTORY_QUERY",
          issues: parsed.error.issues,
        });
      }
      const dispute = await getDisputeById(db, request.params.id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      const newestFirst = await listDisputeAiAssessmentEvents(
        db,
        request.params.id,
        parsed.data.limit + 1,
      );
      const hasMore = newestFirst.length > parsed.data.limit;
      const events = [...newestFirst.slice(0, parsed.data.limit)].reverse();
      const chain = verifyDisputeAiAssessmentEventChain(events);
      const genesisVerified =
        hasMore ||
        events.length === 0 ||
        !events[0]?.eventHash ||
        events[0].previousEventHash === null;
      return reply.send({
        dispute_id: request.params.id,
        events,
        summary: {
          returned: events.length,
          completed: events.filter((event) => event.eventType === "COMPLETED").length,
          failed: events.filter((event) => event.eventType === "FAILED").length,
          chain_valid: chain.valid && genesisVerified,
          chain_complete: !hasMore,
          chain_genesis_verified: genesisVerified,
          sealed_events: chain.sealed_events,
          legacy_unsealed_events: chain.legacy_unsealed_events,
          head_event_hash: chain.head_event_hash,
        },
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/disputes/:id/ai/assess",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = aiAssessmentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_AI_ASSESSMENT_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      const blockingUploads = await listBlockingDisputeEvidenceUploads(db, id);
      if (blockingUploads.length > 0) {
        return reply.code(409).send({
          error: "EVIDENCE_SCAN_PENDING",
          message: "AI assessment is blocked while uploaded evidence remains quarantined",
          uploads: blockingUploads.map((upload) => ({
            id: upload.id,
            status: upload.status,
            scan_status: upload.scanStatus,
            expires_at: upload.expiresAt.toISOString(),
          })),
        });
      }

      const openSessions = activeCameraSessions(dispute);
      if (!parsed.data.force && openSessions.length > 0) {
        return reply.code(409).send({
          error: "EVIDENCE_COLLECTION_STILL_OPEN",
          message:
            "AI assessment can run after active camera evidence sessions are committed or expired",
          active_camera_sessions: openSessions.map((session) => cameraSessionResponse(session)),
        });
      }

      const metadata = disputeMetadata(dispute);
      const currentAssessmentMetadata = { ...metadata };
      delete currentAssessmentMetadata.ai_resolution_assessment_history;
      delete currentAssessmentMetadata.ai_resolution_assessment_attempt_history;
      const currentEvidenceHash = evidenceSnapshotHash(dispute);
      const currentAssessmentModel = resolveDisputeAiModel("resolution_assessor");
      const approvedPrecedents = await listApprovedDisputePrecedents(db, dispute.reason_code, {
        limit: 5,
        evidenceTypes: dispute.evidence.map((evidence) => evidence.type),
      });
      const precedentSnapshot = buildDisputePrecedentSnapshot(approvedPrecedents);
      const appeal = appealReviewFor(dispute);
      if (appeal?.status === "OPEN") {
        return reply.code(409).send({
          error: "APPEAL_REVIEW_REQUIRED",
          message: "An operator must review the appeal before reassessment",
          appeal,
        });
      }
      const previousAssessment = metadata.ai_resolution_assessor;
      if (
        !parsed.data.force &&
        metadata.ai_assessment_stale !== true &&
        previousAssessment &&
        typeof previousAssessment === "object" &&
        !Array.isArray(previousAssessment) &&
        (previousAssessment as Record<string, unknown>).status === "COMPLETED" &&
        (previousAssessment as Record<string, unknown>).evidence_snapshot_hash ===
          currentEvidenceHash &&
        (previousAssessment as Record<string, unknown>).policy_version ===
          DISPUTE_AI_POLICY_VERSION &&
        (previousAssessment as Record<string, unknown>).model === currentAssessmentModel &&
        (previousAssessment as Record<string, unknown>).precedent_snapshot_hash ===
          precedentSnapshot.sha256
      ) {
        return reply.send({
          dispute_id: id,
          ai_assessment: previousAssessment,
          idempotent: true,
        });
      }
      if (disputeAiInFlight.has(id)) {
        return reply.code(409).send({
          error: "AI_ASSESSMENT_IN_PROGRESS",
          message: "An AI assessment is already running for this dispute",
        });
      }

      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      const orderAmountMinor = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;
      const tier = (disputeMetadata(dispute).tier as DisputeTier | undefined) ?? 1;
      const context = buildDisputeAiCaseContextFromDispute(dispute, {
        tier,
        transaction: {
          amount_minor: orderAmountMinor,
          currency: "USDC",
          status: order?.status ?? dispute.status,
        },
        policy: {
          refund_cap_minor: orderAmountMinor > 0 ? orderAmountMinor : undefined,
          allowed_outcomes: [
            "buyer_favor",
            "seller_favor",
            "partial_refund",
            "no_action",
            "escalate",
          ],
          platform_rules: [
            ...stagingDisputeFixturePlatformRules(),
            "Verified Haggle Camera Evidence carries more weight than generic uploads.",
            "When one side has verified camera evidence for the central factual claim and the other side has only unverified text, prefer a direct L1 outcome over escalation.",
            "Do not recommend no_action for a central item-condition claim when one party has one-sided verified Haggle camera evidence.",
            "Cite every verified Haggle camera evidence item in evidence_findings with high weight for the submitting party when it supports the central factual claim.",
            "Escalate when evidence is missing, contradictory, or plausibly manipulated.",
            "Do not finalize money movement from AI output alone in the MVP.",
          ],
          precedent_examples: toResolutionAssessorPrecedentExamples(approvedPrecedents),
        },
      });
      const evidenceHash = currentEvidenceHash;
      const previousAssessmentRecord =
        previousAssessment &&
        typeof previousAssessment === "object" &&
        !Array.isArray(previousAssessment)
          ? (previousAssessment as Record<string, unknown>)
          : null;
      const evidenceSnapshotChanged =
        previousAssessmentRecord?.status === "COMPLETED" &&
        previousAssessmentRecord.evidence_snapshot_hash !== currentEvidenceHash;
      const policyVersionChanged =
        previousAssessmentRecord?.status === "COMPLETED" &&
        previousAssessmentRecord.policy_version !== DISPUTE_AI_POLICY_VERSION;
      const assessmentModelChanged =
        previousAssessmentRecord?.status === "COMPLETED" &&
        previousAssessmentRecord.model !== currentAssessmentModel;
      const precedentSnapshotChanged =
        previousAssessmentRecord?.status === "COMPLETED" &&
        previousAssessmentRecord.precedent_snapshot_hash !== precedentSnapshot.sha256;
      let assessmentHistory = aiAssessmentHistoryFor(dispute);
      let previousAssessmentId = previousAssessmentRecord?.assessment_id;
      if (previousAssessmentRecord?.status === "COMPLETED") {
        previousAssessmentId =
          previousAssessmentId ??
          `legacy_${createHash("sha256")
            .update(JSON.stringify(previousAssessmentRecord))
            .digest("hex")
            .slice(0, 24)}`;
        const alreadyRecorded = assessmentHistory.some(
          (entry) =>
            entry.assessment_id === previousAssessmentId ||
            (entry.context_hash === previousAssessmentRecord.context_hash &&
              entry.assessed_at === previousAssessmentRecord.assessed_at),
        );
        if (!alreadyRecorded) {
          assessmentHistory = [
            ...assessmentHistory,
            {
              ...previousAssessmentRecord,
              assessment_id: previousAssessmentId,
              revision: previousAssessmentRecord.revision ?? assessmentHistory.length + 1,
              legacy_backfill: previousAssessmentRecord.assessment_id === undefined,
            },
          ];
        }
      }
      let reassessmentReason = parsed.data.reassessment_reason ?? null;
      if (!reassessmentReason && appeal?.status === "REOPENED") {
        reassessmentReason = `Appeal ${appeal.id} reopened for reassessment`;
      } else if (!reassessmentReason && evidenceSnapshotChanged) {
        reassessmentReason = "Evidence snapshot changed after the previous assessment";
      } else if (!reassessmentReason && policyVersionChanged) {
        reassessmentReason = "AI assessment policy changed after the previous assessment";
      } else if (!reassessmentReason && assessmentModelChanged) {
        reassessmentReason = "AI assessment model changed after the previous assessment";
      } else if (!reassessmentReason && precedentSnapshotChanged) {
        reassessmentReason = "Approved precedent snapshot changed after the previous assessment";
      }

      const leaseId = createUuid();
      const lease = await acquireDisputeAiAssessmentLease(db, {
        disputeId: id,
        leaseId,
        ownerId: request.user!.id,
      });
      if (!lease) {
        return reply.code(409).send({
          error: "AI_ASSESSMENT_IN_PROGRESS",
          message: "Another API instance is already assessing this dispute",
        });
      }

      disputeAiInFlight.add(id);
      try {
        const result = await runResolutionAssessor(
          context,
          createDisputeAiProvider({ correlationId: `dispute-ai:assess:${id}` }),
        );
        const assessedAt = new Date().toISOString();

        if (!result.ok) {
          const failedAttempt = {
            attempt_id: createUuid(),
            status: "FAILED",
            assessed_at: assessedAt,
            requested_by: request.user!.id,
            force: parsed.data.force,
            reassessment_reason: reassessmentReason,
            evidence_snapshot_hash: evidenceHash,
            policy_version: DISPUTE_AI_POLICY_VERSION,
            precedent_snapshot: precedentSnapshot,
            precedent_snapshot_hash: precedentSnapshot.sha256,
            context_hash: result.contextHash,
            error: result.error,
            message: result.message,
            model: result.model,
            usage: result.usage,
            cost: result.cost ?? null,
          };
          const failedDispute = {
            ...dispute,
            metadata: {
              ...currentAssessmentMetadata,
              ai_resolution_assessor:
                previousAssessmentRecord?.status === "COMPLETED"
                  ? previousAssessmentRecord
                  : failedAttempt,
              ai_resolution_assessor_last_failure: failedAttempt,
            },
          };
          const persistFailure = async (tx: unknown) => {
            const txDb = tx as Database;
            await appendDisputeAiAssessmentEvent(txDb, {
              id: failedAttempt.attempt_id,
              disputeId: id,
              eventType: "FAILED",
              evidenceSnapshotHash: evidenceHash,
              policyVersion: DISPUTE_AI_POLICY_VERSION,
              model: result.model,
              contextHash: result.contextHash,
              requestedBy: request.user!.id,
              forced: parsed.data.force,
              reassessmentReason: reassessmentReason ?? undefined,
              payload: failedAttempt,
              createdAt: new Date(assessedAt),
            });
            await updateDisputeRecord(txDb, failedDispute);
          };
          if (typeof db.transaction === "function") {
            await db.transaction(persistFailure);
          } else {
            await persistFailure(db);
          }
          return reply.code(502).send({
            error: "AI_ASSESSMENT_FAILED",
            message: result.message,
            context_hash: result.contextHash,
            issues: result.issues,
          });
        }

        const assessmentId = createUuid();
        const versionId = createHash("sha256")
          .update(
            [
              id,
              evidenceHash,
              DISPUTE_AI_POLICY_VERSION,
              precedentSnapshot.sha256,
              result.model ?? "unknown-model",
              result.contextHash,
            ].join(":"),
          )
          .digest("hex");
        const aiAssessment = {
          assessment_id: assessmentId,
          version_id: versionId,
          revision:
            typeof previousAssessmentRecord?.revision === "number"
              ? previousAssessmentRecord.revision + 1
              : assessmentHistory.length + 1,
          status: "COMPLETED",
          assessed_at: assessedAt,
          requested_by: request.user!.id,
          force: parsed.data.force,
          reassessment_reason: reassessmentReason,
          supersedes_assessment_id:
            previousAssessmentRecord?.status === "COMPLETED"
              ? (previousAssessmentId ?? null)
              : null,
          evidence_snapshot_hash: evidenceHash,
          policy_version: DISPUTE_AI_POLICY_VERSION,
          precedent_snapshot: precedentSnapshot,
          precedent_snapshot_hash: precedentSnapshot.sha256,
          context_hash: result.contextHash,
          model: result.model,
          usage: result.usage,
          cost: result.cost ?? null,
          conclusion: result.output.recommended_outcome,
          confidence: result.output.confidence,
          judgment: buildReadableDisputeJudgment(result.output),
          output: result.output,
          auto_applied: false,
        };
        const reassessedAppeal =
          appeal?.status === "REOPENED"
            ? { ...appeal, status: "REASSESSED" as const, reassessed_at: assessedAt }
            : appeal;
        const assessedDispute = {
          ...dispute,
          metadata: {
            ...currentAssessmentMetadata,
            ai_resolution_assessor: aiAssessment,
            ai_assessment_stale: false,
            ai_assessment_stale_reason: null,
            ai_assessment_stale_at: null,
            ai_assessment_previous_evidence_snapshot_hash: null,
            ai_assessment_current_evidence_snapshot_hash: evidenceHash,
            ...(reassessedAppeal
              ? {
                  appeal_review: reassessedAppeal,
                  appeal_history: [
                    ...appealHistoryFor(dispute),
                    {
                      event: "APPEAL_REASSESSED",
                      at: assessedAt,
                      actor_id: request.user!.id,
                      appeal_id: reassessedAppeal.id,
                      context_hash: result.contextHash,
                    },
                  ],
                }
              : {}),
          },
        };
        const persistAssessment = async (tx: unknown) => {
          const txDb = tx as Database;
          await appendDisputeAiAssessmentEvent(txDb, {
            id: assessmentId,
            disputeId: id,
            eventType: "COMPLETED",
            revision: aiAssessment.revision,
            versionId,
            supersedesAssessmentId:
              typeof aiAssessment.supersedes_assessment_id === "string"
                ? aiAssessment.supersedes_assessment_id
                : undefined,
            evidenceSnapshotHash: evidenceHash,
            policyVersion: DISPUTE_AI_POLICY_VERSION,
            model: result.model,
            contextHash: result.contextHash,
            requestedBy: request.user!.id,
            forced: parsed.data.force,
            reassessmentReason: reassessmentReason ?? undefined,
            payload: aiAssessment,
            createdAt: new Date(assessedAt),
          });
          await updateDisputeRecord(txDb, assessedDispute);
        };
        if (typeof db.transaction === "function") {
          await db.transaction(persistAssessment);
        } else {
          await persistAssessment(db);
        }

        return reply.send({
          dispute_id: id,
          ai_assessment: aiAssessment,
          idempotent: false,
        });
      } finally {
        disputeAiInFlight.delete(id);
        try {
          await releaseDisputeAiAssessmentLease(db, id, leaseId);
        } catch (error) {
          request.log.error(
            { error, dispute_id: id, lease_id: leaseId },
            "Failed to release AI assessment lease",
          );
        }
      }
    },
  );

  // GET /disputes/:id/evidence/:evidenceId/view — Get a signed view URL
  app.get<{ Params: { id: string; evidenceId: string } }>(
    "/disputes/:id/evidence/:evidenceId/view",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id, evidenceId } = request.params;

      // Look up the evidence record
      const rows = await db
        .select()
        .from(disputeEvidenceTable)
        .where(
          and(eq(disputeEvidenceTable.id, evidenceId), eq(disputeEvidenceTable.disputeId, id)),
        );

      if (rows.length === 0) {
        return reply.code(404).send({ error: "EVIDENCE_NOT_FOUND" });
      }

      const evidenceRow = rows[0];
      if (!evidenceRow.uri) {
        return reply.code(400).send({
          error: "NO_FILE_URI",
          message: "This evidence record has no associated file",
        });
      }

      const upload = await getDisputeEvidenceUploadByEvidenceId(db, id, evidenceId);
      if (upload?.retentionStatus === "DELETED") {
        return reply.code(410).send({
          error: "EVIDENCE_RETAINED_RECORD_FILE_DELETED",
          message:
            "The evidence audit record remains, but its retained file has been deleted under policy",
          deleted_at: upload.deletedAt,
        });
      }

      // Strip bucket prefix if present to get the inner object path
      const BUCKET_PREFIX = "dispute-evidence/";
      const objectPath = evidenceRow.uri.startsWith(BUCKET_PREFIX)
        ? evidenceRow.uri.slice(BUCKET_PREFIX.length)
        : evidenceRow.uri;

      const viewUrl = await createDisputeViewUrl(objectPath);

      return reply.send({
        view_url: viewUrl,
        expires_in: DISPUTE_VIEW_URL_TTL_SECONDS,
      });
    },
  );
}
