export type AdvisorPlannerListing = {
  id: string;
  title: string;
  category?: string;
  condition: string;
  askPriceMinor: number;
  tags: string[];
};

export type AdvisorPlanSlot =
  | "search_intent"
  | "product_type"
  | "model_family"
  | "price_band"
  | "condition"
  | "budget"
  | "buyer_priority";

export type AdvisorCandidateFacet = {
  slot: Exclude<AdvisorPlanSlot, "search_intent" | "budget" | "buyer_priority"> | "category" | "brand";
  values: Array<{ label: string; count: number; share: number }>;
  entropy: number;
};

export type AdvisorNextAction = {
  action: "ask_search_refinement" | "ask_disambiguation" | "ask_budget" | "ask_preference" | "recommend";
  slot: AdvisorPlanSlot;
  reasonCode:
    | "no_candidates"
    | "mixed_product_types"
    | "mixed_model_families"
    | "wide_price_spread"
    | "mixed_conditions"
    | "budget_missing"
    | "preference_missing"
    | "ready";
  question: string | null;
};

export type AdvisorCandidatePlan = {
  candidateCount: number;
  dominantCluster: {
    label: string;
    count: number;
    share: number;
  } | null;
  facets: AdvisorCandidateFacet[];
  nextAction: AdvisorNextAction;
};

export type AdvisorPlannerMemory = {
  categoryInterest?: string;
  mustHave?: string[];
  avoid?: string[];
  source?: string[];
};

type ListingFacetRow = {
  listing: AdvisorPlannerListing;
  category: string;
  brand: string;
  productType: string;
  modelFamily: string;
  priceBand: string;
  condition: string;
};

export function buildAdvisorCandidatePlan(input: {
  listings: AdvisorPlannerListing[];
  budgetKnown: boolean;
  hasBuyerPreference: boolean;
  memory?: AdvisorPlannerMemory;
}): AdvisorCandidatePlan {
  const rows = applyResolvedMemoryFilters(input.listings.map(toFacetRow), input.memory);
  const facets = buildFacets(rows);
  const dominantCluster = getDominantCluster(rows);

  if (rows.length === 0) {
    return {
      candidateCount: 0,
      dominantCluster: null,
      facets,
      nextAction: {
        action: "ask_search_refinement",
        slot: "search_intent",
        reasonCode: "no_candidates",
        question: "제품명이나 브랜드를 조금만 더 구체적으로 말해줄 수 있나요?",
      },
    };
  }

  const productTypeFacet = facets.find((facet) => facet.slot === "product_type");
  if (isMeaningfullySplit(productTypeFacet)) {
    return {
      candidateCount: rows.length,
      dominantCluster,
      facets,
      nextAction: {
        action: "ask_disambiguation",
        slot: "product_type",
        reasonCode: "mixed_product_types",
        question: buildProductTypeQuestion(productTypeFacet),
      },
    };
  }

  const modelFacet = facets.find((facet) => facet.slot === "model_family");
  if (isMeaningfullySplit(modelFacet)) {
    return {
      candidateCount: rows.length,
      dominantCluster,
      facets,
      nextAction: {
        action: "ask_disambiguation",
        slot: "model_family",
        reasonCode: "mixed_model_families",
        question: buildFacetChoiceQuestion("모델", modelFacet),
      },
    };
  }

  if (!input.budgetKnown) {
    return {
      candidateCount: rows.length,
      dominantCluster,
      facets,
      nextAction: {
        action: "ask_budget",
        slot: "budget",
        reasonCode: "budget_missing",
        question: "예산 범위를 알면 선택지를 더 정확히 줄일 수 있어요.",
      },
    };
  }

  const priceFacet = facets.find((facet) => facet.slot === "price_band");
  if (isMeaningfullySplit(priceFacet)) {
    return {
      candidateCount: rows.length,
      dominantCluster,
      facets,
      nextAction: {
        action: "ask_disambiguation",
        slot: "price_band",
        reasonCode: "wide_price_spread",
        question: buildFacetChoiceQuestion("가격대", priceFacet),
      },
    };
  }

  const conditionFacet = facets.find((facet) => facet.slot === "condition");
  if (isMeaningfullySplit(conditionFacet) && !input.hasBuyerPreference) {
    return {
      candidateCount: rows.length,
      dominantCluster,
      facets,
      nextAction: {
        action: "ask_disambiguation",
        slot: "condition",
        reasonCode: "mixed_conditions",
        question: buildFacetChoiceQuestion("상태", conditionFacet),
      },
    };
  }

  if (!input.hasBuyerPreference) {
    return {
      candidateCount: rows.length,
      dominantCluster,
      facets,
      nextAction: {
        action: "ask_preference",
        slot: "buyer_priority",
        reasonCode: "preference_missing",
        question: "가격, 상태, 안전성 중 어디를 더 우선할까요?",
      },
    };
  }

  return {
    candidateCount: rows.length,
    dominantCluster,
    facets,
    nextAction: {
      action: "recommend",
      slot: "buyer_priority",
      reasonCode: "ready",
      question: null,
    },
  };
}

function toFacetRow(listing: AdvisorPlannerListing): ListingFacetRow {
  const text = normalize([listing.title, listing.category, listing.condition, ...listing.tags].join(" "));

  return {
    listing,
    category: normalize(listing.category || "other"),
    brand: inferBrand(text),
    productType: inferProductType(text),
    modelFamily: inferModelFamily(text),
    priceBand: inferPriceBand(listing.askPriceMinor / 100),
    condition: normalize(listing.condition || "used"),
  };
}

function applyResolvedMemoryFilters(rows: ListingFacetRow[], memory: AdvisorPlannerMemory | undefined): ListingFacetRow[] {
  const selectedModelFamily = resolveSelectedModelFamily(rows, memory);
  if (!selectedModelFamily) return rows;

  const filtered = rows.filter((row) => row.modelFamily === selectedModelFamily);
  return filtered.length > 0 ? filtered : rows;
}

function resolveSelectedModelFamily(rows: ListingFacetRow[], memory: AdvisorPlannerMemory | undefined): string | null {
  if (!memory) return null;

  const modelFamilies = Array.from(new Set(rows.map((row) => row.modelFamily).filter((value) => value !== "unknown")));
  if (modelFamilies.length < 2) return null;

  const memoryText = normalize([
    memory.categoryInterest,
    ...(memory.mustHave ?? []),
    ...(memory.avoid ?? []),
    ...(memory.source ?? []),
  ].filter(Boolean).join(" "));
  const matched = modelFamilies.filter((family) => modelFamilyMatchesMemory(family, memoryText));

  return matched.length === 1 ? matched[0] : null;
}

function modelFamilyMatchesMemory(modelFamily: string, memoryText: string): boolean {
  const compactMemory = memoryText.replace(/[\s_-]+/g, "");
  const compactFamily = modelFamily.replace(/[\s_-]+/g, "");
  if (memoryText.includes(modelFamily) || compactMemory.includes(compactFamily)) return true;

  if (/(iphone|아이폰)/.test(memoryText)) {
    if (modelFamily === "iphone 15" && /\b15\b/.test(memoryText)) return true;
    if (modelFamily === "iphone 14" && /\b14\b/.test(memoryText)) return true;
    if (modelFamily === "iphone 13" && /\b13\b/.test(memoryText)) return true;
  }

  if (/(tesla|테슬라|model|모델)/.test(memoryText)) {
    if (modelFamily === "model 3" && /(?:\b3\b|모델\s*3)/.test(memoryText)) return true;
    if (modelFamily === "model y" && /(?:\by\b|모델\s*y)/.test(memoryText)) return true;
  }

  return false;
}

function buildFacets(rows: ListingFacetRow[]): AdvisorCandidateFacet[] {
  return [
    buildFacet("category", rows.map((row) => row.category)),
    buildFacet("brand", rows.map((row) => row.brand)),
    buildFacet("product_type", rows.map((row) => row.productType)),
    buildFacet("model_family", rows.map((row) => row.modelFamily)),
    buildFacet("price_band", rows.map((row) => row.priceBand)),
    buildFacet("condition", rows.map((row) => row.condition)),
  ];
}

function buildFacet(slot: AdvisorCandidateFacet["slot"], values: string[]): AdvisorCandidateFacet {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value || "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const total = Math.max(values.length, 1);
  const sorted = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, share: round(count / total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    slot,
    values: sorted,
    entropy: round(computeEntropy(sorted.map((value) => value.count))),
  };
}

function getDominantCluster(rows: ListingFacetRow[]): AdvisorCandidatePlan["dominantCluster"] {
  if (rows.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = [row.brand, row.modelFamily].filter((value) => value && value !== "unknown").join(" ");
    counts.set(label || row.productType || "unknown", (counts.get(label || row.productType || "unknown") ?? 0) + 1);
  }

  const [label, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  return {
    label,
    count,
    share: round(count / rows.length),
  };
}

function isMeaningfullySplit(facet: AdvisorCandidateFacet | undefined): boolean {
  if (!facet || facet.values.length < 2) return false;

  const [first, second] = facet.values;
  return Boolean(second && first.share < 0.75 && second.share >= 0.2);
}

function buildProductTypeQuestion(facet: AdvisorCandidateFacet | undefined): string {
  const labels = facet?.values.slice(0, 2).map((value) => translateFacetValue(value.label)) ?? [];
  if (labels.includes("본체") && labels.includes("액세서리")) {
    return "본체를 찾는 건가요, 액세서리도 괜찮나요?";
  }
  return buildFacetChoiceQuestion("제품 종류", facet);
}

function buildFacetChoiceQuestion(label: string, facet: AdvisorCandidateFacet | undefined): string {
  const choices = facet?.values.slice(0, 3).map((value) => translateFacetValue(value.label)) ?? [];
  if (choices.length >= 2) {
    return `${label}가 ${choices.join(", ")} 쪽으로 갈려요. 어느 쪽을 우선할까요?`;
  }
  return `${label} 기준을 하나만 더 알려주세요.`;
}

function inferBrand(text: string): string {
  if (text.includes("tesla") || text.includes("테슬라")) return "tesla";
  if (text.includes("apple") || text.includes("iphone") || text.includes("macbook") || text.includes("아이폰") || text.includes("맥북")) return "apple";
  if (text.includes("dell") || text.includes("xps")) return "dell";
  if (text.includes("ford")) return "ford";
  if (text.includes("honda")) return "honda";
  if (text.includes("bmw")) return "bmw";
  return "unknown";
}

function inferProductType(text: string): string {
  if (/(case|sleeve|charger|adapter|stand|dock|케이스|충전기|스탠드)/.test(text)) return "accessory";
  if (/(tesla|ford|honda|bmw|harley|vehicle|car|sedan|truck|motorcycle|테슬라|차량|자동차|전기차)/.test(text)) return "vehicle";
  if (/(iphone|phone|아이폰)/.test(text)) return "phone";
  if (/(macbook|laptop|xps|노트북|맥북)/.test(text)) return "laptop";
  return "other";
}

function inferModelFamily(text: string): string {
  if (/(model\s*3|model-3|모델3)/.test(text)) return "model 3";
  if (/(model\s*y|model-y|모델y)/.test(text)) return "model y";
  if (/iphone\s*15|아이폰\s*15/.test(text)) return "iphone 15";
  if (/iphone\s*14|아이폰\s*14/.test(text)) return "iphone 14";
  if (/iphone\s*13|아이폰\s*13/.test(text)) return "iphone 13";
  if (/macbook\s*pro|맥북\s*프로/.test(text)) return "macbook pro";
  if (/macbook\s*air|맥북\s*에어/.test(text)) return "macbook air";
  return "unknown";
}

function inferPriceBand(price: number): string {
  if (price < 100) return "under_100";
  if (price < 500) return "100_499";
  if (price < 1000) return "500_999";
  if (price < 10000) return "1000_9999";
  return "10000_plus";
}

function translateFacetValue(value: string): string {
  const labels: Record<string, string> = {
    accessory: "액세서리",
    laptop: "본체",
    phone: "휴대폰",
    vehicle: "차량",
    under_100: "$100 미만",
    "100_499": "$100-$499",
    "500_999": "$500-$999",
    "1000_9999": "$1,000-$9,999",
    "10000_plus": "$10,000 이상",
  };
  return labels[value] ?? value;
}

function computeEntropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 0;

  return counts.reduce((entropy, count) => {
    if (count <= 0) return entropy;
    const p = count / total;
    return entropy - (p * Math.log2(p));
  }, 0);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
