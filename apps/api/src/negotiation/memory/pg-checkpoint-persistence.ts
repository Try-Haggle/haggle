import { eq, asc, negotiationCheckpoints, type Database } from '@haggle/db';
import type { CheckpointPersistence } from './checkpoint-store.js';
import type { Checkpoint } from '../types.js';

/**
 * PostgreSQL-backed implementation of CheckpointPersistence.
 * Persists phase checkpoints to the `negotiation_checkpoints` table.
 */
export class PgCheckpointPersistence implements CheckpointPersistence {
  constructor(private readonly db: Database) {}

  async save(sessionId: string, checkpoint: Checkpoint): Promise<void> {
    await this.db.insert(negotiationCheckpoints).values({
      id: checkpoint.id,
      sessionId: sessionId,
      phase: checkpoint.phase,
      version: checkpoint.version,
      roundAtCheckpoint: checkpoint.total_rounds_at_checkpoint,
      coreMemorySnapshot: checkpoint.core_memory_snapshot as unknown as Record<string, unknown>,
      conditionsState: checkpoint.conditions_state as unknown as Record<string, unknown>,
      memoHash: checkpoint.memo_hash ?? null,
    });
  }

  async load(sessionId: string): Promise<Checkpoint[]> {
    const rows = await this.db
      .select()
      .from(negotiationCheckpoints)
      .where(eq(negotiationCheckpoints.sessionId, sessionId))
      .orderBy(asc(negotiationCheckpoints.createdAt));

    return rows.map((row) => ({
      id: row.id,
      session_id: sessionId,
      phase: row.phase as Checkpoint['phase'],
      version: row.version,
      total_rounds_at_checkpoint: row.roundAtCheckpoint,
      core_memory_snapshot: row.coreMemorySnapshot as unknown as Checkpoint['core_memory_snapshot'],
      conditions_state: (row.conditionsState ?? {}) as unknown as Checkpoint['conditions_state'],
      both_agreed: false,
      created_at: row.createdAt.getTime(),
      memo_hash: row.memoHash ?? undefined,
    }));
  }
}
