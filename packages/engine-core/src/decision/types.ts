export type DecisionAction = 'ACCEPT' | 'COUNTER' | 'REJECT' | 'NEAR_DEAL' | 'ESCALATE';

export interface Decision {
  action: DecisionAction;
  counterOffer?: number;
}

export interface DecisionThresholds {
  u_threshold: number;
  u_aspiration: number;
}

export interface SessionState {
  rounds_no_concession: number;
}

export interface FaratinParams {
  p_start: number;
  p_limit: number;
  t: number;
  T: number;
  beta: number;
}

/** Parameters for dynamic beta adjustment. */
export interface DynamicBetaParams {
  /** Base beta from strategy. */
  beta_base: number;
  /** Number of competing alternatives (0 = no competition data). */
  n_competitors?: number;
  /** Opponent's EMA concession rate (-1 to +1). */
  opponent_concession_rate?: number;
  /** Competition sensitivity (default 0.5). */
  kappa?: number;
  /** Opponent response sensitivity (default 0.3). */
  lambda?: number;
}
