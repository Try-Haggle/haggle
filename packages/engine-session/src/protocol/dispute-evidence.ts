import { createHash } from "node:crypto";
import type { HnpMoney } from "./core.js";

/**
 * Phase 4 digital dispute evidence kinds
 * (`docs/wip/digital-fulfillment-settlement-design.md` section Dispute Evidence Expansion).
 * Category allowlist (B9) + content validators (C1). Digital reason-code wiring remains later.
 */
export const HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS = [
  "digital_access",
  "digital_file_hash",
  "license_terms",
  "platform_transfer",
  "onchain_transfer",
] as const;

export type HnpDigitalDisputeEvidenceKind = (typeof HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS)[number];

export const HNP_DISPUTE_EVIDENCE_KINDS = [
  "condition_at_listing",
  "condition_at_arrival",
  "inspection_checklist",
  "carrier_tracking",
  "message_transcript",
  "payment_record",
  "return_label",
  ...HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS,
] as const;

export type HnpDisputeEvidenceKind = (typeof HNP_DISPUTE_EVIDENCE_KINDS)[number];

export type HnpDisputeReason =
  | "item_not_as_described"
  | "damaged_in_shipping"
  | "missing_accessory"
  | "wrong_item"
  | "non_delivery"
  | "payment_issue"
  | "return_dispute"
  | "other";

export type HnpDisputeRequestedResolution =
  | "full_refund"
  | "partial_refund"
  | "return_for_refund"
  | "replacement"
  | "release_payment"
  | "no_action";

export interface HnpDisputeEvidenceItem {
  evidence_id: string;
  kind: HnpDisputeEvidenceKind;
  uri?: string;
  sha256?: string;
  submitted_by_agent_id?: string;
  submitted_at_ms: number;
  metadata?: Record<string, unknown>;
}

export interface HnpInspectionFinding {
  finding_id: string;
  issue_id: string;
  expected: unknown;
  observed: unknown;
  source_evidence_ids: string[];
  severity?: "low" | "medium" | "high";
}

export interface HnpDisputeEvidencePacket {
  packet_id: string;
  agreement_id: string;
  agreement_hash: string;
  reason: HnpDisputeReason;
  requested_resolution: HnpDisputeRequestedResolution;
  requested_adjustment?: HnpMoney;
  evidence: HnpDisputeEvidenceItem[];
  findings: HnpInspectionFinding[];
  created_at_ms: number;
  packet_hash: string;
}

export interface CreateHnpDisputeEvidencePacketInput {
  agreement_id: string;
  agreement_hash: string;
  reason: HnpDisputeReason;
  requested_resolution: HnpDisputeRequestedResolution;
  requested_adjustment?: HnpMoney;
  evidence?: HnpDisputeEvidenceItem[];
  findings?: HnpInspectionFinding[];
  created_at_ms: number;
}

export interface HnpDisputeEvidencePacketIssue {
  code:
    | "MISSING_AGREEMENT"
    | "INVALID_AGREEMENT_HASH"
    | "EMPTY_EVIDENCE"
    | "EMPTY_EVIDENCE_ID"
    | "DUPLICATE_EVIDENCE_ID"
    | "UNSUPPORTED_EVIDENCE_KIND"
    | "INVALID_SHA256"
    | "INVALID_SUBMITTED_AT"
    | "EMPTY_FINDING_ID"
    | "EMPTY_ISSUE_ID"
    | "EMPTY_FINDING_SOURCES"
    | "UNKNOWN_FINDING_SOURCE"
    | "INVALID_ADJUSTMENT"
    | "HASH_MISMATCH";
  field: string;
  message: string;
}

export type HnpDisputeEvidencePacketValidationResult =
  | { ok: true; warnings: HnpDisputeEvidencePacketIssue[] }
  | { ok: false; issues: HnpDisputeEvidencePacketIssue[] };

export function createHnpDisputeEvidencePacket(
  input: CreateHnpDisputeEvidencePacketInput,
): HnpDisputeEvidencePacket {
  const base = {
    agreement_id: input.agreement_id,
    agreement_hash: input.agreement_hash,
    reason: input.reason,
    requested_resolution: input.requested_resolution,
    requested_adjustment: input.requested_adjustment,
    evidence: input.evidence ?? [],
    findings: input.findings ?? [],
    created_at_ms: input.created_at_ms,
  };
  const packetHash = computeHnpDisputeEvidencePacketHash(base);
  return {
    packet_id: `dep_${packetHash.slice("sha256:".length, "sha256:".length + 24)}`,
    ...base,
    packet_hash: packetHash,
  };
}

export function computeHnpDisputeEvidencePacketHash(
  value: Omit<HnpDisputeEvidencePacket, "packet_id" | "packet_hash">,
): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function validateHnpDisputeEvidencePacket(
  packet: HnpDisputeEvidencePacket,
  options: { verifyHash?: boolean } = {},
): HnpDisputeEvidencePacketValidationResult {
  const issues: HnpDisputeEvidencePacketIssue[] = [];

  if (!packet.agreement_id.trim()) {
    issues.push(
      issue("MISSING_AGREEMENT", "agreement_id", "Dispute packet must reference an agreement id."),
    );
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(packet.agreement_hash)) {
    issues.push(
      issue(
        "INVALID_AGREEMENT_HASH",
        "agreement_hash",
        "Dispute packet must reference a valid agreement hash.",
      ),
    );
  }

  if (packet.evidence.length === 0) {
    issues.push(
      issue(
        "EMPTY_EVIDENCE",
        "evidence",
        "Dispute packet must include at least one evidence item.",
      ),
    );
  }

  if (packet.requested_adjustment) {
    if (
      !Number.isInteger(packet.requested_adjustment.units_minor) ||
      packet.requested_adjustment.units_minor < 0
    ) {
      issues.push(
        issue(
          "INVALID_ADJUSTMENT",
          "requested_adjustment.units_minor",
          "Requested adjustment must be a non-negative integer minor-unit value.",
        ),
      );
    }
  }

  const evidenceIds = new Set<string>();
  for (const item of packet.evidence) {
    if (!item.evidence_id.trim()) {
      issues.push(
        issue("EMPTY_EVIDENCE_ID", "evidence.evidence_id", "Evidence id cannot be empty."),
      );
      continue;
    }

    if (evidenceIds.has(item.evidence_id)) {
      issues.push(
        issue(
          "DUPLICATE_EVIDENCE_ID",
          "evidence.evidence_id",
          `Duplicate evidence id: ${item.evidence_id}`,
        ),
      );
    }
    evidenceIds.add(item.evidence_id);

    if (!isSupportedDisputeEvidenceKind(item.kind)) {
      issues.push(
        issue(
          "UNSUPPORTED_EVIDENCE_KIND",
          "evidence.kind",
          `Unsupported evidence kind: ${item.kind}`,
        ),
      );
    }

    if (item.sha256 && !/^sha256:[a-f0-9]{64}$/.test(item.sha256)) {
      issues.push(
        issue(
          "INVALID_SHA256",
          "evidence.sha256",
          `Invalid sha256 digest for ${item.evidence_id}.`,
        ),
      );
    }

    if (!Number.isFinite(item.submitted_at_ms) || item.submitted_at_ms <= 0) {
      issues.push(
        issue(
          "INVALID_SUBMITTED_AT",
          "evidence.submitted_at_ms",
          `Invalid submitted_at_ms for ${item.evidence_id}.`,
        ),
      );
    }
  }

  for (const finding of packet.findings) {
    if (!finding.finding_id.trim()) {
      issues.push(issue("EMPTY_FINDING_ID", "findings.finding_id", "Finding id cannot be empty."));
    }

    if (!finding.issue_id.trim()) {
      issues.push(
        issue("EMPTY_ISSUE_ID", "findings.issue_id", "Finding issue id cannot be empty."),
      );
    }

    if (finding.source_evidence_ids.length === 0) {
      issues.push(
        issue(
          "EMPTY_FINDING_SOURCES",
          "findings.source_evidence_ids",
          `Finding ${finding.finding_id} must cite at least one evidence source.`,
        ),
      );
    }

    for (const sourceEvidenceId of finding.source_evidence_ids) {
      if (!evidenceIds.has(sourceEvidenceId)) {
        issues.push(
          issue(
            "UNKNOWN_FINDING_SOURCE",
            "findings.source_evidence_ids",
            `Unknown finding source: ${sourceEvidenceId}`,
          ),
        );
      }
    }
  }

  if (options.verifyHash) {
    const expectedHash = computeHnpDisputeEvidencePacketHash({
      agreement_id: packet.agreement_id,
      agreement_hash: packet.agreement_hash,
      reason: packet.reason,
      requested_resolution: packet.requested_resolution,
      requested_adjustment: packet.requested_adjustment,
      evidence: packet.evidence,
      findings: packet.findings,
      created_at_ms: packet.created_at_ms,
    });
    if (packet.packet_hash !== expectedHash) {
      issues.push(
        issue(
          "HASH_MISMATCH",
          "packet_hash",
          "Dispute evidence packet hash does not match packet contents.",
        ),
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}

export function isHnpDigitalDisputeEvidenceKind(
  kind: string,
): kind is HnpDigitalDisputeEvidenceKind {
  return (HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

export function isHnpDisputeEvidenceKind(kind: string): kind is HnpDisputeEvidenceKind {
  return (HNP_DISPUTE_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

function isSupportedDisputeEvidenceKind(kind: string): kind is HnpDisputeEvidenceKind {
  return isHnpDisputeEvidenceKind(kind);
}

function issue(
  code: HnpDisputeEvidencePacketIssue["code"],
  field: string,
  message: string,
): HnpDisputeEvidencePacketIssue {
  return { code, field, message };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(record[key]);
      return acc;
    }, {});
}

// ---------------------------------------------------------------------------
// Digital evidence content validation (C1)
// ---------------------------------------------------------------------------

const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ETH_TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
/** Access grant URI: http(s), ipfs, or haggle scheme with non-space body. */
const ACCESS_URI_RE = /^(https?:\/\/|ipfs:\/\/|haggle:\/\/)\S+$/i;
const PLATFORM_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const LICENSE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECEIPT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CHAIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type HnpDigitalAccessContent = {
  access_uri: string;
};

export type HnpDigitalFileHashContent = {
  file_hash: string;
};

export type HnpLicenseTermsContent = {
  license_id: string;
  terms_hash?: string;
};

export type HnpPlatformTransferContent = {
  platform: string;
  receipt_id: string;
};

export type HnpOnchainTransferContent = {
  address: string;
  tx_hash?: string;
  chain?: string;
};

export type HnpDigitalDisputeEvidenceContent =
  | HnpDigitalAccessContent
  | HnpDigitalFileHashContent
  | HnpLicenseTermsContent
  | HnpPlatformTransferContent
  | HnpOnchainTransferContent;

export type HnpDigitalDisputeEvidenceContentIssueCode =
  | "UNSUPPORTED_EVIDENCE_KIND"
  | "MISSING_CONTENT"
  | "INVALID_ACCESS_URI"
  | "INVALID_FILE_HASH"
  | "INVALID_LICENSE_ID"
  | "INVALID_TERMS_HASH"
  | "INVALID_PLATFORM"
  | "INVALID_RECEIPT_ID"
  | "INVALID_ONCHAIN_ADDRESS"
  | "INVALID_TX_HASH"
  | "INVALID_CHAIN";

export interface HnpDigitalDisputeEvidenceContentIssue {
  code: HnpDigitalDisputeEvidenceContentIssueCode;
  field: string;
  message: string;
}

export type HnpDigitalDisputeEvidenceContentValidationResult =
  | { ok: true; kind: HnpDigitalDisputeEvidenceKind; content: HnpDigitalDisputeEvidenceContent }
  | { ok: false; issues: HnpDigitalDisputeEvidenceContentIssue[] };

function contentIssue(
  code: HnpDigitalDisputeEvidenceContentIssueCode,
  field: string,
  message: string,
): HnpDigitalDisputeEvidenceContentIssue {
  return { code, field, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record) || record[key] === undefined || record[key] === null) return undefined;
  return typeof record[key] === "string" ? (record[key] as string).trim() : "";
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; value: string } {
  const raw = record[key];
  if (typeof raw !== "string") return { ok: false, value: "" };
  const value = raw.trim();
  if (!value) return { ok: false, value: "" };
  return { ok: true, value };
}

/**
 * Format validators for Phase 4 digital dispute evidence content.
 * Rejects non-digital kinds (including `card_pan`) — category allowlist is separate.
 */
export function validateDigitalDisputeEvidenceContent(input: {
  kind: string;
  content: unknown;
}): HnpDigitalDisputeEvidenceContentValidationResult {
  const kind = typeof input.kind === "string" ? input.kind.trim() : "";
  if (!isHnpDigitalDisputeEvidenceKind(kind)) {
    return {
      ok: false,
      issues: [
        contentIssue(
          "UNSUPPORTED_EVIDENCE_KIND",
          "kind",
          `Digital content validation only accepts: ${HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS.join(", ")}`,
        ),
      ],
    };
  }

  const record = asRecord(input.content);
  if (!record) {
    return {
      ok: false,
      issues: [
        contentIssue("MISSING_CONTENT", "content", "Digital evidence content object is required."),
      ],
    };
  }

  switch (kind) {
    case "digital_access": {
      const accessUri = readRequiredString(record, "access_uri");
      if (!accessUri.ok || !ACCESS_URI_RE.test(accessUri.value)) {
        return {
          ok: false,
          issues: [
            contentIssue(
              "INVALID_ACCESS_URI",
              "content.access_uri",
              "digital_access requires access_uri with https://, http://, ipfs://, or haggle:// scheme.",
            ),
          ],
        };
      }
      return { ok: true, kind, content: { access_uri: accessUri.value } };
    }
    case "digital_file_hash": {
      const fileHash = readRequiredString(record, "file_hash");
      if (!fileHash.ok || !SHA256_DIGEST_RE.test(fileHash.value)) {
        return {
          ok: false,
          issues: [
            contentIssue(
              "INVALID_FILE_HASH",
              "content.file_hash",
              "digital_file_hash requires file_hash as sha256:<64 lowercase hex>.",
            ),
          ],
        };
      }
      return { ok: true, kind, content: { file_hash: fileHash.value } };
    }
    case "license_terms": {
      const issues: HnpDigitalDisputeEvidenceContentIssue[] = [];
      const licenseId = readRequiredString(record, "license_id");
      if (!licenseId.ok || !LICENSE_ID_RE.test(licenseId.value)) {
        issues.push(
          contentIssue(
            "INVALID_LICENSE_ID",
            "content.license_id",
            "license_terms requires a non-empty license_id (alphanumeric, . _ : -).",
          ),
        );
      }
      const termsHash = readOptionalString(record, "terms_hash");
      if (termsHash !== undefined && !SHA256_DIGEST_RE.test(termsHash)) {
        issues.push(
          contentIssue(
            "INVALID_TERMS_HASH",
            "content.terms_hash",
            "license_terms.terms_hash must be sha256:<64 lowercase hex> when provided.",
          ),
        );
      }
      if (issues.length > 0) return { ok: false, issues };
      const content: HnpLicenseTermsContent = { license_id: licenseId.value };
      if (termsHash) content.terms_hash = termsHash;
      return { ok: true, kind, content };
    }
    case "platform_transfer": {
      const issues: HnpDigitalDisputeEvidenceContentIssue[] = [];
      const platform = readRequiredString(record, "platform");
      if (!platform.ok || !PLATFORM_SLUG_RE.test(platform.value)) {
        issues.push(
          contentIssue(
            "INVALID_PLATFORM",
            "content.platform",
            "platform_transfer requires platform slug (alphanumeric, . _ -).",
          ),
        );
      }
      const receiptId = readRequiredString(record, "receipt_id");
      if (!receiptId.ok || !RECEIPT_ID_RE.test(receiptId.value)) {
        issues.push(
          contentIssue(
            "INVALID_RECEIPT_ID",
            "content.receipt_id",
            "platform_transfer requires receipt_id (alphanumeric, . _ : -).",
          ),
        );
      }
      if (issues.length > 0) return { ok: false, issues };
      return {
        ok: true,
        kind,
        content: { platform: platform.value, receipt_id: receiptId.value },
      };
    }
    case "onchain_transfer": {
      const issues: HnpDigitalDisputeEvidenceContentIssue[] = [];
      const address = readRequiredString(record, "address");
      if (!address.ok || !ETH_ADDRESS_RE.test(address.value)) {
        issues.push(
          contentIssue(
            "INVALID_ONCHAIN_ADDRESS",
            "content.address",
            "onchain_transfer requires address as 0x + 40 hex characters.",
          ),
        );
      }
      const txHash = readOptionalString(record, "tx_hash");
      if (txHash !== undefined && !ETH_TX_HASH_RE.test(txHash)) {
        issues.push(
          contentIssue(
            "INVALID_TX_HASH",
            "content.tx_hash",
            "onchain_transfer.tx_hash must be 0x + 64 hex characters when provided.",
          ),
        );
      }
      const chain = readOptionalString(record, "chain");
      if (chain !== undefined && !CHAIN_ID_RE.test(chain)) {
        issues.push(
          contentIssue(
            "INVALID_CHAIN",
            "content.chain",
            "onchain_transfer.chain must be a non-empty chain id slug when provided.",
          ),
        );
      }
      if (issues.length > 0) return { ok: false, issues };
      const content: HnpOnchainTransferContent = { address: address.value };
      if (txHash) content.tx_hash = txHash;
      if (chain) content.chain = chain;
      return { ok: true, kind, content };
    }
    default: {
      const _exhaustive: never = kind;
      return {
        ok: false,
        issues: [
          contentIssue(
            "UNSUPPORTED_EVIDENCE_KIND",
            "kind",
            `Unhandled digital kind: ${String(_exhaustive)}`,
          ),
        ],
      };
    }
  }
}
