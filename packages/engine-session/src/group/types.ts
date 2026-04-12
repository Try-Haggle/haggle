import type { CompetitionContext } from '@haggle/engine-core';
import type { SessionSnapshot } from '@haggle/engine-core';

/** 1:N topology. */
export type GroupTopology = '1_BUYER_N_SELLERS' | 'N_BUYERS_1_SELLER';

/** Group lifecycle. */
export type GroupStatus = 'ACTIVE' | 'RESOLVED' | 'EXPIRED' | 'CANCELLED';

/** A group of related negotiation sessions. */
export interface NegotiationGroup {
  group_id: string;
  topology: GroupTopology;
  /** The user on the "1" side (buyer in 1:N, seller in N:1). */
  anchor_user_id: string;
  intent_id?: string;
  max_sessions: number;
  session_ids: string[];
  status: GroupStatus;
  created_at: number;
  updated_at: number;
}

/** Snapshot of a group + all its session utilities for orchestration decisions. */
export interface GroupSnapshot {
  group: NegotiationGroup;
  sessions: SessionSnapshot[];
}

/** Actions the orchestrator can produce. */
export type GroupAction =
  | { action: 'update_competition'; session_ids: string[]; competition: Partial<CompetitionContext> }
  | { action: 'supersede_losers'; winner_session_id: string; loser_session_ids: string[] }
  | { action: 'update_batna'; batna: number; best_session_id: string }
  | { action: 'close_group'; reason: string }
  | { action: 'no_action'; reason: string };
