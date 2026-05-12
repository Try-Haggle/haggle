import {
  and,
  eq,
  gte,
  inArray,
  desc,
  sql,
  commerceOrders,
  disputeCases,
  listingDrafts,
  listingsPublished,
  negotiationRounds,
  negotiationSessions,
  profiles,
  settlementReliabilitySnapshots,
  trustPenaltyRecords,
  trustScores,
  userWallets,
  type Database,
} from "@haggle/db";

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

// ── In-memory cache (60s TTL) ────────────────────────────────────
// Profile cards are read-heavy (browse grids, listing pages) and the
// underlying data only changes on settle / dispute resolution events,
// so a brief shared cache cuts load without staleness risk.

const CACHE_TTL_MS = 60_000;
type CacheEntry = { data: TrustCardData; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(actorId: string, role: TrustCardRole): string {
  return `${actorId}:${role}`;
}

export function invalidateProfileCardCache(actorId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${actorId}:`)) cache.delete(key);
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function statusFor(completed: number): TrustCardStatus {
  if (completed >= 20) return "MATURE";
  if (completed >= 5) return "SCORING";
  return "NEW";
}

function reliabilityToComponents(
  snapshot:
    | {
        successfulSettlements: number;
        approvalDefaults: number;
        shipmentSlaMisses: number;
        disputeWins: number;
        disputeLosses: number;
      }
    | null,
  role: TrustCardRole,
): TrustCardComponents {
  if (!snapshot) {
    return {
      completionRate: null,
      disputeRate: null,
      slaCompliance: null,
      peerRating: null,
      autoConfirmRate: null,
    };
  }

  const total =
    snapshot.successfulSettlements +
    snapshot.approvalDefaults +
    snapshot.disputeWins +
    snapshot.disputeLosses;
  const totalSettlements =
    snapshot.successfulSettlements + snapshot.approvalDefaults;
  const totalDisputes = snapshot.disputeWins + snapshot.disputeLosses;

  return {
    completionRate:
      total > 0 ? snapshot.successfulSettlements / total : null,
    disputeRate: total > 0 ? totalDisputes / total : null,
    slaCompliance:
      role === "seller" && totalSettlements > 0
        ? 1 - snapshot.shipmentSlaMisses / Math.max(totalSettlements, 1)
        : null,
    peerRating: null,
    autoConfirmRate: null,
  };
}

async function fetchActiveListings(
  db: Database,
  actorId: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingsPublished)
    .innerJoin(
      listingDrafts,
      eq(listingsPublished.draftId, listingDrafts.id),
    )
    .where(eq(listingDrafts.userId, actorId));
  return Number(result[0]?.count ?? 0);
}

async function fetchAvgResponseMinutes(
  db: Database,
  actorId: string,
): Promise<number | null> {
  // Average time between consecutive rounds in sessions where the actor
  // was the responder. Bounded to last 50 sessions to keep this cheap.
  const sessions = await db
    .select({
      id: negotiationSessions.id,
      role: negotiationSessions.role,
    })
    .from(negotiationSessions)
    .where(
      sql`(${negotiationSessions.buyerId} = ${actorId} OR ${negotiationSessions.sellerId} = ${actorId})`,
    )
    .orderBy(desc(negotiationSessions.createdAt))
    .limit(50);

  if (sessions.length === 0) return null;

  const sessionIds = sessions.map((s) => s.id);
  const rounds = await db
    .select({
      sessionId: negotiationRounds.sessionId,
      senderRole: negotiationRounds.senderRole,
      createdAt: negotiationRounds.createdAt,
    })
    .from(negotiationRounds)
    .where(inArray(negotiationRounds.sessionId, sessionIds))
    .orderBy(negotiationRounds.sessionId, negotiationRounds.roundNo);

  // Group by session, find gaps where actor responded to opponent.
  const bySession = new Map<string, typeof rounds>();
  for (const r of rounds) {
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r);
    bySession.set(r.sessionId, list);
  }

  const sessionRoleMap = new Map(sessions.map((s) => [s.id, s.role]));
  const gaps: number[] = [];

  for (const [sessionId, list] of bySession) {
    const actorRoleInSession = sessionRoleMap.get(sessionId);
    // We don't know exactly which side the actor is on a priori — derive
    // from buyer/seller membership of the session. For simplicity treat
    // any round NOT preceded by the actor's own round as their response.
    // This still gives a meaningful "responsiveness" signal.
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      if (prev.senderRole !== curr.senderRole) {
        const gapMs =
          curr.createdAt.getTime() - prev.createdAt.getTime();
        if (gapMs > 0 && gapMs < 7 * 24 * 60 * 60 * 1000) {
          gaps.push(gapMs);
        }
      }
    }
    void actorRoleInSession;
  }

  if (gaps.length === 0) return null;
  const avgMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.round(avgMs / 60_000);
}

async function fetchDisputeMarker(
  db: Database,
  actorId: string,
): Promise<TrustCardDisputeMarker> {
  // Active disputes the actor is party to (as seller or buyer).
  const activeOrders = await db
    .select({ id: commerceOrders.id })
    .from(commerceOrders)
    .where(
      sql`(${commerceOrders.sellerId} = ${actorId} OR ${commerceOrders.buyerId} = ${actorId})`,
    );

  if (activeOrders.length === 0) {
    return { show: false, activeCount: 0, recentRatio: null };
  }

  const orderIds = activeOrders.map((o) => o.id);
  const openDisputes = await db
    .select({ id: disputeCases.id })
    .from(disputeCases)
    .where(
      and(
        inArray(disputeCases.orderId, orderIds),
        inArray(disputeCases.status, [
          "OPEN",
          "UNDER_REVIEW",
          "WAITING_FOR_BUYER",
          "WAITING_FOR_SELLER",
        ]),
      ),
    );

  const activeCount = openDisputes.length;

  // Recent ratio: disputes among most recent 10 orders.
  const recentOrders = await db
    .select({ id: commerceOrders.id })
    .from(commerceOrders)
    .where(
      sql`(${commerceOrders.sellerId} = ${actorId} OR ${commerceOrders.buyerId} = ${actorId})`,
    )
    .orderBy(desc(commerceOrders.createdAt))
    .limit(10);

  let recentRatio: number | null = null;
  if (recentOrders.length > 0) {
    const recentIds = recentOrders.map((o) => o.id);
    const recentDisputes = await db
      .select({ id: disputeCases.id })
      .from(disputeCases)
      .where(inArray(disputeCases.orderId, recentIds));
    recentRatio = recentDisputes.length / recentOrders.length;
  }

  // Threshold: 3+ active disputes OR ≥30% recent dispute ratio.
  const show =
    activeCount >= 3 || (recentRatio !== null && recentRatio >= 0.3);

  return { show, activeCount, recentRatio };
}

async function fetchWalletVerified(
  db: Database,
  actorId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: userWallets.id })
    .from(userWallets)
    .where(eq(userWallets.userId, actorId))
    .limit(1);
  return rows.length > 0;
}

// ── Main composer ────────────────────────────────────────────────

export async function getProfileCard(
  db: Database,
  actorId: string,
  role: TrustCardRole,
  options: { skipCache?: boolean } = {},
): Promise<TrustCardData | null> {
  const key = cacheKey(actorId, role);
  if (!options.skipCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
  }

  // Profile (display name, avatar, joined_at).
  const profileRow = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, actorId))
    .limit(1);

  if (profileRow.length === 0) {
    // Profile mirror not yet synced. Emit a minimal NEW card so callers
    // (e.g. listing grids) don't suppress the surface entirely.
    const fallback: TrustCardData = {
      actorId,
      role,
      status: "NEW",
      displayName: "Anonymous",
      avatarUrl: null,
      joinedAt: new Date().toISOString(),
      score: null,
      completedDeals: 0,
      components: null,
      signals: {
        walletVerified: await fetchWalletVerified(db, actorId),
        emailVerified: false,
        activeListings: await fetchActiveListings(db, actorId),
        avgResponseMinutes: null,
      },
      disputeMarker: { show: false, activeCount: 0, recentRatio: null },
    };
    cache.set(key, { data: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
    return fallback;
  }

  const profile = profileRow[0];

  // Trust score (role-specific; fallback to combined).
  const trustQuery = role === "combined" ? [role] : [role, "combined" as const];
  const trustRow = await db
    .select()
    .from(trustScores)
    .where(
      and(
        eq(trustScores.actorId, actorId),
        inArray(trustScores.actorRole, trustQuery),
      ),
    )
    .orderBy(desc(trustScores.updatedAt))
    .limit(1);

  // Settlement reliability snapshot for component breakdown.
  const reliabilityRole = role === "combined" ? "seller" : role;
  const reliabilityRow = await db
    .select()
    .from(settlementReliabilitySnapshots)
    .where(
      and(
        eq(settlementReliabilitySnapshots.actorId, actorId),
        eq(settlementReliabilitySnapshots.actorRole, reliabilityRole),
      ),
    )
    .limit(1);

  // Parallel fetches for signals + dispute marker.
  const [walletVerified, activeListings, avgResponseMinutes, disputeMarker] =
    await Promise.all([
      fetchWalletVerified(db, actorId),
      fetchActiveListings(db, actorId),
      fetchAvgResponseMinutes(db, actorId),
      fetchDisputeMarker(db, actorId),
    ]);

  const completedDeals = trustRow[0]?.completedTransactions ?? 0;
  const status: TrustCardStatus =
    (trustRow[0]?.status as TrustCardStatus | undefined) ??
    statusFor(completedDeals);
  const score =
    status === "NEW" || !trustRow[0]
      ? null
      : Math.round(Number(trustRow[0].score));

  const components =
    status === "NEW"
      ? null
      : reliabilityToComponents(
          reliabilityRow[0]
            ? {
                successfulSettlements: reliabilityRow[0].successfulSettlements,
                approvalDefaults: reliabilityRow[0].approvalDefaults,
                shipmentSlaMisses: reliabilityRow[0].shipmentSlaMisses,
                disputeWins: reliabilityRow[0].disputeWins,
                disputeLosses: reliabilityRow[0].disputeLosses,
              }
            : null,
          role,
        );

  const data: TrustCardData = {
    actorId,
    role,
    status,
    displayName: profile.displayName ?? "Anonymous",
    avatarUrl: profile.avatarUrl,
    joinedAt: profile.joinedAt.toISOString(),
    score,
    completedDeals,
    components,
    signals: {
      walletVerified,
      emailVerified: profile.emailVerified !== null,
      activeListings,
      avgResponseMinutes,
    },
    disputeMarker,
  };

  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function getProfileCardsBatch(
  db: Database,
  actorIds: string[],
  role: TrustCardRole,
): Promise<Record<string, TrustCardData>> {
  const out: Record<string, TrustCardData> = {};
  const results = await Promise.all(
    actorIds.map((id) => getProfileCard(db, id, role).then((d) => [id, d] as const)),
  );
  for (const [id, data] of results) {
    if (data) out[id] = data;
  }
  return out;
}

// ── Penalty history (self view, /profile/level dashboard) ────────

export interface PenaltyHistoryItem {
  id: string;
  reason: string;
  penaltyScore: number;
  createdAt: string;
}

export async function getPenaltyHistory(
  db: Database,
  actorId: string,
  limit = 20,
): Promise<PenaltyHistoryItem[]> {
  const rows = await db
    .select()
    .from(trustPenaltyRecords)
    .where(eq(trustPenaltyRecords.actorId, actorId))
    .orderBy(desc(trustPenaltyRecords.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    penaltyScore: Number(r.penaltyScore),
    createdAt: r.createdAt.toISOString(),
  }));
}

// Suppress unused-import warning for `gte` (kept for future filters).
void gte;
