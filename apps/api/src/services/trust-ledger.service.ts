import {
  computeSettlementReliability,
  resolveTrustPenaltyReason,
  trustPenaltyScore,
  type TrustTriggerEvent,
} from "@haggle/commerce-core";
import {
  eq,
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

async function getSnapshot(db: Database, actorId: string, actorRole: ActorRole) {
  const existing = await db.query.settlementReliabilitySnapshots.findFirst({
    where: (fields, ops) => ops.and(ops.eq(fields.actorId, actorId), ops.eq(fields.actorRole, actorRole)),
  });
  return existing ?? null;
}

async function getOnchainProfile(db: Database, actorId: string) {
  const existing = await db.query.onchainTrustProfiles.findFirst({
    where: (fields, ops) => ops.eq(fields.actorId, actorId),
  });
  return existing ?? null;
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

    const snapshot = await getSnapshot(db, actorId, trigger.actor_role);
    const next = {
      actor_id: actorId,
      actor_role: trigger.actor_role,
      successful_settlements: snapshot?.successfulSettlements ?? 0,
      approval_defaults: snapshot?.approvalDefaults ?? 0,
      shipment_sla_misses: snapshot?.shipmentSlaMisses ?? 0,
      dispute_wins: snapshot?.disputeWins ?? 0,
      dispute_losses: snapshot?.disputeLosses ?? 0,
    };

    switch (trigger.type) {
      case "successful_settlement":
        next.successful_settlements += 1;
        break;
      case "buyer_approved_but_not_paid":
      case "seller_approved_but_not_fulfilled":
        next.approval_defaults += 1;
        break;
      case "shipment_input_sla_missed":
        next.shipment_sla_misses += 1;
        break;
      case "dispute_win":
        next.dispute_wins += 1;
        break;
      case "dispute_loss":
        next.dispute_losses += 1;
        break;
    }

    const reliability = computeSettlementReliability({
      actor_id: next.actor_id,
      actor_role: next.actor_role,
      successful_settlements: next.successful_settlements,
      approval_defaults: next.approval_defaults,
      shipment_sla_misses: next.shipment_sla_misses,
      dispute_wins: next.dispute_wins,
      dispute_losses: next.dispute_losses,
    });

    if (snapshot) {
      await db
        .update(settlementReliabilitySnapshots)
        .set({
          successfulSettlements: next.successful_settlements,
          approvalDefaults: next.approval_defaults,
          shipmentSlaMisses: next.shipment_sla_misses,
          disputeWins: next.dispute_wins,
          disputeLosses: next.dispute_losses,
          settlementReliability: String(reliability),
          updatedAt: new Date(),
        })
        .where(eq(settlementReliabilitySnapshots.id, snapshot.id));
    } else {
      await db.insert(settlementReliabilitySnapshots).values({
        actorId,
        actorRole: trigger.actor_role,
        successfulSettlements: next.successful_settlements,
        approvalDefaults: next.approval_defaults,
        shipmentSlaMisses: next.shipment_sla_misses,
        disputeWins: next.dispute_wins,
        disputeLosses: next.dispute_losses,
        settlementReliability: String(reliability),
      });
    }

    const profile = await getOnchainProfile(db, actorId);
    if (profile) {
      await db
        .update(onchainTrustProfiles)
        .set({
          settlementReliability: String(reliability),
          successfulSettlements: next.successful_settlements,
          approvalDefaults: next.approval_defaults,
          shipmentSlaMisses: next.shipment_sla_misses,
          disputeWins: next.dispute_wins,
          disputeLosses: next.dispute_losses,
          reputationScore: profile.reputationScore,
          updatedAt: new Date(),
        })
        .where(eq(onchainTrustProfiles.id, profile.id));
    } else {
      await db.insert(onchainTrustProfiles).values({
        actorId,
        reputationScore: String(reliability),
        settlementReliability: String(reliability),
        successfulSettlements: next.successful_settlements,
        approvalDefaults: next.approval_defaults,
        shipmentSlaMisses: next.shipment_sla_misses,
        disputeWins: next.dispute_wins,
        disputeLosses: next.dispute_losses,
      });
    }
  }
}
