export type NegotiationPresetId = "safe_buyer" | "balanced_closer" | "lowest_price" | "fast_close";

export type TermEnforcement = "hard" | "soft" | "deal_breaker";

export type AdvisorMemoryLike = {
  categoryInterest?: string;
  budgetMax?: number;
  targetPrice?: number;
  mustHave?: string[];
  avoid?: string[];
  riskStyle?: "safe_first" | "balanced" | "lowest_price";
  negotiationStyle?: "defensive" | "balanced" | "aggressive";
  openingTactic?: "condition_anchor" | "fair_market_anchor" | "speed_close";
  source?: string[];
  structured?: {
    activeIntent?: {
      productScope?: string;
    };
    pendingSlots?: Array<{
      slotId: string;
      question?: string;
      enforcement?: "hard" | "soft";
      productScope?: string;
      status: "pending" | "ambiguous";
    }>;
    productRequirements?: Record<string, {
      mustHave?: string[];
      avoid?: string[];
      answeredSlots?: string[];
      ambiguousSlots?: string[];
    }>;
    globalPreferences?: {
      mustHave?: string[];
      avoid?: string[];
      budgetMax?: number;
      targetPrice?: number;
    };
  };
};

export type PresetListingInput = {
  id: string;
  title: string;
  category?: string;
  condition: string;
  askPriceMinor: number;
  floorPriceMinor?: number;
  marketMedianMinor?: number;
  tags: string[];
  sellerNote?: string;
};

export type TagTermRequirement = {
  tag: string;
  termId: string;
  label: string;
  enforcement: TermEnforcement;
  question: string;
  appliesToPresets: NegotiationPresetId[];
  defaultImportance: "low" | "medium" | "high";
  evidenceSource: "listing" | "memory" | "user" | "seller_reply";
};

export type PresetTermDraft = {
  termId: string;
  label: string;
  enforcement: TermEnforcement;
  source: "listing" | "memory" | "preset" | "tag";
  question: string;
  rationale: string;
  checked: boolean;
  confirmedValue?: {
    value: string | number | boolean;
    label?: string;
    unit?: string;
    source: "listing" | "memory" | "user" | "seller_reply";
  };
};

export type PresetLeverageDraft = {
  termId: string;
  label: string;
  reason: string;
  priceImpactMinor: number;
  source: "listing" | "memory" | "preset" | "tag";
  enabled: boolean;
};

export type PresetWalkAwayDraft = {
  id: string;
  label: string;
  reason: string;
  source: "listing" | "memory" | "preset" | "tag";
  enabled: boolean;
};

export type PresetEngineReview = {
  cycle: "design_architecture_implementation_review";
  status: "ready" | "needs_user_input" | "blocked";
  branches: Array<{
    id: string;
    label: string;
    outcome: "continue" | "ask_user" | "block";
    reason: string;
  }>;
  blockers: Array<{
    id: string;
    label: string;
    severity: "hard" | "soft";
    source: "listing" | "memory" | "tag" | "security";
    reason: string;
  }>;
  nextActions: Array<{
    termId?: string;
    label: string;
    control: "toggle" | "slider" | "select" | "text";
    question: string;
    controlConfig?: {
      unit?: string;
      min?: number;
      max?: number;
      step?: number;
      defaultValue?: string | number | boolean;
      placeholder?: string;
      options?: Array<{ value: string; label: string }>;
    };
  }>;
};

export type PresetListingSnapshot = {
  id: string;
  title: string;
  category?: string;
  askPriceMinor: number;
  marketMedianMinor?: number;
  tags: string[];
};

export type PresetTuningDraft = {
  draftId: string;
  presetId: NegotiationPresetId;
  presetLabel: string;
  listing: PresetListingSnapshot;
  priceCapMinor: number;
  openingOfferMinor: number;
  maxAgreementMinor: number;
  concessionSpeed: "slow" | "medium" | "fast";
  riskTolerance: "low" | "medium" | "high";
  strategyNotes: string[];
  mustVerify: PresetTermDraft[];
  leverage: PresetLeverageDraft[];
  walkAway: PresetWalkAwayDraft[];
  engineReview: PresetEngineReview;
  sourceBadges: Array<"listing" | "memory" | "preset" | "tag">;
  negotiationStartPayload: {
    listing: PresetListingSnapshot;
    preset_id: NegotiationPresetId;
    price_cap_minor: number;
    opening_offer_minor: number;
    tuning_draft: {
      must_verify: PresetTermDraft[];
        leverage: PresetLeverageDraft[];
        walk_away: PresetWalkAwayDraft[];
        concession_speed: "slow" | "medium" | "fast";
        risk_tolerance: "low" | "medium" | "high";
        engine_review: PresetEngineReview;
      };
    memory_snapshot: {
      categoryInterest?: string;
      budgetMax?: number;
      targetPrice?: number;
      mustHave: string[];
      avoid: string[];
      source: string[];
    };
  };
};

type PresetConfig = {
  id: NegotiationPresetId;
  label: string;
  openingMultiplier: number;
  concessionSpeed: PresetTuningDraft["concessionSpeed"];
  riskTolerance: PresetTuningDraft["riskTolerance"];
  notes: string[];
};

const PRESETS: Record<NegotiationPresetId, PresetConfig> = {
  safe_buyer: {
    id: "safe_buyer",
    label: "Safe Buyer",
    openingMultiplier: 0.8,
    concessionSpeed: "slow",
    riskTolerance: "low",
    notes: [
      "검증되지 않은 hard term은 협상 전에 확인한다.",
      "가격보다 fraud/condition 리스크를 먼저 제한한다.",
    ],
  },
  balanced_closer: {
    id: "balanced_closer",
    label: "Balanced Closer",
    openingMultiplier: 0.84,
    concessionSpeed: "medium",
    riskTolerance: "medium",
    notes: [
      "시장가와 listing 상태를 같이 보고 적당한 anchor를 잡는다.",
      "중요 term은 확인하되 거래 속도를 과하게 늦추지 않는다.",
    ],
  },
  lowest_price: {
    id: "lowest_price",
    label: "Lowest Price",
    openingMultiplier: 0.72,
    concessionSpeed: "slow",
    riskTolerance: "high",
    notes: [
      "상태/구성품/불확실성을 가격 인하 근거로 적극 사용한다.",
      "cap을 넘는 합의는 허용하지 않는다.",
    ],
  },
  fast_close: {
    id: "fast_close",
    label: "Fast Close",
    openingMultiplier: 0.9,
    concessionSpeed: "fast",
    riskTolerance: "medium",
    notes: [
      "deal breaker만 빠르게 확인하고 합의 가능성을 높인다.",
      "opening offer는 cap에 가깝지만 cap 자체는 절대 넘지 않는다.",
    ],
  },
};

const IPHONE_TAG = "electronics/phones/iphone";
const MACBOOK_TAG = "electronics/laptops/macbook";

const IPHONE_TERMS: TagTermRequirement[] = [
  {
    tag: IPHONE_TAG,
    termId: "battery_health",
    label: "Battery health",
    enforcement: "hard",
    question: "Battery health is not explicit enough. What percentage is shown in Settings?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "listing",
  },
  {
    tag: IPHONE_TAG,
    termId: "carrier_lock",
    label: "Carrier unlock",
    enforcement: "hard",
    question: "Is it fully unlocked, not just compatible with one carrier?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "listing",
  },
  {
    tag: IPHONE_TAG,
    termId: "find_my_status",
    label: "Find My off",
    enforcement: "deal_breaker",
    question: "Can the seller confirm Find My is off before checkout?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "seller_reply",
  },
  {
    tag: IPHONE_TAG,
    termId: "imei_verification",
    label: "Clean IMEI",
    enforcement: "deal_breaker",
    question: "Can the seller provide clean IMEI confirmation?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price"],
    defaultImportance: "high",
    evidenceSource: "seller_reply",
  },
  {
    tag: IPHONE_TAG,
    termId: "storage_capacity",
    label: "Storage capacity",
    enforcement: "soft",
    question: "Which storage capacity is this exact listing?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "medium",
    evidenceSource: "listing",
  },
  {
    tag: IPHONE_TAG,
    termId: "screen_condition",
    label: "Screen condition",
    enforcement: "hard",
    question: "Are there scratches, cracks, or any screen replacement history?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "listing",
  },
  {
    tag: IPHONE_TAG,
    termId: "original_accessories",
    label: "Original box/accessories",
    enforcement: "soft",
    question: "Are the original box or accessories included?",
    appliesToPresets: ["balanced_closer", "lowest_price"],
    defaultImportance: "medium",
    evidenceSource: "listing",
  },
];

const MACBOOK_TERMS: TagTermRequirement[] = [
  {
    tag: MACBOOK_TAG,
    termId: "battery_cycle_count",
    label: "Battery cycle count",
    enforcement: "hard",
    question: "What is the exact battery cycle count shown in System Settings?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "listing",
  },
  {
    tag: MACBOOK_TAG,
    termId: "keyboard_condition",
    label: "Keyboard condition",
    enforcement: "hard",
    question: "Do all keys work without sticky, double-press, or backlight issues?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "listing",
  },
  {
    tag: MACBOOK_TAG,
    termId: "applecare_status",
    label: "AppleCare status",
    enforcement: "soft",
    question: "Is AppleCare active, expired, or never included?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price"],
    defaultImportance: "medium",
    evidenceSource: "listing",
  },
  {
    tag: MACBOOK_TAG,
    termId: "storage_capacity",
    label: "Storage capacity",
    enforcement: "soft",
    question: "Which SSD capacity is this exact MacBook?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "medium",
    evidenceSource: "listing",
  },
  {
    tag: MACBOOK_TAG,
    termId: "screen_condition",
    label: "Screen condition",
    enforcement: "hard",
    question: "Are there scratches, dead pixels, coating wear, or screen replacement history?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "listing",
  },
  {
    tag: MACBOOK_TAG,
    termId: "activation_lock",
    label: "Activation Lock off",
    enforcement: "deal_breaker",
    question: "Can the seller confirm Activation Lock / Find My Mac is off before checkout?",
    appliesToPresets: ["safe_buyer", "balanced_closer", "lowest_price", "fast_close"],
    defaultImportance: "high",
    evidenceSource: "seller_reply",
  },
];

export function compilePresetTuningDraft(params: {
  listing: PresetListingInput;
  memory?: AdvisorMemoryLike | null;
  presetId?: NegotiationPresetId;
  priceCapMinor?: number;
}): PresetTuningDraft {
  const listing = params.listing;
  const memory = params.memory ?? {};
  const presetId = params.presetId ?? presetFromMemory(memory);
  const preset = PRESETS[presetId] ?? PRESETS.balanced_closer;
  const facts = listingFacts(listing);
  const memoryFacts = memoryText(memory);
  const priceCapMinor = normalizeCap(params.priceCapMinor, memory, listing);
  const terms = resolveTerms(listing, presetId, facts, memoryFacts);
  const leverage = resolveLeverage(listing, memory, facts, memoryFacts, presetId);
  const walkAway = resolveWalkAway(listing, facts, memoryFacts, presetId);
  const engineReview = buildEngineReview(listing, memory, terms, facts);
  const leverageImpact = leverage
    .filter((item) => item.enabled)
    .reduce((sum, item) => sum + item.priceImpactMinor, 0);
  const rawOpening = Math.round(listing.askPriceMinor * preset.openingMultiplier) - leverageImpact;
  const openingOfferMinor = clampOffer(rawOpening, listing, priceCapMinor, presetId);
  const sourceBadges = Array.from(new Set([
    "listing",
    "preset",
    "tag",
    ...(memoryHasUsefulSignals(memory) ? ["memory" as const] : []),
  ])) as PresetTuningDraft["sourceBadges"];
  const memorySnapshot = {
    categoryInterest: memory.categoryInterest,
    budgetMax: memory.budgetMax,
    targetPrice: memory.targetPrice,
    mustHave: memory.mustHave ?? [],
    avoid: memory.avoid ?? [],
    source: memory.source ?? [],
  };

  const draft: Omit<PresetTuningDraft, "negotiationStartPayload"> = {
    draftId: makeDraftId(listing, presetId, priceCapMinor),
    presetId,
    presetLabel: preset.label,
    listing: {
      id: listing.id,
      title: listing.title,
      category: listing.category,
      askPriceMinor: listing.askPriceMinor,
      marketMedianMinor: listing.marketMedianMinor,
      tags: listing.tags,
    },
    priceCapMinor,
    openingOfferMinor,
    maxAgreementMinor: priceCapMinor,
    concessionSpeed: preset.concessionSpeed,
    riskTolerance: preset.riskTolerance,
    strategyNotes: resolveStrategyNotes(preset, memory, facts, memoryFacts),
    mustVerify: terms,
    leverage,
    walkAway,
    engineReview,
    sourceBadges,
  };

  return {
    ...draft,
    negotiationStartPayload: {
      listing: draft.listing,
      preset_id: draft.presetId,
      price_cap_minor: draft.priceCapMinor,
      opening_offer_minor: draft.openingOfferMinor,
      tuning_draft: {
        must_verify: draft.mustVerify,
        leverage: draft.leverage,
        walk_away: draft.walkAway,
        concession_speed: draft.concessionSpeed,
        risk_tolerance: draft.riskTolerance,
        engine_review: draft.engineReview,
      },
      memory_snapshot: memorySnapshot,
    },
  };
}

export function listNegotiationPresets() {
  return Object.values(PRESETS).map((preset) => ({
    id: preset.id,
    label: preset.label,
    concessionSpeed: preset.concessionSpeed,
    riskTolerance: preset.riskTolerance,
    notes: preset.notes,
  }));
}

function presetFromMemory(memory: AdvisorMemoryLike): NegotiationPresetId {
  if (memory.riskStyle === "safe_first" || memory.negotiationStyle === "defensive") return "safe_buyer";
  if (memory.riskStyle === "lowest_price" || memory.negotiationStyle === "aggressive") return "lowest_price";
  if (memory.openingTactic === "speed_close") return "fast_close";
  return "balanced_closer";
}

function normalizeCap(priceCapMinor: number | undefined, memory: AdvisorMemoryLike, listing: PresetListingInput): number {
  if (priceCapMinor && Number.isFinite(priceCapMinor) && priceCapMinor > 0) return priceCapMinor;
  if (memory.budgetMax && Number.isFinite(memory.budgetMax) && memory.budgetMax > 0) return Math.round(memory.budgetMax * 100);
  return Math.max(1, Math.min(listing.askPriceMinor, listing.marketMedianMinor ?? listing.askPriceMinor));
}

function resolveTerms(
  listing: PresetListingInput,
  presetId: NegotiationPresetId,
  facts: ReturnType<typeof listingFacts>,
  memoryFacts: string,
): PresetTermDraft[] {
  const terms = tagTermsForListing(listing)
    .filter((term) => term.appliesToPresets.includes(presetId));

  return terms.map((term) => {
    const observed = termObserved(term.termId, facts);
    const memoryMentions = memoryFacts.includes(term.termId.replace(/_/g, " "))
      || memoryFacts.includes(term.label.toLowerCase());
    const source = memoryMentions ? "memory" : observed ? "listing" : "tag";
    const checked = observed && term.enforcement !== "deal_breaker";

    return {
      termId: term.termId,
      label: term.label,
      enforcement: elevateEnforcement(term, presetId),
      source,
      question: term.question,
      rationale: termRationale(term.termId, observed, memoryMentions, facts),
      checked,
      confirmedValue: observed ? observedConfirmedValue(term.termId, facts, source) : undefined,
    };
  });
}

function observedConfirmedValue(
  termId: string,
  facts: ReturnType<typeof listingFacts>,
  source: PresetTermDraft["source"],
): PresetTermDraft["confirmedValue"] {
  const confirmedSource = source === "memory" ? "memory" : "listing";
  switch (termId) {
    case "battery_health":
      return facts.batteryHealth !== null
        ? { value: facts.batteryHealth, unit: "%", label: `${facts.batteryHealth}%`, source: confirmedSource }
        : undefined;
    case "battery_cycle_count":
      return facts.batteryCycleCount !== null
        ? { value: facts.batteryCycleCount, unit: "cycles", label: `${facts.batteryCycleCount} cycles`, source: confirmedSource }
        : undefined;
    case "storage_capacity":
      return facts.storageGb !== null
        ? { value: facts.storageGb, unit: "GB", label: facts.storageGb >= 1024 ? `${facts.storageGb / 1024}TB` : `${facts.storageGb}GB`, source: confirmedSource }
        : undefined;
    case "carrier_lock":
      return facts.unlocked ? { value: true, label: "Unlocked", source: confirmedSource } : undefined;
    case "screen_condition":
      return facts.screenClear && !facts.screenRisk && !facts.hasVisibleWear
        ? { value: "clear", label: "Screen clear", source: confirmedSource }
        : undefined;
    case "imei_verification":
      return facts.cleanImei ? { value: true, label: "Clean IMEI", source: confirmedSource } : undefined;
    case "keyboard_condition":
      return facts.keyboardClear ? { value: true, label: "Keyboard works", source: confirmedSource } : undefined;
    case "applecare_status":
      if (facts.appleCareDenied) return { value: "not_included", label: "AppleCare not included", source: confirmedSource };
      return facts.appleCareMentioned ? { value: "mentioned", label: "AppleCare mentioned", source: confirmedSource } : undefined;
    case "activation_lock":
      return facts.activationLockMentioned === true ? { value: true, label: "Activation Lock off", source: confirmedSource } : undefined;
    default:
      return undefined;
  }
}

function elevateEnforcement(term: TagTermRequirement, presetId: NegotiationPresetId): TermEnforcement {
  if (presetId === "safe_buyer" && term.enforcement === "soft" && term.defaultImportance === "high") return "hard";
  if (presetId === "fast_close" && term.enforcement === "soft") return "soft";
  return term.enforcement;
}

function resolveLeverage(
  listing: PresetListingInput,
  memory: AdvisorMemoryLike,
  facts: ReturnType<typeof listingFacts>,
  memoryFacts: string,
  presetId: NegotiationPresetId,
): PresetLeverageDraft[] {
  const leverage: PresetLeverageDraft[] = [];
  const preferredBattery = preferredBatteryMin(memoryFacts);

  if (facts.batteryHealth !== null && preferredBattery !== null && facts.batteryHealth < preferredBattery) {
    leverage.push({
      termId: "battery_health",
      label: "Battery below preference",
      reason: `Memory prefers >=${preferredBattery}%, listing appears ${facts.batteryHealth}%.`,
      priceImpactMinor: batteryImpact(preferredBattery - facts.batteryHealth, presetId),
      source: "memory",
      enabled: true,
    });
  } else if (facts.batteryHealth !== null && facts.batteryHealth < 88) {
    leverage.push({
      termId: "battery_health",
      label: "Battery below strong resale range",
      reason: `Listing appears ${facts.batteryHealth}%, below the safer resale range.`,
      priceImpactMinor: batteryImpact(90 - facts.batteryHealth, presetId),
      source: "listing",
      enabled: presetId !== "fast_close",
    });
  }

  if (facts.hasVisibleWear || facts.screenRisk) {
    leverage.push({
      termId: "screen_condition",
      label: "Visible condition risk",
      reason: "Wear, scratches, cracks, or replacement uncertainty can justify a lower anchor.",
      priceImpactMinor: presetId === "lowest_price" ? 4500 : 2500,
      source: "listing",
      enabled: true,
    });
  }

  if (memory.avoid?.some((item) => /damage|scratch|crack|wear|파손|흠집|기스/i.test(item)) && (facts.hasVisibleWear || facts.screenRisk)) {
    leverage.push({
      termId: "condition_preference",
      label: "Conflicts with avoid list",
      reason: "The selected product touches a condition the buyer previously wanted to avoid.",
      priceImpactMinor: 3000,
      source: "memory",
      enabled: true,
    });
  }

  if (isIphoneListing(listing) && !facts.unlocked) {
    leverage.push({
      termId: "carrier_lock",
      label: "Unlock not confirmed",
      reason: "Carrier unlock is not clearly confirmed in the listing.",
      priceImpactMinor: presetId === "lowest_price" ? 3500 : 2000,
      source: "tag",
      enabled: presetId !== "fast_close",
    });
  }

  if (isMacbookListing(listing) && facts.batteryCycleCount !== null && facts.batteryCycleCount > 600) {
    leverage.push({
      termId: "battery_cycle_count",
      label: "High battery cycle count",
      reason: `Listing shows ${facts.batteryCycleCount} cycles, which can justify service-risk discounting.`,
      priceImpactMinor: presetId === "lowest_price" ? 6500 : 4000,
      source: "listing",
      enabled: presetId !== "fast_close",
    });
  }

  if (isMacbookListing(listing) && facts.appleCareDenied) {
    leverage.push({
      termId: "applecare_status",
      label: "AppleCare not included",
      reason: "No AppleCare shifts more repair risk to the buyer.",
      priceImpactMinor: presetId === "lowest_price" ? 3500 : 2000,
      source: "listing",
      enabled: presetId !== "fast_close",
    });
  }

  return leverage.slice(0, 5);
}

function resolveWalkAway(
  listing: PresetListingInput,
  facts: ReturnType<typeof listingFacts>,
  memoryFacts: string,
  presetId: NegotiationPresetId,
): PresetWalkAwayDraft[] {
  const strict = presetId === "safe_buyer";
  const walkAway: PresetWalkAwayDraft[] = [
    {
      id: "cap_exceeded",
      label: "Cap exceeded",
      reason: "Do not agree above the user-approved price cap.",
      source: "preset",
      enabled: true,
    },
  ];

  if (isIphoneListing(listing)) {
    walkAway.push({
      id: "find_my_not_confirmed",
      label: "Find My not confirmed off",
      reason: "Activation lock risk can make the phone unusable.",
      source: "tag",
      enabled: strict || presetId === "balanced_closer",
    });
    walkAway.push({
      id: "clean_imei_refused",
      label: "Clean IMEI refused",
      reason: "Refusal to confirm IMEI creates ownership/blacklist risk.",
      source: "tag",
      enabled: strict || presetId === "lowest_price",
    });
  }

  if (isMacbookListing(listing) && facts.activationLockMentioned !== true) {
    walkAway.push({
      id: "activation_lock_not_confirmed",
      label: "Activation Lock not confirmed off",
      reason: "Activation Lock can block setup after purchase.",
      source: "tag",
      enabled: strict || presetId === "balanced_closer",
    });
  }

  if (facts.batteryHealth !== null && facts.batteryHealth < 80) {
    walkAway.push({
      id: "battery_service_risk",
      label: "Battery service risk",
      reason: "Battery below 80% usually means service is soon required.",
      source: "listing",
      enabled: strict || /battery|배터리/.test(memoryFacts),
    });
  }

  return walkAway;
}

function buildEngineReview(
  listing: PresetListingInput,
  memory: AdvisorMemoryLike,
  terms: PresetTermDraft[],
  facts: ReturnType<typeof listingFacts>,
): PresetEngineReview {
  const blockers: PresetEngineReview["blockers"] = [];
  const branches: PresetEngineReview["branches"] = [];
  const nextActions: PresetEngineReview["nextActions"] = [];
  const productConflict = productScopeConflict(listing, memory);
  const missingHardTerms = terms.filter((term) => !term.checked && term.enforcement !== "soft");
  const ambiguousSlots = collectAmbiguousSlots(memory);

  branches.push({
    id: "context_scope",
    label: "Context scope",
    outcome: productConflict ? "block" : "continue",
    reason: productConflict
      ? productConflict.reason
      : "Current memory and listing can be evaluated in the same product scope.",
  });

  branches.push({
    id: "required_terms",
    label: "Required terms",
    outcome: missingHardTerms.length > 0 ? "ask_user" : "continue",
    reason: missingHardTerms.length > 0
      ? `${missingHardTerms.length} hard/deal-breaker term(s) still need confirmation.`
      : "Hard terms have usable listing evidence or user confirmation.",
  });

  branches.push({
    id: "payment_permission",
    label: "Payment permission",
    outcome: productConflict || missingHardTerms.length > 0 ? "ask_user" : "continue",
    reason: productConflict || missingHardTerms.length > 0
      ? "Do not create payment permission until scope and required terms are resolved."
      : "Draft can be converted into an AgentPaymentGrant after user confirmation.",
  });

  if (productConflict) {
    blockers.push({
      id: "product_scope_conflict",
      label: "Product scope conflict",
      severity: "hard",
      source: "memory",
      reason: productConflict.reason,
    });
    nextActions.push({
      label: "Confirm product scope",
      control: "select",
      question: productConflict.question,
      controlConfig: controlConfigForTerm("product_scope", "select", facts),
    });
  }

  for (const term of missingHardTerms) {
    const control = controlForTerm(term.termId, facts);
    blockers.push({
      id: `missing_${term.termId}`,
      label: term.label,
      severity: "hard",
      source: term.source === "preset" ? "tag" : term.source,
      reason: term.rationale,
    });
    nextActions.push({
      termId: term.termId,
      label: term.label,
      control,
      question: term.question,
      controlConfig: controlConfigForTerm(term.termId, control, facts),
    });
  }

  for (const slot of ambiguousSlots.slice(0, 3)) {
    const control = controlForTerm(slot, facts);
    blockers.push({
      id: `ambiguous_${slot}`,
      label: slotLabel(slot),
      severity: "soft",
      source: "memory",
      reason: "Memory marks this slot as ambiguous, so it should be resolved before the engine treats it as a durable preference.",
    });
    nextActions.push({
      termId: slot,
      label: slotLabel(slot),
      control,
      question: questionForAmbiguousSlot(slot),
      controlConfig: controlConfigForTerm(slot, control, facts),
    });
  }

  const hasHardBlocker = blockers.some((blocker) => blocker.severity === "hard" && blocker.id === "product_scope_conflict");
  const status: PresetEngineReview["status"] = hasHardBlocker
    ? "blocked"
    : blockers.length > 0 ? "needs_user_input" : "ready";

  return {
    cycle: "design_architecture_implementation_review",
    status,
    branches,
    blockers,
    nextActions: dedupeActions(nextActions).slice(0, 6),
  };
}

function productScopeConflict(
  listing: PresetListingInput,
  memory: AdvisorMemoryLike,
): { reason: string; question: string } | null {
  const listingKind = listingProductKind(listing);
  if (!listingKind) return null;

  const scopes = [
    memory.categoryInterest,
    memory.structured?.activeIntent?.productScope,
    ...(memory.source ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  const conflictingScope = scopes.find((scope) => {
    const scopeKind = textProductKind(scope);
    return scopeKind !== null && scopeKind !== listingKind;
  });

  if (!conflictingScope) return null;

  return {
    reason: `Memory points to ${conflictingScope}, but this listing looks like ${listingKind}.`,
    question: `이전 기억은 ${conflictingScope} 쪽이고 현재 상품은 ${listingKind}로 보입니다. 이 상품에 같은 조건을 적용할까요?`,
  };
}

function listingProductKind(listing: PresetListingInput): "iphone" | "macbook" | null {
  if (isIphoneListing(listing)) return "iphone";
  if (isMacbookListing(listing)) return "macbook";
  return null;
}

function textProductKind(text: string): "iphone" | "macbook" | null {
  if (/iphone|아이폰/.test(text)) return "iphone";
  if (/macbook|mac book|맥북/.test(text)) return "macbook";
  return null;
}

function collectAmbiguousSlots(memory: AdvisorMemoryLike): string[] {
  const structured = memory.structured;
  const slots = [
    ...(structured?.pendingSlots ?? [])
      .filter((slot) => slot.status === "ambiguous")
      .map((slot) => slot.slotId),
    ...Object.values(structured?.productRequirements ?? {})
      .flatMap((req) => req.ambiguousSlots ?? []),
  ];
  return Array.from(new Set(slots.filter(Boolean)));
}

function controlForTerm(termId: string, facts: ReturnType<typeof listingFacts>): PresetEngineReview["nextActions"][number]["control"] {
  if (/battery_health/.test(termId)) return "slider";
  if (/battery_cycle_count/.test(termId)) return "text";
  if (/carrier|lock|imei|find_my|activation/.test(termId)) return "toggle";
  if (/storage|model|scope/.test(termId) || facts.storageGb === null) return "select";
  return "text";
}

function controlConfigForTerm(
  termId: string,
  control: PresetEngineReview["nextActions"][number]["control"],
  facts: ReturnType<typeof listingFacts>,
): NonNullable<PresetEngineReview["nextActions"][number]["controlConfig"]> {
  if (termId === "battery_health") {
    return {
      unit: "%",
      min: 70,
      max: 100,
      step: 1,
      defaultValue: facts.batteryHealth ?? 90,
    };
  }
  if (termId === "battery_cycle_count") {
    return {
      unit: "cycles",
      placeholder: "예: 320",
      defaultValue: facts.batteryCycleCount ?? "",
    };
  }
  if (/carrier|lock|imei|find_my|activation/.test(termId)) {
    return {
      defaultValue: true,
    };
  }
  if (termId === "storage_capacity") {
    return {
      unit: "GB",
      defaultValue: facts.storageGb ? String(facts.storageGb) : "256",
      options: ["64", "128", "256", "512", "1024"].map((value) => ({
        value,
        label: value === "1024" ? "1TB" : `${value}GB`,
      })),
    };
  }
  if (/scope/.test(termId)) {
    return {
      defaultValue: "apply_current_listing",
      options: [
        { value: "apply_current_listing", label: "현재 상품에 적용" },
        { value: "keep_saved_only", label: "저장된 기억으로만 유지" },
      ],
    };
  }
  if (control === "select") {
    return {
      options: [
        { value: "apply", label: "협상에 적용" },
        { value: "skip", label: "이번 상품에서는 제외" },
      ],
      defaultValue: "apply",
    };
  }
  return {
    placeholder: "확인한 값을 입력",
    defaultValue: "",
  };
}

function slotLabel(slotId: string): string {
  return slotId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function questionForAmbiguousSlot(slotId: string): string {
  if (/battery/.test(slotId)) return "배터리 조건을 몇 퍼센트 이상으로 적용할까요?";
  if (/price|budget|cap/.test(slotId)) return "이 숫자를 예산 상한으로 저장해도 될까요?";
  if (/model|scope|product/.test(slotId)) return "이 조건을 현재 상품에도 적용할까요, 아니면 다른 상품 기억으로 남길까요?";
  return "이 조건을 협상에 적용할지 확인해 주세요.";
}

function dedupeActions(actions: PresetEngineReview["nextActions"]): PresetEngineReview["nextActions"] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.termId ?? action.label}:${action.control}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveStrategyNotes(
  preset: PresetConfig,
  memory: AdvisorMemoryLike,
  facts: ReturnType<typeof listingFacts>,
  memoryFacts: string,
): string[] {
  const notes = [...preset.notes];
  if (memory.budgetMax) notes.push(`사용자 메모리의 max budget $${memory.budgetMax}을 cap 기본값으로 사용한다.`);
  if (memory.targetPrice) notes.push(`사용자 target $${memory.targetPrice} 근처에서 opening offer를 보정한다.`);
  if (facts.storageGb !== null) notes.push(`Listing storage ${facts.storageGb}GB를 payload에 유지한다.`);
  if (/original box|box included|박스/.test(memoryFacts)) notes.push("원박스 선호가 있으면 accessories term을 leverage로 남긴다.");
  return notes.slice(0, 6);
}

function clampOffer(rawOpening: number, listing: PresetListingInput, cap: number, presetId: NegotiationPresetId): number {
  const floor = Math.max(1, Math.min(listing.floorPriceMinor ?? Math.round(listing.askPriceMinor * 0.55), listing.askPriceMinor));
  const minimum = presetId === "lowest_price" ? Math.round(floor * 0.92) : Math.round(floor * 0.98);
  return Math.max(1, Math.min(cap, listing.askPriceMinor, Math.max(minimum, rawOpening)));
}

function listingFacts(listing: PresetListingInput) {
  const text = `${listing.title} ${listing.category ?? ""} ${listing.condition} ${listing.tags.join(" ")} ${listing.sellerNote ?? ""}`.toLowerCase();
  const batteryMatch = text.match(/battery[_\s-]*(?:health)?[_\s:>=-]*(\d{2,3})\s*%?/) ?? text.match(/(\d{2,3})\s*%\s*battery/);
  const batteryHealth = batteryMatch ? clampPercent(Number(batteryMatch[1])) : listing.tags.includes("battery_90_plus") ? 90 : null;
  const cycleMatch = text.match(/(?:cycle[_\s-]*count|battery[_\s-]*cycles?|cycles?)[_\s:=-]*(\d{1,4})/)
    ?? text.match(/(\d{1,4})\s*(?:battery\s*)?cycles?\b/);
  const batteryCycleCount = cycleMatch ? clampCycleCount(Number(cycleMatch[1])) : null;
  const storageMatch = text.match(/(\d{2,4})\s*(gb|tb)/);
  const storageGb = storageMatch
    ? Number(storageMatch[1]) * (storageMatch[2] === "tb" ? 1024 : 1)
    : null;

  return {
    text,
    batteryHealth,
    batteryCycleCount,
    storageGb,
    unlocked: /\bunlocked\b|factory unlocked|sim free|carrier[_\s-]?unlocked/.test(text),
    cleanImei: /clean[_\s-]?imei|imei[_\s-]?clean/.test(text),
    appleCareMentioned: /apple\s*care|applecare/.test(text),
    appleCareDenied: /no\s*apple\s*care|no\s*applecare|apple\s*care\s*(?:expired|none)|without\s*apple\s*care/.test(text),
    keyboardClear: /keyboard[_\s-]?(?:clean|works?|perfect)|all\s*keys\s*work|no\s*sticky\s*keys|키보드\s*(?:정상|깨끗)/.test(text),
    activationLockMentioned: /activation\s*lock\s*(?:off|disabled)|find\s*my\s*mac\s*(?:off|disabled)/.test(text)
      ? true
      : /activation\s*lock|find\s*my\s*mac/.test(text) ? false : null,
    screenClear: /screen[_\s-]?(mint|clean|flawless)|mint[_\s-]?screen|no[_\s-]?scratch|화면\s*깨끗/.test(text),
    hasVisibleWear: /visible[_\s-]?wear|wear|scratch|scratches|scuff|dent|기스|흠집/.test(text),
    screenRisk: /crack|cracked|screen[_\s-]?replaced|replacement|교체|액정/.test(text),
  };
}

function clampPercent(value: number): number | null {
  if (!Number.isFinite(value) || value < 1 || value > 100) return null;
  return value;
}

function clampCycleCount(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 3000) return null;
  return value;
}

function memoryText(memory: AdvisorMemoryLike): string {
  const structured = memory.structured;
  const scoped = structured?.productRequirements
    ? Object.entries(structured.productRequirements)
        .flatMap(([scope, req]) => [scope, ...(req.mustHave ?? []), ...(req.avoid ?? [])])
    : [];
  return [
    memory.categoryInterest,
    ...(memory.mustHave ?? []),
    ...(memory.avoid ?? []),
    ...(memory.source ?? []),
    structured?.activeIntent?.productScope,
    ...(structured?.globalPreferences?.mustHave ?? []),
    ...(structured?.globalPreferences?.avoid ?? []),
    ...scoped,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function memoryHasUsefulSignals(memory: AdvisorMemoryLike): boolean {
  return Boolean(
    memory.categoryInterest
      || memory.budgetMax
      || memory.targetPrice
      || memory.mustHave?.length
      || memory.avoid?.length
      || memory.source?.length
      || memory.structured?.activeIntent?.productScope,
  );
}

function isIphoneListing(listing: PresetListingInput): boolean {
  return `${listing.title} ${listing.category ?? ""} ${listing.tags.join(" ")}`.toLowerCase().includes("iphone");
}

function isMacbookListing(listing: PresetListingInput): boolean {
  return /macbook|mac book|맥북/.test(`${listing.title} ${listing.category ?? ""} ${listing.tags.join(" ")}`.toLowerCase());
}

function tagTermsForListing(listing: PresetListingInput): TagTermRequirement[] {
  if (isIphoneListing(listing)) return IPHONE_TERMS;
  if (isMacbookListing(listing)) return MACBOOK_TERMS;
  return [];
}

function termObserved(termId: string, facts: ReturnType<typeof listingFacts>): boolean {
  switch (termId) {
    case "battery_health": return facts.batteryHealth !== null;
    case "battery_cycle_count": return facts.batteryCycleCount !== null;
    case "carrier_lock": return facts.unlocked;
    case "storage_capacity": return facts.storageGb !== null;
    case "screen_condition": return facts.screenClear && !facts.screenRisk && !facts.hasVisibleWear;
    case "imei_verification": return facts.cleanImei;
    case "keyboard_condition": return facts.keyboardClear;
    case "applecare_status": return facts.appleCareMentioned;
    case "activation_lock": return facts.activationLockMentioned === true;
    default: return false;
  }
}

function termRationale(
  termId: string,
  observed: boolean,
  memoryMentions: boolean,
  facts: ReturnType<typeof listingFacts>,
): string {
  if (termId === "battery_health" && facts.batteryHealth !== null) {
    return `Listing gives battery around ${facts.batteryHealth}%.`;
  }
  if (termId === "battery_cycle_count" && facts.batteryCycleCount !== null) {
    return `Listing gives battery cycle count around ${facts.batteryCycleCount}.`;
  }
  if (termId === "applecare_status" && facts.appleCareDenied) {
    return "Listing says AppleCare is not included, so keep repair risk visible.";
  }
  if (observed) return "Listing already gives usable evidence, keep it in the payload.";
  if (memoryMentions) return "User memory says this condition matters, so require it before execution.";
  return "Tag Garden marks this as a relevant negotiation term for this product.";
}

function preferredBatteryMin(memoryFacts: string): number | null {
  const match = memoryFacts.match(/battery\s*(?:>=|over|above|이상)?\s*(\d{2,3})\s*%?/) ?? memoryFacts.match(/배터리\s*(\d{2,3})/);
  const value = match ? Number(match[1]) : null;
  return value && value >= 1 && value <= 100 ? value : null;
}

function batteryImpact(delta: number, presetId: NegotiationPresetId): number {
  const perPoint = presetId === "lowest_price" ? 450 : 300;
  return Math.min(8000, Math.max(1500, Math.round(delta * perPoint)));
}

function makeDraftId(listing: PresetListingInput, presetId: NegotiationPresetId, cap: number): string {
  return `draft_${listing.id}_${presetId}_${cap}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96);
}
