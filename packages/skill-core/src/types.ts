/** Skill categories — what kind of capability the skill provides */
export type SkillCategory =
  | "STRATEGY"
  | "DATA"
  | "INTERPRETATION"
  | "AUTHENTICATION"
  | "DISPUTE_RESOLUTION";

/** Skill lifecycle status in the registry */
export type SkillStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "DEPRECATED";

/** Who provides the skill */
export type SkillProvider = "FIRST_PARTY" | "THIRD_PARTY" | "COMMUNITY";

/** When in the negotiation pipeline a skill can be invoked */
export type HookPoint =
  | "PRE_SESSION"
  | "PRE_ROUND"
  | "POST_ROUND"
  | "POST_SESSION"
  | "ON_DISPUTE_OPEN"
  | "ON_DISPUTE_EVIDENCE"
  | "ON_LISTING_CREATE"
  | "ON_MATCH";

/** Pricing model for skill usage */
export type PricingModel = "FREE" | "PER_USE" | "SUBSCRIPTION" | "REVENUE_SHARE";

export interface SkillPricing {
  model: PricingModel;
  perUseCents?: number;
  monthlySubscriptionCents?: number;
  revenueSharePercent?: number;
}

export interface SkillManifest {
  skillId: string;
  name: string;
  description: string;
  version: string;
  category: SkillCategory;
  provider: SkillProvider;
  supportedCategories: string[];
  hookPoints: HookPoint[];
  pricing: SkillPricing;
  configSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RegisteredSkill {
  manifest: SkillManifest;
  status: SkillStatus;
  registeredAt: string;
  updatedAt: string;
  usageCount: number;
  averageLatencyMs: number;
  errorRate: number;
}

export interface SkillInput {
  hookPoint: HookPoint;
  context: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface SkillOutput {
  skillId: string;
  hookPoint: HookPoint;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
}
