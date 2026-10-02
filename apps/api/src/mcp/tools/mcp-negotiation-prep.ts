import {
  buildBuyerChoiceQuestions,
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
} from "@haggle/shared";
import { MVP_ENABLED_FULFILLMENT_METHODS } from "../../lib/negotiation-fulfillment.js";
import { buyerVisibleRequiredCriteria } from "../../services/public-listing-view.js";
import type { McpRecentMessage } from "./negotiation-talk.js";

/** Listing columns the prep helpers read (subset of getPublishedListingByPublicId). */
export interface PrepListing {
  id: string;
  publicId: string | null;
  title: string | null;
  description?: string | null;
  category: string | null;
  condition: string | null;
  targetPrice: string | null;
  photoUrl?: string | null;
  tags?: string[] | null;
  negotiationAgentSnapshot?: unknown;
}

function listingTags(listing: PrepListing): string[] {
  return [listing.category, ...(listing.tags ?? [])].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
}

/** Tag-garden questions with options — the same source as the web wizard. */
export function listingTagQuestions(listing: PrepListing) {
  return buildBuyerChoiceQuestions(listingTags(listing)).map((q) => ({
    check_id: q.checkId,
    question: q.question,
    enforcement: q.enforcement,
    options: q.options,
  }));
}

/**
 * Server-filled advisor input for haggle_builder_chat_turn. Buyer pages never see the
 * seller floor, so floor/market fall back to the ask exactly like the web builder.
 */
export function advisorInputFromListing(listing: PrepListing) {
  const askMajor = Number(listing.targetPrice);
  const askPriceMinor = Number.isFinite(askMajor) && askMajor > 0 ? Math.round(askMajor * 100) : 0;
  const snapshot = (listing.negotiationAgentSnapshot as Record<string, unknown> | null) ?? {};
  return {
    listings:
      askPriceMinor > 0
        ? [
            {
              id: listing.publicId ?? listing.id,
              title: listing.title ?? "",
              ...(listing.category ? { category: listing.category } : {}),
              condition: listing.condition ?? "unknown",
              askPriceMinor,
              floorPriceMinor: askPriceMinor,
              marketMedianMinor: askPriceMinor,
              tags: listing.tags ?? [],
              ...(listing.description ? { sellerNote: listing.description } : {}),
            },
          ]
        : [],
    seller_required_criteria: buyerVisibleRequiredCriteria(snapshot),
  };
}

export function defaultBuilderMemory(listing: PrepListing) {
  return {
    categoryInterest: listing.category ?? listing.title ?? "item",
    mustHave: [],
    avoid: [],
    dealBreakers: [],
    mustEmphasize: [],
    notes: [],
    categoryCriteria: [],
    riskStyle: "balanced" as const,
    negotiationStyle: "balanced" as const,
    openingTactic: "fair_market_anchor" as const,
    questions: [],
    source: [],
  };
}

function presetView(preset: NegotiationAgentPreset) {
  return {
    id: preset.id,
    name: preset.copy.buyer.name,
    name_ko: preset.copy.buyer.nameKo,
    description: preset.copy.buyer.description,
  };
}

export const MCP_MODE_GUIDANCE = {
  consult:
    "Round by round with the user (buyer_control_mode manual): haggle_play_next each round, show the counterpart line and price, decide the next move together.",
  delegate:
    "Hand it off with the budget limit (buyer_control_mode auto): haggle_play_until runs rounds and returns a per-round transcript_summary and chat_url.",
};

export const MCP_FULFILLMENT_CHOICES = MVP_ENABLED_FULFILLMENT_METHODS.map((method) => ({
  method,
  label: "Carrier shipping (address is collected at checkout)",
  start_arg: { fulfillment: { methods: [method], preferred: method } },
}));

export function buildPrepareNegotiationView(
  listing: PrepListing,
  savedAgents: Array<{ id: string; name: string; description: string | null }>,
) {
  const required = buyerVisibleRequiredCriteria(listing.negotiationAgentSnapshot);
  const askMajor = Number(listing.targetPrice);
  return {
    listing: {
      public_id: listing.publicId,
      title: listing.title,
      category: listing.category,
      condition: listing.condition,
      asking_price: Number.isFinite(askMajor) ? askMajor : null,
      photo_url: listing.photoUrl ?? null,
    },
    required_criteria: required.map((c) => ({ ...c, must_answer: true })),
    tag_questions: listingTagQuestions(listing),
    price_questions: [
      {
        field: "targetPrice",
        ask: "What price would you ideally like to pay? (whole dollars)",
      },
      {
        field: "budgetMax",
        ask: "What is the most you would pay — your walk-away limit? (whole dollars)",
      },
    ],
    presets: NEGOTIATION_AGENT_PRESETS.map(presetView),
    saved_agents: savedAgents,
    fulfillment_choices: MCP_FULFILLMENT_CHOICES,
    modes: MCP_MODE_GUIDANCE,
    start_with: "haggle_start_negotiation",
    instruction:
      "Ask the user every required_criteria question first (must_answer), then the tag_questions, then target and max price (budgetMax/targetPrice are WHOLE DOLLARS). Offer a strategy chat via haggle_builder_chat_turn with this public_id. Ask which fulfillment to use, then ask: consult (decide each round together) or delegate (hand it off with the limit). Finally call haggle_start_negotiation with buyerCriteria, builder_memory {budgetMax, targetPrice, ...}, buyer_control_mode and fulfillment.",
  };
}

/** One line per spoken round for haggle_play_until / digests. */
export function summarizeTranscript(messages: McpRecentMessage[]) {
  return messages.map((m) => ({
    round: m.round_no,
    who: m.speaker === "BUYER" ? "buyer" : "seller",
    price_minor: m.price_minor ?? null,
    line: (m.message ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  }));
}

/** `![title](photo_url)` for a listing photo, or null. Text clients render it inline. */
export function listingImageMarkdown(
  title: string | null | undefined,
  photoUrl: string | null | undefined,
): string | null {
  if (!photoUrl) return null;
  const alt = (title ?? "listing").replace(/[[\]\n]/g, " ").trim() || "listing";
  return `![${alt}](${photoUrl})`;
}

const money = (minor: string | number | null | undefined) => {
  const major = Number(minor) / 100;
  return minor == null || !Number.isFinite(major)
    ? "-"
    : major.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
};

/** Round table (round / seller offer / my offer / note) + status + chat link. No full message dump. */
export function negotiationSummaryMarkdown(
  messages: McpRecentMessage[],
  status: string | null | undefined,
  chatUrl: string,
): string {
  const byRound = new Map<number, { seller: string; mine: string; note: string }>();
  for (const m of messages) {
    const row = byRound.get(m.round_no) ?? { seller: "-", mine: "-", note: "" };
    if (m.speaker === "BUYER") row.mine = money(m.price_minor);
    else row.seller = money(m.price_minor);
    const line = (m.message ?? "")
      .replace(/[\s|]+/g, " ")
      .trim()
      .slice(0, 80);
    row.note = row.note || line;
    byRound.set(m.round_no, row);
  }
  const rows = [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, r]) => `| ${round} | ${r.seller} | ${r.mine} | ${r.note} |`);
  return [
    "| round | seller offer | my offer | note |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    `Status: ${status ?? "unknown"} · [Open chat](${chatUrl})`,
  ].join("\n");
}
