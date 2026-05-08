"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAdvisorTurn,
  getAdvisorDemoListings,
  getDemoMemoryCards,
  saveAdvisorMemory,
  type AdvisorCandidatePlan,
  type AdvisorDemoListingsResponse,
  type AdvisorTurnCost,
  type StoredMemoryCard,
} from "@/lib/intelligence-demo-api";
import type { AdvisorListing, AdvisorMemory } from "@/lib/advisor-demo-types";
import type { PresetTuningDraft } from "@/lib/intelligence-demo-api";
import { ANCIENT_BEINGS, type AncientBeingId } from "./negotiation-avatar-coach";
import { PresetTuningPanel } from "./preset-tuning-panel";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
};

type AdvisorCostTurn = AdvisorTurnCost & {
  turn: number;
};

type AdvisorRetrievalMeta = NonNullable<AdvisorDemoListingsResponse["retrieval"]>;

type NegotiationReadiness = {
  ready: boolean;
  reason: string | null;
  question: string | null;
};

type ProductAttributes = {
  category: string | null;
  brand: string | null;
  family: string | null;
  model: string | null;
  variant: string | null;
  storageGb: number | null;
  condition: string | null;
  batteryMin: number | null;
  unlocked: boolean | null;
  avoidDamage: boolean;
  hasVisibleWear: boolean;
};

type AttributeCheck = {
  key: string;
  label: string;
  memory: string;
  listing: string;
  status: "pass" | "warn" | "fail" | "neutral";
  weight: number;
  reason: string;
};

type AlignmentIssue =
  | "none"
  | "model_mismatch"
  | "variant_mismatch"
  | "storage_mismatch"
  | "condition_missing"
  | "condition_violation"
  | "budget_warning"
  | "product_mismatch"
  | "generic";

type ListingAlignment = {
  status: "match" | "near_match" | "mismatch" | "unknown";
  issue: AlignmentIssue;
  reason: string | null;
  question: string | null;
  memoryIntent: string | null;
  listingIntent: string | null;
  score: number;
  checks: AttributeCheck[];
  memoryAttributes: ProductAttributes | null;
  listingAttributes: ProductAttributes | null;
};

type AlignmentIntervention = {
  mode: "none" | "observe" | "inline_confirm" | "chat_confirm";
  blocksStart: boolean;
  showsChatPrompt: boolean;
  label: string;
};

type PendingBudgetChange = {
  intent: string;
  from: number;
  to: number;
  previousBudgetMax?: number;
  previousTargetPrice?: number;
  proposedMemory: AdvisorMemory;
};

type MissingInfoSlot = {
  slotId: string;
  question: string;
  enforcement: "hard" | "soft";
  productScope?: string;
  status: "pending" | "ambiguous";
};

type SlotControlValue =
  | { kind: "budget"; budgetMax: number; targetPrice?: number }
  | { kind: "battery"; threshold?: number; noPreference?: boolean }
  | { kind: "carrier"; unlockedRequired: boolean | null }
  | { kind: "text"; text: string; noPreference?: boolean };

function getAgent(id: AncientBeingId) {
  return ANCIENT_BEINGS.find((being) => being.id === id) ?? ANCIENT_BEINGS[0];
}

function getAgentImage(id: AncientBeingId): string {
  const agent = getAgent(id);
  return agent.selectionImage ?? agent.expressions?.curious ?? agent.image;
}

const AGENT_OPENING_LINES: Record<AncientBeingId, string> = {
  fab: "아 그거? 먼저 찾는 상황. 제품명이든 쓰려는 목적이든, 그거부터 말해 주세요.",
  vel: "아름답군요. 아직 형태가 흐려도 괜찮습니다. 어떤 걸 찾는지, 왜 필요한지부터 같이 비춰보죠.",
  judge: "저지입니다. 먼저 요청의 범위를 잡겠습니다. 찾는 제품이나 사용 상황을 편하게 말해 주세요.",
  hark: "하크입니다. 시작 규칙은 단순하다. 무엇을 찾는지, 어떤 상황인지부터 대세요.",
  mia: "미아예요. 괜찮아요, 천천히. 필요한 물건이나 쓰려는 상황부터 말해 주세요.",
  vault: "...볼트입니다. 안전해. 먼저 찾는 물건과 이유를 말해 주세요. 중요한 조건은 그다음 잠가두겠습니다.",
  dealer_kai: "Wait, wait- 신호부터 잡아볼게요. 제품명이든 쓰려는 상황이든 먼저 던져주세요. 그니까, 보드 전원부터 켜는 느낌으로요.",
  dealer_hana: "헐, 좋아요. 일단 뭐 찾는지부터 잡아볼게요. 제품명이나 쓰려는 상황을 편하게 말해 주세요!",
  dealer_ethan: "에단입니다. 먼저 구매 의도부터 보겠습니다. 찾는 제품이나 사용 목적을 알려주세요.",
  dealer_claire: "클레어예요. 무리 없이 시작해볼게요. 필요한 물건이나 쓰려는 상황부터 알려주세요.",
  buddy_fizz: "잠깐! 신호 잡아볼게요. 제품명이든 상황이든 먼저 짧게 말해 주세요.",
  buddy_echo: "원하는 쪽이 천천히 보여요. 찾는 물건이나 필요한 상황부터 조용히 비춰볼게요.",
};

function createInitialMessages(agentId: AncientBeingId): ChatMessage[] {
  return [
    {
      id: "agent-0",
      role: "agent",
      text: AGENT_OPENING_LINES[agentId],
    },
  ];
}

function createBaseMemory(): AdvisorMemory {
  return {
    categoryInterest: "탐색 중",
    mustHave: [],
    avoid: [],
    riskStyle: "balanced",
    negotiationStyle: "balanced",
    openingTactic: "fair_market_anchor",
    questions: ["찾고 싶은 제품이나 상황을 편하게 말해주세요."],
    source: [],
  };
}

function dollarsToMinor(value: number): number {
  return Math.round(value * 100);
}

function minorToDollars(value: number): number {
  return value / 100;
}

function formatMinor(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}

function scoreListing(listing: AdvisorListing, memory: AdvisorMemory): number {
  let score = 0;
  const listingText = [
    listing.title,
    listing.category,
    listing.condition,
    ...listing.tags,
  ].filter(Boolean).join(" ").toLowerCase();
  const searchTerms = getListingSearchTerms(memory);

  for (const term of searchTerms) {
    if (listingText.includes(term)) score += term.length > 4 ? 12 : 8;
  }

  if (memory.budgetMax && listing.askPriceMinor <= dollarsToMinor(memory.budgetMax + 30)) score += 24;
  if (memory.budgetMax && listing.floorPriceMinor <= dollarsToMinor(memory.budgetMax)) score += 12;
  if (memory.mustHave.includes("battery >= 90%") && listing.tags.includes("battery_90_plus")) score += 18;
  if (memory.mustHave.includes("unlocked") && listing.tags.includes("unlocked")) score += 18;
  if (memory.mustHave.includes("clean IMEI") && listing.tags.includes("clean_imei")) score += 10;
  if (memory.mustHave.includes("original box included") && listing.tags.includes("box_included")) score += 14;
  if (memory.riskStyle === "safe_first" && listing.tags.some((tag) => ["clean_imei", "box_included", "screen_mint"].includes(tag))) {
    score += 10;
  }
  if (listing.tags.includes("visible_wear")) score -= 8;
  return score;
}

function getListingSearchTerms(memory: AdvisorMemory): string[] {
  const raw = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source.slice(-3),
  ].join(" ");

  return Array.from(new Set(
    raw
      .toLowerCase()
      .replace(/탐색 중|not specified|unknown/g, " ")
      .split(/[\s,.;:!?()[\]{}"'`/\\|<>~@#$%^&*+=]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !STOP_TERMS.has(term)),
  )).slice(0, 12);
}

const STOP_TERMS = new Set([
  "중고",
  "제품",
  "상품",
  "찾고",
  "싶어",
  "좋아",
  "조건",
  "예산",
  "최대",
  "이상",
  "정도",
  "사용",
  "용도",
]);

function buildListingSearchQuery(memory: AdvisorMemory, latestMessage: string): string {
  const raw = [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    latestMessage,
  ]
    .join(" ")
    .replace(/탐색 중|not specified|unknown/gi, " ")
    .trim();

  return Array.from(new Set(
    raw
      .toLowerCase()
      .replace(/\$?\d+(?:\.\d+)?/g, " ")
      .split(/[\s,.;:!?()[\]{}"'`/\\|<>~@#$%^&*+=]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !STOP_TERMS.has(term)),
  )).slice(0, 12).join(" ").slice(0, 240);
}

function buildNegotiationBrief(memory: AdvisorMemory, listing: AdvisorListing): string[] {
  return [
    `target_price: $${memory.targetPrice ?? Math.max(minorToDollars(listing.floorPriceMinor), minorToDollars(listing.askPriceMinor) - 40)}`,
    `max_budget: $${memory.budgetMax ?? minorToDollars(listing.askPriceMinor)}`,
    `must_have: ${memory.mustHave.length > 0 ? memory.mustHave.join(", ") : "not confirmed"}`,
    `condition_filters: ${memory.avoid.length > 0 ? memory.avoid.join(", ") : "none"}`,
    `opening_tactic: ${memory.openingTactic}`,
  ];
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMemoryStrength(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return `${Math.round(parsed * 100)}%`;
}

function mergeStoredMemoryCards(existing: StoredMemoryCard[], incoming: StoredMemoryCard[]): StoredMemoryCard[] {
  const merged = new Map<string, StoredMemoryCard>();
  for (const card of existing) merged.set(card.id, card);
  for (const card of incoming) merged.set(card.id, card);
  return Array.from(merged.values()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function formatRetrievalMode(meta: AdvisorRetrievalMeta | null): string {
  if (!meta) return "keyword";
  return meta.semanticApplied
    ? `semantic + keyword · ${meta.semanticCandidates} vector`
    : `keyword · ${meta.keywordCandidates} lexical`;
}

function formatPlannerSlot(slot: string): string {
  const labels: Record<string, string> = {
    search_intent: "search intent",
    product_type: "product type",
    model_family: "model family",
    price_band: "price band",
    condition: "condition",
    budget: "budget",
    buyer_priority: "buyer priority",
    category: "category",
    brand: "brand",
  };
  return labels[slot] ?? slot;
}

function isKnownEmptyIntent(value?: string): boolean {
  return !value || ["탐색 중", "not specified", "unknown"].includes(value.toLowerCase());
}

function normalizeForIntent(value: string): string {
  return value
    .toLowerCase()
    .replace(/아이폰/g, "iphone")
    .replace(/맥북/g, "macbook")
    .replace(/아이패드/g, "ipad")
    .replace(/테슬라/g, "tesla")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function memoryIntentText(memory: AdvisorMemory): string {
  return [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
    ...memory.source,
  ].join(" ");
}

function activeMemoryIntentText(memory: AdvisorMemory): string {
  return [
    memory.categoryInterest,
    ...memory.mustHave,
    ...memory.avoid,
  ].join(" ");
}

function listingIntentText(listing: AdvisorListing): string {
  return [
    listing.title,
    listing.category,
    listing.condition,
    ...listing.tags,
    listing.sellerNote,
  ].filter(Boolean).join(" ");
}

function extractIphoneModel(value: string): string | null {
  const normalized = normalizeForIntent(value);
  const match = normalized.match(/\biphone\s*(1[1-9]|[2-9][0-9]?)(?:\s*(pro\s*max|pro|max|plus|mini))?\b/);
  return match ? ["iphone", match[1], match[2]?.replace(/\s+/g, " ")].filter(Boolean).join(" ") : null;
}

function extractProductFamily(value: string): string | null {
  const normalized = normalizeForIntent(value);
  if (/\biphone\b/.test(normalized)) return "iphone";
  if (/\bipad\b/.test(normalized)) return "ipad";
  if (/\bmacbook\b/.test(normalized) || /노트북|랩탑/.test(normalized)) return "laptop";
  if (/\btesla\b/.test(normalized)) return "tesla";
  return null;
}

function extractBrand(value: string): string | null {
  const normalized = normalizeForIntent(value);
  if (/\bapple\b|\biphone\b|\bipad\b|\bmacbook\b/.test(normalized)) return "apple";
  if (/\bsamsung\b|\bgalaxy\b/.test(normalized)) return "samsung";
  if (/\btesla\b/.test(normalized)) return "tesla";
  return null;
}

function extractCategory(value: string): string | null {
  const normalized = normalizeForIntent(value);
  if (/\biphone\b|\bgalaxy\b|phone|스마트폰|휴대폰/.test(normalized)) return "phone";
  if (/\bipad\b|tablet|태블릿/.test(normalized)) return "tablet";
  if (/\bmacbook\b|laptop|노트북|랩탑/.test(normalized)) return "laptop";
  if (/\btesla\b|car|자동차/.test(normalized)) return "vehicle";
  return null;
}

function extractVariant(value: string): string | null {
  const normalized = normalizeForIntent(value);
  if (/\bpro\s*max\b|프로\s*맥스/.test(normalized)) return "pro max";
  if (/\bpro\b|프로/.test(normalized)) return "pro";
  if (/\bplus\b|플러스/.test(normalized)) return "plus";
  if (/\bmini\b|미니/.test(normalized)) return "mini";
  return null;
}

function extractStorageGb(value: string): number | null {
  const normalized = normalizeForIntent(value);
  const match = normalized.match(/\b(64|128|256|512|1024|1)\s*(gb|g|tb)\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === "tb" ? amount * 1024 : amount;
}

function extractBatteryMin(value: string): number | null {
  const normalized = normalizeForIntent(value);
  const match = normalized.match(/battery\s*(?:>=|over|above|at least)?\s*(\d{2,3})|배터리\s*(\d{2,3})/);
  const parsed = Number(match?.[1] ?? match?.[2]);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(100, parsed));
}

function extractCondition(value: string): string | null {
  const normalized = normalizeForIntent(value);
  if (/mint|like new|excellent|최상|새것/.test(normalized)) return "mint";
  if (/good|used|중고|양호/.test(normalized)) return "good";
  if (/fair|visible wear|wear|흠집|스크래치/.test(normalized)) return "fair";
  if (/broken|crack|damage|파손|깨짐/.test(normalized)) return "damaged";
  return null;
}

function extractUnlocked(value: string): boolean | null {
  const normalized = normalizeForIntent(value);
  if (/unlocked|언락|자급제/.test(normalized)) return true;
  if (/locked|carrier lock|통신사/.test(normalized)) return false;
  return null;
}

function extractProductAttributes(value: string): ProductAttributes {
  const normalized = normalizeForIntent(value);
  return {
    category: extractCategory(value),
    brand: extractBrand(value),
    family: extractProductFamily(value),
    model: extractIphoneModel(value),
    variant: extractVariant(value),
    storageGb: extractStorageGb(value),
    condition: extractCondition(value),
    batteryMin: extractBatteryMin(value),
    unlocked: extractUnlocked(value),
    avoidDamage: /외관\s*파손|visible damage|no damage|damage|파손.*싫|깨진.*싫/.test(normalized),
    hasVisibleWear: /visible_wear|visible wear|damage|damaged|파손|깨짐|흠집/.test(normalized),
  };
}

function activeIntentKey(value: string): string | null {
  const attrs = extractProductAttributes(value);
  return attrs.model ?? attrs.family ?? attrs.category;
}

function inputIntentLabel(value: string): string | null {
  const attrs = extractProductAttributes(value);
  return attrs.model ?? attrs.family ?? attrs.category;
}

function isPhoneSpecificConstraint(value: string): boolean {
  const normalized = normalizeForIntent(value);
  return /\biphone\b|battery|배터리|imei|unlocked|언락|자급제|\b(?:64|128|256|512|1024)\s*(?:gb|g|tb)\b/.test(normalized);
}

function applyActiveIntentSwitchOverride(
  text: string,
  previousMemory: AdvisorMemory,
  nextMemory: AdvisorMemory,
): AdvisorMemory {
  const nextIntent = activeIntentKey(text);
  const previousIntent = activeIntentKey(activeMemoryIntentText(previousMemory));
  if (!nextIntent || !previousIntent || nextIntent === previousIntent) return nextMemory;

  const normalizedInput = normalizeForIntent(text);
  const explicitCategoryInterest = inputIntentLabel(text);
  const keepConstraint = (value: string) => {
    const normalizedValue = normalizeForIntent(value);
    if (isPhoneSpecificConstraint(value) && nextIntent !== "iphone") return false;
    return normalizedInput.includes(normalizedValue) || activeIntentKey(value) === nextIntent;
  };

  return {
    ...nextMemory,
    categoryInterest: explicitCategoryInterest ?? nextMemory.categoryInterest,
    mustHave: nextMemory.mustHave.filter(keepConstraint),
    avoid: nextMemory.avoid.filter(keepConstraint),
    source: [
      ...nextMemory.source.filter((item) => activeIntentKey(item) === nextIntent),
      `Active intent switched from ${previousIntent} to ${nextIntent}`,
    ],
    questions: nextMemory.questions.filter((question) => activeIntentKey(question) !== previousIntent),
  };
}

function formatIntentLabel(value: string | null): string {
  return value ?? "선택한 상품";
}

function formatAttributeValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function makeCheck(
  key: string,
  label: string,
  memory: string | number | boolean | null,
  listing: string | number | boolean | null,
  weight: number,
  status: AttributeCheck["status"],
  reason: string,
): AttributeCheck {
  return {
    key,
    label,
    memory: formatAttributeValue(memory),
    listing: formatAttributeValue(listing),
    status,
    weight,
    reason,
  };
}

function scoreChecks(checks: AttributeCheck[]): number {
  const scored = checks.filter((check) => check.status !== "neutral" && check.weight > 0);
  const total = scored.reduce((sum, check) => sum + check.weight, 0);
  if (total <= 0) return 0;
  const earned = scored.reduce((sum, check) => {
    if (check.status === "pass") return sum + check.weight;
    if (check.status === "warn") return sum + check.weight * 0.45;
    return sum;
  }, 0);
  return Math.round((earned / total) * 100) / 100;
}

function deriveAlignmentIssue(checks: AttributeCheck[]): AlignmentIssue {
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const isProblem = (key: string) => {
    const status = byKey.get(key)?.status;
    return status === "warn" || status === "fail";
  };

  if (isProblem("category") || isProblem("brand")) return "product_mismatch";
  if (isProblem("model")) return "model_mismatch";
  if (isProblem("variant")) return "variant_mismatch";
  if (isProblem("storage")) return "storage_mismatch";
  if (byKey.get("battery")?.status === "fail" || byKey.get("damage")?.status === "fail") {
    return "condition_violation";
  }
  if (byKey.get("battery")?.status === "warn" || byKey.get("damage")?.status === "warn") {
    return "condition_missing";
  }
  if (byKey.get("budget")?.status === "warn") return "budget_warning";
  if (checks.some((check) => check.status === "warn" || check.status === "fail")) return "generic";
  return "none";
}

function issueLabels(alignment: ListingAlignment): string {
  const labels = alignment.checks
    .filter((check) => check.status === "warn" || check.status === "fail")
    .map((check) => check.label);
  return labels.length > 0 ? labels.join(", ") : "조건";
}

function alignmentBadgeText(alignment: ListingAlignment): string {
  const labels = issueLabels(alignment);

  switch (alignment.issue) {
    case "condition_missing":
      return `조건 확인 필요: ${labels}`;
    case "condition_violation":
      return `조건 충돌: ${labels}`;
    case "model_mismatch":
      return `모델 확인 필요: ${alignment.memoryIntent} → ${alignment.listingIntent}`;
    case "variant_mismatch":
      return `옵션 확인 필요: ${labels}`;
    case "storage_mismatch":
      return `용량 확인 필요: ${labels}`;
    case "budget_warning":
      return `예산 확인 필요: ${labels}`;
    case "product_mismatch":
      return `상품 확인 필요: ${alignment.memoryIntent} → ${alignment.listingIntent}`;
    default:
      return `확인 필요: ${labels}`;
  }
}

function memoryTargetRank(alignment: ListingAlignment): number {
  if (alignment.status === "match") return 0;
  if (alignment.issue === "condition_missing" || alignment.issue === "budget_warning") return 1;
  if (
    alignment.memoryIntent
    && alignment.listingIntent
    && alignment.memoryIntent === alignment.listingIntent
  ) {
    return 2;
  }
  return 99;
}

function alignmentIntervention(alignment: ListingAlignment): AlignmentIntervention {
  if (alignment.status === "unknown" || alignment.issue === "none") {
    return {
      mode: "none",
      blocksStart: false,
      showsChatPrompt: false,
      label: "추가 확인 없음",
    };
  }

  if (alignment.issue === "condition_violation") {
    return {
      mode: "chat_confirm",
      blocksStart: true,
      showsChatPrompt: true,
      label: "강제 확인",
    };
  }

  if (
    alignment.issue === "condition_missing"
    || alignment.issue === "variant_mismatch"
    || alignment.issue === "storage_mismatch"
    || alignment.issue === "budget_warning"
    || alignment.issue === "model_mismatch"
  ) {
    return {
      mode: "inline_confirm",
      blocksStart: true,
      showsChatPrompt: false,
      label: "협상 전 확인",
    };
  }

  if (alignment.issue === "product_mismatch") {
    return {
      mode: "observe",
      blocksStart: false,
      showsChatPrompt: false,
      label: "참고",
    };
  }

  return {
    mode: "inline_confirm",
    blocksStart: true,
    showsChatPrompt: false,
    label: "확인 필요",
  };
}

function evaluateListingAlignment(memory: AdvisorMemory, listing?: AdvisorListing | null): ListingAlignment {
  const emptyAlignment = (listingIntent: string | null = listing?.title ?? null): ListingAlignment => ({
    status: "unknown",
    issue: "generic",
    reason: null,
    question: null,
    memoryIntent: null,
    listingIntent,
    score: 0,
    checks: [],
    memoryAttributes: null,
    listingAttributes: null,
  });

  if (!listing || isKnownEmptyIntent(memory.categoryInterest)) {
    return emptyAlignment();
  }

  const memoryText = activeMemoryIntentText(memory);
  const listingText = listingIntentText(listing);
  const memoryAttrs = extractProductAttributes(memoryText);
  const listingAttrs = extractProductAttributes(listingText);
  const memoryModel = memoryAttrs.model;
  const listingModel = listingAttrs.model;
  const memoryFamily = memoryAttrs.family;
  const listingFamily = listingAttrs.family;
  const memoryIntent = memoryModel ?? memoryFamily ?? memory.categoryInterest;
  const listingIntent = listingModel ?? listingFamily ?? listing.title;
  const checks: AttributeCheck[] = [];

  checks.push(makeCheck(
    "category",
    "category",
    memoryAttrs.category,
    listingAttrs.category,
    20,
    memoryAttrs.category && listingAttrs.category
      ? memoryAttrs.category === listingAttrs.category ? "pass" : "fail"
      : "neutral",
    "상품군이 다르면 기억을 그대로 적용하기 어렵습니다.",
  ));
  checks.push(makeCheck(
    "brand",
    "brand",
    memoryAttrs.brand,
    listingAttrs.brand,
    15,
    memoryAttrs.brand && listingAttrs.brand
      ? memoryAttrs.brand === listingAttrs.brand ? "pass" : "fail"
      : "neutral",
    "브랜드는 제품 정체성의 강한 기준입니다.",
  ));
  checks.push(makeCheck(
    "model",
    "model family",
    memoryModel ?? memoryFamily,
    listingModel ?? listingFamily,
    25,
    memoryModel && listingModel
      ? memoryModel === listingModel ? "pass" : "warn"
      : memoryFamily && listingFamily
        ? memoryFamily === listingFamily ? "pass" : "fail"
        : "neutral",
    "모델 번호가 다르면 같은 계열이어도 확인이 필요합니다.",
  ));
  checks.push(makeCheck(
    "variant",
    "variant",
    memoryAttrs.variant,
    listingAttrs.variant,
    15,
    memoryAttrs.variant && listingAttrs.variant
      ? memoryAttrs.variant === listingAttrs.variant ? "pass" : "warn"
      : "neutral",
    "Pro, Plus 같은 변형은 가격과 성능 차이가 큽니다.",
  ));
  checks.push(makeCheck(
    "storage",
    "storage",
    memoryAttrs.storageGb ? `${memoryAttrs.storageGb}GB` : null,
    listingAttrs.storageGb ? `${listingAttrs.storageGb}GB` : null,
    10,
    memoryAttrs.storageGb && listingAttrs.storageGb
      ? memoryAttrs.storageGb === listingAttrs.storageGb ? "pass" : "warn"
      : "neutral",
    "저장용량이 다르면 확인이 필요합니다.",
  ));
  checks.push(makeCheck(
    "battery",
    "battery",
    memoryAttrs.batteryMin ? `>=${memoryAttrs.batteryMin}%` : null,
    listingAttrs.batteryMin ? `>=${listingAttrs.batteryMin}%` : null,
    10,
    memoryAttrs.batteryMin
      ? listingAttrs.batteryMin
        ? listingAttrs.batteryMin >= memoryAttrs.batteryMin ? "pass" : "fail"
        : "warn"
      : "neutral",
    "배터리 조건은 구매자가 말한 경우 hard constraint로 봅니다.",
  ));
  checks.push(makeCheck(
    "damage",
    "damage",
    memoryAttrs.avoidDamage ? "avoid" : null,
    listingAttrs.hasVisibleWear ? "visible wear" : "not signaled",
    10,
    memoryAttrs.avoidDamage
      ? listingAttrs.hasVisibleWear ? "fail" : "pass"
      : "neutral",
    "피하고 싶은 손상 조건은 가격보다 먼저 확인합니다.",
  ));
  checks.push(makeCheck(
    "budget",
    "budget vs ask",
    memory.budgetMax ? `$${memory.budgetMax}` : null,
    formatMinor(listing.askPriceMinor),
    12,
    memory.budgetMax
      ? listing.floorPriceMinor <= dollarsToMinor(memory.budgetMax)
        ? "pass"
        : listing.askPriceMinor <= dollarsToMinor(memory.budgetMax)
          ? "pass"
          : "warn"
      : "neutral",
    "판매가가 예산보다 높아도 floor가 예산 안이면 협상 여지가 있습니다.",
  ));

  const score = scoreChecks(checks);
  const failedHard = checks.some((check) => check.status === "fail" && ["category", "brand", "battery", "damage"].includes(check.key));
  const hasWarning = checks.some((check) => check.status === "warn");
  const issue = deriveAlignmentIssue(checks);
  const status: ListingAlignment["status"] = failedHard
    ? "mismatch"
    : score >= 0.8 && !hasWarning
      ? "match"
      : score >= 0.55
        ? "near_match"
        : "mismatch";

  return {
    status,
    issue: status === "match" ? "none" : issue,
    reason: status === "match"
      ? null
      : `memory/listing alignment score ${Math.round(score * 100)}%; issue=${issue}.`,
    question: status === "match"
      ? null
      : `기억은 ${formatIntentLabel(memoryIntent)}, 선택은 ${formatIntentLabel(listingIntent)}입니다. 이 상품으로 진행할까요?`,
    memoryIntent,
    listingIntent,
    score,
    checks,
    memoryAttributes: memoryAttrs,
    listingAttributes: listingAttrs,
  };
}

function buildAgentAlignmentQuestion(
  agentId: AncientBeingId,
  alignment: ListingAlignment,
): string {
  const remembered = formatIntentLabel(alignment.memoryIntent);
  const selected = formatIntentLabel(alignment.listingIntent);
  const labels = issueLabels(alignment);
  const base = (() => {
    switch (alignment.issue) {
      case "condition_missing":
        return {
          fab: `모델은 ${selected}로 맞아. 다만 ${labels} 정보가 카드에서 비어 있어. 이 조건은 나중에 확인하고 먼저 협상 들어갈까?`,
          vel: `${selected}의 윤곽은 맞습니다. 다만 ${labels} 빛이 아직 비어 있어요. 이 공백을 안고 진행할까요?`,
          judge: `모델은 일치합니다. 다만 ${labels} 증거가 부족합니다. 이 조건을 미확인 상태로 두고 진행할까요?`,
          hark: `모델은 맞다. 하지만 ${labels} 확인이 없다. 이 리스크를 안고 협상할지 결정해라.`,
          mia: `${selected}는 맞아 보여요. 그런데 ${labels} 정보가 아직 없어요. 그래도 조심해서 진행할까요?`,
          vault: `선택 잠금은 맞습니다. 단, ${labels} 증거가 비어 있습니다. 이 상태로 열까요?`,
          dealer_kai: `모델 신호는 맞아요. 근데 ${labels} 값이 비어 있네요. 일단 딜 켜고 확인 포인트로 잡을까요?`,
          dealer_hana: `좋아요, ${selected}는 맞아요. 근데 ${labels} 정보가 없어요. 이건 확인 포인트로 두고 협상 시작할까요?`,
          dealer_ethan: `모델은 맞습니다. 다만 ${labels} 데이터가 없습니다. 미확인 조건으로 표시하고 진행할까요?`,
          dealer_claire: `${selected} 선택은 맞습니다. 다만 ${labels} 확인이 필요해요. 이 상태로 진행할까요?`,
          buddy_fizz: `오, 모델은 맞아! 그런데 ${labels} 신호가 비어 있어. 이거 체크 포인트로 두고 협상할까?`,
          buddy_echo: `${selected} 쪽으로 기억과 맞닿아 있어요. 다만 ${labels} 정보가 비어 있습니다. 이 흐름으로 갈까요?`,
        };
      case "condition_violation":
        return {
          fab: `아, 이건 조심해야 해. ${labels} 조건이 기억이랑 충돌해. 그래도 이 상품으로 밀어볼까?`,
          vel: `${labels} 조건이 기억과 어긋납니다. 이 그림자를 감수하고 진행할까요?`,
          judge: `조건 충돌입니다. ${labels} 항목이 구매 조건을 위반할 수 있습니다. 그래도 진행할까요?`,
          hark: `조건 위반 가능성. ${labels}부터 걸린다. 이대로 진행할지 명확히 해라.`,
          mia: `${labels} 조건이 마음에 걸려요. 그래도 이 상품으로 진행해도 괜찮을까요?`,
          vault: `경고 잠금. ${labels} 조건이 충돌합니다. 예외로 열까요?`,
          dealer_kai: `이건 빨간 신호예요. ${labels}가 조건이랑 안 맞을 수 있어요. 그래도 딜 볼까요?`,
          dealer_hana: `잠깐, ${labels} 조건이 걸려요. 이건 위험할 수 있는데 그래도 갈까요?`,
          dealer_ethan: `${labels} 조건이 정책상 충돌합니다. 예외 승인으로 진행할까요?`,
          dealer_claire: `${labels} 조건이 맞지 않을 수 있어요. 그래도 이 상품으로 진행할까요?`,
          buddy_fizz: `앗, ${labels}에서 삐빅! 조건이 충돌해. 그래도 가볼까?`,
          buddy_echo: `${labels} 쪽에서 기억과 다른 울림이 있어요. 이 선택을 유지할까요?`,
        };
      case "model_mismatch":
      case "product_mismatch":
        return {
          fab: `아, 잠깐. 내 기억엔 ${remembered} 쪽이었는데 지금은 ${selected}를 눌렀어. 지금 상품으로 계속할지, 기억한 ${remembered} 후보로 돌아갈지 골라줘.`,
          vel: `기억 속 초점은 ${remembered}였어요. 지금 고른 건 ${selected}네요. 지금 선택을 비출지, ${remembered} 쪽으로 돌아갈지 고르면 됩니다.`,
          judge: `확인하겠습니다. 저장된 구매 의도는 ${remembered}, 현재 선택은 ${selected}입니다. 현재 상품으로 진행할지, 저장된 의도로 돌아갈지 선택해 주세요.`,
          hark: `멈춰. 기억은 ${remembered}, 선택은 ${selected}다. 현재 상품으로 협상할지, 원래 목표로 돌아갈지 정해라.`,
          mia: `잠깐만요. 전에 ${remembered}를 찾는다고 기억해요. 지금 고른 ${selected}로 갈지, ${remembered}로 돌아갈지 골라주세요.`,
          vault: `확인 잠금. 기억은 ${remembered}, 선택은 ${selected}. 현재 상품을 열지, ${remembered} 쪽으로 되돌릴지 선택하세요.`,
          dealer_kai: `Wait, 신호가 살짝 갈렸어요. 메모리는 ${remembered}, 지금 카드는 ${selected}. 지금 카드로 딜 켤지, ${remembered}로 돌릴지 골라주세요.`,
          dealer_hana: `헐 잠깐, 기억은 ${remembered}였는데 지금 ${selected} 눌렀어요. 이 상품으로 갈지, ${remembered}로 돌아갈지 골라주세요.`,
          dealer_ethan: `체크할게요. 이전 의도는 ${remembered}, 현재 선택은 ${selected}입니다. 현재 상품 기준으로 진행할지, 이전 의도로 돌아갈지 선택해 주세요.`,
          dealer_claire: `확인하고 갈게요. 기억은 ${remembered}인데 지금은 ${selected}를 선택했어요. 현재 상품으로 갈지, 기억한 상품으로 돌아갈지 골라주세요.`,
          buddy_fizz: `앗, 신호가 다르다! 기억은 ${remembered}, 지금 누른 건 ${selected}. 이걸로 협상할지, ${remembered}로 다시 갈지 골라줘.`,
          buddy_echo: `기억은 ${remembered} 쪽에 남아 있어요. 지금 선택은 ${selected}. 지금 흐름을 유지할지, 기억 쪽으로 돌아갈지 골라주세요.`,
        };
      case "variant_mismatch":
      case "storage_mismatch":
        return {
          fab: `${selected} 계열은 맞는데 ${labels}가 기억이랑 달라. 이 차이를 감수하고 협상 갈까?`,
          vel: `큰 형태는 맞지만 ${labels} 결이 다릅니다. 이 차이를 받아들일까요?`,
          judge: `제품군은 가깝지만 ${labels} 항목이 다릅니다. 현재 상품으로 진행할까요?`,
          hark: `${labels}가 다르다. 같은 계열이라고 그냥 넘기면 안 된다. 진행 여부를 정해라.`,
          mia: `거의 맞는데 ${labels}가 달라요. 이 정도 차이는 괜찮을까요?`,
          vault: `부분 일치. ${labels} 차이가 있습니다. 예외로 잠금 해제할까요?`,
          dealer_kai: `거의 맞는데 ${labels} 스펙이 달라요. 이 차이 감안하고 딜 켤까요?`,
          dealer_hana: `오 비슷한데 ${labels}가 달라요. 그래도 이걸로 가볼까요?`,
          dealer_ethan: `${labels} 차이가 감지됐습니다. 현재 상품으로 협상 조건을 갱신할까요?`,
          dealer_claire: `${labels}가 기억과 다릅니다. 이 상품 기준으로 진행할까요?`,
          buddy_fizz: `비슷해! 근데 ${labels}가 삐끗했어. 그래도 갈까?`,
          buddy_echo: `같은 방향이지만 ${labels}에서 다른 울림이 있어요. 이대로 갈까요?`,
        };
      case "budget_warning":
        return {
          fab: `상품은 맞아 보이는데 가격이 예산선에서 빡빡해. 그래도 협상으로 눌러볼까?`,
          vel: `가격이 예산의 가장자리에 걸려 있어요. 이 긴장을 안고 협상할까요?`,
          judge: `예산 경계입니다. 현재 가격 조건으로 협상을 시작할까요?`,
          hark: `예산선이 빡빡하다. 그래도 압박 협상으로 들어갈지 정해라.`,
          mia: `예산이 조금 빡빡해 보여요. 그래도 조심스럽게 시작할까요?`,
          vault: `가격 경계 감지. 예산 잠금 안에서 시도할까요?`,
          dealer_kai: `가격이 살짝 타이트해요. 그래도 앵커 낮게 잡고 들어갈까요?`,
          dealer_hana: `가격이 좀 빡빡한데, 그래도 한번 깎아볼까요?`,
          dealer_ethan: `예산 대비 가격 여유가 제한적입니다. 협상을 시작할까요?`,
          dealer_claire: `예산선이 가까워요. 현재 조건으로 진행할까요?`,
          buddy_fizz: `가격 신호가 타이트해! 그래도 딜 걸어볼까?`,
          buddy_echo: `가격이 예산 가까이에서 울려요. 이 흐름으로 갈까요?`,
        };
      default:
        return {
          fab: `확인할 게 있어. ${labels} 쪽이 애매해. 그래도 이 상품으로 갈까?`,
          vel: `${labels} 항목이 흐립니다. 이 선택을 이어갈까요?`,
          judge: `${labels} 확인이 필요합니다. 현재 상품으로 진행할까요?`,
          hark: `${labels} 확인 필요. 진행 여부를 정해라.`,
          mia: `${labels} 쪽을 조금 더 확인해야 해요. 그래도 진행할까요?`,
          vault: `${labels} 확인 잠금이 남아 있습니다. 열까요?`,
          dealer_kai: `${labels} 신호가 애매해요. 이대로 딜 켤까요?`,
          dealer_hana: `${labels}가 아직 애매해요. 그래도 가볼까요?`,
          dealer_ethan: `${labels} 확인이 필요합니다. 진행할까요?`,
          dealer_claire: `${labels}를 확인하고 싶어요. 그래도 시작할까요?`,
          buddy_fizz: `${labels} 신호가 반짝반짝 애매해! 그래도 갈까?`,
          buddy_echo: `${labels} 쪽이 아직 희미해요. 이 흐름으로 갈까요?`,
        };
    }
  })();

  return base[agentId] ?? alignment.question ?? `기억은 ${remembered}, 선택은 ${selected}입니다. 이 상품으로 진행할까요?`;
}

function quickActionLabels(
  pendingBudgetChange: PendingBudgetChange | null,
  alignment: ListingAlignment,
): { primary: string; secondary: string; tertiary: string } {
  if (pendingBudgetChange) {
    return {
      primary: "예산 변경 저장",
      secondary: "기존 예산 유지",
      tertiary: "직접 입력",
    };
  }

  const remembered = formatIntentLabel(alignment.memoryIntent);
  if (alignment.issue === "model_mismatch" || alignment.issue === "product_mismatch") {
    return {
      primary: "이 상품으로 협상",
      secondary: `${remembered}로 돌아가기`,
      tertiary: "직접 입력",
    };
  }

  if (alignment.issue === "condition_missing") {
    return {
      primary: "확인 포인트로 진행",
      secondary: "다른 상품 찾기",
      tertiary: "직접 입력",
    };
  }

  if (alignment.issue === "condition_violation") {
    return {
      primary: "그래도 진행",
      secondary: "조건 맞는 상품 찾기",
      tertiary: "직접 입력",
    };
  }

  if (alignment.issue === "variant_mismatch" || alignment.issue === "storage_mismatch") {
    return {
      primary: "이 스펙으로 진행",
      secondary: "기억 조건으로 찾기",
      tertiary: "직접 입력",
    };
  }

  if (alignment.issue === "budget_warning") {
    return {
      primary: "낮게 협상 시작",
      secondary: "예산 맞는 상품 찾기",
      tertiary: "직접 입력",
    };
  }

  return {
    primary: "현재 상품으로 진행",
    secondary: "기억 조건으로 찾기",
    tertiary: "직접 입력",
  };
}

function buildPendingBudgetChange(
  previousMemory: AdvisorMemory,
  nextMemory: AdvisorMemory,
): PendingBudgetChange | null {
  const previousBudget = previousMemory.budgetMax ?? previousMemory.targetPrice;
  const nextBudget = nextMemory.budgetMax ?? nextMemory.targetPrice;
  if (previousBudget === undefined || nextBudget === undefined) return null;
  if (Math.abs(previousBudget - nextBudget) < 5) return null;

  const previousIntent = extractIphoneModel(activeMemoryIntentText(previousMemory))
    ?? extractProductFamily(activeMemoryIntentText(previousMemory))
    ?? previousMemory.categoryInterest;
  const nextIntent = extractIphoneModel(activeMemoryIntentText(nextMemory))
    ?? extractProductFamily(activeMemoryIntentText(nextMemory))
    ?? nextMemory.categoryInterest;

  if (isKnownEmptyIntent(previousIntent) || isKnownEmptyIntent(nextIntent)) return null;
  if (previousIntent !== nextIntent) return null;

  return {
    intent: nextIntent,
    from: previousBudget,
    to: nextBudget,
    previousBudgetMax: previousMemory.budgetMax,
    previousTargetPrice: previousMemory.targetPrice,
    proposedMemory: nextMemory,
  };
}

function isBudgetConfirmation(text: string): boolean {
  return /^(맞아|응|네|ㅇㅇ|그래|확인|좋아|yes|yep|correct|right)(요|요\.|\.|!)?$/i.test(text.trim());
}

function isBudgetQuestion(text: string): boolean {
  return /(?:예산|budget|max|최대|목표|target|가격|얼마)/i.test(text);
}

function hasPercentNumber(text: string): boolean {
  return /\b\d{1,3}\s*%|퍼센트|프로\b/i.test(text);
}

function hasProductModelNumber(text: string): boolean {
  return /(?:iphone|아이폰|model|모델)\s*\d{1,2}\b/i.test(text)
    || /\b\d{1,2}\s*(?:pro\s*max|pro|max|plus|mini)\b/i.test(text);
}

function isShortModelAnswerToPendingQuestion(text: string, previousMemory?: AdvisorMemory): boolean {
  if (!previousMemory?.questions.some((question) => /(?:모델|iphone|아이폰|쪽|우선)/i.test(question))) return false;
  return /^\s*(?:1[1-9]|[2-9])\s*(?:은|는|로|요|\?)*\s*$/i.test(text.trim());
}

function hasExplicitMoneyUnit(text: string): boolean {
  return /[$]|(?:usd|dollars?|bucks?|달러|불)\b/i.test(text);
}

function extractExplicitBudgetDollars(text: string, previousMemory?: AdvisorMemory): number | null {
  const raw = text.toLowerCase().replace(/,/g, " ");
  if (hasPercentNumber(raw) || hasProductModelNumber(raw) || isShortModelAnswerToPendingQuestion(raw, previousMemory)) return null;
  const hasBudgetContext = isBudgetQuestion(raw)
    || previousMemory?.questions.some((question) => isBudgetQuestion(question));
  if (!hasBudgetContext) return null;

  const keywordAfter = raw.match(/(?:예산|budget|max|최대|목표|target|가격)[^\d$]{0,24}\$?\s*(\d{2,6})/i);
  const keywordBefore = raw.match(/\$?\s*(\d{2,6})\s*(?:달러|usd|dollars?|bucks?)?[^\n]{0,16}(?:예산|budget|max|최대|목표|target|가격)/i);
  const contextNumber = hasBudgetContext && !keywordAfter && !keywordBefore
    ? raw.match(/(?:^|[^\d])\$?\s*(\d{2,6})(?:\s*(?:달러|usd|dollars?|bucks?))?(?:$|[^\d])/i)
    : null;
  const parsed = Number(keywordAfter?.[1] ?? keywordBefore?.[1] ?? contextNumber?.[1]);

  if (!Number.isFinite(parsed)) return null;
  if (parsed < 100 && !hasExplicitMoneyUnit(raw) && !/(?:예산|budget|max|최대|목표|target)[^\d$]{0,24}\d{2}/i.test(raw)) return null;
  if (parsed < 20 || parsed > 100000) return null;
  return parsed;
}

function applyExplicitBudgetOverride(
  text: string,
  memory: AdvisorMemory,
  previousMemory?: AdvisorMemory,
): AdvisorMemory {
  const explicitBudget = extractExplicitBudgetDollars(text, previousMemory);
  if (!explicitBudget) return memory;

  const targetPrice = memory.targetPrice && memory.targetPrice <= explicitBudget
    ? memory.targetPrice
    : Math.max(1, Math.round(explicitBudget * 0.96));
  const hadPreviousBudget = previousMemory?.budgetMax !== undefined || previousMemory?.targetPrice !== undefined;

  return {
    ...memory,
    budgetMax: explicitBudget,
    targetPrice,
    questions: memory.questions.filter((question) => !isBudgetQuestion(question)),
    source: [
      ...memory.source.filter((item) => !/^Budget changed to/i.test(item) && !/^Budget change requested/i.test(item)),
      hadPreviousBudget ? `Budget change requested to $${explicitBudget}` : `budgetMax: ${explicitBudget}`,
    ],
  };
}

function getNegotiationReadiness(
  memory: AdvisorMemory,
  hasStoredMemory: boolean,
  options: {
    listing?: AdvisorListing | null;
    pendingBudgetChange?: PendingBudgetChange | null;
    alignmentConfirmed?: boolean;
  } = {},
): NegotiationReadiness {
  if (!hasStoredMemory) {
    return {
      ready: false,
      reason: "상담에서 구매 조건을 먼저 저장해 주세요.",
      question: memory.questions[0] ?? "어떤 물건을 어떤 조건으로 찾는지 알려주세요.",
    };
  }

  if (isKnownEmptyIntent(memory.categoryInterest)) {
    return {
      ready: false,
      reason: "찾는 상품 종류가 아직 충분히 정해지지 않았습니다.",
      question: "어떤 물건을 찾고 있는지 먼저 알려주세요.",
    };
  }

  if (memory.questions.length > 0) {
    return {
      ready: false,
      reason: `협상 전에 확인할 정보가 남아 있습니다: ${memory.questions[0]}`,
      question: memory.questions[0],
    };
  }

  if (!memory.budgetMax && !memory.targetPrice) {
    return {
      ready: false,
      reason: "협상에 쓸 예산 정보가 아직 없습니다.",
      question: "최대 예산이나 목표 가격은 어느 정도인가요?",
    };
  }

  if (options.pendingBudgetChange) {
    return {
      ready: false,
      reason: `${options.pendingBudgetChange.intent} 예산이 $${options.pendingBudgetChange.from}에서 $${options.pendingBudgetChange.to}로 바뀐 것으로 보입니다. 확인 후 협상을 시작합니다.`,
      question: `예산을 $${options.pendingBudgetChange.to}로 바꿀까요?`,
    };
  }

  if (!options.alignmentConfirmed) {
    const alignment = evaluateListingAlignment(memory, options.listing);
    const intervention = alignmentIntervention(alignment);
    if (intervention.blocksStart) {
      return {
        ready: false,
        reason: alignment.reason,
        question: alignment.question,
      };
    }
  }

  return { ready: true, reason: null, question: null };
}

function emptyCostLedger(): { turns: AdvisorCostTurn[]; prompt: number; completion: number; usd: number } {
  return {
    turns: [],
    prompt: 0,
    completion: 0,
    usd: 0,
  };
}

function statusTone(status: "idle" | "active" | "done" | "blocked") {
  if (status === "done") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (status === "active") return "border-cyan-400/40 bg-cyan-500/10 text-cyan-100";
  if (status === "blocked") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-slate-700 bg-slate-950/70 text-slate-400";
}

function checkTone(status: AttributeCheck["status"]) {
  if (status === "pass") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  if (status === "warn") return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  if (status === "fail") return "border-red-500/25 bg-red-500/10 text-red-100";
  return "border-slate-700 bg-slate-950/70 text-slate-400";
}

function formatAlignmentStatus(status: ListingAlignment["status"]) {
  if (status === "match") return "match";
  if (status === "near_match") return "near match";
  if (status === "mismatch") return "mismatch";
  return "unknown";
}

function EngineFlowPanel({
  hasStoredMemory,
  activeListing,
  alignment,
  readiness,
  pendingBudgetChange,
  alignmentConfirmed,
}: {
  hasStoredMemory: boolean;
  activeListing?: AdvisorListing | null;
  alignment: ListingAlignment;
  readiness: NegotiationReadiness;
  pendingBudgetChange: PendingBudgetChange | null;
  alignmentConfirmed: boolean;
}) {
  const intervention = alignmentIntervention(alignment);
  const alignmentBlocked = intervention.blocksStart;
  const steps = [
    {
      key: "memory",
      label: "Memory",
      value: hasStoredMemory ? "cards loaded" : "waiting",
      status: hasStoredMemory ? "done" : "active",
    },
    {
      key: "listing",
      label: "Listing",
      value: activeListing?.title ?? "not selected",
      status: activeListing ? "done" : "idle",
    },
    {
      key: "gate",
      label: "Alignment Gate",
      value: alignment.status === "unknown"
        ? "not evaluated"
        : `${formatAlignmentStatus(alignment.status)} · ${Math.round(alignment.score * 100)}%`,
      status: pendingBudgetChange || (alignmentBlocked && !alignmentConfirmed)
        ? "blocked"
        : alignment.status === "match" || alignmentConfirmed
          ? "done"
          : activeListing
            ? "active"
            : "idle",
    },
    {
      key: "hil",
      label: "HIL",
      value: pendingBudgetChange
        ? "budget confirm"
        : alignmentBlocked && !alignmentConfirmed
          ? intervention.label
          : "no intervention",
      status: pendingBudgetChange || (alignmentBlocked && !alignmentConfirmed)
        ? "active"
        : "done",
    },
    {
      key: "start",
      label: "Start",
      value: readiness.ready ? "enabled" : "blocked",
      status: readiness.ready ? "done" : "blocked",
    },
  ] satisfies Array<{ key: string; label: string; value: string; status: "idle" | "active" | "done" | "blocked" }>;
  const activeIndex = steps.findIndex((step) => step.status === "active");
  const blockedIndex = steps.findIndex((step) => step.status === "blocked");
  const currentIndex = activeIndex >= 0 ? activeIndex : blockedIndex >= 0 ? blockedIndex : steps.length - 1;
  const currentStep = steps[currentIndex] ?? steps[0];
  const currentStateLabel = currentStep.status === "blocked"
    ? "BLOCKED"
    : currentStep.status === "done"
      ? "DONE"
      : currentStep.status === "active"
        ? "ACTIVE"
        : "WAITING";

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
          Engine Flow
        </p>
        <span className="font-mono text-[10px] text-slate-500">
          live gate
        </span>
      </div>
      <div className="mb-2 rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-[10px] leading-5 text-slate-400">
        현재 위치는 <span className="text-cyan-200">{currentStep.label}</span> 단계이며 상태는 <span className="text-cyan-200">{currentStateLabel}</span>입니다. 점수는 데모용 휴리스틱이며 실제 최적 가중치는 거래 데이터로 보정해야 합니다.
      </div>
      <div>
        {steps.map((step, index) => (
          <div key={step.key}>
            <div className={`rounded-lg border p-2 text-xs ${statusTone(step.status)} ${
              index === currentIndex ? "ring-1 ring-cyan-300/60" : ""
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{index + 1}. {step.label}</span>
                <span className="font-mono uppercase">{index === currentIndex ? "YOU ARE HERE" : step.status}</span>
              </div>
              <p className="mt-1 truncate text-[11px] opacity-80">{step.value}</p>
            </div>
            {index < steps.length - 1 && (
              <div className="flex items-center gap-2 px-3 py-1 text-[11px] text-slate-500">
                <span className={`h-4 w-px ${steps[index + 1].status === "idle" ? "bg-slate-700" : "bg-cyan-400/40"}`} />
                <span className={steps[index + 1].status === "idle" ? "text-slate-600" : "text-cyan-300"}>↓</span>
                <span>{step.status === "blocked" ? "blocked before next step" : "next"}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AttributeGatePanel({ alignment }: { alignment: ListingAlignment }) {
  const visibleChecks = alignment.checks.filter((check) => check.status !== "neutral");
  if (visibleChecks.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Product Gate
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          상품을 선택하고 메모리가 로드되면 속성별 판단이 표시됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Product Gate
        </p>
        <span className="font-mono text-[10px] text-slate-500">
          score {Math.round(alignment.score * 100)}%
        </span>
      </div>
      <p className="mb-2 rounded-lg border border-amber-500/15 bg-amber-500/10 p-2 text-[11px] leading-5 text-amber-100">
        기준값은 아직 학습된 최적값이 아니라 rule-based heuristic입니다. 지금은 차단, 협상 전 확인, 참고 표시를 분리하고 추후 실제 성공/실패 협상 데이터로 가중치를 보정해야 합니다.
      </p>
      <div className="space-y-1.5">
        {visibleChecks.map((check) => (
          <div key={check.key} className={`rounded-lg border px-2 py-1.5 text-xs ${checkTone(check.status)}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{check.label}</span>
              <span className="font-mono uppercase">{check.status} · w{check.weight}</span>
            </div>
            <p className="mt-0.5 text-[11px] opacity-80">
              memory {check.memory} → listing {check.listing}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingInfoBoard({
  memory,
  disabled,
  onApply,
}: {
  memory: AdvisorMemory;
  disabled: boolean;
  onApply: (slot: MissingInfoSlot, value: SlotControlValue) => void;
}) {
  const slots = collectMissingInfoSlots(memory);
  const [budgetInput, setBudgetInput] = useState(memory.budgetMax ? String(memory.budgetMax) : "");
  const [batteryThreshold, setBatteryThreshold] = useState(extractBatteryMin(activeMemoryIntentText(memory)) ?? 90);
  const [textValues, setTextValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setBudgetInput(memory.budgetMax ? String(memory.budgetMax) : "");
    setBatteryThreshold(extractBatteryMin(activeMemoryIntentText(memory)) ?? 90);
  }, [memory]);

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
            Missing Info Board
          </p>
          <span className="font-mono text-[10px] text-emerald-200">CLEAR</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-emerald-100">
          필수 조건은 채워졌습니다. 협상 전에는 상품 게이트와 예산 확인만 남습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-100">
          Missing Info Board
        </p>
        <span className="font-mono text-[10px] text-amber-100">
          {slots.filter((slot) => slot.enforcement === "hard").length} hard / {slots.length} total
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-5 text-amber-100/80">
        부족한 조건을 한 번에 보고 채울 수 있습니다. 숫자 답변은 이 보드의 슬롯 안에서만 저장되므로 배터리 90%가 예산으로 바뀌지 않습니다.
      </p>
      <div className="space-y-2">
        {slots.map((slot) => {
          const key = slotKey(slot);
          return (
            <div key={key} className="rounded-lg border border-slate-700 bg-slate-950/70 p-2">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-white">{slotTitle(slot.slotId)}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{slot.question}</p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${
                  slot.enforcement === "hard"
                    ? "border-red-400/30 text-red-200"
                    : "border-slate-600 text-slate-400"
                }`}>
                  {slot.enforcement}
                </span>
              </div>

              {slot.slotId === "max_budget" && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={budgetInput}
                    onChange={(event) => setBudgetInput(event.target.value)}
                    placeholder="최대 예산"
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    disabled={disabled || !Number.isFinite(Number(budgetInput)) || Number(budgetInput) <= 0}
                    onClick={() => onApply(slot, { kind: "budget", budgetMax: Number(budgetInput) })}
                    className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    저장
                  </button>
                </div>
              )}

              {slot.slotId === "battery_health" && (
                <div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={75}
                      max={100}
                      step={1}
                      value={batteryThreshold}
                      onChange={(event) => setBatteryThreshold(Number(event.target.value))}
                      className="min-w-0 flex-1"
                    />
                    <span className="w-12 text-right font-mono text-xs text-cyan-100">{batteryThreshold}%</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {[90, 85, 80].map((value) => (
                      <button
                        key={value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onApply(slot, { kind: "battery", threshold: value })}
                        className="rounded-md border border-cyan-500/30 px-2 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
                      >
                        {value}%+
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onApply(slot, { kind: "battery", threshold: batteryThreshold })}
                      className="rounded-md bg-cyan-500 px-2 py-1.5 text-[11px] font-semibold text-slate-950 disabled:opacity-50"
                    >
                      적용
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onApply(slot, { kind: "battery", noPreference: true })}
                    className="mt-1.5 w-full rounded-md border border-slate-600 px-2 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-50"
                  >
                    배터리 기준 없음
                  </button>
                </div>
              )}

              {slot.slotId === "carrier_lock" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onApply(slot, { kind: "carrier", unlockedRequired: true })}
                    className="rounded-md bg-cyan-500 px-2 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
                  >
                    언락 필수
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onApply(slot, { kind: "carrier", unlockedRequired: null })}
                    className="rounded-md border border-slate-600 px-2 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-50"
                  >
                    상관없음
                  </button>
                </div>
              )}

              {!["max_budget", "battery_health", "carrier_lock"].includes(slot.slotId) && (
                <div className="flex gap-2">
                  <input
                    value={textValues[key] ?? ""}
                    onChange={(event) => setTextValues((prev) => ({ ...prev, [key]: event.target.value }))}
                    placeholder={slot.slotId === "shopping_intent" ? "예: iPhone 15 Pro" : "직접 입력"}
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    disabled={disabled || !(textValues[key] ?? "").trim()}
                    onClick={() => onApply(slot, { kind: "text", text: textValues[key] ?? "" })}
                    className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    저장
                  </button>
                </div>
              )}

              {slot.slotId === "buyer_priority" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApply(slot, { kind: "text", text: "no additional requirements", noPreference: true })}
                  className="mt-1.5 w-full rounded-md border border-slate-600 px-2 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-50"
                >
                  추가 조건 없음
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function collectMissingInfoSlots(memory: AdvisorMemory): MissingInfoSlot[] {
  const slots: MissingInfoSlot[] = [];
  const add = (slot: MissingInfoSlot) => {
    const key = slotKey(slot);
    if (slots.some((item) => slotKey(item) === key)) return;
    slots.push(slot);
  };

  if (isKnownEmptyIntent(memory.categoryInterest)) {
    add({
      slotId: "shopping_intent",
      question: "찾는 제품이나 상황을 먼저 정해주세요.",
      enforcement: "hard",
      status: "pending",
    });
  }

  if (!memory.budgetMax && !memory.targetPrice) {
    add({
      slotId: "max_budget",
      question: "협상에 쓸 최대 예산을 정해주세요.",
      enforcement: "hard",
      productScope: memory.structured?.activeIntent?.productScope,
      status: "pending",
    });
  }

  for (const slot of memory.structured?.pendingSlots ?? []) {
    add(slot);
  }

  for (const slot of memory.structured?.questionPlan?.deferred ?? []) {
    add({
      slotId: slot.slotId,
      question: slot.question,
      enforcement: slot.enforcement,
      productScope: slot.productScope,
      status: "pending",
    });
  }

  for (const question of memory.questions) {
    add({
      slotId: inferSlotIdFromQuestion(question),
      question,
      enforcement: "hard",
      productScope: memory.structured?.activeIntent?.productScope,
      status: "pending",
    });
  }

  return slots.sort((a, b) => {
    if (a.enforcement !== b.enforcement) return a.enforcement === "hard" ? -1 : 1;
    return slotPriority(a.slotId) - slotPriority(b.slotId);
  });
}

function slotKey(slot: Pick<MissingInfoSlot, "slotId" | "productScope">): string {
  return `${slot.productScope ?? "global"}:${slot.slotId}`;
}

function slotPriority(slotId: string): number {
  const priorities: Record<string, number> = {
    shopping_intent: 1,
    max_budget: 2,
    battery_health: 3,
    carrier_lock: 4,
    buyer_priority: 5,
  };
  return priorities[slotId] ?? 99;
}

function slotTitle(slotId: string): string {
  const labels: Record<string, string> = {
    shopping_intent: "상품 범위",
    max_budget: "최대 예산",
    buyer_priority: "구매 우선순위",
    battery_health: "배터리 기준",
    carrier_lock: "언락/통신사",
    imei_verification: "IMEI 확인",
  };
  return labels[slotId] ?? slotId.replace(/_/g, " ");
}

function inferSlotIdFromQuestion(question: string): string {
  if (/(?:예산|최대|목표|가격|budget|max|target|얼마)/i.test(question)) return "max_budget";
  if (/(?:배터리|성능|battery)/i.test(question)) return "battery_health";
  if (/(?:언락|잠금|통신사|carrier|unlocked|locked)/i.test(question)) return "carrier_lock";
  if (/(?:제품|상품|찾고|상황|모델|iphone|아이폰)/i.test(question)) return "shopping_intent";
  return "buyer_priority";
}

function applySlotControlValue(memory: AdvisorMemory, slot: MissingInfoSlot, value: SlotControlValue): AdvisorMemory {
  let next: AdvisorMemory = {
    ...memory,
    mustHave: [...memory.mustHave],
    avoid: [...memory.avoid],
    questions: memory.questions.filter((question) => inferSlotIdFromQuestion(question) !== slot.slotId),
    source: [...memory.source],
  };
  const sourcePrefix = slot.productScope ? `${slot.productScope} ` : "";

  if (value.kind === "budget") {
    const budgetMax = Math.max(1, Math.round(value.budgetMax));
    next = {
      ...next,
      budgetMax,
      targetPrice: value.targetPrice && value.targetPrice <= budgetMax
        ? Math.round(value.targetPrice)
        : Math.max(1, Math.round(budgetMax * 0.96)),
      source: uniqueStrings([
        ...next.source.filter((item) => !/^budgetMax:|^Budget changed to|^Budget change requested/i.test(item)),
        `budgetMax: ${budgetMax}`,
      ]),
    };
  } else if (value.kind === "battery") {
    const fact = value.noPreference
      ? `${sourcePrefix}battery no preference`.trim()
      : `${sourcePrefix}battery >= ${value.threshold ?? 90}%`.trim();
    next = {
      ...next,
      mustHave: value.noPreference
        ? next.mustHave.filter((item) => !/battery|배터리|성능/i.test(item))
        : replaceSlotFacts(next.mustHave, "battery_health", fact),
      source: replaceSourceSlot(next.source, "battery_health", fact),
    };
  } else if (value.kind === "carrier") {
    const fact = value.unlockedRequired === true
      ? `${sourcePrefix}unlocked`.trim()
      : `${sourcePrefix}carrier no preference`.trim();
    next = {
      ...next,
      mustHave: value.unlockedRequired === true
        ? replaceSlotFacts(next.mustHave, "carrier_lock", "unlocked")
        : next.mustHave.filter((item) => !/unlocked|locked|carrier|언락|잠금|통신사/i.test(item)),
      source: replaceSourceSlot(next.source, "carrier_lock", fact),
    };
  } else if (value.kind === "text") {
    const text = value.text.trim();
    if (slot.slotId === "shopping_intent") {
      next = {
        ...next,
        categoryInterest: text,
        source: uniqueStrings([...next.source, text]),
      };
    } else if (slot.slotId === "buyer_priority" && value.noPreference) {
      next = {
        ...next,
        source: uniqueStrings([...next.source, text]),
      };
    } else if (text) {
      next = {
        ...next,
        mustHave: uniqueStrings([...next.mustHave, text]),
        source: uniqueStrings([...next.source, `${sourcePrefix}${text}`.trim()]),
      };
    }
  }

  return markSlotAnswered(next, slot);
}

function markSlotAnswered(memory: AdvisorMemory, slot: MissingInfoSlot): AdvisorMemory {
  if (!memory.structured) return memory;
  const activeScope = slot.productScope ?? memory.structured.activeIntent?.productScope;
  const productRequirements = { ...memory.structured.productRequirements };

  if (activeScope) {
    const current = productRequirements[activeScope] ?? {
      mustHave: [],
      avoid: [],
      answeredSlots: [],
      ambiguousSlots: [],
    };
    productRequirements[activeScope] = {
      ...current,
      answeredSlots: uniqueStrings([...current.answeredSlots, slot.slotId]),
      ambiguousSlots: current.ambiguousSlots.filter((item) => item !== slot.slotId),
    };
  }

  return {
    ...memory,
    structured: {
      ...memory.structured,
      productRequirements,
      pendingSlots: memory.structured.pendingSlots.filter((item) => slotKey(item) !== slotKey(slot)),
      questionPlan: memory.structured.questionPlan
        ? {
          ...memory.structured.questionPlan,
          askedThisTurn: { kind: "none" },
          deferred: memory.structured.questionPlan.deferred.filter((item) => slotKey(item) !== slotKey(slot)),
        }
        : memory.structured.questionPlan,
    },
  };
}

function replaceSlotFacts(values: string[], slotId: string, fact: string): string[] {
  return uniqueStrings([
    ...values.filter((item) => !factMatchesSlot(item, slotId)),
    fact,
  ]);
}

function replaceSourceSlot(values: string[], slotId: string, fact: string): string[] {
  return uniqueStrings([
    ...values.filter((item) => !factMatchesSlot(item, slotId)),
    fact,
  ]).slice(-8);
}

function factMatchesSlot(value: string, slotId: string): boolean {
  if (slotId === "battery_health") return /battery|배터리|성능/i.test(value);
  if (slotId === "carrier_lock") return /unlocked|locked|carrier|언락|잠금|통신사/i.test(value);
  if (slotId === "max_budget") return /budget|예산|target|목표/i.test(value);
  return false;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export function AgentProductAdvisor({
  userId,
  selectedAgentId,
  selectedListingId,
  onStartNegotiation,
  onPresetDraftChange,
  presetFeedbackUpdate,
  onEndDemo,
  endingDemo,
}: {
  userId: string;
  selectedAgentId: AncientBeingId;
  selectedListingId?: string;
  onStartNegotiation: (listing: AdvisorListing, memory: AdvisorMemory, readiness: NegotiationReadiness) => void;
  onPresetDraftChange?: (draft: PresetTuningDraft | null) => void;
  presetFeedbackUpdate?: {
    id: string;
    cards: StoredMemoryCard[];
    message: string;
  } | null;
  onEndDemo: () => void;
  endingDemo: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => createInitialMessages(selectedAgentId));
  const [memory, setMemory] = useState<AdvisorMemory>(() => createBaseMemory());
  const memoryRef = useRef<AdvisorMemory>(memory);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [backendState, setBackendState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    origin: "none" | "loaded" | "saved_this_session";
    cards: StoredMemoryCard[];
    extracted: number;
    message: string;
  }>({
    status: "idle",
    origin: "none",
    cards: [],
    extracted: 0,
    message: "아직 백엔드 저장 전입니다.",
  });
  const [costLedger, setCostLedger] = useState(() => emptyCostLedger());
  const [listings, setListings] = useState<AdvisorListing[]>([]);
  const [listingStatus, setListingStatus] = useState<"loading" | "db" | "empty" | "error">("loading");
  const [listingMatchedCount, setListingMatchedCount] = useState(0);
  const [candidatePlan, setCandidatePlan] = useState<AdvisorCandidatePlan | null>(null);
  const [retrievalMeta, setRetrievalMeta] = useState<AdvisorRetrievalMeta | null>(null);
  const [activeListingId, setActiveListingId] = useState(selectedListingId ?? "");
  const [pendingBudgetChange, setPendingBudgetChange] = useState<PendingBudgetChange | null>(null);
  const [confirmedListingId, setConfirmedListingId] = useState<string | null>(null);
  const agent = getAgent(selectedAgentId);
  const agentImage = getAgentImage(selectedAgentId);
  const availableListings = listings;
  const scoredListings = useMemo(
    () =>
      availableListings
        .map((listing) => ({ listing, score: scoreListing(listing, memory) }))
        .sort((a, b) => b.score - a.score),
    [availableListings, memory],
  );
  const visibleScoredListings = scoredListings.slice(0, 8);
  const activeListing = availableListings.find((listing) => listing.id === activeListingId) ?? scoredListings[0]?.listing;
  const hasStoredMemory = backendState.status === "saved" && backendState.cards.length > 0;
  const memoryOriginLabel = backendState.origin === "loaded"
    ? "loaded from backend"
    : backendState.origin === "saved_this_session"
      ? "saved this session"
      : "session draft";
  const latestStoredCardAt = backendState.cards
    .map((card) => card.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const activeAlignment = evaluateListingAlignment(memory, activeListing);
  const activeIntervention = alignmentIntervention(activeAlignment);
  const alignmentConfirmed = Boolean(activeListing && confirmedListingId === activeListing.id);
  const activeNeedsAlignmentConfirmation = !alignmentConfirmed && activeIntervention.blocksStart;
  const activeNeedsChatConfirmation = activeNeedsAlignmentConfirmation && activeIntervention.showsChatPrompt;
  const activeNeedsInlineConfirmation = activeNeedsAlignmentConfirmation && !activeIntervention.showsChatPrompt;
  const activeAlignmentCleared = activeAlignment.status === "match" || alignmentConfirmed || !activeIntervention.blocksStart;
  const negotiationReadiness = getNegotiationReadiness(memory, hasStoredMemory, {
    listing: activeListing,
    pendingBudgetChange,
    alignmentConfirmed,
  });
  const quickActions = quickActionLabels(pendingBudgetChange, activeAlignment);
  const briefStatusText = pendingBudgetChange
    ? "예산 변경 확인이 필요합니다."
    : activeNeedsAlignmentConfirmation
      ? alignmentBadgeText(activeAlignment)
      : negotiationReadiness.ready
        ? "상품을 선택했습니다. 오른쪽 협상 시작 버튼을 누르면 저장된 메모리로 진행합니다."
        : negotiationReadiness.reason ?? "상담에서 조건을 조금 더 확인해야 합니다.";

  useEffect(() => {
    let cancelled = false;

    async function loadListings() {
      try {
        const response = await getAdvisorDemoListings({ limit: 8 });
        if (cancelled) return;
        if (response.listings.length > 0) {
          setListings(response.listings);
          setListingStatus("db");
          setListingMatchedCount(response.count);
          setCandidatePlan(response.advisor_plan ?? null);
          setRetrievalMeta(response.retrieval ?? null);
          setActiveListingId((prev) => (
            response.listings.some((listing) => listing.id === prev)
              ? prev
              : response.listings[0].id
          ));
        } else {
          setListings([]);
          setListingStatus("empty");
          setListingMatchedCount(0);
          setCandidatePlan(null);
          setRetrievalMeta(response.retrieval ?? null);
        }
      } catch {
        if (!cancelled) {
          setListings([]);
          setListingStatus("error");
          setListingMatchedCount(0);
          setCandidatePlan(null);
          setRetrievalMeta(null);
        }
      }
    }

    void loadListings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadStoredMemory() {
      try {
        const response = await getDemoMemoryCards(userId);
        if (cancelled) return;

        const restored = response.advisor_memory;
        if (!restored) {
          setBackendState((prev) => ({
            ...prev,
            status: "idle",
            origin: "none",
            cards: [],
            extracted: 0,
            message: "저장된 상담 메모리가 없습니다. 대화로 조건을 남기면 새로고침 후에도 복원됩니다.",
          }));
          return;
        }

        memoryRef.current = restored;
        setMemory(restored);
        const listingQuery = buildListingSearchQuery(restored, restored.source.join(" "));
        const listingResponse = await getAdvisorDemoListings({
          query: listingQuery,
          limit: 8,
        }).catch(() => null);
        if (cancelled) return;
        if (listingResponse?.listings.length) {
          const bestListing = listingResponse.listings
            .map((listing) => ({
              listing,
              score: scoreListing(listing, restored),
              rank: memoryTargetRank(evaluateListingAlignment(restored, listing)),
            }))
            .sort((a, b) => {
              const rankDelta = a.rank - b.rank;
              return rankDelta !== 0 ? rankDelta : b.score - a.score;
            })[0]?.listing;
          setListings(listingResponse.listings);
          setListingStatus("db");
          setListingMatchedCount(listingResponse.count);
          setCandidatePlan(listingResponse.advisor_plan ?? null);
          setRetrievalMeta(listingResponse.retrieval ?? null);
          setActiveListingId(bestListing?.id ?? listingResponse.listings[0].id);
        }
        setBackendState({
          status: "saved",
          origin: "loaded",
          cards: response.cards,
          extracted: response.cards.length,
          message: `${response.cards.length}개 저장 메모리를 불러왔습니다. 상품을 누르면 이 메모리로 협상합니다.`,
        });
      } catch (error) {
        if (!cancelled) {
          setBackendState((prev) => ({
            ...prev,
            status: "error",
            message: error instanceof Error ? error.message : "저장된 메모리를 불러오지 못했습니다.",
          }));
        }
      }
    }

    void loadStoredMemory();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!presetFeedbackUpdate) return;
    setBackendState((prev) => {
      const cards = mergeStoredMemoryCards(prev.cards, presetFeedbackUpdate.cards);
      return {
        ...prev,
        status: "saved",
        origin: "saved_this_session",
        cards,
        extracted: cards.length,
        message: presetFeedbackUpdate.message,
      };
    });
  }, [presetFeedbackUpdate]);

  useEffect(() => {
    if (!hasStoredMemory || scoredListings.length === 0) return;
    setActiveListingId((prev) => {
      const ranked = scoredListings
        .map(({ listing, score }) => ({
          listing,
          score,
          rank: memoryTargetRank(evaluateListingAlignment(memory, listing)),
        }))
        .sort((a, b) => {
          const rankDelta = a.rank - b.rank;
          return rankDelta !== 0 ? rankDelta : b.score - a.score;
        });
      const best = ranked[0];
      const current = ranked.find(({ listing }) => listing.id === prev);
      if (!best) return prev;
      if (!current) return best.listing.id;
      return current.rank <= best.rank ? prev : best.listing.id;
    });
  }, [hasStoredMemory, memory, scoredListings]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0]?.id === "agent-0" && prev[0].role === "agent") {
        return createInitialMessages(selectedAgentId);
      }
      return prev;
    });
  }, [selectedAgentId]);

  async function persistMemory(text: string, nextMemory: AdvisorMemory): Promise<boolean> {
    setBackendState((prev) => ({
      ...prev,
      status: "saving",
      message: "백엔드에 상담 메모리를 저장 중입니다.",
    }));

    try {
      const response = await saveAdvisorMemory({
        userId,
        agentId: selectedAgentId,
        message: text,
        memory: nextMemory,
      });

      setBackendState({
        status: "saved",
        origin: "saved_this_session",
        cards: response.memory_cards,
        extracted: response.signals.extracted,
        message: `${response.memory_cards.length}개 메모리 카드 저장, ${response.signals.extracted}개 대화 신호 추출`,
      });
      return response.memory_cards.length > 0;
    } catch (error) {
      setBackendState((prev) => ({
        ...prev,
        status: "error",
        message: error instanceof Error ? error.message : "백엔드 저장에 실패했습니다.",
      }));
      return false;
    }
  }

  function askForMissingNegotiationInfo(question: string | null) {
    const text = question ?? "협상 전에 조건을 조금 더 확인해야 합니다.";
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "agent" && last.text === text) return prev;
      if (questionAlreadyCovered(prev, text)) return prev;
      return [
        ...prev,
        {
          id: `agent-missing-info-${Date.now()}`,
          role: "agent",
          text,
        },
      ];
    });
  }

  function questionAlreadyCovered(messagesToCheck: ChatMessage[], question: string): boolean {
    const recentAgentText = messagesToCheck
      .filter((message) => message.role === "agent")
      .slice(-3)
      .map((message) => message.text)
      .join(" ");
    const normalizedRecent = normalizeQuestion(recentAgentText);
    const normalizedQuestion = normalizeQuestion(question);

    if (normalizedQuestion && normalizedRecent.includes(normalizedQuestion)) return true;
    if (/(?:모델|iphone13|iphone15|13|15)/i.test(normalizedQuestion)) {
      return /(?:모델|쪽|우선)/.test(normalizedRecent) && /13/.test(normalizedRecent) && /15/.test(normalizedRecent);
    }
    if (/(?:예산|목표|가격|budget|target)/i.test(question)) {
      return /(?:예산|목표|가격|budget|target)/i.test(recentAgentText);
    }

    return false;
  }

  function normalizeQuestion(value: string): string {
    return value
      .toLowerCase()
      .replace(/iphone\s*/g, "iphone")
      .replace(/[\s"'`.,:;()[\]{}_\-/?!?。！？]+/g, "");
  }

  function selectListingForNegotiation(listing: AdvisorListing) {
    const selectedListingConfirmed = confirmedListingId === listing.id;
    const readiness = getNegotiationReadiness(memoryRef.current, hasStoredMemory, {
      listing,
      pendingBudgetChange,
      alignmentConfirmed: selectedListingConfirmed,
    });
    setActiveListingId(listing.id);
    if (!selectedListingConfirmed) setConfirmedListingId(null);
    onStartNegotiation(listing, memoryRef.current, readiness);
    const alignment = evaluateListingAlignment(memoryRef.current, listing);
    const shouldUseQuickAction = pendingBudgetChange
      || alignment.status === "near_match"
      || alignment.status === "mismatch";
    if (!readiness.ready && !shouldUseQuickAction) {
      askForMissingNegotiationInfo(readiness.question);
    }
  }

  function confirmBudgetChange() {
    if (!pendingBudgetChange) return;
    const confirmedMemory = pendingBudgetChange.proposedMemory;
    memoryRef.current = confirmedMemory;
    setMemory(confirmedMemory);
    setBackendState((prev) => ({
      ...prev,
      message: `${pendingBudgetChange.intent} 예산 변경을 $${pendingBudgetChange.to}로 확인했습니다.`,
    }));
    setPendingBudgetChange(null);
    const readiness = getNegotiationReadiness(confirmedMemory, hasStoredMemory, {
      listing: activeListing,
      pendingBudgetChange: null,
      alignmentConfirmed,
    });
    if (activeListing) {
      onStartNegotiation(activeListing, confirmedMemory, readiness);
    }
    void persistMemory("budget_change_confirmed", confirmedMemory);
  }

  async function rejectBudgetChange() {
    if (!pendingBudgetChange) return;
    setPendingBudgetChange(null);
    setBackendState((prev) => ({
      ...prev,
      status: hasStoredMemory ? "saved" : prev.status,
      message: `예산 변경을 취소하고 $${pendingBudgetChange.from} 기준으로 되돌렸습니다.`,
    }));
    if (activeListing) {
      const readiness = getNegotiationReadiness(memoryRef.current, hasStoredMemory, {
        listing: activeListing,
        pendingBudgetChange: null,
        alignmentConfirmed,
      });
      onStartNegotiation(activeListing, memoryRef.current, readiness);
    }
  }

  async function applyMissingInfoSlot(slot: MissingInfoSlot, value: SlotControlValue) {
    const nextMemory = applySlotControlValue(memoryRef.current, slot, value);
    memoryRef.current = nextMemory;
    setMemory(nextMemory);
    setPendingBudgetChange(null);
    setConfirmedListingId(null);
    setMessages((prev) => [
      ...prev,
      {
        id: `agent-slot-${slot.slotId}-${Date.now()}`,
        role: "agent",
        text: `${slotTitle(slot.slotId)} 기준을 저장했습니다. 남은 조건은 오른쪽 보드에서 이어서 조정할 수 있어요.`,
      },
    ]);

    const saved = await persistMemory(`slot_control:${slot.slotId}`, nextMemory);
    if (activeListing) {
      const readiness = getNegotiationReadiness(nextMemory, saved || hasStoredMemory, {
        listing: activeListing,
        pendingBudgetChange: null,
        alignmentConfirmed: false,
      });
      onStartNegotiation(activeListing, nextMemory, readiness);
    }
  }

  function confirmSelectedListing() {
    if (!activeListing) return;
    setConfirmedListingId(activeListing.id);
    const readiness = getNegotiationReadiness(memoryRef.current, hasStoredMemory, {
      listing: activeListing,
      pendingBudgetChange,
      alignmentConfirmed: true,
    });
    onStartNegotiation(activeListing, memoryRef.current, readiness);
    setBackendState((prev) => ({
      ...prev,
      message: `${activeListing.title} 선택을 확인했습니다.`,
    }));
  }

  function startFreshDraft() {
    const freshMemory = createBaseMemory();
    memoryRef.current = freshMemory;
    setMemory(freshMemory);
    setMessages(createInitialMessages(selectedAgentId));
    setPendingBudgetChange(null);
    setConfirmedListingId(null);
    setCostLedger(emptyCostLedger());
    setBackendState({
      status: "idle",
      origin: "none",
      cards: [],
      extracted: 0,
      message: "백엔드 저장값은 삭제하지 않고, 현재 화면만 새 상담 초안으로 전환했습니다. 새로고침하면 저장된 메모리를 다시 불러올 수 있습니다.",
    });
  }

  function focusChatInput() {
    inputRef.current?.focus();
  }

  function selectBestMemoryMatchedListing() {
    const matched = scoredListings
      .map(({ listing, score }) => ({
        listing,
        score,
        alignment: evaluateListingAlignment(memoryRef.current, listing),
      }))
      .filter(({ alignment }) => memoryTargetRank(alignment) < 99)
      .sort((a, b) => {
        const rankDelta = memoryTargetRank(a.alignment) - memoryTargetRank(b.alignment);
        return rankDelta !== 0 ? rankDelta : b.score - a.score;
      })[0]?.listing;
    if (!matched) {
      focusChatInput();
      return;
    }
    setActiveListingId(matched.id);
    setConfirmedListingId(null);
    const readiness = getNegotiationReadiness(memoryRef.current, hasStoredMemory, {
      listing: matched,
      pendingBudgetChange,
      alignmentConfirmed: false,
    });
    onStartNegotiation(matched, memoryRef.current, readiness);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: `user-${messages.length}-${Date.now()}`,
      role: "user",
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (inputRef.current) inputRef.current.value = "";

    if (pendingBudgetChange && isBudgetConfirmation(trimmed)) {
      confirmBudgetChange();
      return;
    }

    setBackendState((prev) => ({
      ...prev,
      status: "saving",
      message: "상담 맥락을 분석해 필요한 정보만 추리는 중입니다.",
    }));

    try {
      const previousMemory = memoryRef.current;
      const selectedListingBeforeTurn = activeListing;
      const inputListings = (availableListings.length > 0
        ? availableListings
        : activeListing
          ? [activeListing]
          : []
      ).slice(0, 8);
      const analyzed = await analyzeAdvisorTurn({
        userId,
        agentId: selectedAgentId,
        message: trimmed,
        previousMemory,
        listings: inputListings,
      });
      const intentSwitchedMemory = applyActiveIntentSwitchOverride(trimmed, previousMemory, analyzed.memory);
      const proposedMemory = applyExplicitBudgetOverride(trimmed, intentSwitchedMemory, previousMemory);
      const budgetChange = buildPendingBudgetChange(previousMemory, proposedMemory);
      const nextMemory = budgetChange ? previousMemory : proposedMemory;
      const planningMemory = budgetChange ? proposedMemory : nextMemory;
      const agentMessage: ChatMessage = {
        id: `agent-${messages.length}-${Date.now()}`,
        role: "agent",
        text: budgetChange
          ? `${budgetChange.intent} 예산을 $${budgetChange.from}에서 $${budgetChange.to}로 바꿀까요? 확인 전에는 저장하지 않을게요.`
          : analyzed.reply,
      };

      memoryRef.current = nextMemory;
      setMemory(nextMemory);
      setPendingBudgetChange(budgetChange);
      if (!budgetChange) setConfirmedListingId(null);
      setMessages((prev) => [...prev, agentMessage]);
      setCandidatePlan(analyzed.advisor_plan ?? candidatePlan);
      const turnCost = analyzed.turn_cost;
      if (turnCost) {
        setCostLedger((prev) => ({
          turns: [
            ...prev.turns,
            {
              ...turnCost,
              turn: prev.turns.length + 1,
            },
          ],
          prompt: prev.prompt + turnCost.tokens.prompt,
          completion: prev.completion + turnCost.tokens.completion,
          usd: prev.usd + turnCost.estimated_usd,
        }));
      }
      if (budgetChange) {
        setBackendState((prev) => ({
          ...prev,
          status: hasStoredMemory ? "saved" : "idle",
          message: `${budgetChange.intent} 예산 변경을 $${budgetChange.from}에서 $${budgetChange.to}로 바꿀지 확인 대기 중입니다. 승인 전에는 저장하지 않았습니다.`,
        }));
        return;
      }

      setBackendState((prev) => ({
        ...prev,
        status: "saving",
        message: "상담 답변 완료. 조건에 맞는 상품과 메모리를 업데이트 중입니다.",
      }));

      const listingQuery = buildListingSearchQuery(planningMemory, trimmed);
      const [searchedListings, memorySaved] = await Promise.all([
        getAdvisorDemoListings({
          query: listingQuery,
          limit: 8,
        }).catch(() => null),
        persistMemory(trimmed, nextMemory),
      ]);
      const nextListings = searchedListings?.listings.length
        ? searchedListings.listings
        : inputListings;
      const nextBestListing = nextListings
        .map((listing) => ({ listing, score: scoreListing(listing, planningMemory) }))
        .sort((a, b) => b.score - a.score)[0]?.listing;
      const retainedListing = selectedListingBeforeTurn
        && nextListings.some((listing) => listing.id === selectedListingBeforeTurn.id)
        ? selectedListingBeforeTurn
        : nextBestListing;

      if (nextListings.length > 0) {
        setListings(nextListings);
        setListingStatus("db");
        setListingMatchedCount(searchedListings?.count ?? nextListings.length);
        setCandidatePlan(analyzed.advisor_plan ?? searchedListings?.advisor_plan ?? null);
        setRetrievalMeta(searchedListings?.retrieval ?? null);
        setActiveListingId(retainedListing?.id ?? nextListings[0].id);
      } else {
        setListings([]);
        setListingStatus("empty");
        setListingMatchedCount(0);
        setCandidatePlan(analyzed.advisor_plan ?? null);
        setRetrievalMeta(searchedListings?.retrieval ?? null);
        setActiveListingId("");
      }

      if (memorySaved && nextBestListing) {
        const savedReadiness = getNegotiationReadiness(nextMemory, true, {
          listing: nextBestListing,
          pendingBudgetChange: budgetChange,
          alignmentConfirmed: false,
        });
        onStartNegotiation(nextBestListing, nextMemory, savedReadiness);
      } else if (nextBestListing) {
        onStartNegotiation(nextBestListing, nextMemory, {
          ready: false,
          reason: "상담 메모리 저장이 끝나야 협상을 시작할 수 있습니다.",
          question: null,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "상담 분석에 실패했습니다.";
      setBackendState((prev) => ({
        ...prev,
        status: "error",
        message: `상담 분석 실패: ${message}`,
      }));
      setMessages((prev) => [
        ...prev,
        {
          id: `agent-error-${Date.now()}`,
          role: "agent",
          text: "상담 분석 API에 연결하지 못했습니다. 로컬 API가 켜져 있는지 확인한 뒤 다시 전송해 주세요.",
        },
      ]);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/30 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 inline-flex rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200">
            Agent Product Advisor
          </div>
          <h2 className="text-xl font-bold text-white">상담 → 메모리 → 상품 추천 → 협상 시작</h2>
          <p className="mt-1 text-sm text-slate-400">
            구매자 에이전트가 넓은 요청에서 선호를 기억하고, DB의 등록 상품 중 협상할 대상을 고릅니다.
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          판매자는 기본 에이전트 하나로 고정
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
          <div className="mb-3 flex items-center gap-3 border-b border-slate-800 pb-3">
            <div className="h-14 w-14 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
              <img src={agentImage} alt="" className="h-full w-full object-cover object-top" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-cyan-200">내 소유 에이전트</p>
              <p className="font-bold text-white">{agent.name}</p>
              <p className="text-xs text-slate-400">{agent.kind} · {agent.role}</p>
            </div>
          </div>

          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[86%] rounded-xl border px-3 py-2 text-sm leading-6 ${
                    message.role === "user"
                      ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-50"
                      : "border-slate-700 bg-slate-900 text-slate-200"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
            {(pendingBudgetChange || activeNeedsChatConfirmation) && (
              <div className="flex justify-start">
                <div className="max-w-[86%] rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-50">
                  <p>
                    {pendingBudgetChange
                      ? `${pendingBudgetChange.intent} 예산을 $${pendingBudgetChange.from}에서 $${pendingBudgetChange.to}로 바꿀까요?`
                      : buildAgentAlignmentQuestion(selectedAgentId, activeAlignment)}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={pendingBudgetChange ? confirmBudgetChange : confirmSelectedListing}
                      className="rounded-md bg-amber-300 px-2 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-200"
                    >
                      {quickActions.primary}
                    </button>
                    <button
                      type="button"
                      onClick={pendingBudgetChange ? () => void rejectBudgetChange() : selectBestMemoryMatchedListing}
                      className="rounded-md border border-amber-300/30 px-2 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/10"
                    >
                      {quickActions.secondary}
                    </button>
                    <button
                      type="button"
                      onClick={focusChatInput}
                      className="rounded-md border border-slate-600 px-2 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-400"
                    >
                      {quickActions.tertiary}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <input
              ref={inputRef}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={(event) => {
                const nativeEvent = event.nativeEvent as KeyboardEvent;
                if (
                  event.key === "Enter"
                  && !composingRef.current
                  && !nativeEvent.isComposing
                  && nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  void send(event.currentTarget.value);
                }
              }}
              placeholder="예: 대학원에서 쓸 가벼운 노트북 찾고 있어"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={() => void send(inputRef.current?.value ?? "")}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
            >
              전송
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <MissingInfoBoard
            memory={memory}
            disabled={backendState.status === "saving"}
            onApply={(slot, value) => void applyMissingInfoSlot(slot, value)}
          />

          <EngineFlowPanel
            hasStoredMemory={hasStoredMemory}
            activeListing={activeListing}
            alignment={activeAlignment}
            readiness={negotiationReadiness}
            pendingBudgetChange={pendingBudgetChange}
            alignmentConfirmed={alignmentConfirmed}
          />

          <AttributeGatePanel alignment={activeAlignment} />

          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">
              Memory Overview
            </p>
            <div className="grid gap-2 text-xs text-slate-300">
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">category_interest</span>
                <p className="font-medium text-white">{memory.categoryInterest}</p>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">budget_model</span>
                <p className="font-medium text-white">
                  target ${memory.targetPrice ?? "?"} / max ${memory.budgetMax ?? "?"}
                </p>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">must_have</span>
                <p className="font-medium text-white">{memory.mustHave.join(", ") || "not confirmed"}</p>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">avoid</span>
                <p className="font-medium text-white">{memory.avoid.join(", ") || "none"}</p>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">risk_and_tactic</span>
                <p className="font-medium text-white">
                  {memory.riskStyle} · {memory.negotiationStyle} · {memory.openingTactic}
                </p>
              </div>
            </div>
            {memory.source.length > 0 && (
              <div className="mt-3 rounded-lg border border-violet-500/15 bg-slate-950/60 p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">
                    Source Summary
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">{memory.source.length} facts</span>
                </div>
                <ul className="space-y-1 text-xs text-slate-300">
                  {memory.source.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}
            {memory.structured && (
              <div className="mt-3 rounded-lg border border-sky-500/15 bg-slate-950/60 p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-200">
                    Structured Memory
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {Object.keys(memory.structured.productRequirements).length} scopes
                  </span>
                </div>
                <div className="space-y-1 text-xs text-slate-300">
                  <p>
                    active:{" "}
                    <span className="text-white">
                      {memory.structured.activeIntent?.productScope ?? "not scoped"}
                    </span>
                  </p>
                  {Object.entries(memory.structured.productRequirements).slice(0, 3).map(([scope, requirements]) => (
                    <p key={scope}>
                      {scope}:{" "}
                      <span className="text-white">
                        {[...requirements.mustHave, ...requirements.avoid].join(", ") || "no scoped facts"}
                      </span>
                    </p>
                  ))}
                  {memory.structured.pendingSlots.length > 0 && (
                    <p>
                      pending:{" "}
                      <span className="text-amber-100">
                        {memory.structured.pendingSlots.map((slot) => `${slot.slotId}:${slot.status}`).join(", ")}
                      </span>
                    </p>
                  )}
                  {memory.structured.discardedSignals.length > 0 && (
                    <p>
                      discarded:{" "}
                      <span className="text-slate-400">
                        {memory.structured.discardedSignals.slice(-2).map((signal) => signal.reason).join(", ")}
                      </span>
                    </p>
                  )}
                  {memory.structured.memoryConflicts.length > 0 && (
                    <p>
                      conflicts:{" "}
                      <span className="text-rose-100">
                        {memory.structured.memoryConflicts.slice(-3).map((item) => `${item.slotId}:${item.status}`).join(", ")}
                      </span>
                    </p>
                  )}
                  {(memory.structured.scopedConditionDecisions ?? []).length > 0 && (
                    <p>
                      scope decisions:{" "}
                      <span className="text-amber-100">
                        {(memory.structured.scopedConditionDecisions ?? []).slice(-2).map((item) => `${item.slotId}:${item.decision}`).join(", ")}
                      </span>
                    </p>
                  )}
                  {memory.structured.longTermMemory && (
                    <p>
                      long-term:{" "}
                      <span className="text-emerald-100">
                        {memory.structured.longTermMemory.facts.slice(-3).join(", ") || "none"}
                      </span>
                    </p>
                  )}
                  {memory.structured.sessionMemory && (
                    <p>
                      session-only:{" "}
                      <span className="text-cyan-100">
                        {memory.structured.sessionMemory.facts.slice(-2).join(", ") || "none"}
                      </span>
                    </p>
                  )}
                  {memory.structured.promotionDecisions.length > 0 && (
                    <p>
                      promotion:{" "}
                      <span className="text-slate-400">
                        {memory.structured.promotionDecisions.slice(-3).map((item) => `${item.decision}:${item.reason}`).join(", ")}
                      </span>
                    </p>
                  )}
                  {memory.structured.compression && (
                    <p>
                      compression:{" "}
                      <span className="text-slate-400">{memory.structured.compression.summary}</span>
                    </p>
                  )}
                  {memory.structured.questionPlan && (
                    <p>
                      question:{" "}
                      <span className="text-slate-400">
                        {memory.structured.questionPlan.askedThisTurn.kind} {memory.structured.questionPlan.budget.used}/{memory.structured.questionPlan.budget.maxQuestionsPerTurn}
                        {memory.structured.questionPlan.deferred.length > 0
                          ? ` · deferred ${memory.structured.questionPlan.deferred.map((item) => `${item.slotId}:${item.reason}`).join(", ")}`
                          : ""}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            )}
            {memory.questions.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-100">
                부족한 정보: {memory.questions[0]}
              </div>
            )}
            {memory.questions.length > 0 && !hasStoredMemory && (
              <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-xs text-cyan-100">
                상담을 한 번 전송하고 백엔드 저장이 완료되면 새로고침 후에도 이 조건을 다시 불러옵니다.
              </div>
            )}
            <div
              className={`mt-3 rounded-lg border p-2 text-xs ${
                backendState.status === "saved"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                  : backendState.status === "error"
                    ? "border-red-500/20 bg-red-500/10 text-red-100"
                    : "border-slate-700 bg-slate-950/60 text-slate-400"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">Backend Memory</span>
                <span className="font-mono">{backendState.status}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-300">
                  {memoryOriginLabel}
                </span>
                {latestStoredCardAt && (
                  <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                    updated {new Date(latestStoredCardAt).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="mt-1">{backendState.message}</p>
              {backendState.origin === "loaded" && (
                <p className="mt-2 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-amber-100">
                  이 화면의 조건은 이전에 저장된 백엔드 메모리에서 복원된 값입니다. 새 메시지를 보내면 현재 대화 기준으로 다시 분석하고 저장합니다.
                </p>
              )}
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                user_id: {userId}
              </p>
              {backendState.cards.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
                    <span>Stored HIL Cards</span>
                    <span>{backendState.cards.length} cards</span>
                  </div>
                  {backendState.cards.map((card) => (
                    <div key={card.id} className="rounded bg-slate-950/60 px-2 py-1.5 text-slate-300">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-emerald-200">
                          {card.card_type}:{card.memory_key.replace("advisor:", "")}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {formatMemoryStrength(card.strength)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-5 text-slate-200">{card.summary}</p>
                    </div>
                  ))}
                </div>
              )}
              {backendState.origin !== "none" && (
                <button
                  type="button"
                  onClick={startFreshDraft}
                  disabled={endingDemo}
                  className="mt-3 w-full rounded-lg border border-cyan-500/30 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-400 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  화면만 새 상담 초안으로 전환
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setCostLedger(emptyCostLedger());
                  onEndDemo();
                }}
                disabled={endingDemo}
                className="mt-3 w-full rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:border-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {endingDemo ? "데모 데이터 삭제 중" : "데모 종료 및 메모리 삭제"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
                Advisor LLM Cost
              </p>
              <span className="font-mono text-[10px] text-slate-500">
                {costLedger.turns.length} calls
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">prompt</span>
                <p className="font-mono font-semibold text-white">{costLedger.prompt.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">completion</span>
                <p className="font-mono font-semibold text-white">{costLedger.completion.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-2">
                <span className="text-slate-500">est.</span>
                <p className="font-mono font-semibold text-white">{formatUsd(costLedger.usd)}</p>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-slate-400">
              {costLedger.turns.length === 0 ? (
                <p>상담 메시지를 보내면 턴별 토큰과 예상 비용이 기록됩니다.</p>
              ) : (
                costLedger.turns.slice(-3).map((turn) => (
                  <div key={turn.turn} className="flex items-center justify-between gap-2 rounded bg-slate-950/60 px-2 py-1">
                    <span>turn {turn.turn} · {turn.model}</span>
                    <span className="font-mono text-slate-300">
                      {turn.tokens.prompt.toLocaleString()}+{turn.tokens.completion.toLocaleString()} · {formatUsd(turn.estimated_usd)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-200">
                Candidate Planner
              </p>
              <span className="font-mono text-[10px] text-slate-500">
                {listingMatchedCount} matched
              </span>
            </div>
            {candidatePlan ? (
              <div className="space-y-2 text-xs">
                <div className="rounded-lg bg-slate-950/70 p-2">
                  <span className="text-slate-500">next action</span>
                  <p className="font-medium text-white">
                    {candidatePlan.nextAction.action} · {formatPlannerSlot(candidatePlan.nextAction.slot)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">{candidatePlan.nextAction.reasonCode}</p>
                </div>
                {candidatePlan.dominantCluster && (
                  <div className="rounded-lg bg-slate-950/70 p-2">
                    <span className="text-slate-500">dominant cluster</span>
                    <p className="font-medium text-white">
                      {candidatePlan.dominantCluster.label} · {formatShare(candidatePlan.dominantCluster.share)}
                    </p>
                  </div>
                )}
                <div className="grid gap-2">
                  {candidatePlan.facets
                    .filter((facet) => facet.values.length > 1)
                    .slice(0, 3)
                    .map((facet) => (
                      <div key={facet.slot} className="rounded-lg bg-slate-950/70 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">{formatPlannerSlot(facet.slot)}</span>
                          <span className="font-mono text-[10px] text-slate-600">H {facet.entropy}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-slate-300">
                          {facet.values.slice(0, 3).map((value) => `${value.label} ${value.count}`).join(" · ")}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <p className="text-xs leading-5 text-slate-500">
                상담 메시지를 보내면 후보군 분포와 다음 질문 근거가 표시됩니다.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                등록된 DB 상품
              </p>
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">
                {listingStatus === "db"
                  ? `${availableListings.length}/${listingMatchedCount} from DB · ${formatRetrievalMode(retrievalMeta)}`
                  : listingStatus}
              </span>
            </div>
            {visibleScoredListings.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs leading-5 text-slate-400">
                실제 등록 상품을 불러오지 못했습니다. DB에 published listing이 있어야 이 데모에서 협상할 물건을 선택할 수 있습니다.
              </div>
            ) : (
            <div className="space-y-2">
              {visibleScoredListings.map(({ listing, score }) => {
                const selected = listing.id === activeListing?.id;
                const alignment = evaluateListingAlignment(memory, listing);
                const intervention = alignmentIntervention(alignment);
                const needsGateCheck = intervention.mode !== "none";

                return (
                  <button
                    key={listing.id}
                    type="button"
	                    onClick={() => selectListingForNegotiation(listing)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-cyan-400/50 bg-cyan-500/10"
                        : "border-slate-800 bg-slate-900/70 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{listing.title}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          {listing.category ? `${listing.category} · ` : ""}{listing.condition}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-bold text-cyan-200">{formatMinor(listing.askPriceMinor)}</p>
                        <p className="text-[10px] text-slate-500">fit {score}</p>
                      </div>
                    </div>
                    {needsGateCheck && (
                      <p className={`mt-2 rounded-md border px-2 py-1 text-[11px] leading-5 ${
                        intervention.mode === "observe"
                          ? "border-slate-700 bg-slate-950/60 text-slate-400"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                      }`}>
                        {intervention.label}: {alignmentBadgeText(alignment)}
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-slate-500">{listing.sellerNote}</p>
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {activeListing && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
              Negotiation Brief
            </p>
            <ul className="space-y-1 text-xs text-slate-300">
              {buildNegotiationBrief(memory, activeListing).map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
            <p className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-400">
              {briefStatusText}
            </p>
            {activeAlignment.status !== "unknown" && (
              <p
                className={`mt-2 rounded-lg border p-2 text-xs ${
                  activeAlignmentCleared
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                }`}
              >
                intent alignment: {activeAlignment.memoryIntent} → {activeAlignment.listingIntent}
                {activeAlignment.status === "match" || alignmentConfirmed
                  ? " · matched"
                  : activeIntervention.mode === "observe"
                    ? " · observed"
                    : " · needs confirmation"}
              </p>
            )}
            {pendingBudgetChange && (
              <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-100">
                예산 변경은 왼쪽 상담창에서 확인합니다.
              </p>
            )}
            {activeNeedsInlineConfirmation && (
              <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2">
                <p className="text-xs leading-5 text-amber-100">
                  {buildAgentAlignmentQuestion(selectedAgentId, activeAlignment)}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={confirmSelectedListing}
                    className="rounded-md bg-amber-300 px-2 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-200"
                  >
                    {quickActions.primary}
                  </button>
                  <button
                    type="button"
                    onClick={selectBestMemoryMatchedListing}
                    className="rounded-md border border-amber-300/30 px-2 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/10"
                  >
                    {quickActions.secondary}
                  </button>
                  <button
                    type="button"
                    onClick={focusChatInput}
                    className="rounded-md border border-slate-600 px-2 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-400"
                  >
                    {quickActions.tertiary}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}

          <PresetTuningPanel
            userId={userId}
            agentId={selectedAgentId}
            listing={activeListing}
            memory={memory}
            storedCards={backendState.cards}
            onDraftChange={onPresetDraftChange}
            onCandidateSaved={(cards, summary) => {
              setBackendState((prev) => {
                const mergedCards = mergeStoredMemoryCards(prev.cards, cards);
                return {
                  ...prev,
                  status: "saved",
                  origin: "saved_this_session",
                  cards: mergedCards,
                  extracted: mergedCards.length,
                  message: `User-tuned preset 후보 저장: ${summary}`,
                };
              });
            }}
          />
        </div>
      </div>
    </section>
  );
}
