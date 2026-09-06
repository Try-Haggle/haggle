"use client";

import {
  type AgentBuilderState,
  applyChatStrategyToState,
  engineParamsFromPreset,
  isBuilderCustomized,
  resolveEffectivePreset,
} from "@haggle/shared";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentBuilder } from "@/app/(app)/sell/agents/_components/AgentBuilder";
import { Nav } from "@/components/nav";
import {
  canStartWithFulfillment,
  emptyFulfillmentValue,
  PreNegotiationFulfillment,
  type PreNegotiationFulfillmentValue,
} from "@/components/shipping/pre-negotiation-fulfillment";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { ApiError } from "@/lib/api-client";
import { formatPriceStr } from "@/lib/format";
import {
  formatListingParcel,
  parseListingParcel,
  parseSellerFulfillmentOffer,
} from "@/lib/fulfillment-options";
import { stashGuestBuyerClaim } from "@/lib/guest-buyer-claim-storage";
import { storeNegotiationRunToken } from "@/lib/negotiation-auto-play-token";
import { isCompleteShippingAddress, toApiAddress } from "@/lib/shipping-address";
import { useAmplitude } from "@/providers/amplitude-provider";
import {
  NegotiationAgentBuilderChat,
  type NegotiationAgentBuilderMemory,
} from "./negotiation-agent-builder-chat";
import { startOrResumeListingNegotiation } from "./negotiation-api";

/* ─── Types ───────────────────────────────────────────────── */

interface Listing {
  id: string;
  publicId: string;
  publishedAt: string;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  tags: string[] | null;
  sellerAgentPreset: string | null;
  sellingDeadline: string | null;
  /** Phase G Flow 2: the seller's REQUIRED category criteria (buyer-safe: id + ask). */
  sellerRequiredCriteria: Array<{ checkId: string; ask: string }> | null;
  sellerFulfillmentOffer?: {
    options: Array<{ method: string; radius_miles?: number; max_weight_lb?: number }>;
    preferred?: string;
  } | null;
  parcel?: {
    weight_oz: number;
    length_in?: number;
    width_in?: number;
    height_in?: number;
  } | null;
}

/* ─── Helpers ─────────────────────────────────────────────── */

function getSellerAgentName(presetId: string | null): string {
  const map: Record<string, string> = {
    gatekeeper: "The Gatekeeper",
    diplomat: "The Diplomat",
    storyteller: "The Storyteller",
    dealmaker: "The Dealmaker",
  };
  return presetId ? (map[presetId] ?? "Custom Agent") : "Default Agent";
}

function timeRemaining(deadline: string | null): string | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h remaining`;
  return `${hours}h remaining`;
}

/* Radar replaced by StrategyRadar (4D weights + behavior curves). */

/* ─── Main Component ──────────────────────────────────────── */

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface HfmiData {
  median: number;
  sample_count: number;
  period_days: 30;
}

type Origin = "browse" | "buy-dashboard" | "sell-dashboard";

const ORIGIN_LABEL: Record<Origin, string> = {
  browse: "Back to Browse",
  "buy-dashboard": "Back to Dashboard",
  "sell-dashboard": "Back to Dashboard",
};

const ORIGIN_HREF: Record<Origin, string> = {
  browse: "/browse",
  "buy-dashboard": "/buy/dashboard",
  "sell-dashboard": "/sell/dashboard",
};

export function BuyerLanding({
  listing,
  user,
  isOwner = false,
  from = null,
}: {
  listing: Listing;
  user: UserInfo | null;
  isOwner?: boolean;
  from?: Origin | null;
}) {
  const { track } = useAmplitude();
  const [agentValue, setAgentValue] = useState<AgentBuilderState | null>(null);
  const [negotiationAgentBuilderMemory, setNegotiationAgentBuilderMemory] =
    useState<NegotiationAgentBuilderMemory | null>(null);
  const [negotiationState, setNegotiationState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [negotiationMessage, setNegotiationMessage] = useState("");
  const [hfmiData, setHfmiData] = useState<HfmiData | null>(null);
  const sellerOffer = parseSellerFulfillmentOffer(listing.sellerFulfillmentOffer);
  const listingParcel = parseListingParcel(listing.parcel);
  const [fulfillment, setFulfillment] = useState<PreNegotiationFulfillmentValue>(() =>
    emptyFulfillmentValue(sellerOffer, !!user),
  );

  const selectedAgent = agentValue ? resolveEffectivePreset(agentValue) : null;
  const deadline = timeRemaining(listing.sellingDeadline);

  // Public Listing Viewed (1회)
  const viewTracked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track once on mount
  useEffect(() => {
    if (viewTracked.current) return;
    viewTracked.current = true;
    track("Public Listing Viewed", {
      public_id: listing.publicId,
      category: listing.category,
      is_authenticated: !!user,
      is_owner: isOwner,
    });
  }, []);

  // Fetch HFMI fair market price (non-blocking)
  useEffect(() => {
    if (!listing.category?.includes("iphone")) return;
    const model = listing.category.toLowerCase().replace(/\s+/g, "_");
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
    fetch(`${apiBase}/hfmi/${encodeURIComponent(model)}/median`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: HfmiData | null) => {
        if (data?.median) setHfmiData(data);
      })
      .catch(() => {
        // Non-fatal: HFMI unavailable
      });
  }, [listing.category]);

  return (
    <main className="min-h-screen bg-surface">
      {/* Header: shared Nav for logged-in users, minimal header for guests */}
      {user ? (
        <Nav userEmail={user.email} userName={user.name} userAvatarUrl={user.avatarUrl} />
      ) : (
        <nav className="fixed inset-x-0 top-0 z-50 h-14 border-line border-b bg-surface/80 backdrop-blur-md">
          <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <span className="text-lg font-bold text-ink">Haggle</span>
            <a
              href="/sign-in"
              className="text-sm font-medium text-ink-secondary hover:text-ink transition-colors"
            >
              Sign in
            </a>
          </div>
        </nav>
      )}

      <div className={`mx-auto max-w-7xl px-4 pb-8 ${user ? "pt-8 md:pt-24" : "pt-[88px]"}`}>
        {/* ── Back link (if originated from a known surface) ── */}
        {from && (
          <BackLink href={ORIGIN_HREF[from]} className="mb-6">
            {ORIGIN_LABEL[from]}
          </BackLink>
        )}

        {/* ── Item Overview (top, prominent) ──────────────── */}
        <section className="mb-10">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Item for Sale
          </p>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface-raised">
            <div className="grid gap-0 md:grid-cols-2">
              {/* Photo */}
              <div className="relative aspect-square bg-surface-sunken md:aspect-auto md:min-h-[400px] md:max-h-[520px]">
                {listing.photoUrl ? (
                  // biome-ignore lint/performance/noImgElement: remote listing photo
                  <img
                    src={listing.photoUrl}
                    alt={listing.title ?? ""}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full min-h-[300px] items-center justify-center text-ink-muted">
                    <svg
                      width="64"
                      height="64"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex flex-col justify-between p-6 md:p-8">
                <div>
                  <h1 className="text-2xl font-bold text-ink md:text-3xl">{listing.title}</h1>

                  <Price
                    amount={Number(listing.targetPrice ?? 0)}
                    size="xl"
                    tone="accent"
                    className="mt-3 block md:text-4xl"
                  />

                  {hfmiData && (
                    <p className="mt-1 text-sm text-ink-secondary">
                      Fair Market Price:{" "}
                      <span className="font-medium text-ink-secondary">
                        {formatPriceStr(hfmiData.median.toString())}
                      </span>{" "}
                      <span className="text-xs text-ink-muted">
                        (HFMI, {hfmiData.sample_count} obs)
                      </span>
                    </p>
                  )}

                  {/* Tags */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {listing.condition && <Badge tone="neutral">{listing.condition}</Badge>}
                    {listing.category && <Badge tone="neutral">{listing.category}</Badge>}
                    {listing.tags?.map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {listingParcel && (
                    <p className="mt-3 text-sm text-ink-secondary">
                      Parcel: {formatListingParcel(listingParcel)}
                    </p>
                  )}

                  {/* Description */}
                  {listing.description && (
                    <p className="mt-5 text-sm leading-relaxed text-ink-secondary">
                      {listing.description}
                    </p>
                  )}
                </div>

                {/* Seller Agent + Deadline */}
                <div className="mt-6 space-y-3">
                  {deadline && (
                    <div className="flex items-center gap-2 text-sm text-warning">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {deadline}
                    </div>
                  )}
                  <Alert tone="success" title="Seller's AI Agent is ready">
                    <p className="text-ink-muted text-xs">
                      {getSellerAgentName(listing.sellerAgentPreset)} is handling negotiations for
                      this seller.
                    </p>
                  </Alert>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Choose Your Buyer Agent ─────────────────────── */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Choose Your Buyer Agent
          </p>
          <p className="mb-6 text-sm text-ink-secondary">
            Pick an AI negotiator to represent you. It will negotiate with the seller&apos;s agent
            to get you the best price.
          </p>

          <div className="grid gap-6">
            {/* biome-ignore lint/a11y/useValidAriaRole: "role" is an AgentBuilder prop (buyer/seller), not an ARIA role */}
            <AgentBuilder
              role="buyer"
              embedded
              value={agentValue}
              onChange={setAgentValue}
              chatSlot={
                // biome-ignore lint/a11y/useValidAriaRole: "role" is a NegotiationAgentBuilderChat prop (buyer/seller), not an ARIA role
                <NegotiationAgentBuilderChat
                  agent={selectedAgent}
                  listingPublicId={listing.publicId}
                  listingTitle={listing.title}
                  listingCategory={listing.category}
                  listingPrice={listing.targetPrice}
                  listingCondition={listing.condition}
                  listingTags={listing.tags ?? undefined}
                  listingDescription={listing.description}
                  sellerRequiredCriteria={listing.sellerRequiredCriteria ?? undefined}
                  role="buyer"
                  onNegotiationAgentBuilderMemoryUpdate={setNegotiationAgentBuilderMemory}
                  onStrategyUpdate={(s) =>
                    setAgentValue((prev) => (prev ? applyChatStrategyToState(prev, s) : prev))
                  }
                />
              }
            />

            <PreNegotiationFulfillment
              signedIn={!!user}
              offer={sellerOffer}
              parcel={listingParcel}
              value={fulfillment}
              onChange={setFulfillment}
            />

            {/* CTA below the builder */}
            <div>
              <div className="mb-3 flex items-center gap-2 text-[12px] text-ink-muted">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                No account needed. Create an account to save your agent and track negotiation
                history.
              </div>

              {isOwner ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-sunken px-4 py-3 text-[14px] font-medium text-ink-secondary">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  You own this listing
                </div>
              ) : (
                <>
                  <Button
                    fullWidth
                    loading={negotiationState === "loading"}
                    disabled={!selectedAgent || !canStartWithFulfillment(fulfillment)}
                    aria-busy={negotiationState === "loading"}
                    onClick={async () => {
                      if (!selectedAgent) return;

                      setNegotiationState("loading");
                      setNegotiationMessage("Briefing your agent…");

                      try {
                        // Real session path only — never intents/trigger-match.
                        // Resume reuses an open session; otherwise start applies strategy once.
                        const res = await startOrResumeListingNegotiation({
                          userId: user?.id,
                          listingId: listing.id,
                          startBody: {
                            listing_public_id: listing.publicId,
                            negotiation_agent_preset_id: selectedAgent.id,
                            agent_weights: { ...selectedAgent.weights },
                            agent_overrides:
                              agentValue && isBuilderCustomized(agentValue)
                                ? {
                                    weights: { ...selectedAgent.weights },
                                    ...engineParamsFromPreset(selectedAgent),
                                  }
                                : undefined,
                            // Prefer memory captured in this session's builder
                            // chat; otherwise fall back to the durable memory
                            // saved on the reused agent so a picked "My Agent"
                            // still carries its deal-breakers/must-haves/urgency.
                            negotiation_agent_builder_memory:
                              negotiationAgentBuilderMemory ??
                              (agentValue?.agent.builderChatMemory as
                                | NegotiationAgentBuilderMemory
                                | undefined) ??
                              undefined,
                            fulfillment: {
                              methods: fulfillment.methods,
                              preferred: fulfillment.preferred,
                              ...(fulfillment.methods.includes("carrier") &&
                              isCompleteShippingAddress(fulfillment.address)
                                ? { buyer_address: toApiAddress(fulfillment.address) }
                                : {}),
                              save_address:
                                !!user &&
                                fulfillment.methods.includes("carrier") &&
                                fulfillment.saveAddress,
                              constraints: {
                                travel_radius_miles: fulfillment.travel_radius_miles,
                                max_pickup_weight_lb: fulfillment.max_pickup_weight_lb,
                              },
                              ...(fulfillment.methods.includes("carrier")
                                ? { carrier_priority: fulfillment.carrier_priority }
                                : {}),
                              ...(sellerOffer ? { seller_offer: sellerOffer } : {}),
                            },
                          },
                        });
                        // Stash guest buyer id + PoP for the post-signup claim step.
                        // Logged-in callers never receive guest_buyer_id back,
                        // so the localStorage write is a no-op for them.
                        if (res.guest_buyer_id && res.guest_claim_pop) {
                          stashGuestBuyerClaim(res.guest_buyer_id, res.guest_claim_pop);
                        }
                        track("Negotiation Started", {
                          public_id: listing.publicId,
                          agent_preset: selectedAgent.id,
                          has_negotiation_agent_builder_memory: !!negotiationAgentBuilderMemory,
                          resumed: !!res.resumed,
                        });

                        setNegotiationMessage(
                          res.resumed
                            ? "Resuming your negotiation..."
                            : "Opening the live negotiation...",
                        );
                        if (res.run_token) {
                          storeNegotiationRunToken(res.session_id, res.run_token);
                        }
                        window.location.href = `/buy/negotiations/${res.session_id}`;
                      } catch (err) {
                        const apiErr = err instanceof ApiError ? err : null;
                        setNegotiationState("error");
                        setNegotiationMessage(
                          apiErr?.message ??
                            apiErr?.code ??
                            "Couldn't reach Haggle. Check your connection and try again.",
                        );
                      }
                    }}
                  >
                    {negotiationState === "loading" ? (
                      negotiationMessage || "Briefing your agent…"
                    ) : (
                      <>
                        Start Negotiation
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                  {selectedAgent && !canStartWithFulfillment(fulfillment) && (
                    <p className="mt-3 text-center text-ink-muted text-sm">
                      Add a delivery address to start.
                    </p>
                  )}
                  {negotiationState === "error" && (
                    <div className="mt-3 text-center text-error text-sm">{negotiationMessage}</div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
