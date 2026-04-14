import { eq, desc, sql, and, buddies, buddyTrades, agentLevels, type Database } from "@haggle/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Species =
  | "FOX" | "RABBIT" | "BEAR" | "CAT"
  | "OWL" | "DRAGON" | "EAGLE" | "WOLF";

export type Rarity =
  | "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "MYTHIC";

export type NegotiationOutcome = "DEAL" | "REJECT" | "TIMEOUT" | "WALKAWAY";

export interface BuddyAbility {
  id: string;
  name: string;
  description: string;
  effect: string;
  enhanced?: boolean;
  bonus?: string;
}

export interface AwakenPerk {
  id: string;
  name: string;
  effect: string;
  value?: number;
  pool: "common" | Species;
}

export interface TradeCompletedParams {
  sessionId: string;
  odUserId: string;         // buyer or seller — called for EACH side
  outcome: NegotiationOutcome;
  amount: number;           // USD
  savingPct: number;        // 0-1
  category: string;
  skillsUsed: string[];
  presetUsed?: string;
  buddyId?: string;         // equipped buddy (representative)
  isJuryVerdict?: boolean;
  isDisputeFree?: boolean;
  roundsUsed?: number;
  maxRounds?: number;
  mutualRating?: number;    // counterpart's rating of me (1-5), undefined if not yet rated
  myRating?: number;        // my rating of counterpart (1-5)
  trustScore?: number;      // user's current trust score
  consecutiveDealsOverride?: number;  // pre-computed from caller
}

export interface QualityMultiplier {
  base: number;
  factors: { name: string; value: number }[];
  total: number;
}

export interface HCReward {
  tradeReward: number;
  ratingBonus: number;
  total: number;
}

export interface PipelineModification {
  field: string;
  action: "add" | "set" | "multiply";
  value: number | string | boolean;
  source: string;
}

// ---------------------------------------------------------------------------
// Constants: Species Mapping
// ---------------------------------------------------------------------------

const CATEGORY_SPECIES_MAP: Record<string, Species> = {
  "electronics/phones": "FOX",
  "electronics/tablets": "FOX",
  clothing: "RABBIT",
  luxury_fashion: "RABBIT",
  sports_outdoor: "BEAR",
  heavy_equipment: "BEAR",
  home_garden: "CAT",
  books_media: "CAT",
  collectibles: "OWL",
  art: "OWL",
  jewelry: "DRAGON",
  musical_instruments: "DRAGON",
  vehicles: "EAGLE",
  vehicle_parts: "EAGLE",
  real_estate: "WOLF",
  other: "WOLF",
};

const DEFAULT_SPECIES: Species = "WOLF";

// ---------------------------------------------------------------------------
// Constants: Level Tables
// ---------------------------------------------------------------------------

export const AGENT_LEVEL_TABLE: ReadonlyArray<{ level: number; xp: number }> = [
  { level: 1, xp: 0 },
  { level: 5, xp: 2_000 },
  { level: 10, xp: 8_000 },
  { level: 15, xp: 18_000 },
  { level: 20, xp: 35_000 },
  { level: 25, xp: 60_000 },
  { level: 30, xp: 100_000 },
  { level: 40, xp: 220_000 },
  { level: 50, xp: 500_000 },
];

export const BUDDY_LEVEL_TABLE: ReadonlyArray<{ level: number; xp: number }> = [
  { level: 1, xp: 0 },
  { level: 5, xp: 500 },
  { level: 10, xp: 2_000 },
  { level: 15, xp: 5_000 },
  { level: 20, xp: 10_000 },
  { level: 25, xp: 18_000 },
  { level: 30, xp: 30_000 },
  { level: 40, xp: 60_000 },
  { level: 50, xp: 120_000 },
];

// ---------------------------------------------------------------------------
// Constants: Rarity
// ---------------------------------------------------------------------------

// Fixed rates (COMMON~EPIC) — no dynamic adjustment
// Dynamic rates (LEGENDARY/MYTHIC) — adjusted by amount + totalMinted
const FIXED_RATES: ReadonlyArray<{ rarity: Rarity; rate: number }> = [
  { rarity: "COMMON", rate: 0.55 },
  { rarity: "UNCOMMON", rate: 0.28 },
  { rarity: "RARE", rate: 0.13 },
  { rarity: "EPIC", rate: 0.039 },
];

const DYNAMIC_RATES: ReadonlyArray<{ rarity: Rarity; baseRate: number }> = [
  { rarity: "LEGENDARY", baseRate: 0.00097 },
  { rarity: "MYTHIC", baseRate: 0.0001 },
];

const MYTHIC_CAP = 24; // 3 per species × 8 species

// Pity thresholds — dual ceiling (volume OR quality trade count)
const PITY_EPIC_VOLUME = 3_000;       // $3,000 effective contribution
const PITY_EPIC_TRADES = 15;          // 15 quality trades
const PITY_LEGENDARY_VOLUME = 15_000; // $15,000 effective contribution
const PITY_LEGENDARY_TRADES = 40;     // 40 quality trades
const PITY_MIN_TRADE_AMOUNT = 20;     // $20 minimum to count

// HC rewards per trade
const HC_TRADE_BASE = 2;
const HC_TRADE_AMOUNT_DIVISOR = 200;

// Buddy release HC values
export const BUDDY_RELEASE_HC: Record<Rarity, number> = {
  COMMON: 3,
  UNCOMMON: 12,
  RARE: 60,
  EPIC: 300,
  LEGENDARY: 10_000,
  MYTHIC: 50_000,
};

// ---------------------------------------------------------------------------
// Constants: Buddy Abilities (LEGENDARY/MYTHIC only)
// ---------------------------------------------------------------------------

// All abilities are FAIR — public data / symmetric / reward-only.
// NO asymmetric abilities (opponent manipulation, hidden info, forced concession).
export const LEGENDARY_ABILITIES: Record<Species, BuddyAbility> = {
  FOX: { id: "price_insight", name: "시세 감각", description: "공개 시장 평균가 대비 현재 제안가 위치 표시", effect: "market_price_hint" },
  RABBIT: { id: "trend_sense", name: "트렌드 감지", description: "공개 수요 트렌드 힌트 제공", effect: "demand_signal" },
  BEAR: { id: "endurance", name: "인내력", description: "타임아웃 전 추가 1라운드 (양측 모두 혜택)", effect: "extra_round" },
  CAT: { id: "practical_eye", name: "생활 감정", description: "생활용품 실용 가치 평가 기준 briefing 추가", effect: "practical_value_hint" },
  OWL: { id: "appraisal", name: "감정안", description: "공개 경매 데이터 기반 컨디션 정보 제공", effect: "condition_insight" },
  DRAGON: { id: "gem_knowledge", name: "보석 지식", description: "공개 보석/귀금속 시세 데이터 briefing 추가", effect: "gem_market_hint" },
  EAGLE: { id: "wide_view", name: "넓은 시야", description: "공개 유사 거래 비교 데이터 1건 제공", effect: "comparable_hint" },
  WOLF: { id: "adaptability", name: "적응력", description: "어떤 카테고리에서든 버디 XP 감소 없음", effect: "no_category_penalty" },
};

// MYTHIC = enhanced LEGENDARY + unique MYTHIC-only ability
export const MYTHIC_ABILITIES: Record<Species, BuddyAbility> = {
  FOX: { id: "market_forecast", name: "시장 예언", description: "가격 변동 추세 예측 힌트", effect: "market_forecast" },
  RABBIT: { id: "resale_data", name: "스타일 오라", description: "브랜드 리세일 가치 데이터 추가", effect: "resale_value_data" },
  BEAR: { id: "double_endurance", name: "불굴의 의지", description: "추가 2라운드 + 장기전 XP 보너스", effect: "double_endurance" },
  CAT: { id: "mutual_satisfaction", name: "편안한 거래", description: "양측 모두 만족 시 HC 보너스", effect: "mutual_satisfaction_hc" },
  OWL: { id: "master_appraisal", name: "마스터 감정", description: "경매 이력 + 출처 정보 종합", effect: "master_appraisal" },
  DRAGON: { id: "dragon_hoard", name: "용의 보물", description: "$1000+ 거래 성사 시 보너스 에그 확정", effect: "guaranteed_bonus_egg" },
  EAGLE: { id: "triple_comparable", name: "전략적 시야", description: "유사 거래 3건 비교 데이터", effect: "triple_comparable" },
  WOLF: { id: "universal_xp", name: "만능 적응", description: "모든 카테고리에서 버디/에이전트 XP 보너스", effect: "universal_xp_boost" },
};

// ---------------------------------------------------------------------------
// Constants: Awaken Perks
// ---------------------------------------------------------------------------

export const COMMON_PERKS: ReadonlyArray<AwakenPerk> = [
  { id: "extra_round", name: "추가 라운드", effect: "max_rounds_+1", pool: "common" },
  { id: "bonus_egg", name: "보너스 에그", effect: "double_egg_chance", pool: "common" },
  { id: "rarity_upgrade", name: "등급 승급", effect: "rarity_tier_+1", pool: "common" },
  { id: "hc_boost", name: "HC 부스트", effect: "hc_multiplier", value: 1.20, pool: "common" },
  { id: "xp_boost", name: "XP 부스트", effect: "xp_multiplier", value: 1.15, pool: "common" },
  { id: "buddy_xp_boost", name: "버디 XP 부스트", effect: "buddy_xp_multiplier", value: 1.25, pool: "common" },
  { id: "market_context", name: "시장 맥락", effect: "market_data_access", pool: "common" },
  { id: "deal_streak_bonus", name: "연속 딜 보너스", effect: "streak_xp_multiplier", pool: "common" },
];

export const SPECIES_PERKS: Record<Species, ReadonlyArray<AwakenPerk>> = {
  FOX: [
    { id: "spec_analyst", name: "스펙 분석가", effect: "spec_comparison_brief", pool: "FOX" },
    { id: "depreciation_sense", name: "감가 감각", effect: "depreciation_range", pool: "FOX" },
    { id: "tech_trend", name: "기술 트렌드", effect: "successor_price_hint", pool: "FOX" },
    { id: "quick_deal", name: "빠른 딜", effect: "fast_deal_xp_bonus", pool: "FOX" },
  ],
  RABBIT: [
    { id: "trend_radar", name: "트렌드 레이더", effect: "season_demand_trend", pool: "RABBIT" },
    { id: "brand_knowledge", name: "브랜드 지식", effect: "resale_value_brief", pool: "RABBIT" },
    { id: "condition_eye", name: "컨디션 감정", effect: "clothing_condition_check", pool: "RABBIT" },
    { id: "fashion_network", name: "패션 네트워크", effect: "category_hc_bonus", pool: "RABBIT" },
  ],
  BEAR: [
    { id: "durability_check", name: "내구성 분석", effect: "wear_assessment", pool: "BEAR" },
    { id: "seasonal_timing", name: "시즌 타이밍", effect: "season_price_pattern", pool: "BEAR" },
    { id: "bulk_sense", name: "대량 감각", effect: "high_value_xp_bonus", pool: "BEAR" },
    { id: "endurance_deal", name: "장기전 특화", effect: "long_deal_xp_bonus", pool: "BEAR" },
  ],
  CAT: [
    { id: "comfort_index", name: "편안함 지수", effect: "practical_value_brief", pool: "CAT" },
    { id: "gentle_approach", name: "부드러운 접근", effect: "first_accept_egg_bonus", pool: "CAT" },
    { id: "home_expert", name: "홈 전문가", effect: "home_category_buddy_xp", pool: "CAT" },
    { id: "cozy_deal", name: "아늑한 딜", effect: "balanced_savings_hc", pool: "CAT" },
  ],
  OWL: [
    { id: "appraisal_eye", name: "감정안", effect: "auction_data_ref", pool: "OWL" },
    { id: "provenance_check", name: "출처 확인", effect: "item_history_check", pool: "OWL" },
    { id: "collector_network", name: "수집가 네트워크", effect: "rarity_upgrade_double", pool: "OWL" },
    { id: "patience_reward", name: "인내의 보상", effect: "final_round_xp_double", pool: "OWL" },
  ],
  DRAGON: [
    { id: "gem_knowledge", name: "보석 지식", effect: "gem_market_brief", pool: "DRAGON" },
    { id: "premium_sense", name: "프리미엄 감각", effect: "high_value_hc_double", pool: "DRAGON" },
    { id: "artisan_eye", name: "장인의 눈", effect: "handmade_value_brief", pool: "DRAGON" },
    { id: "dragon_hoard", name: "용의 보물", effect: "guaranteed_bonus_egg", pool: "DRAGON" },
  ],
  EAGLE: [
    { id: "mileage_calc", name: "주행거리 계산", effect: "mileage_depreciation", pool: "EAGLE" },
    { id: "part_compatibility", name: "호환성 체크", effect: "compatibility_check", pool: "EAGLE" },
    { id: "wide_search", name: "넓은 탐색", effect: "comparable_brief", pool: "EAGLE" },
    { id: "road_warrior", name: "로드 워리어", effect: "vehicle_agent_xp_bonus", pool: "EAGLE" },
  ],
  WOLF: [
    { id: "adaptability", name: "적응력", effect: "no_category_xp_penalty", pool: "WOLF" },
    { id: "pack_instinct", name: "무리 본능", effect: "repeat_seller_xp_bonus", pool: "WOLF" },
    { id: "territory_mark", name: "영역 표시", effect: "region_diversity_hc", pool: "WOLF" },
    { id: "lone_wolf", name: "론 울프", effect: "custom_preset_xp_bonus", pool: "WOLF" },
  ],
};

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

export function mapCategoryToSpecies(category: string): Species {
  // Try direct match first, then try matching prefix
  if (CATEGORY_SPECIES_MAP[category]) return CATEGORY_SPECIES_MAP[category];
  for (const [key, species] of Object.entries(CATEGORY_SPECIES_MAP)) {
    if (category.startsWith(key)) return species;
  }
  return DEFAULT_SPECIES;
}

export function computeXP(
  outcome: NegotiationOutcome,
  amount: number,
  consecutiveWins: number,
  isJuryVerdict: boolean,
  isDisputeFree: boolean,
): number {
  const base = 100;
  const amountBonus = Math.pow(Math.max(amount, 0), 0.4) * 5;
  const streakBonus = Math.min(consecutiveWins, 10) * 15;
  const juryBonus = isJuryVerdict ? 50 : 0;
  const disputeFreeBonus = isDisputeFree ? 25 : 0;
  const total = base + amountBonus + streakBonus + juryBonus + disputeFreeBonus;
  return Math.floor(outcome === "DEAL" ? total : total * 0.3);
}

export function computeBuddyXP(agentXP: number): number {
  return Math.floor(agentXP * 0.5);
}

export function computeRarity(
  amount: number,
  totalMintedBySpecies: number,
  pityGuarantee?: "EPIC" | "LEGENDARY",
): Rarity {
  // If pity ceiling reached, guarantee that rarity
  if (pityGuarantee) {
    // Still roll — but floor is the guaranteed rarity
    const roll = Math.random();
    if (pityGuarantee === "LEGENDARY") {
      // Small chance of MYTHIC even on pity
      const mythicChance = 0.01; // 1% on pity roll
      return roll < mythicChance ? "MYTHIC" : "LEGENDARY";
    }
    // EPIC pity: small chance of higher
    const legendaryChance = 0.005;
    return roll < legendaryChance ? "LEGENDARY" : "EPIC";
  }

  // Fixed rates for COMMON~EPIC
  const fixed = FIXED_RATES.map(r => ({ ...r }));

  // Dynamic rates for LEGENDARY/MYTHIC
  const dynamicMultiplier = Math.log(1 + amount / 100) / Math.sqrt(1 + totalMintedBySpecies / 5000);
  const dynamic = DYNAMIC_RATES.map(({ rarity, baseRate }) => ({
    rarity,
    rate: baseRate * dynamicMultiplier,
  }));

  // Combine and normalize to 100%
  const allRates = [...fixed, ...dynamic];
  const rawTotal = allRates.reduce((sum, r) => sum + r.rate, 0);
  const normalized = allRates.map(r => ({ ...r, rate: r.rate / rawTotal }));

  const roll = Math.random();
  let cumulative = 0;

  // Walk from rarest to most common
  for (let i = normalized.length - 1; i >= 0; i--) {
    cumulative += normalized[i]!.rate;
    if (roll < cumulative) return normalized[i]!.rarity;
  }
  return "COMMON";
}

/**
 * Compute quality multiplier for pity accumulation.
 * All factors are symmetric — based on trade quality, NOT one side's win.
 */
export function computeQualityMultiplier(params: {
  isDisputeFree: boolean;
  roundsUsed?: number;
  maxRounds?: number;
  mutualPositiveRating: boolean;  // both sides rated 3+
  consecutiveDeals: number;
  trustScore?: number;
}): QualityMultiplier {
  const factors: { name: string; value: number }[] = [];

  // Clean deal (no dispute): ×1.3
  if (params.isDisputeFree) {
    factors.push({ name: "clean_deal", value: 1.3 });
  }

  // Efficient negotiation (≤60% of max rounds): ×1.2
  if (params.roundsUsed != null && params.maxRounds != null && params.maxRounds > 0) {
    if (params.roundsUsed <= params.maxRounds * 0.6) {
      factors.push({ name: "efficient", value: 1.2 });
    }
  }

  // Mutual positive rating: ×1.2
  if (params.mutualPositiveRating) {
    factors.push({ name: "mutual_rating", value: 1.2 });
  }

  // Consecutive deals 3+: ×1.2
  if (params.consecutiveDeals >= 3) {
    factors.push({ name: "streak", value: 1.2 });
  }

  // Trust 80+: ×1.1
  if (params.trustScore != null && params.trustScore >= 80) {
    factors.push({ name: "trust", value: 1.1 });
  }

  const total = factors.reduce((prod, f) => prod * f.value, 1.0);
  return { base: 1.0, factors, total };
}

/**
 * Compute HC reward for a completed trade.
 * Formula: 2 + floor(amount / 200)
 */
export function computeTradeHC(amount: number, mutualPositiveRating: boolean): HCReward {
  const tradeReward = HC_TRADE_BASE + Math.floor(amount / HC_TRADE_AMOUNT_DIVISOR);
  const ratingBonus = mutualPositiveRating ? 2 : 0; // rating submission bonus
  return { tradeReward, ratingBonus, total: tradeReward + ratingBonus };
}

/**
 * Compute HC value for releasing a buddy.
 * HC = baseValue × (1 + buddyLevel × 0.05)
 */
export function computeReleaseHC(rarity: Rarity, buddyLevel: number): number {
  const base = BUDDY_RELEASE_HC[rarity];
  const levelMultiplier = 1 + buddyLevel * 0.05;
  return Math.floor(base * levelMultiplier);
}

/**
 * Check pity ceiling. Returns guaranteed rarity if ceiling reached, null otherwise.
 */
export function checkPityCeiling(
  pityVolumeEpic: number,
  pityTradesEpic: number,
  pityVolumeLegendary: number,
  pityTradesLegendary: number,
): "EPIC" | "LEGENDARY" | null {
  // Check LEGENDARY first (higher priority)
  if (pityVolumeLegendary >= PITY_LEGENDARY_VOLUME || pityTradesLegendary >= PITY_LEGENDARY_TRADES) {
    return "LEGENDARY";
  }
  if (pityVolumeEpic >= PITY_EPIC_VOLUME || pityTradesEpic >= PITY_EPIC_TRADES) {
    return "EPIC";
  }
  return null;
}

/**
 * Compute XP bonus multiplier from mutual rating.
 * Both sides 4+: +20%. One side positive: +10% for recipient.
 */
export function computeRatingXPMultiplier(myRating?: number, mutualRating?: number): number {
  if (myRating != null && myRating >= 4 && mutualRating != null && mutualRating >= 4) {
    return 1.20; // mutual positive
  }
  if (mutualRating != null && mutualRating >= 4) {
    return 1.10; // counterpart rated me positively
  }
  return 1.0;
}

export function resolveLevel(totalXP: number, table: ReadonlyArray<{ level: number; xp: number }>): number {
  let resolved = table[0]!.level;
  for (const entry of table) {
    if (totalXP >= entry.xp) resolved = entry.level;
    else break;
  }
  return resolved;
}

export function getAbilityForBuddy(species: Species, rarity: Rarity): BuddyAbility | BuddyAbility[] | null {
  if (rarity === "MYTHIC") {
    // MYTHIC gets enhanced LEGENDARY + unique MYTHIC ability
    return [
      { ...LEGENDARY_ABILITIES[species], enhanced: true },
      MYTHIC_ABILITIES[species],
    ];
  }
  if (rarity === "LEGENDARY") return LEGENDARY_ABILITIES[species];
  return null;
}

export function getAvailablePerks(species: Species): AwakenPerk[] {
  return [...COMMON_PERKS, ...SPECIES_PERKS[species]];
}

// ---------------------------------------------------------------------------
// Service: onTradeCompleted
// ---------------------------------------------------------------------------

export async function onTradeCompleted(db: Database, params: TradeCompletedParams) {
  const {
    odUserId: userId, sessionId, outcome, amount, savingPct,
    category, skillsUsed, presetUsed, buddyId,
    isJuryVerdict = false, isDisputeFree = true,
    roundsUsed, maxRounds, mutualRating, myRating, trustScore,
  } = params;

  // Only DEAL outcomes produce eggs
  const isDeal = outcome === "DEAL";

  // 1. Rating XP multiplier (mutual positive = +20%, one-sided = +10%)
  const ratingMultiplier = computeRatingXPMultiplier(myRating, mutualRating);

  // 2. Quality multiplier (for pity accumulation)
  const mutualPositiveRating = (myRating != null && myRating >= 3 && mutualRating != null && mutualRating >= 3);
  const quality = computeQualityMultiplier({
    isDisputeFree,
    roundsUsed,
    maxRounds,
    mutualPositiveRating,
    consecutiveDeals: params.consecutiveDealsOverride ?? 0,
    trustScore,
  });

  // 3. Compute agent XP
  const existingAgent = await db
    .select()
    .from(agentLevels)
    .where(eq(agentLevels.userId, userId))
    .limit(1);

  const consecutiveWins = existingAgent[0]
    ? (isDeal ? existingAgent[0].consecutiveDeals + 1 : 0)
    : (isDeal ? 1 : 0);

  const baseXP = computeXP(outcome, amount, consecutiveWins, isJuryVerdict, isDisputeFree);
  const xpGained = Math.floor(baseXP * ratingMultiplier);
  let currentTotalXP: number;

  if (existingAgent[0]) {
    currentTotalXP = existingAgent[0].xp + xpGained;
    const newLevel = resolveLevel(currentTotalXP, AGENT_LEVEL_TABLE);
    const totalDeals = existingAgent[0].totalDeals + (isDeal ? 1 : 0);
    const totalTrades = existingAgent[0].totalTrades + 1;
    const totalVolume = Number(existingAgent[0].totalVolume) + amount;
    const totalSaved = Number(existingAgent[0].totalSaved) + (amount * savingPct);
    const newAvgSaving = totalVolume > 0 ? (totalSaved / totalVolume).toString() : "0";
    const newBestSaving = Math.max(Number(existingAgent[0].bestSavingPct), savingPct);

    await db.update(agentLevels).set({
      xp: currentTotalXP,
      level: newLevel,
      totalTrades,
      totalDeals,
      totalVolume: totalVolume.toFixed(2),
      totalSaved: totalSaved.toFixed(2),
      avgSavingPct: newAvgSaving,
      bestSavingPct: newBestSaving.toFixed(4),
      consecutiveDeals: consecutiveWins,
      updatedAt: new Date(),
    }).where(eq(agentLevels.userId, userId));
  } else {
    currentTotalXP = xpGained;
    const newLevel = resolveLevel(currentTotalXP, AGENT_LEVEL_TABLE);

    await db.insert(agentLevels).values({
      userId,
      xp: currentTotalXP,
      level: newLevel,
      totalTrades: 1,
      totalDeals: isDeal ? 1 : 0,
      totalVolume: amount.toFixed(2),
      totalSaved: (amount * savingPct).toFixed(2),
      avgSavingPct: savingPct.toFixed(4),
      bestSavingPct: savingPct.toFixed(4),
      consecutiveDeals: consecutiveWins,
    });
  }

  // 4. HC reward
  const hcReward = isDeal ? computeTradeHC(amount, mutualPositiveRating) : { tradeReward: 0, ratingBonus: 0, total: 0 };

  // 5. Create buddy egg (DEAL only, both sides get one)
  let newBuddyId: string | null = null;
  let species: Species | null = null;
  let rarity: Rarity | null = null;

  if (isDeal) {
    species = mapCategoryToSpecies(category);

    const [{ value: totalMinted }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(buddies)
      .where(eq(buddies.species, species));

    // Check pity ceiling from agentLevels
    let pityGuarantee: "EPIC" | "LEGENDARY" | null = null;
    if (existingAgent[0] && amount >= PITY_MIN_TRADE_AMOUNT) {
      pityGuarantee = checkPityCeiling(
        Number(existingAgent[0].pityVolumeEpic),
        existingAgent[0].pityTradesEpic,
        Number(existingAgent[0].pityVolumeLegendary),
        existingAgent[0].pityTradesLegendary,
      );
    }

    rarity = computeRarity(amount, totalMinted, pityGuarantee ?? undefined);

    // Enforce mythic cap
    if (rarity === "MYTHIC") {
      const [{ value: mythicCount }] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(buddies)
        .where(and(eq(buddies.species, species), eq(buddies.rarity, "MYTHIC")));
      if (mythicCount >= MYTHIC_CAP) rarity = "LEGENDARY";
    }

    // Auto-hatch: create as ACTIVE directly (no EGG waiting)
    const ability = getAbilityForBuddy(species, rarity);
    const now = new Date();

    const [newBuddy] = await db.insert(buddies).values({
      userId,
      species,
      rarity,
      birthTradeId: sessionId,
      birthCategory: category,
      birthSkills: skillsUsed,
      birthPreset: presetUsed ?? null,
      birthSavingPct: savingPct.toFixed(4),
      status: "ACTIVE",
      hatchedAt: now,
      ability: Array.isArray(ability) ? ability : ability ? ability : null,
      abilityUnlockedAt: ability ? now : null,
    }).returning();

    newBuddyId = newBuddy!.id;

    // Update pity counters
    if (amount >= PITY_MIN_TRADE_AMOUNT) {
      const effectiveVolume = amount * quality.total; // quality-weighted volume

      if (rarity === "LEGENDARY" || rarity === "MYTHIC") {
        // Got LEGENDARY+, reset both pity counters
        await db.update(agentLevels).set({
          pityVolumeEpic: "0",
          pityTradesEpic: 0,
          pityVolumeLegendary: "0",
          pityTradesLegendary: 0,
        }).where(eq(agentLevels.userId, userId));
      } else if (rarity === "EPIC") {
        // Got EPIC, reset epic pity, accumulate legendary
        const prevLegVol = existingAgent[0] ? Number(existingAgent[0].pityVolumeLegendary) : 0;
        const prevLegTrades = existingAgent[0] ? existingAgent[0].pityTradesLegendary : 0;
        await db.update(agentLevels).set({
          pityVolumeEpic: "0",
          pityTradesEpic: 0,
          pityVolumeLegendary: (prevLegVol + effectiveVolume).toFixed(2),
          pityTradesLegendary: prevLegTrades + 1,
        }).where(eq(agentLevels.userId, userId));
      } else {
        // COMMON~RARE: accumulate both pity counters
        const prevEpicVol = existingAgent[0] ? Number(existingAgent[0].pityVolumeEpic) : 0;
        const prevEpicTrades = existingAgent[0] ? existingAgent[0].pityTradesEpic : 0;
        const prevLegVol = existingAgent[0] ? Number(existingAgent[0].pityVolumeLegendary) : 0;
        const prevLegTrades = existingAgent[0] ? existingAgent[0].pityTradesLegendary : 0;
        await db.update(agentLevels).set({
          pityVolumeEpic: (prevEpicVol + effectiveVolume).toFixed(2),
          pityTradesEpic: prevEpicTrades + 1,
          pityVolumeLegendary: (prevLegVol + effectiveVolume).toFixed(2),
          pityTradesLegendary: prevLegTrades + 1,
        }).where(eq(agentLevels.userId, userId));
      }
    }
  }

  // 6. Handle equipped buddy participation
  let buddyXpGained = 0;
  if (buddyId && isDeal) {
    buddyXpGained = computeBuddyXP(xpGained);

    await db.insert(buddyTrades).values({
      buddyId,
      sessionId,
      category,
      skillsUsed,
      presetUsed: presetUsed ?? null,
      outcome,
      savingPct: savingPct.toFixed(4),
    });

    const [existingBuddy] = await db
      .select()
      .from(buddies)
      .where(eq(buddies.id, buddyId))
      .limit(1);

    if (existingBuddy) {
      const newBuddyXp = existingBuddy.buddyXp + buddyXpGained;
      const newBuddyLevel = resolveLevel(newBuddyXp, BUDDY_LEVEL_TABLE);
      const newTotalTrades = existingBuddy.totalTrades + 1;
      const outcomeKey = outcome.toLowerCase() as "deals" | "rejects" | "timeouts" | "walkaways";

      await db.update(buddies).set({
        buddyXp: newBuddyXp,
        buddyLevel: newBuddyLevel,
        totalTrades: newTotalTrades,
        [outcomeKey]: (existingBuddy[outcomeKey] ?? 0) + 1,
        avgSavingPct: (
          ((Number(existingBuddy.avgSavingPct) || 0) * existingBuddy.totalTrades + savingPct)
          / newTotalTrades
        ).toFixed(4),
        bestSavingPct: Math.max(Number(existingBuddy.bestSavingPct) || 0, savingPct).toFixed(4),
        updatedAt: new Date(),
      }).where(eq(buddies.id, buddyId));
    }
  }

  return {
    agentXP: xpGained,
    buddyXP: buddyXpGained,
    agentTotalXP: currentTotalXP,
    agentLevel: resolveLevel(currentTotalXP, AGENT_LEVEL_TABLE),
    newBuddyId,
    species,
    rarity,
    hcReward,
    qualityMultiplier: quality,
  };
}

// ---------------------------------------------------------------------------
// Service: hatchEgg
// ---------------------------------------------------------------------------

export async function hatchEgg(db: Database, buddyId: string) {
  const [buddy] = await db.select().from(buddies).where(eq(buddies.id, buddyId)).limit(1);

  if (!buddy) return { ok: false as const, error: "BUDDY_NOT_FOUND" };
  if (buddy.status !== "EGG") return { ok: false as const, error: "NOT_AN_EGG" };

  const ability = getAbilityForBuddy(buddy.species as Species, buddy.rarity as Rarity);

  const [hatched] = await db.update(buddies).set({
    status: "ACTIVE",
    hatchedAt: new Date(),
    ability,
    abilityUnlockedAt: ability ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(buddies.id, buddyId)).returning();

  return { ok: true as const, buddy: hatched };
}

// ---------------------------------------------------------------------------
// Service: Awaken System
// ---------------------------------------------------------------------------

export async function checkAwakenEligibility(db: Database, buddyId: string) {
  const [buddy] = await db.select().from(buddies).where(eq(buddies.id, buddyId)).limit(1);

  if (!buddy) return { eligible: false as const, reason: "BUDDY_NOT_FOUND" };

  const rarity = buddy.rarity as Rarity;
  if (rarity !== "LEGENDARY" && rarity !== "MYTHIC") {
    return { eligible: false as const, reason: "RARITY_TOO_LOW" };
  }
  if (buddy.buddyLevel < 50) {
    return { eligible: false as const, reason: "BUDDY_LEVEL_TOO_LOW" };
  }
  if (buddy.isAwakened) {
    return { eligible: false as const, reason: "ALREADY_AWAKENED" };
  }

  // Check agent is top 100 or top 1%
  const [{ value: totalAgents }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(agentLevels);

  const top1pctThreshold = Math.max(Math.ceil(totalAgents * 0.01), 1);
  const rankThreshold = Math.min(100, top1pctThreshold);

  const topAgents = await db
    .select({ userId: agentLevels.userId })
    .from(agentLevels)
    .orderBy(desc(agentLevels.xp))
    .limit(rankThreshold);

  const isTopAgent = topAgents.some(a => a.userId === buddy.userId);

  if (!isTopAgent) return { eligible: false as const, reason: "AGENT_RANK_TOO_LOW" };

  const maxPerks = rarity === "MYTHIC" ? 5 : 4;
  const available = getAvailablePerks(buddy.species as Species);

  return { eligible: true as const, maxPerks, availablePerks: available };
}

export async function awakenBuddy(db: Database, buddyId: string, selectedPerkIds: string[]) {
  const eligibility = await checkAwakenEligibility(db, buddyId);
  if (!eligibility.eligible) return { ok: false as const, error: eligibility.reason };

  const { maxPerks, availablePerks } = eligibility;

  if (selectedPerkIds.length !== maxPerks) {
    return { ok: false as const, error: `MUST_SELECT_EXACTLY_${maxPerks}_PERKS` };
  }

  const availableIds = new Set(availablePerks.map(p => p.id));
  if (selectedPerkIds.some(id => !availableIds.has(id))) {
    return { ok: false as const, error: "INVALID_PERK_IDS" };
  }
  if (new Set(selectedPerkIds).size !== selectedPerkIds.length) {
    return { ok: false as const, error: "DUPLICATE_PERKS" };
  }

  const [awakened] = await db.update(buddies).set({
    isAwakened: true,
    awakenPerks: selectedPerkIds,
    awakenedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(buddies.id, buddyId)).returning();

  return { ok: true as const, buddy: awakened };
}

// ---------------------------------------------------------------------------
// Service: applyBuddyAbility
// ---------------------------------------------------------------------------

export function applyBuddyAbility(
  ability: BuddyAbility,
  _pipelineContext: Record<string, unknown>,
): PipelineModification[] {
  const multiplier = ability.enhanced ? 2 : 1;
  const source = `buddy_ability:${ability.id}`;

  switch (ability.effect) {
    // LEGENDARY abilities (symmetric/public data only)
    case "market_price_hint":
      return [{ field: "includeMarketPrice", action: "set", value: true, source }];
    case "demand_signal":
      return [{ field: "includeDemandSignal", action: "set", value: true, source }];
    case "extra_round":
      return [{ field: "maxRounds", action: "add", value: 1 * multiplier, source }];
    case "practical_value_hint":
      return [{ field: "includePracticalValue", action: "set", value: true, source }];
    case "condition_insight":
      return [{ field: "includeConditionInsight", action: "set", value: true, source }];
    case "gem_market_hint":
      return [{ field: "includeGemMarket", action: "set", value: true, source }];
    case "comparable_hint":
      return [{ field: "includeComparables", action: "set", value: true, source }];
    case "no_category_penalty":
      return [{ field: "noCategoryXpPenalty", action: "set", value: true, source }];

    // MYTHIC unique abilities
    case "market_forecast":
      return [{ field: "includeMarketForecast", action: "set", value: true, source }];
    case "resale_value_data":
      return [{ field: "includeResaleData", action: "set", value: true, source }];
    case "double_endurance":
      return [
        { field: "maxRounds", action: "add", value: 2, source },
        { field: "longDealXpBonus", action: "set", value: true, source },
      ];
    case "mutual_satisfaction_hc":
      return [{ field: "mutualSatisfactionHcBonus", action: "set", value: true, source }];
    case "master_appraisal":
      return [
        { field: "includeConditionInsight", action: "set", value: true, source },
        { field: "includeProvenanceCheck", action: "set", value: true, source },
      ];
    case "guaranteed_bonus_egg":
      return [{ field: "guaranteedBonusEgg", action: "set", value: true, source }];
    case "triple_comparable":
      return [{ field: "includeComparables", action: "set", value: true, source },
              { field: "comparableCount", action: "set", value: 3, source }];
    case "universal_xp_boost":
      return [
        { field: "noCategoryXpPenalty", action: "set", value: true, source },
        { field: "xpMultiplier", action: "multiply", value: 1.15, source },
      ];
    default:
      return [];
  }
}
