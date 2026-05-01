import { sql, type Database } from "@haggle/db";

type BuddyRarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "MYTHIC";
type MemoryEligibilityReason =
  | "legendary_buddy_trade_threshold"
  | "mythic_buddy_trade_threshold"
  | "reviewer_trade_threshold"
  | "subscription"
  | "manual"
  | "not_eligible";

export interface EvermemoEligibilityThresholds {
  monthlyTradeCount: number;
  reviewerParticipationCount: number;
}

export interface EvaluateEvermemoEligibilityInput {
  userId: string;
  monthlyTradeCount: number;
  reviewerParticipationCount?: number;
  subscriptionActive?: boolean;
  manualEligible?: boolean;
  buddy?: {
    id?: string;
    rarity?: BuddyRarity | string | null;
  };
  thresholds?: Partial<EvermemoEligibilityThresholds>;
  sourcePayload?: Record<string, unknown>;
}

export interface EvermemoEligibilityDecision {
  eligible: boolean;
  reason: MemoryEligibilityReason;
}

export interface RecordEvermemoEligibilityResult extends EvermemoEligibilityDecision {
  recorded: boolean;
}

export const DEFAULT_EVERMEMO_ELIGIBILITY_THRESHOLDS: EvermemoEligibilityThresholds = {
  monthlyTradeCount: 4,
  reviewerParticipationCount: 3,
};

export function evaluateEvermemoEligibility(
  input: EvaluateEvermemoEligibilityInput,
): EvermemoEligibilityDecision {
  const thresholds = {
    ...DEFAULT_EVERMEMO_ELIGIBILITY_THRESHOLDS,
    ...input.thresholds,
  };
  const rarity = input.buddy?.rarity;

  if (input.manualEligible) {
    return { eligible: true, reason: "manual" };
  }

  if (input.subscriptionActive) {
    return { eligible: true, reason: "subscription" };
  }

  if (rarity === "MYTHIC" && input.monthlyTradeCount >= thresholds.monthlyTradeCount) {
    return { eligible: true, reason: "mythic_buddy_trade_threshold" };
  }

  if (rarity === "LEGENDARY" && input.monthlyTradeCount >= thresholds.monthlyTradeCount) {
    return { eligible: true, reason: "legendary_buddy_trade_threshold" };
  }

  if (
    (input.reviewerParticipationCount ?? 0) >= thresholds.reviewerParticipationCount
    && input.monthlyTradeCount >= thresholds.monthlyTradeCount
  ) {
    return { eligible: true, reason: "reviewer_trade_threshold" };
  }

  return { eligible: false, reason: "not_eligible" };
}

export async function recordEvermemoEligibilitySnapshot(
  db: Database,
  input: EvaluateEvermemoEligibilityInput,
): Promise<RecordEvermemoEligibilityResult> {
  const decision = evaluateEvermemoEligibility(input);
  const thresholds = {
    ...DEFAULT_EVERMEMO_ELIGIBILITY_THRESHOLDS,
    ...input.thresholds,
  };

  try {
    await db.execute(sql`
      INSERT INTO memory_eligibility_snapshots (
        user_id,
        eligible,
        reason,
        buddy_id,
        buddy_rarity,
        monthly_trade_count,
        reviewer_participation_count,
        subscription_active,
        source_payload,
        evaluated_at,
        expires_at
      )
      VALUES (
        ${input.userId},
        ${decision.eligible},
        ${decision.reason},
        ${input.buddy?.id ?? null},
        ${input.buddy?.rarity ?? null},
        ${input.monthlyTradeCount},
        ${input.reviewerParticipationCount ?? 0},
        ${input.subscriptionActive === true},
        ${JSON.stringify({
          ...input.sourcePayload,
          thresholds,
          manualEligible: input.manualEligible === true,
        })}::jsonb,
        NOW(),
        NOW() + INTERVAL '30 days'
      )
    `);

    return { ...decision, recorded: true };
  } catch (err) {
    console.error("[evermemo-eligibility] failed to record snapshot:", (err as Error).message);
    return { ...decision, recorded: false };
  }
}
