/**
 * Dispute Event Handler
 *
 * Processes events from the DisputeRegistry contract and reconciles
 * on-chain state with the database. Each handler is idempotent.
 *
 * Events handled:
 * - DisputeAnchored — update dispute_cases metadata with anchor_id, tx_hash
 * - AnchorRevoked — mark anchor as revoked in metadata
 */

import {
  type Database,
  disputeCases,
  eq,
} from "@haggle/db";
import type { Log } from "viem";

// ── Types ───────────────────────────────────────────────────────

interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
}

// ── Handler ─────────────────────────────────────────────────────

export async function handleDisputeEvent(
  db: Database,
  log: Log,
  event: DecodedEvent,
): Promise<void> {
  const txHash = log.transactionHash ?? "unknown";

  switch (event.eventName) {
    case "DisputeAnchored":
      await handleDisputeAnchored(db, txHash, event.args);
      break;

    case "AnchorRevoked":
      await handleAnchorRevoked(db, txHash, event.args);
      break;

    default:
      // Other events (ResolverGranted, AnchorSuperseded, etc.) are logged but not acted on
      break;
  }
}

// ── DisputeAnchored ─────────────────────────────────────────────

async function handleDisputeAnchored(
  db: Database,
  txHash: string,
  args: Record<string, unknown>,
): Promise<void> {
  const anchorId = args.anchorId as string;
  const orderId = args.orderId as string;
  const disputeCaseId = args.disputeCaseId as string;
  const evidenceRootHash = args.evidenceRootHash as string;
  const resolutionHash = args.resolutionHash as string;

  // The on-chain disputeCaseId is a keccak256 hash of the DB UUID.
  // We need to search for dispute cases and check their metadata for existing anchors.
  const allCases = await db
    .select({
      id: disputeCases.id,
      metadata: disputeCases.metadata,
    })
    .from(disputeCases)
    .limit(200);

  for (const dc of allCases) {
    const meta = (dc.metadata ?? {}) as Record<string, unknown>;
    const anchors = (meta.onchain_anchors ?? []) as Array<Record<string, unknown>>;

    // Idempotency: check if this anchor is already recorded
    if (anchors.some((a) => a.anchor_id === anchorId)) {
      return;
    }
  }

  // Since we cannot reverse the keccak256 hash to a UUID, log the event.
  // In production, the dispute anchoring API should store the mapping
  // (disputeCaseId hash -> DB UUID) so we can update metadata here.
  //
  // For now, try to find cases that have a pending anchor in their metadata.
  for (const dc of allCases) {
    const meta = (dc.metadata ?? {}) as Record<string, unknown>;

    // If the case has a pending_anchor_tx that matches, or no anchors yet and is under review
    if (meta.pending_anchor === true || meta.anchor_tx_hash === txHash) {
      const anchors = ((meta.onchain_anchors ?? []) as Array<Record<string, unknown>>).concat({
        anchor_id: anchorId,
        order_id: orderId,
        dispute_case_id: disputeCaseId,
        evidence_root_hash: evidenceRootHash,
        resolution_hash: resolutionHash,
        tx_hash: txHash,
        anchored_at: new Date().toISOString(),
      });

      await db
        .update(disputeCases)
        .set({
          metadata: {
            ...meta,
            onchain_anchors: anchors,
            pending_anchor: false,
            last_anchor_tx_hash: txHash,
          },
          updatedAt: new Date(),
        })
        .where(eq(disputeCases.id, dc.id));

      console.log(
        `[chain-listener] DisputeAnchored: updated case=${dc.id} anchorId=${anchorId} txHash=${txHash}`,
      );
      return;
    }
  }

  // No matching case found — log for investigation
  console.warn(
    `[chain-listener] WARNING: DisputeAnchored on-chain with no matching DB case. ` +
    `anchorId=${anchorId} orderId=${orderId} disputeCaseId=${disputeCaseId} txHash=${txHash}`,
  );
}

// ── AnchorRevoked ───────────────────────────────────────────────

async function handleAnchorRevoked(
  db: Database,
  txHash: string,
  args: Record<string, unknown>,
): Promise<void> {
  const anchorId = args.anchorId as string;
  const reason = (args.reason as string) ?? "revoked on-chain";

  // Search all dispute cases for one that has this anchor in metadata
  const allCases = await db
    .select({
      id: disputeCases.id,
      metadata: disputeCases.metadata,
    })
    .from(disputeCases)
    .limit(200);

  for (const dc of allCases) {
    const meta = (dc.metadata ?? {}) as Record<string, unknown>;
    const anchors = (meta.onchain_anchors ?? []) as Array<Record<string, unknown>>;

    const anchorIndex = anchors.findIndex((a) => a.anchor_id === anchorId);
    if (anchorIndex === -1) continue;

    // Idempotency: check if already marked as revoked
    if (anchors[anchorIndex]!.revoked === true) {
      return;
    }

    // Mark the anchor as revoked
    anchors[anchorIndex] = {
      ...anchors[anchorIndex]!,
      revoked: true,
      revoked_reason: reason,
      revoked_tx_hash: txHash,
      revoked_at: new Date().toISOString(),
    };

    await db
      .update(disputeCases)
      .set({
        metadata: {
          ...meta,
          onchain_anchors: anchors,
        },
        updatedAt: new Date(),
      })
      .where(eq(disputeCases.id, dc.id));

    console.log(
      `[chain-listener] AnchorRevoked: updated case=${dc.id} anchorId=${anchorId} reason="${reason}" txHash=${txHash}`,
    );
    return;
  }

  console.warn(
    `[chain-listener] WARNING: AnchorRevoked on-chain but no matching DB anchor found. ` +
    `anchorId=${anchorId} reason="${reason}" txHash=${txHash}`,
  );
}
