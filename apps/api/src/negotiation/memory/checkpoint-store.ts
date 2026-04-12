import { randomUUID } from 'node:crypto';
import type {
  Checkpoint,
  CoreMemory,
  NegotiationPhase,
  RevertPolicy,
} from '../types.js';

// ---------------------------------------------------------------------------
// Persistence Interface (DB adapter)
// ---------------------------------------------------------------------------

/**
 * Optional persistence backend for checkpoint data.
 * Implement this interface to store checkpoints in PostgreSQL, Redis, etc.
 */
export interface CheckpointPersistence {
  save(sessionId: string, checkpoint: Checkpoint): Promise<void>;
  load(sessionId: string): Promise<Checkpoint[]>;
}

// ---------------------------------------------------------------------------
// CheckpointStore
// ---------------------------------------------------------------------------

/**
 * Checkpoint Store — in-memory implementation (PostgreSQL-ready interface).
 * Manages phase checkpoints and revert (되감기) operations.
 *
 * When a CheckpointPersistence backend is provided, checkpoints are also
 * written to durable storage on save and pre-loaded on first access.
 */
export class CheckpointStore {
  private checkpoints = new Map<string, Checkpoint[]>();
  private revertCounts = new Map<string, number>();
  private persistence: CheckpointPersistence | undefined;

  constructor(persistence?: CheckpointPersistence) {
    this.persistence = persistence;
  }

  /** Phase 전환 시 자동 저장 */
  async save(checkpoint: Omit<Checkpoint, 'id' | 'created_at'>): Promise<Checkpoint> {
    const full: Checkpoint = {
      ...checkpoint,
      id: randomUUID(),
      created_at: Date.now(),
    };

    const existing = this.checkpoints.get(checkpoint.session_id) ?? [];
    existing.push(full);
    this.checkpoints.set(checkpoint.session_id, existing);

    // Persist to DB if backend is configured
    if (this.persistence) {
      await this.persistence.save(checkpoint.session_id, full);
    }

    return full;
  }

  /** 특정 Phase의 최신 Checkpoint 조회 */
  async getLatest(sessionId: string, phase: NegotiationPhase): Promise<Checkpoint | null> {
    const all = this.checkpoints.get(sessionId) ?? [];
    const phaseCheckpoints = all.filter((cp) => cp.phase === phase);
    if (phaseCheckpoints.length === 0) return null;
    return phaseCheckpoints[phaseCheckpoints.length - 1]!;
  }

  /** 세션의 전체 Checkpoint 이력 */
  async getAll(sessionId: string): Promise<Checkpoint[]> {
    return this.checkpoints.get(sessionId) ?? [];
  }

  /**
   * Load checkpoints from persistence backend into memory.
   * Call this on session start to hydrate the in-memory store.
   */
  async hydrate(sessionId: string): Promise<void> {
    if (!this.persistence) return;

    const persisted = await this.persistence.load(sessionId);
    if (persisted.length > 0) {
      this.checkpoints.set(sessionId, persisted);
    }
  }

  /** 되감기: Checkpoint에서 복원 + 버전 증가 */
  async revert(
    sessionId: string,
    targetPhase: NegotiationPhase,
    revertPolicy: RevertPolicy,
  ): Promise<{
    checkpoint: Checkpoint;
    restoredMemory: CoreMemory;
    newVersion: number;
    cost: number;
  }> {
    // Check if current phase is blocked
    const allCheckpoints = this.checkpoints.get(sessionId) ?? [];
    if (allCheckpoints.length === 0) {
      throw new Error(`No checkpoints found for session ${sessionId}`);
    }

    // Get the latest checkpoint to determine current phase
    const latestCheckpoint = allCheckpoints[allCheckpoints.length - 1]!;
    const currentPhase = latestCheckpoint.phase;

    // Check blocked_from
    if (revertPolicy.blocked_from.includes(currentPhase)) {
      throw new Error(`Revert blocked from phase ${currentPhase}`);
    }

    // Check allowed transitions
    const isAllowed = revertPolicy.allowed_transitions.some(
      (t) => t.from === currentPhase && t.to === targetPhase,
    );
    if (!isAllowed) {
      throw new Error(
        `Revert from ${currentPhase} to ${targetPhase} is not allowed`,
      );
    }

    // Find the target phase checkpoint
    const targetCheckpoint = await this.getLatest(sessionId, targetPhase);
    if (!targetCheckpoint) {
      throw new Error(`No checkpoint found for phase ${targetPhase}`);
    }

    // Calculate cost
    const revertCount = this.revertCounts.get(sessionId) ?? 0;
    const cost = revertPolicy.first_free && revertCount === 0
      ? 0
      : revertPolicy.revert_cost_hc;

    // Increment revert count
    this.revertCounts.set(sessionId, revertCount + 1);

    // Compute new version
    const newVersion = targetCheckpoint.version + 1;

    return {
      checkpoint: targetCheckpoint,
      restoredMemory: structuredClone(targetCheckpoint.core_memory_snapshot),
      newVersion,
      cost,
    };
  }

  /** 되감기 횟수 조회 (비용 계산용) */
  async getRevertCount(sessionId: string): Promise<number> {
    return this.revertCounts.get(sessionId) ?? 0;
  }
}
