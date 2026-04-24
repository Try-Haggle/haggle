/**
 * On-chain Dispute Anchoring
 *
 * When a dispute is resolved, computes an evidence merkle root and
 * resolution hash, then anchors them on the DisputeRegistry contract
 * via the gas relayer. This provides a tamper-proof record of dispute
 * outcomes on Base L2.
 *
 * Design decisions:
 * - Merkle root of empty evidence = bytes32(0)
 * - Single evidence item: leaf is hashed, then paired with itself to
 *   produce the root (hash(leaf, leaf)) for consistency with the
 *   pairwise algorithm.
 * - Odd-count leaves: last leaf is duplicated before pairing.
 * - All hash inputs use abi.encodePacked for EVM compatibility.
 * - Anchoring is best-effort: failure is logged, never crashes the caller.
 *
 * Security:
 * - Relayer private key from env var only, never logged or exposed.
 * - Contract address from env var, graceful skip if missing.
 * - No user input in hash computation (server-side only from DB records).
 */

import {
  keccak256,
  encodePacked,
  encodeFunctionData,
  type Hex,
} from "viem";
import type {
  DisputeEvidence,
  DisputeResolution,
} from "@haggle/dispute-core";
import { HAGGLE_DISPUTE_REGISTRY_ABI } from "@haggle/contracts";
import { relayTransaction } from "../payments/gas-relayer.js";

// ── Constants ──────────────────────────────────────────────────────

const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// ── Evidence Merkle Root ───────────────────────────────────────────

/**
 * Compute a leaf hash for a single evidence item.
 * leaf = keccak256(abi.encodePacked(type, uri_or_text, created_at))
 */
function computeEvidenceLeaf(evidence: DisputeEvidence): Hex {
  const content = evidence.uri ?? evidence.text ?? "";
  return keccak256(
    encodePacked(
      ["string", "string", "string"],
      [evidence.type, content, evidence.created_at],
    ),
  );
}

/**
 * Hash two sibling nodes together.
 * Sorts them lexicographically before hashing to ensure deterministic ordering
 * regardless of insertion order (standard sorted-pair merkle tree).
 */
function hashPair(a: Hex, b: Hex): Hex {
  // Sort to make the tree order-independent for the same set of leaves
  const [left, right] = a <= b ? [a, b] : [b, a];
  return keccak256(
    encodePacked(["bytes32", "bytes32"], [left, right]),
  );
}

/**
 * Compute a merkle root from dispute evidence items.
 *
 * - Empty array -> bytes32(0)
 * - Single item -> hash(leaf, leaf) (paired with itself for consistency)
 * - Odd count -> last leaf duplicated before pairing
 * - Pairwise hash up to root
 */
export function computeEvidenceMerkleRoot(evidence: DisputeEvidence[]): Hex {
  if (evidence.length === 0) {
    return ZERO_BYTES32;
  }

  // Compute leaf hashes
  let level: Hex[] = evidence.map(computeEvidenceLeaf);

  // Single leaf case: pair with itself for consistency with pairwise algorithm
  if (level.length === 1) {
    return hashPair(level[0]!, level[0]!);
  }

  // Build tree bottom-up
  while (level.length > 1) {
    // If odd, duplicate the last element
    if (level.length % 2 !== 0) {
      level.push(level[level.length - 1]!);
    }

    const nextLevel: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      nextLevel.push(hashPair(level[i]!, level[i + 1]!));
    }
    level = nextLevel;
  }

  return level[0]!;
}

// ── Resolution Hash ────────────────────────────────────────────────

/**
 * Compute resolution hash.
 * keccak256(abi.encodePacked(outcome, refund_amount_minor_str, summary))
 *
 * Pure function: same inputs always produce the same hash.
 */
export function computeResolutionHash(resolution: DisputeResolution): Hex {
  const refundStr = String(resolution.refund_amount_minor ?? 0);
  return keccak256(
    encodePacked(
      ["string", "string", "string"],
      [resolution.outcome, refundStr, resolution.summary],
    ),
  );
}

// ── UUID to bytes32 ────────────────────────────────────────────────

/**
 * Convert a UUID string to bytes32 via keccak256.
 * Deterministic: same UUID always produces the same bytes32.
 */
export function uuidToBytes32(uuid: string): Hex {
  return keccak256(
    encodePacked(["string"], [uuid]),
  );
}

// ── On-chain Anchoring ─────────────────────────────────────────────

export interface AnchorResult {
  txHash: string;
  anchorId: string;
}

let missingEnvLoggedOnce = false;

/**
 * Anchor a resolved dispute on-chain via DisputeRegistry.anchorDispute().
 * Uses the gas relayer to submit the transaction.
 *
 * Returns { txHash, anchorId } on success, null on failure (graceful).
 * If contract not deployed (no address env var), returns null with a log.
 */
export async function anchorDisputeOnChain(params: {
  orderId: string;
  disputeCaseId: string;
  evidence: DisputeEvidence[];
  resolution: DisputeResolution;
}): Promise<AnchorResult | null> {
  // 1. Check env vars
  const registryAddress = process.env.DISPUTE_REGISTRY_ADDRESS;
  const relayerKey = process.env.HAGGLE_ROUTER_RELAYER_PRIVATE_KEY;

  if (!registryAddress) {
    if (!missingEnvLoggedOnce) {
      console.log(
        "[dispute-anchoring] DISPUTE_REGISTRY_ADDRESS not set — on-chain anchoring disabled",
      );
      missingEnvLoggedOnce = true;
    }
    return null;
  }

  if (!relayerKey) {
    if (!missingEnvLoggedOnce) {
      console.log(
        "[dispute-anchoring] HAGGLE_ROUTER_RELAYER_PRIVATE_KEY not set — on-chain anchoring disabled",
      );
      missingEnvLoggedOnce = true;
    }
    return null;
  }

  try {
    // 2. Compute hashes
    const evidenceRootHash = computeEvidenceMerkleRoot(params.evidence);
    const resolutionHash = computeResolutionHash(params.resolution);
    const orderIdBytes32 = uuidToBytes32(params.orderId);
    const disputeCaseIdBytes32 = uuidToBytes32(params.disputeCaseId);

    // 3. Encode function call
    const data = encodeFunctionData({
      abi: HAGGLE_DISPUTE_REGISTRY_ABI,
      functionName: "anchorDispute",
      args: [orderIdBytes32, disputeCaseIdBytes32, evidenceRootHash, resolutionHash],
    });

    // 4. Submit via gas relayer
    const relayResult = await relayTransaction({
      to: registryAddress,
      data,
    });

    // 5. Compute expected anchorId (matches contract: keccak256(orderId, disputeCaseId, evidenceRootHash, resolutionHash))
    const anchorId = keccak256(
      encodePacked(
        ["bytes32", "bytes32", "bytes32", "bytes32"],
        [orderIdBytes32, disputeCaseIdBytes32, evidenceRootHash, resolutionHash],
      ),
    );

    console.log(
      `[dispute-anchoring] Anchored dispute on-chain: orderId=${params.orderId} ` +
      `disputeCaseId=${params.disputeCaseId} txHash=${relayResult.txHash} ` +
      `anchorId=${anchorId} gasCost=$${relayResult.gasCostUsd}`,
    );

    return {
      txHash: relayResult.txHash,
      anchorId,
    };
  } catch (error) {
    // Anchoring is best-effort: log and return null
    console.error(
      "[dispute-anchoring] Failed to anchor dispute on-chain:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
