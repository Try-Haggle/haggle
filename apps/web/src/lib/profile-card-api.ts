import { api } from "./api-client";

export type TrustCardRole = "buyer" | "seller" | "combined";
export type TrustCardStatus = "NEW" | "SCORING" | "MATURE";

export interface TrustCardComponents {
  completionRate: number | null;
  disputeRate: number | null;
  slaCompliance: number | null;
  peerRating: number | null;
  autoConfirmRate: number | null;
}

export interface TrustCardSignals {
  walletVerified: boolean;
  emailVerified: boolean;
  activeListings: number;
  avgResponseMinutes: number | null;
}

export interface TrustCardDisputeMarker {
  show: boolean;
  activeCount: number;
  recentRatio: number | null;
}

export interface TrustCardData {
  actorId: string;
  role: TrustCardRole;
  status: TrustCardStatus;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  score: number | null;
  completedDeals: number;
  components: TrustCardComponents | null;
  signals: TrustCardSignals;
  disputeMarker: TrustCardDisputeMarker;
}

export interface PenaltyHistoryItem {
  id: string;
  reason: string;
  penaltyScore: number;
  createdAt: string;
}

export async function fetchProfileCard(
  actorId: string,
  role: TrustCardRole = "seller",
): Promise<TrustCardData> {
  const data = await api.get<{ profile_card: TrustCardData }>(
    `/sellers/${actorId}/profile-card?role=${role}`,
  );
  return data.profile_card;
}

export async function fetchProfileCardsBatch(
  actorIds: string[],
  role: TrustCardRole = "seller",
): Promise<Record<string, TrustCardData>> {
  if (actorIds.length === 0) return {};
  const data = await api.post<{ profile_cards: Record<string, TrustCardData> }>(
    `/sellers/profile-cards`,
    { actorIds, role },
  );
  return data.profile_cards;
}

export async function fetchPenaltyHistory(): Promise<PenaltyHistoryItem[]> {
  const data = await api.get<{ penalty_history: PenaltyHistoryItem[] }>(
    `/me/penalty-history`,
  );
  return data.penalty_history;
}
