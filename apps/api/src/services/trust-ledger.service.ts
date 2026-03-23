import {
  computeSettlementReliability,
  resolveTrustPenaltyReason,
  trustPenaltyScore,
  type TrustTriggerEvent,
} from "@haggle/commerce-core";
import {
  eq,
  sql,
  and,
  onchainTrustProfiles,
  settlementReliabilitySnapshots,
  trustPenaltyRecords,
  type Database,
} from "@haggle/db";

type ActorRole = "buyer" | "seller";

interface TrustLedgerContext {
  order_id: string;
  buyer_id: string;
  seller_id: string;
  triggers: TrustTriggerEvent[];
}

function actorIdForRole(context: TrustLedgerContext, role: ActorRole): string {
  return role === "buyer" ? context.buyer_id : context.seller_id;
}

function columnForTriggerType(type: TrustTriggerEvent["type"]): string | null {
  switch (type) {
    case "successful_settlement":
      return "successful_settlements";
    case "buyer_approved_but_not_paid":
    case "seller_approved_but_not_fulfilled":
      return "approval_defaults";
    case "shipment_input_sla_missed":
      return "shipment_sla_misses";
    case "dispute_win":
      return "dispute_wins";
    case "dispute_loss":
      return "dispute_losses";
    default:
      return null;
  }
}

export async function applyTrustTriggers(db: Database, context: TrustLedgerContext) {
  for (const trigger of context.triggers) {
    const actorId = actorIdForRole(context, trigger.actor_role);
    const reason = resolveTrustPenaltyReason(trigger);

    if (reason) {
      await db.insert(trustPenaltyRecords).values({
        orderId: context.order_id,
        actorId,
        actorRole: trigger.actor_role,
        reason,
        penaltyScore: String(trustPenaltyScore(reason)),
        metadata: {
          module: trigger.module,
          trigger_type: trigger.type,
        },
      });
    }

    const col = columnForTriggerType(trigger.type);
    if (!col) continue;

    // Atomic upsert: use SQL INCREMENT to avoid read-modify-write race condition.
    // If no snapshot exists, insert with initial values. If it exists, increment atomically.
    const existing = await db.query.settlementReliabilitySnapshots.findFirst({
      where: (fields, ops) =>
        ops.and(ops.eq(fields.actorId, actorId), ops.eq(fields.actorRole, trigger.actor_role)),
    });

    if (existing) {
      // Atomic increment — avoids last-write-wins on concurrent triggers
      await db
        .update(settlementReliabilitySnapshots)
        .set({
          [col]: sql`${sql.identifier(col)} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(settlementReliabilitySnapshots.id, existing.id));

      // Re-read for reliability computation
      const updated = await db.query.settlementReliabilitySnapshots.findFirst({
        where: (fields, ops) => ops.eq(fields.id, existing.id),
      });

      if (updated) {
        const reliability = computeSettlementReliability({
          actor_id: actorId,
          actor_role: trigger.actor_role,
          successful_settlements: updated.successfulSettlements,
          approval_defaults: updated.approvalDefaults,
          shipment_sla_misses: updated.shipmentSlaMisses,
          dispute_wins: updated.disputeWins,
          dispute_losses: updated.disputeLosses,
        });

        await db
          .update(settlementReliabilitySnapshots)
          .set({ settlementReliability: String(reliability) })
          .where(eq(settlementReliabilitySnapshots.id, updated.id));
      }
    } else {
      const initial = {
        successful_settlements: 0,
        approval_defaults: 0,
        shipment_sla_misses: 0,
        dispute_wins: 0,
        dispute_losses: 0,
        [col.replace(/s$/, "").replace(/_/g, "_")]: 1,
      };
      // Map column name back to counter field
      const counters = {
        successful_settlements: col === "successful_settlements" ? 1 : 0,
        approval_defaults: col === "approval_defaults" ? 1 : 0,
        shipment_sla_misses: col === "shipment_sla_misses" ? 1 : 0,
        dispute_wins: col === "dispute_wins" ? 1 : 0,
        dispute_losses: col === "dispute_losses" ? 1 : 0,
      };

      const reliability = computeSettlementReliability({
        actor_id: actorId,
        actor_role: trigger.actor_role,
        ...counters,
      });

      await db.insert(settlementReliabilitySnapshots).values({
        actorId,
        actorRole: trigger.actor_role,
        successfulSettlements: counters.successful_settlements,
        approvalDefaults: counters.approval_defaults,
        shipmentSlaMisses: counters.shipment_sla_misses,
        disputeWins: counters.dispute_wins,
        disputeLosses: counters.dispute_losses,
        settlementReliability: String(reliability),
      });
    }

    // Update onchain trust profile
    const profile = await db.query.onchainTrustProfiles.findFirst({
      where: (fields, ops) => ops.eq(fields.actorId, actorId),
    });

    // Re-read the latest snapshot for profile sync
    const latestSnapshot = await db.query.settlementReliabilitySnapshots.findFirst({
      where: (fields, ops) =>
        ops.and(ops.eq(fields.actorId, actorId), ops.eq(fields.actorRole, trigger.actor_role)),
    });

    if (latestSnapshot) {
      const reliability = computeSettlementReliability({
        actor_id: actorId,
        actor_role: trigger.actor_role,
        successful_settlements: latestSnapshot.successfulSettlements,
        approval_defaults: latestSnapshot.approvalDefaults,
        shipment_sla_misses: latestSnapshot.shipmentSlaMisses,
        dispute_wins: latestSnapshot.disputeWins,
        dispute_losses: latestSnapshot.disputeLosses,
      });

      if (profile) {
        await db
          .update(onchainTrustProfiles)
          .set({
            settlementReliability: String(reliability),
            successfulSettlements: latestSnapshot.successfulSettlements,
            approvalDefaults: latestSnapshot.approvalDefaults,
            shipmentSlaMisses: latestSnapshot.shipmentSlaMisses,
            disputeWins: latestSnapshot.disputeWins,
            disputeLosses: latestSnapshot.disputeLosses,
            reputationScore: String(reliability),
            updatedAt: new Date(),
          })
          .where(eq(onchainTrustProfiles.id, profile.id));
      } else {
        await db.insert(onchainTrustProfiles).values({
          actorId,
          reputationScore: String(reliability),
          settlementReliability: String(reliability),
          successfulSettlements: latestSnapshot.successfulSettlements,
          approvalDefaults: latestSnapshot.approvalDefaults,
          shipmentSlaMisses: latestSnapshot.shipmentSlaMisses,
          disputeWins: latestSnapshot.disputeWins,
          disputeLosses: latestSnapshot.disputeLosses,
        });
      }
    }
  }
}
