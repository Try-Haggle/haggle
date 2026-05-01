export type RequirementStage = "advisor_recommendation" | "pre_close_verification";
export type RequirementEnforcement = "hard" | "soft";

export type TagRequirementSlot = {
  slotId: string;
  tagPath: string;
  label: string;
  questionKo: string;
  stage: RequirementStage;
  enforcement: RequirementEnforcement;
  priority: number;
  aliases: string[];
  answerOptions?: string[];
};

export type AdvisorMemoryForRequirements = {
  categoryInterest: string;
  budgetMax?: number;
  mustHave: string[];
  avoid: string[];
  source: string[];
  structured?: {
    scopedConditionDecisions?: Array<{
      slotId: string;
      sourceScope?: string;
      targetScope: string;
      decision: "applied" | "rejected";
      reason?: string;
    }>;
  };
};

export type ListingForRequirements = {
  title: string;
  condition: string;
  tags: string[];
};

export type TagRequirementPlan = {
  matchedTags: string[];
  requiredSlots: TagRequirementSlot[];
  missingSlots: TagRequirementSlot[];
  blockingSlots: TagRequirementSlot[];
  nextSlot: TagRequirementSlot | null;
  question: string | null;
  hasBlockingMissingSlots: boolean;
};

export type TagGardenQuestionResolution = {
  question: string;
  slotId: string;
  tagPath: string;
  stage: RequirementStage;
  enforcement: RequirementEnforcement;
  answerOptions?: string[];
  source: "tag_garden";
};

const UNIVERSAL_BUYER_SLOTS: TagRequirementSlot[] = [
  {
    slotId: "shopping_intent",
    tagPath: "buyer/context",
    label: "broad shopping intent",
    questionKo: "찾고 싶은 제품이나 상황을 편하게 말해주세요.",
    stage: "advisor_recommendation",
    enforcement: "hard",
    priority: 5,
    aliases: ["categoryInterest", "product", "제품", "상품", "찾는", "상황"],
  },
  {
    slotId: "max_budget",
    tagPath: "buyer/context",
    label: "maximum buyer budget",
    questionKo: "대략적인 예산 범위는 어느 정도인가요?",
    stage: "advisor_recommendation",
    enforcement: "hard",
    priority: 20,
    aliases: ["budget", "budgetMax", "max budget", "최대 예산", "예산"],
  },
  {
    slotId: "buyer_priority",
    tagPath: "buyer/context",
    label: "at least one buyer priority",
    questionKo: "꼭 원하는 조건이나 우선순위가 있나요?",
    stage: "advisor_recommendation",
    enforcement: "soft",
    priority: 30,
    aliases: ["mustHave", "avoid", "priority", "선호", "조건", "피하고"],
  },
];

const TAG_REQUIREMENTS: Record<string, TagRequirementSlot[]> = {
  "electronics/phones/iphone": [
    {
      slotId: "battery_health",
      tagPath: "electronics/phones/iphone",
      label: "battery health",
      questionKo: "중고폰은 배터리 성능에 따라 가격이 꽤 달라져요. 90% 이상만 볼까요, 85% 이상이면 괜찮을까요, 아니면 가격이 좋으면 80%대도 괜찮을까요?",
      stage: "advisor_recommendation",
      enforcement: "hard",
      priority: 40,
      aliases: ["battery", "battery health", "battery_health", "배터리", "성능"],
      answerOptions: ["90% 이상만", "85% 이상까지 허용", "80%대도 가격 좋으면 허용", "상관없음"],
    },
    {
      slotId: "carrier_lock",
      tagPath: "electronics/phones/iphone",
      label: "carrier lock status",
      questionKo: "언락 모델이 필수인가요?",
      stage: "advisor_recommendation",
      enforcement: "hard",
      priority: 50,
      aliases: ["unlocked", "locked", "carrier", "carrier_lock", "factory unlocked", "언락", "잠금", "통신사"],
      answerOptions: ["언락 필수", "통신사 잠금도 가능", "상관없음"],
    },
    {
      slotId: "imei_verification",
      tagPath: "electronics/phones/iphone",
      label: "clean IMEI verification",
      questionKo: "거래 확정 전에는 IMEI가 깨끗한지 확인해야 합니다.",
      stage: "pre_close_verification",
      enforcement: "hard",
      priority: 80,
      aliases: ["imei", "clean imei", "blacklist", "블랙리스트"],
    },
    {
      slotId: "find_my_status",
      tagPath: "electronics/phones/iphone",
      label: "Find My disabled",
      questionKo: "거래 확정 전에는 Find My 비활성화 여부를 확인해야 합니다.",
      stage: "pre_close_verification",
      enforcement: "hard",
      priority: 90,
      aliases: ["find my", "activation lock", "icloud", "아이클라우드", "나의 찾기"],
    },
  ],
};

const SLOT_ALIASES: Record<string, string> = {
  product_identity: "shopping_intent",
  budget_boundary: "max_budget",
  buyer_priority: "buyer_priority",
  battery_health: "battery_health",
  carrier_lock: "carrier_lock",
  verification_status: "imei_verification",
  warranty_status: "warranty_status",
  shipping_terms: "shipping_terms",
};

const GENERIC_REQUIREMENT_SLOTS: TagRequirementSlot[] = [
  {
    slotId: "warranty_status",
    tagPath: "terms/warranty",
    label: "warranty status",
    questionKo: "보증이나 AppleCare가 남아 있나요?",
    stage: "advisor_recommendation",
    enforcement: "soft",
    priority: 60,
    aliases: ["warranty", "applecare", "보증"],
  },
  {
    slotId: "shipping_terms",
    tagPath: "terms/logistics",
    label: "shipping or pickup terms",
    questionKo: "배송 포함인지, 보험 배송인지, 아니면 직거래인지 확인해도 될까요?",
    stage: "advisor_recommendation",
    enforcement: "soft",
    priority: 70,
    aliases: ["shipping", "insured shipping", "pickup", "delivery", "배송", "직거래"],
  },
  {
    slotId: "payment_safety",
    tagPath: "trust/safety",
    label: "safe payment boundary",
    questionKo: "안전을 위해 결제와 대화는 Haggle 안에서 진행할까요?",
    stage: "advisor_recommendation",
    enforcement: "hard",
    priority: 10,
    aliases: ["escrow", "checkout", "payment", "safety", "결제", "안전"],
  },
];

const ALL_REQUIREMENT_SLOTS = [
  ...UNIVERSAL_BUYER_SLOTS,
  ...GENERIC_REQUIREMENT_SLOTS,
  ...Object.values(TAG_REQUIREMENTS).flat(),
];

export function resolveTagGardenQuestionForSlot(
  slotId: string,
): TagGardenQuestionResolution | null {
  const canonicalSlotId = SLOT_ALIASES[slotId] ?? slotId;
  const slot = ALL_REQUIREMENT_SLOTS.find((candidate) => candidate.slotId === canonicalSlotId);
  if (!slot) return null;

  return {
    question: slot.questionKo,
    slotId: slot.slotId,
    tagPath: slot.tagPath,
    stage: slot.stage,
    enforcement: slot.enforcement,
    answerOptions: slot.answerOptions,
    source: "tag_garden",
  };
}

export function buildAdvisorRequirementPlan(input: {
  memory: AdvisorMemoryForRequirements;
  listings: ListingForRequirements[];
}): TagRequirementPlan {
  const matchedTags = resolveMatchedTags(input.memory, input.listings);
  const tagSlots = matchedTags.flatMap((tag) => TAG_REQUIREMENTS[tag] ?? []);
  const requiredSlots = [...UNIVERSAL_BUYER_SLOTS, ...tagSlots].sort((a, b) => a.priority - b.priority);
  const activeScope = resolveActiveProductScope(input.memory, input.listings);
  const missingSlots = requiredSlots.flatMap((slot) => {
    if (slot.stage !== "advisor_recommendation") return [];

    if (activeScope && activeScopeSatisfiesSlot(input.memory, slot, activeScope)) return [];
    if (activeScope && hasScopedConditionRejection(input.memory, slot, activeScope)) return [slot];

    const scopeMismatch = getHardSlotScopeMismatch(input.memory, slot, activeScope);
    if (scopeMismatch) return [buildScopeConfirmationSlot(slot, scopeMismatch)];

    return memorySatisfiesSlot(input.memory, slot) ? [] : [slot];
  });
  const blockingSlots = missingSlots.filter((slot) => slot.enforcement === "hard");
  const nextSlot = blockingSlots[0] ?? missingSlots[0] ?? null;

  return {
    matchedTags,
    requiredSlots,
    missingSlots,
    blockingSlots,
    nextSlot,
    question: nextSlot ? nextSlot.questionKo : null,
    hasBlockingMissingSlots: blockingSlots.length > 0,
  };
}

export function formatTagRequirementPlanForPrompt(plan: TagRequirementPlan): string {
  if (plan.requiredSlots.length === 0) return "No Tag Garden requirement slots matched.";

  return [
    `matched_tags: ${plan.matchedTags.join(", ") || "none"}`,
    "required_slots:",
    ...plan.requiredSlots.map((slot) => (
      `- ${slot.slotId} | tag=${slot.tagPath} | stage=${slot.stage} | enforcement=${slot.enforcement} | label=${slot.label} | question="${slot.questionKo}"${slot.answerOptions ? ` | options=${slot.answerOptions.join("/")}` : ""}`
    )),
  ].join("\n");
}

function resolveMatchedTags(
  memory: AdvisorMemoryForRequirements,
  listings: ListingForRequirements[],
): string[] {
  const memoryText = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].join(" ").toLowerCase();
  const matched = new Set<string>();

  if (/iphone|아이폰/.test(memoryText)) {
    matched.add("electronics/phones/iphone");
  }

  const intentMatchedListings = listings.filter((listing) => listingMatchesMemoryIntent(listing, memoryText));
  for (const tag of Object.keys(TAG_REQUIREMENTS)) {
    if (intentMatchedListings.some((listing) => listing.tags.includes(tag))) matched.add(tag);
  }

  return Array.from(matched);
}

function listingMatchesMemoryIntent(listing: ListingForRequirements, memoryText: string): boolean {
  if (!hasShoppingIntent(memoryText)) return false;

  const listingText = [
    listing.title,
    listing.condition,
    ...listing.tags,
  ].join(" ").toLowerCase();

  return memoryText
    .split(/[\s,.;:!?()[\]{}"'`/\\|<>~@#$%^&*+=]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !["중고", "제품", "상품", "조건"].includes(term))
    .some((term) => listingText.includes(term));
}

function memorySatisfiesSlot(memory: AdvisorMemoryForRequirements, slot: TagRequirementSlot): boolean {
  if (slot.slotId === "shopping_intent") return hasShoppingIntent(memory.categoryInterest);
  if (slot.slotId === "max_budget") return Boolean(memory.budgetMax);

  const memoryText = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].join(" ").toLowerCase();

  if (slot.slotId === "buyer_priority") {
    return memory.mustHave.length > 0 || memory.avoid.length > 0 || hasNoAdditionalRequirements(memoryText);
  }
  if (slot.slotId === "battery_health") {
    return hasBatteryThreshold(memoryText) || hasBatteryNoPreference(memoryText);
  }
  if (slot.slotId === "carrier_lock") {
    return hasCarrierDecision(memoryText) || hasCarrierNoPreference(memoryText);
  }

  return slot.aliases.some((alias) => memoryText.includes(alias.toLowerCase()));
}

type ProductScope = {
  key: string;
  label: string;
};

function getHardSlotScopeMismatch(
  memory: AdvisorMemoryForRequirements,
  slot: TagRequirementSlot,
  activeScope: ProductScope | null,
): { memoryScope: ProductScope; activeScope: ProductScope } | null {
  if (slot.enforcement !== "hard" || !activeScope || !memorySatisfiesSlot(memory, slot)) return null;
  if (slot.slotId === "shopping_intent" || slot.slotId === "max_budget") return null;

  const evidenceLines = [
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].filter((line) => slotSatisfiedByText(line, slot));
  const evidenceScopes = evidenceLines.flatMap(extractProductScopes);
  if (evidenceScopes.some((scope) => scope.key === activeScope.key)) return null;

  const staleScope = evidenceScopes.find((scope) => scope.key !== activeScope.key);
  if (staleScope) return { memoryScope: staleScope, activeScope };

  return null;
}

function activeScopeSatisfiesSlot(
  memory: AdvisorMemoryForRequirements,
  slot: TagRequirementSlot,
  activeScope: ProductScope,
): boolean {
  if (slot.slotId === "shopping_intent" || slot.slotId === "max_budget") return false;
  const evidenceLines = [
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].filter((line) => slotSatisfiedByText(line, slot));

  return evidenceLines.some((line) => (
    extractProductScopes(line).some((scope) => scope.key === activeScope.key)
  ));
}

function hasScopedConditionRejection(
  memory: AdvisorMemoryForRequirements,
  slot: TagRequirementSlot,
  activeScope: ProductScope,
): boolean {
  if (slot.enforcement !== "hard") return false;
  const latestDecision = latestScopedConditionDecision(memory, slot, activeScope);
  return latestDecision?.decision === "rejected";
}

function latestScopedConditionDecision(
  memory: AdvisorMemoryForRequirements,
  slot: TagRequirementSlot,
  activeScope: ProductScope,
): NonNullable<NonNullable<AdvisorMemoryForRequirements["structured"]>["scopedConditionDecisions"]>[number] | null {
  return memory.structured?.scopedConditionDecisions
    ?.slice()
    .reverse()
    .find((decision) => (
      decision.slotId === slot.slotId
      && extractProductScopes(decision.targetScope).some((scope) => scope.key === activeScope.key)
    )) ?? null;
}

function buildScopeConfirmationSlot(
  slot: TagRequirementSlot,
  mismatch: { memoryScope: ProductScope; activeScope: ProductScope },
): TagRequirementSlot {
  const conditionName = slot.slotId === "battery_health"
    ? "배터리 조건"
    : slot.slotId === "carrier_lock"
      ? "언락/통신사 조건"
      : "이 조건";

  return {
    ...slot,
    questionKo: `전에 ${mismatch.memoryScope.label}에서 말한 ${conditionName}을 ${mismatch.activeScope.label}에도 그대로 적용할까요, 아니면 다시 정할까요?`,
  };
}

function slotSatisfiedByText(text: string, slot: TagRequirementSlot): boolean {
  const normalized = text.toLowerCase();
  if (slot.slotId === "battery_health") {
    return hasBatteryThreshold(normalized) || hasBatteryNoPreference(normalized);
  }
  if (slot.slotId === "carrier_lock") {
    return hasCarrierDecision(normalized) || hasCarrierNoPreference(normalized);
  }
  return slot.aliases.some((alias) => normalized.includes(alias.toLowerCase()));
}

function resolveActiveProductScope(
  memory: AdvisorMemoryForRequirements,
  listings: ListingForRequirements[],
): ProductScope | null {
  for (const line of [...memory.source].reverse()) {
    if (!isActiveProductScopeSource(line)) continue;
    const sourceScopes = extractProductScopes(line);
    if (sourceScopes.length > 0) return sourceScopes[sourceScopes.length - 1]!;
  }

  const latestScopeDecision = memory.structured?.scopedConditionDecisions?.at(-1);
  if (latestScopeDecision) {
    const decisionScopes = extractProductScopes(latestScopeDecision.targetScope);
    if (decisionScopes.length > 0) return decisionScopes[decisionScopes.length - 1]!;
  }

  const memoryScopes = extractProductScopes(memory.categoryInterest);
  if (memoryScopes.length > 0) return memoryScopes[memoryScopes.length - 1]!;

  const listingScopes = listings.flatMap((listing) => extractProductScopes(listing.title));
  if (listingScopes.length === 0) return null;

  const first = listingScopes[0]!;
  return listingScopes.every((scope) => scope.key === first.key) ? first : null;
}

function extractProductScopes(text: string): ProductScope[] {
  const scopes: ProductScope[] = [];
  const seen = new Set<string>();
  const add = (scope: ProductScope) => {
    if (seen.has(scope.key)) return;
    seen.add(scope.key);
    scopes.push(scope);
  };

  for (const match of text.matchAll(/(?:iphone|아이폰)\s*(1[1-9]|[2-9])\s*(pro\s*max|pro|max|plus|mini)?/gi)) {
    const generation = match[1]!;
    const variant = normalizeVariant(match[2]);
    const label = ["iPhone", generation, variant].filter(Boolean).join(" ");
    add({
      key: ["iphone", generation, variant?.toLowerCase().replace(/\s+/g, "_")].filter(Boolean).join("_"),
      label,
    });
  }

  return scopes;
}

function isActiveProductScopeSource(text: string): boolean {
  return (
    /(?:이번(?:에는|엔)?|now|also|too|include|expanded|switched|active intent|보고|볼게|찾고|관심)/i.test(text)
    && !hasBatteryThreshold(text.toLowerCase())
    && !hasBatteryNoPreference(text.toLowerCase())
    && !hasCarrierDecision(text.toLowerCase())
    && !hasCarrierNoPreference(text.toLowerCase())
  );
}

function normalizeVariant(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasShoppingIntent(categoryInterest: string): boolean {
  const normalized = categoryInterest.trim().toLowerCase();
  return (
    normalized.length > 0
    && !["탐색 중", "not specified", "unknown", "none", "n/a"].includes(normalized)
  );
}

function hasBatteryThreshold(memoryText: string): boolean {
  return (
    /battery(?:\s+health)?[^0-9]{0,24}(?:>=|>|at least|minimum|min)?\s*(?:[7-9][0-9]|100)\s*%?\+?/.test(memoryText)
    || /(?:배터리|성능)[^0-9]{0,20}(?:[7-9][0-9]|100)\s*%?/.test(memoryText)
    || /(?:[7-9][0-9]|100)\s*%?[^a-z0-9가-힣]{0,20}(?:battery|배터리|성능)/.test(memoryText)
  );
}

function hasBatteryNoPreference(memoryText: string): boolean {
  return (
    /battery\s+no\s+preference/.test(memoryText)
    || /(?:배터리|성능)[^.!?。！？]{0,30}(?:상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)/.test(memoryText)
    || /(?:상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)[^.!?。！？]{0,30}(?:배터리|성능)/.test(memoryText)
  );
}

function hasCarrierDecision(memoryText: string): boolean {
  return (
    /\b(?:unlocked|factory unlocked|locked)\b/.test(memoryText)
    || /(?:언락|잠금\s*(?:필수|무관|상관없|상관 없어|필요없|필요 없어)|통신사\s*(?:잠금|무관|상관없|상관 없어))/.test(memoryText)
  );
}

function hasCarrierNoPreference(memoryText: string): boolean {
  return (
    /carrier\s+no\s+preference/.test(memoryText)
    || /(?:언락|잠금|통신사)[^.!?。！？]{0,30}(?:상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)/.test(memoryText)
    || /(?:상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)[^.!?。！？]{0,30}(?:언락|잠금|통신사)/.test(memoryText)
  );
}

function hasNoAdditionalRequirements(memoryText: string): boolean {
  return /(?:no additional requirements|no preference|none|상관\s*없|무관|필요\s*없|신경\s*안\s*써|특별히\s*없|조건\s*없|선호\s*없)/.test(memoryText);
}
