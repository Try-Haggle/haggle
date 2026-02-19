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
