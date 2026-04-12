import {
  eq,
  and,
  negotiationGroups,
  type Database,
} from "@haggle/db";

type GroupTopology = "1_BUYER_N_SELLERS" | "N_BUYERS_1_SELLER";
type GroupStatus = "ACTIVE" | "RESOLVED" | "EXPIRED" | "CANCELLED";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createGroup(
  db: Database,
  data: {
    topology: GroupTopology;
    anchorUserId: string;
    intentId?: string;
    maxSessions?: number;
  },
) {
  const [row] = await db
    .insert(negotiationGroups)
    .values({
      topology: data.topology,
      anchorUserId: data.anchorUserId,
      intentId: data.intentId,
      maxSessions: data.maxSessions,
    })
    .returning();

  return row;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getGroupById(db: Database, groupId: string) {
  const rows = await db
    .select()
    .from(negotiationGroups)
    .where(eq(negotiationGroups.id, groupId))
    .limit(1);

  return rows[0] ?? null;
}

export async function getActiveGroupsByUser(db: Database, userId: string) {
  return db
    .select()
    .from(negotiationGroups)
    .where(
      and(
        eq(negotiationGroups.anchorUserId, userId),
        eq(negotiationGroups.status, "ACTIVE" as GroupStatus),
      ),
    );
}

// ---------------------------------------------------------------------------
// Update with optimistic locking
// ---------------------------------------------------------------------------

export async function updateGroupStatus(
  db: Database,
  groupId: string,
  expectedVersion: number,
  status: GroupStatus,
) {
  const rows = await db
    .update(negotiationGroups)
    .set({
      status,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(negotiationGroups.id, groupId),
        eq(negotiationGroups.version, expectedVersion),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

export async function updateGroupMetadata(
  db: Database,
  groupId: string,
  expectedVersion: number,
  updates: Partial<{
    batna: string;
    bestSessionId: string;
    metadata: Record<string, unknown>;
    status: GroupStatus;
  }>,
) {
  const rows = await db
    .update(negotiationGroups)
    .set({
      ...updates,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(negotiationGroups.id, groupId),
        eq(negotiationGroups.version, expectedVersion),
      ),
    )
    .returning();

  return rows[0] ?? null;
}
