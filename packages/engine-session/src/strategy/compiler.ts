import type { MasterStrategy } from './types.js';

export type StrategyRole = 'BUYER' | 'SELLER';

export type AgentStats = {
  priceAggression?: number;
  patienceLevel?: number;
  riskTolerance?: number;
  speedBias?: number;
  detailFocus?: number;
};

export type StrategyCompilerInput = {
  role: StrategyRole;
  userId?: string;
  strategyId?: string;
  preset?: string;
  agentStats?: AgentStats | null;
  userPreferences?: Record<string, unknown> | null;
  listing: {
    id?: string;
    category?: string | null;
    condition?: string | null;
    targetPriceMinor: number;
    floorPriceMinor: number;
    listedAtMs: number;
    deadlineAtMs?: number | null;
  };
  nowMs?: number;
};

export type CompiledStrategySnapshot = MasterStrategy & {
  compiler: {
    version: 'strategy-compiler-v1';
    source: 'listing_context';
    selected_playbook: string;
    candidate_playbooks: string[];
  };
  role: StrategyRole;
  p_reservation: number;
  p_initial: number;
  t_max: number;
  created_at_ms: number;
  deadline_at_ms: number;
  time_value: {
    curve: 'faratin';
    listed_at_ms: number;
    deadline_at_ms: number;
    t_total_ms: number;
    beta: number;
    source: 'listing_selling_deadline' | 'compiler_default_window';
  };
  utility_weights: {
    price: number;
    time: number;
    reputation: number;
    satisfaction: number;
  };
  thresholds: {
    accept: number;
    counter: number;
    reject: number;
    near_deal: number;
  };
  concession: {
    beta: number;
    k: number;
  };
  listing_context: {
    id?: string;
    category?: string | null;
    condition?: string | null;
  };
  user_preference_ref?: Record<string, unknown>;
};

type NormalizedStats = Required<AgentStats>;

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STATS: NormalizedStats = {
  priceAggression: 50,
  patienceLevel: 50,
  riskTolerance: 50,
  speedBias: 50,
  detailFocus: 50,
};

export function compileStrategySnapshot(input: StrategyCompilerInput): CompiledStrategySnapshot {
  const stats = normalizeAgentStats(input.agentStats, input.preset);
  const nowMs = input.nowMs ?? Date.now();
  const listedAtMs = saneMillis(input.listing.listedAtMs, nowMs);
  const deadlineAtMs = Math.max(
    listedAtMs + 1,
    saneMillis(input.listing.deadlineAtMs, listedAtMs + DEFAULT_WINDOW_MS),
  );
  const totalMs = Math.max(1, deadlineAtMs - listedAtMs);
  const selectedPlaybook = selectPlaybook(stats, input.preset);
  const priceProfile = derivePriceProfile(stats);
  const timeProfile = deriveTimeProfile(stats, totalMs);
  const riskProfile = deriveRiskProfile(stats);
  const satisfactionProfile = deriveSatisfactionProfile(stats);
  const weights = normalizeWeights({
    price: priceProfile.weight,
    time: timeProfile.weight,
    reputation: riskProfile.weight,
    satisfaction: satisfactionProfile.weight,
  });
  const thresholds = deriveThresholds(stats, input.role);
  const concession = deriveConcession(stats);
  const pTarget = Math.max(1, input.listing.targetPriceMinor);
  const rawLimit = Math.max(1, input.listing.floorPriceMinor);
  const pLimit = input.role === 'SELLER'
    ? Math.min(pTarget, rawLimit)
    : Math.max(pTarget, rawLimit);

  return {
    id: input.strategyId ?? `${input.role.toLowerCase()}_${selectedPlaybook}`,
    user_id: input.userId ?? '',
    role: input.role,
    persona: selectedPlaybook,
    weights: {
      w_p: weights.price,
      w_t: weights.time,
      w_r: weights.reputation,
      w_s: weights.satisfaction,
    },
    p_target: pTarget,
    p_limit: pLimit,
    p_reservation: pLimit,
    p_initial: pTarget,
    alpha: timeProfile.curveAlpha,
    beta: concession.beta,
    t_deadline: totalMs,
    t_max: totalMs,
    v_t_floor: timeProfile.floor,
    n_threshold: satisfactionProfile.noConcessionThreshold,
    v_s_base: satisfactionProfile.base,
    w_rep: riskProfile.reputationWeight,
    w_info: riskProfile.infoWeight,
    u_threshold: thresholds.counter,
    u_aspiration: thresholds.accept,
    gamma: priceProfile.competitionGamma,
    created_at: listedAtMs,
    expires_at: deadlineAtMs,
    created_at_ms: listedAtMs,
    deadline_at_ms: deadlineAtMs,
    time_value: {
      curve: 'faratin',
      listed_at_ms: listedAtMs,
      deadline_at_ms: deadlineAtMs,
      t_total_ms: totalMs,
      beta: concession.beta,
      source: input.listing.deadlineAtMs ? 'listing_selling_deadline' : 'compiler_default_window',
    },
    utility_weights: {
      price: weights.price,
      time: weights.time,
      reputation: weights.reputation,
      satisfaction: weights.satisfaction,
    },
    thresholds,
    concession,
    compiler: {
      version: 'strategy-compiler-v1',
      source: 'listing_context',
      selected_playbook: selectedPlaybook,
      candidate_playbooks: rankPlaybooks(stats),
    },
    listing_context: {
      id: input.listing.id,
      category: input.listing.category,
      condition: input.listing.condition,
    },
    user_preference_ref: input.userPreferences ?? undefined,
  };
}

export function normalizeAgentStats(stats?: AgentStats | null, preset?: string): NormalizedStats {
  const presetStats = presetToStats(preset);
  return {
    priceAggression: clampScore(stats?.priceAggression ?? presetStats.priceAggression),
    patienceLevel: clampScore(stats?.patienceLevel ?? presetStats.patienceLevel),
    riskTolerance: clampScore(stats?.riskTolerance ?? presetStats.riskTolerance),
    speedBias: clampScore(stats?.speedBias ?? presetStats.speedBias),
    detailFocus: clampScore(stats?.detailFocus ?? presetStats.detailFocus),
  };
}

function presetToStats(preset?: string): NormalizedStats {
  switch (preset) {
    case 'gatekeeper':
    case 'firm':
      return { priceAggression: 85, patienceLevel: 90, riskTolerance: 20, speedBias: 30, detailFocus: 75 };
    case 'storyteller':
      return { priceAggression: 60, patienceLevel: 80, riskTolerance: 35, speedBias: 25, detailFocus: 95 };
    case 'dealmaker':
    case 'quick_deal':
      return { priceAggression: 40, patienceLevel: 25, riskTolerance: 75, speedBias: 95, detailFocus: 35 };
    case 'aggressive':
      return { priceAggression: 90, patienceLevel: 70, riskTolerance: 35, speedBias: 45, detailFocus: 60 };
    case 'patient':
      return { priceAggression: 65, patienceLevel: 90, riskTolerance: 30, speedBias: 20, detailFocus: 75 };
    case 'diplomat':
    case 'balanced':
    default:
      return DEFAULT_STATS;
  }
}

function selectPlaybook(stats: NormalizedStats, preset?: string): string {
  if (preset && ['gatekeeper', 'diplomat', 'storyteller', 'dealmaker'].includes(preset)) return preset;
  return rankPlaybooks(stats)[0] ?? 'balanced';
}

function rankPlaybooks(stats: NormalizedStats): string[] {
  const scores = [
    ['gatekeeper', stats.priceAggression * 0.45 + stats.patienceLevel * 0.35 + (100 - stats.riskTolerance) * 0.20],
    ['dealmaker', stats.speedBias * 0.55 + stats.riskTolerance * 0.25 + (100 - stats.patienceLevel) * 0.20],
    ['storyteller', stats.detailFocus * 0.55 + stats.patienceLevel * 0.25 + stats.priceAggression * 0.20],
    ['diplomat', (100 - Math.abs(stats.priceAggression - 55)) * 0.35 + (100 - Math.abs(stats.speedBias - 50)) * 0.35 + stats.riskTolerance * 0.30],
  ] as const;
  return [...scores].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function derivePriceProfile(stats: NormalizedStats) {
  const aggression = stats.priceAggression / 100;
  return {
    weight: 0.28 + aggression * 0.27,
    competitionGamma: 0.15 + aggression * 0.35,
  };
}

function deriveTimeProfile(stats: NormalizedStats, totalMs: number) {
  const speed = stats.speedBias / 100;
  const patience = stats.patienceLevel / 100;
  const windowDays = totalMs / (24 * 60 * 60 * 1000);
  const deadlinePressure = windowDays <= 1 ? 0.12 : windowDays <= 3 ? 0.06 : 0;
  return {
    weight: 0.12 + speed * 0.25 + deadlinePressure,
    curveAlpha: round3(0.75 + speed * 0.9 + (1 - patience) * 0.35),
    floor: round3(0.04 + patience * 0.11),
  };
}

function deriveRiskProfile(stats: NormalizedStats) {
  const riskTolerance = stats.riskTolerance / 100;
  const riskAversion = 1 - riskTolerance;
  return {
    weight: 0.12 + riskAversion * 0.18,
    reputationWeight: round3(0.35 + riskAversion * 0.45),
    infoWeight: round3(0.65 - riskAversion * 0.45),
  };
}

function deriveSatisfactionProfile(stats: NormalizedStats) {
  const detail = stats.detailFocus / 100;
  const patience = stats.patienceLevel / 100;
  return {
    weight: 0.08 + detail * 0.15,
    base: round3(0.42 + detail * 0.2),
    noConcessionThreshold: Math.round(2 + patience * 4),
  };
}

function deriveThresholds(stats: NormalizedStats, role: StrategyRole) {
  const aggression = stats.priceAggression / 100;
  const speed = stats.speedBias / 100;
  const risk = stats.riskTolerance / 100;
  const roleFirmness = role === 'SELLER' ? 0.03 : 0;
  const accept = clamp01(0.68 + aggression * 0.16 - speed * 0.10 - risk * 0.04 + roleFirmness);
  return {
    accept: round3(accept),
    counter: round3(clamp01(0.42 + aggression * 0.1 - speed * 0.06)),
    reject: round3(clamp01(0.16 + aggression * 0.1 - risk * 0.05)),
    near_deal: round3(clamp01(accept - 0.06)),
  };
}

function deriveConcession(stats: NormalizedStats) {
  const speed = stats.speedBias / 100;
  const patience = stats.patienceLevel / 100;
  const aggression = stats.priceAggression / 100;
  const beta = 0.35 + speed * 0.45 + (1 - patience) * 0.20 - aggression * 0.15;
  const k = 0.6 + speed * 1.4 + (1 - aggression) * 0.35;
  return {
    beta: round3(clamp(beta, 0.2, 0.95)),
    k: round3(clamp(k, 0.4, 2.4)),
  };
}

function normalizeWeights(input: {
  price: number;
  time: number;
  reputation: number;
  satisfaction: number;
}) {
  const total = input.price + input.time + input.reputation + input.satisfaction;
  const price = round6(input.price / total);
  const time = round6(input.time / total);
  const reputation = round6(input.reputation / total);

  return {
    price,
    time,
    reputation,
    satisfaction: 1 - price - time - reputation,
  };
}

function saneMillis(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampScore(value: unknown): number {
  return Math.round(clamp(typeof value === 'number' && Number.isFinite(value) ? value : 50, 0, 100));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
