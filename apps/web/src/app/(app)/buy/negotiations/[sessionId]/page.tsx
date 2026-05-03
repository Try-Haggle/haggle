import { serverApi } from "@/lib/api-server";
import { BUYER_AGENT_PRESETS } from "@/lib/buyer-agents";
import { PlaybackArena } from "./playback/playback-arena";
import { getMockPlayback } from "./playback/mock-data";
import type { PlaybackResponse } from "./playback/types";

/**
 * Buyer-side negotiation playback page.
 *
 * Frontend-only: the transcript is mocked, but the listing details (title,
 * asking price, category, seller agent) are fetched from the real listing
 * referenced in the sessionId so the playback reflects the item the buyer
 * actually opened.
 */

interface PublicListing {
  publicId: string;
  title: string;
  category: string | null;
  targetPrice: string | null;
  photoUrl: string | null;
  sellerAgentPreset: string | null;
}

const SELLER_AGENT_META: Record<string, { name: string; tagline: string; accentColor: string; iconKey: PlaybackResponse["session"]["sellerAgent"]["iconKey"] }> = {
  gatekeeper:  { name: "The Gatekeeper",  tagline: "Holds firm on value.",          accentColor: "#06b6d4", iconKey: "gatekeeper" },
  diplomat:    { name: "The Diplomat",    tagline: "Builds rapport, lands fair deals.", accentColor: "#06b6d4", iconKey: "diplomat" },
  storyteller: { name: "The Storyteller", tagline: "Frames value through context.",  accentColor: "#a855f7", iconKey: "storyteller" },
  dealmaker:   { name: "The Dealmaker",   tagline: "Closes deals quickly.",          accentColor: "#10b981", iconKey: "dealmaker" },
};

/** Extracts the listing publicId from the sessionId, stripping the `-{agentId}` suffix. */
function parsePublicId(sessionId: string): string {
  for (const preset of BUYER_AGENT_PRESETS) {
    const suffix = `-${preset.id}`;
    if (sessionId.endsWith(suffix)) return sessionId.slice(0, -suffix.length);
  }
  return sessionId;
}

async function fetchListing(publicId: string): Promise<PublicListing | null> {
  try {
    const data = await serverApi.get<{ ok: boolean; listing: PublicListing }>(
      `/api/public/listings/${publicId}`,
      { skipAuth: true },
    );
    return data?.ok && data.listing ? data.listing : null;
  } catch {
    return null;
  }
}

/** Round to a "nice" increment so scaled prices read naturally ($1,275 not $1,273.42). */
function roundToNice(n: number): number {
  if (n < 100) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 25) * 25;
  if (n < 10000) return Math.round(n / 50) * 50;
  return Math.round(n / 100) * 100;
}

/** Scales every $N occurrence in a text by `ratio`, preserving formatting. */
function scalePricesInText(text: string, ratio: number): string {
  return text.replace(/\$([\d,]+(?:\.\d+)?)/g, (_, raw: string) => {
    const n = parseFloat(raw.replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) return `$${raw}`;
    return `$${roundToNice(n * ratio).toLocaleString("en-US")}`;
  });
}

function applyListingOverride(base: PlaybackResponse, listing: PublicListing): PlaybackResponse {
  const realAsking = listing.targetPrice ? parseFloat(listing.targetPrice) : base.session.listing.askingPrice;
  const mockAsking = base.session.listing.askingPrice;
  const ratio = mockAsking > 0 ? realAsking / mockAsking : 1;
  const sellerMeta = listing.sellerAgentPreset ? SELLER_AGENT_META[listing.sellerAgentPreset] : null;

  // Scale every offer price proportionally so the negotiation numbers anchor
  // to the real asking price (e.g. mock $4,200 opening on a $5,800 listing
  // becomes ~$870 opening on a $1,200 listing).
  const scaledRounds = base.rounds.map((r) => ({
    ...r,
    offerPrice: roundToNice(r.offerPrice * ratio),
    message: scalePricesInText(r.message, ratio),
    factors: {
      ...r.factors,
      reasoning: r.factors.reasoning
        ? scalePricesInText(r.factors.reasoning, ratio)
        : r.factors.reasoning,
    },
  }));
  const scaledFinalPrice = base.session.finalPrice
    ? roundToNice(base.session.finalPrice * ratio)
    : null;

  return {
    ...base,
    session: {
      ...base.session,
      listing: {
        ...base.session.listing,
        id: listing.publicId,
        title: listing.title,
        imageUrl: listing.photoUrl,
        askingPrice: realAsking,
        category: listing.category,
      },
      finalPrice: scaledFinalPrice,
      sellerAgent: sellerMeta
        ? { ...base.session.sellerAgent, presetId: listing.sellerAgentPreset!, ...sellerMeta }
        : base.session.sellerAgent,
    },
    rounds: scaledRounds,
  };
}

export default async function BuyerNegotiationPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const publicId = parsePublicId(sessionId);
  const [base, listing] = await Promise.all([
    Promise.resolve(getMockPlayback(sessionId)),
    fetchListing(publicId),
  ]);
  const data = listing ? applyListingOverride(base, listing) : base;
  return <PlaybackArena data={data} />;
}
