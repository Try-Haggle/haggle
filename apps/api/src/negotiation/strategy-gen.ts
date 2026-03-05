import type { MasterStrategy, HnpRole } from '@haggle/engine-session';
import type { UtilityWeights } from '@haggle/engine-core';
import type { ListingContext, PersonaPreset } from './types.js';

// ── Condition-based discount tables (BUYER only) ────────────────

interface ConditionParams {
  discount: number;
  limit_frac: number;
}

const CONDITION_TABLE: Record<ListingContext['condition'], ConditionParams> = {
  new:      { discount: 0.10, limit_frac: 0.95 },
  like_new: { discount: 0.15, limit_frac: 0.90 },
  good:     { discount: 0.20, limit_frac: 0.85 },
  fair:     { discount: 0.25, limit_frac: 0.80 },
  poor:     { discount: 0.35, limit_frac: 0.70 },
};

// ── Persona → beta mapping ──────────────────────────────────────

const PERSONA_BETA: Record<PersonaPreset, number> = {
  balanced:     1.0,
  aggressive:   0.5,
  conservative: 2.0,
};

// ── Default constants ───────────────────────────────────────────

const DEFAULT_WEIGHTS: UtilityWeights = { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 };
const DEFAULT_ALPHA = 1.0;
const DEFAULT_T_DEADLINE = 86400; // 24h in seconds
const DEFAULT_U_THRESHOLD = 0.4;
const DEFAULT_U_ASPIRATION = 0.7;

// ── Strategy generator ──────────────────────────────────────────

let strategyCounter = 0;

export function generateStrategy(
  listing: ListingContext,
  role: HnpRole,
  persona: PersonaPreset = 'balanced',
): MasterStrategy {
  const now = Date.now();
  const beta = PERSONA_BETA[persona];

  let p_target: number;
  let p_limit: number;

  if (role === 'SELLER') {
    p_target = listing.target_price;
    p_limit = listing.floor_price;
  } else {
    const params = CONDITION_TABLE[listing.condition];
    p_target = listing.target_price * (1 - params.discount);
    p_limit = listing.target_price * params.limit_frac;
  }

  strategyCounter += 1;
  const id = `strat_${now}_${strategyCounter}`;

  return {
    id,
    user_id: '',
    weights: { ...DEFAULT_WEIGHTS },
    p_target,
    p_limit,
    alpha: DEFAULT_ALPHA,
    beta,
    t_deadline: DEFAULT_T_DEADLINE,
    v_t_floor: 0.1,
    n_threshold: 3,
    v_s_base: 0.5,
    w_rep: listing.seller_reputation ?? 0.5,
    w_info: listing.info_completeness ?? 0.7,
    u_threshold: DEFAULT_U_THRESHOLD,
    u_aspiration: DEFAULT_U_ASPIRATION,
    persona,
    created_at: now,
    expires_at: now + DEFAULT_T_DEADLINE * 1000,
  };
}
