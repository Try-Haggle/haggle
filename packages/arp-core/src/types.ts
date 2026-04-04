// ---------------------------------------------------------------------------
// Amount Tiers
// ---------------------------------------------------------------------------

export type AmountTier = "MICRO" | "LOW" | "MID" | "HIGH" | "PREMIUM" | "ULTRA";

/** Boundaries in minor units (cents). Upper bound is exclusive. */
export const AMOUNT_TIER_BOUNDARIES: Record<AmountTier, { min_minor: number; max_minor: number }> = {
  MICRO:   { min_minor:    1_000, max_minor:     5_000 },   // $10 – $50
  LOW:     { min_minor:    5_001, max_minor:    20_000 },   // $51 – $200
  MID:     { min_minor:   20_001, max_minor:   100_000 },   // $201 – $1,000
  HIGH:    { min_minor:  100_001, max_minor:   500_000 },   // $1,001 – $5,000
  PREMIUM: { min_minor:  500_001, max_minor: 5_000_000 },   // $5,001 – $50,000
  ULTRA:   { min_minor: 5_000_001, max_minor: Infinity },   // $50,001+
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type Category =
  | "BOOKS_MEDIA"
  | "CLOTHING"
  | "ELECTRONICS_SMALL"
  | "ELECTRONICS_LARGE"
  | "COLLECTIBLES"
  | "LUXURY_FASHION"
  | "JEWELRY"
  | "SPORTS_OUTDOOR"
  | "HOME_GARDEN"
  | "VEHICLES"
  | "VEHICLE_PARTS"
  | "REAL_ESTATE"
  | "HEAVY_EQUIPMENT"
  | "MUSICAL_INSTRUMENTS"
  | "ART"
  | "OTHER";

// ---------------------------------------------------------------------------
// Tag lifecycle
// ---------------------------------------------------------------------------

export type TagStatus = "CANDIDATE" | "EMERGING" | "OFFICIAL" | "DEPRECATED";

// ---------------------------------------------------------------------------
// Cold-start defaults (hours)
// ---------------------------------------------------------------------------

export const COLD_START_BY_CATEGORY: Record<Category, number> = {
  CLOTHING: 24,
  BOOKS_MEDIA: 24,
  COLLECTIBLES: 48,
  SPORTS_OUTDOOR: 48,
  HOME_GARDEN: 48,
  ELECTRONICS_SMALL: 48,
  ELECTRONICS_LARGE: 72,
  LUXURY_FASHION: 72,
  JEWELRY: 72,
  MUSICAL_INSTRUMENTS: 72,
  ART: 72,
  VEHICLE_PARTS: 48,
  VEHICLES: 168,
  HEAVY_EQUIPMENT: 168,
  REAL_ESTATE: 336,
  OTHER: 36,
};

export const COLD_START_BY_AMOUNT: Record<AmountTier, number> = {
  MICRO: 24,
  LOW: 36,
  MID: 48,
  HIGH: 72,
  PREMIUM: 120,
  ULTRA: 168,
};

// ---------------------------------------------------------------------------
// Segment
// ---------------------------------------------------------------------------

export interface SegmentKey {
  category?: Category;
  amount_tier?: AmountTier;
  tag?: string;
}

export interface SegmentData {
  key: SegmentKey;
  review_hours: number;
  sample_count: number;
  last_adjusted_at?: string;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface SignalMetrics {
  total_actions: number;
  late_disputes: number;
  late_valid_disputes: number;
  discovery_p90_hours: number;
  auto_confirms: number;
  buyer_valid_disputes: number;
}

export type SignalDirection = "INCREASE" | "DECREASE" | "HOLD";

export interface SignalDetail {
  name: string;
  triggered: boolean;
  value: number;
  threshold: number;
  magnitude: number;
}

export interface SignalResult {
  signals: SignalDetail[];
  net_magnitude: number;
  direction: SignalDirection;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface AdjustmentResult {
  segment_key: SegmentKey;
  previous_hours: number;
  new_hours: number;
  step_count: number;
  direction: SignalDirection;
  signals: SignalResult;
  skipped: boolean;
  skip_reason?: string;
}

// ---------------------------------------------------------------------------
// Meta-Tuner
// ---------------------------------------------------------------------------

export interface ArpCycleHistory {
  direction: SignalDirection;
  magnitude: number;
  cycle_index: number;
}

export interface MetaTunerResult {
  cycle_days: number;
  max_steps_per_cycle: number;
  step_hours: number;
  adjustments: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SignalThresholds {
  late_dispute_rate: number;
  late_valid_dispute_rate: number;
  discovery_p90_ratio: number;
  auto_confirm_rate: number;
  buyer_valid_rate: number;
}

export interface ArpConfig {
  step_hours: number;
  max_steps_per_cycle: number;
  min_hours: number;
  max_hours: number;
  min_sample_count: number;
  cycle_days: number;
  magnitude_per_step: number;
  thresholds: SignalThresholds;
}

export const DEFAULT_SIGNAL_THRESHOLDS: SignalThresholds = {
  late_dispute_rate: 0.15,
  late_valid_dispute_rate: 0.10,
  discovery_p90_ratio: 0.70,
  auto_confirm_rate: 0.95,
  buyer_valid_rate: 0.03,
};

export const DEFAULT_ARP_CONFIG: ArpConfig = {
  step_hours: 6,
  max_steps_per_cycle: 2,
  min_hours: 24,
  max_hours: 336,
  min_sample_count: 30,
  cycle_days: 14,
  magnitude_per_step: 2,
  thresholds: DEFAULT_SIGNAL_THRESHOLDS,
};
