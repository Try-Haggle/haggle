import { describe, expect, it } from "vitest";
import {
  HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS,
  validateDigitalDisputeEvidenceContent,
} from "../src/index.js";

const VALID_FILE_HASH = `sha256:${"a".repeat(64)}`;
const VALID_TERMS_HASH = `sha256:${"b".repeat(64)}`;
const VALID_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const VALID_TX = `0x${"c".repeat(64)}`;

/** Golden table: valid content per digital kind. */
const VALID_GOLDENS = [
  {
    kind: "digital_access" as const,
    content: { access_uri: "https://example.com/grant/abc" },
    note: "https access grant",
  },
  {
    kind: "digital_access" as const,
    content: { access_uri: "ipfs://bafybeigoldenaccess" },
    note: "ipfs access grant",
  },
  {
    kind: "digital_file_hash" as const,
    content: { file_hash: VALID_FILE_HASH },
    note: "sha256 file hash",
  },
  {
    kind: "license_terms" as const,
    content: { license_id: "lic-2026-09-06", terms_hash: VALID_TERMS_HASH },
    note: "license with terms hash",
  },
  {
    kind: "license_terms" as const,
    content: { license_id: "MIT-like-1" },
    note: "license id only",
  },
  {
    kind: "platform_transfer" as const,
    content: { platform: "github", receipt_id: "xfer_9f3a" },
    note: "github transfer receipt",
  },
  {
    kind: "onchain_transfer" as const,
    content: { address: VALID_ADDRESS, tx_hash: VALID_TX, chain: "base-sepolia" },
    note: "onchain address + tx",
  },
  {
    kind: "onchain_transfer" as const,
    content: { address: VALID_ADDRESS },
    note: "onchain address only",
  },
] as const;

/** Golden table: invalid content / rejected kinds (incl. card_pan). */
const INVALID_GOLDENS = [
  {
    kind: "card_pan",
    content: { pan: "4111111111111111" },
    code: "UNSUPPORTED_EVIDENCE_KIND" as const,
    note: "card_pan always rejected",
  },
  {
    kind: "payment_record",
    content: { ref: "pay_1" },
    code: "UNSUPPORTED_EVIDENCE_KIND" as const,
    note: "non-digital kind rejected by content validator",
  },
  {
    kind: "digital_access",
    content: { access_uri: "ftp://evil.example/grant" },
    code: "INVALID_ACCESS_URI" as const,
    note: "bad access scheme",
  },
  {
    kind: "digital_access",
    content: {},
    code: "INVALID_ACCESS_URI" as const,
    note: "missing access_uri",
  },
  {
    kind: "digital_file_hash",
    content: { file_hash: "sha256:deadbeef" },
    code: "INVALID_FILE_HASH" as const,
    note: "short file hash",
  },
  {
    kind: "digital_file_hash",
    content: { file_hash: `SHA256:${"a".repeat(64)}` },
    code: "INVALID_FILE_HASH" as const,
    note: "uppercase sha256 prefix rejected",
  },
  {
    kind: "license_terms",
    content: { license_id: "" },
    code: "INVALID_LICENSE_ID" as const,
    note: "empty license id",
  },
  {
    kind: "license_terms",
    content: { license_id: "ok", terms_hash: "not-a-hash" },
    code: "INVALID_TERMS_HASH" as const,
    note: "bad terms hash",
  },
  {
    kind: "platform_transfer",
    content: { platform: "GitHub!", receipt_id: "r1" },
    code: "INVALID_PLATFORM" as const,
    note: "bad platform slug",
  },
  {
    kind: "platform_transfer",
    content: { platform: "namecheap", receipt_id: "" },
    code: "INVALID_RECEIPT_ID" as const,
    note: "empty receipt id",
  },
  {
    kind: "onchain_transfer",
    content: { address: "0x1234" },
    code: "INVALID_ONCHAIN_ADDRESS" as const,
    note: "short address",
  },
  {
    kind: "onchain_transfer",
    content: { address: VALID_ADDRESS, tx_hash: "0xgg" },
    code: "INVALID_TX_HASH" as const,
    note: "bad tx hash",
  },
  {
    kind: "onchain_transfer",
    content: null,
    code: "MISSING_CONTENT" as const,
    note: "missing content object",
  },
] as const;

describe("C1 digital dispute evidence content goldens", () => {
  it("covers all five Phase 4 digital kinds in the valid golden set", () => {
    const kinds = new Set(VALID_GOLDENS.map((g) => g.kind));
    expect([...kinds].sort()).toEqual([...HNP_DIGITAL_DISPUTE_EVIDENCE_KINDS].sort());
  });

  it.each(VALID_GOLDENS)("accepts valid $kind ($note)", ({ kind, content }) => {
    const result = validateDigitalDisputeEvidenceContent({ kind, content });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe(kind);
      expect(result.content).toEqual(content);
    }
  });

  it.each(INVALID_GOLDENS)("rejects $kind ($note)", ({ kind, content, code }) => {
    const result = validateDigitalDisputeEvidenceContent({ kind, content });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === code)).toBe(true);
    }
  });
});
