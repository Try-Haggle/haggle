"use client";

import { useState, useEffect, useRef } from "react";
import { StrategyChat, loadSelectedAgentId } from "./strategy-chat";
import {
  AgentBuilder,
  type AgentBuilderValue,
} from "@/app/(app)/sell/agents/_components/AgentBuilder";
import { Nav } from "@/components/nav";
import { useAmplitude } from "@/providers/amplitude-provider";

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
}

/* ─── Helpers ─────────────────────────────────────────────── */

function formatPrice(price: string | null): string {
  if (!price) return "$0";
  const n = parseFloat(price);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function getSellerAgentName(presetId: string | null): string {
  const map: Record<string, string> = {
    gatekeeper: "The Gatekeeper",
    diplomat: "The Diplomat",
    storyteller: "The Storyteller",
    dealmaker: "The Dealmaker",
  };
  return presetId ? map[presetId] ?? "Custom Agent" : "Default Agent";
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

export function BuyerLanding({ listing, user, isOwner = false, from = null }: { listing: Listing; user: UserInfo | null; isOwner?: boolean; from?: Origin | null }) {
  const { track } = useAmplitude();
  const [agentValue, setAgentValue] = useState<AgentBuilderValue | null>(null);
  const [negotiationState, setNegotiationState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [negotiationMessage, setNegotiationMessage] = useState("");
  const [hfmiData, setHfmiData] = useState<HfmiData | null>(null);

  const selectedAgent = agentValue?.effectivePreset ?? null;
  const selectedCopy = selectedAgent?.copy.buyer ?? null;
  const deadline = timeRemaining(listing.sellingDeadline);

  // Public Listing Viewed (1회)
  const viewTracked = useRef(false);
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
    if (!listing.category || !listing.category.includes("iphone")) return;
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
    <main className="min-h-screen bg-bg-primary">
      {/* Header: shared Nav for logged-in users, minimal header for guests */}
      {user ? (
        <Nav userEmail={user.email} userName={user.name} userAvatarUrl={user.avatarUrl} />
      ) : (
        <nav className="fixed top-0 inset-x-0 z-50 h-14 border-b border-slate-800 bg-bg-primary/80 backdrop-blur-md">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
            <span className="text-lg font-bold text-white">Haggle</span>
            <a
              href="/sign-in"
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Sign in
            </a>
          </div>
        </nav>
      )}

      <div className={`mx-auto max-w-6xl px-4 pb-8 ${user ? "pt-8 md:pt-24" : "pt-[88px]"}`}>
        {/* ── Back link (if originated from a known surface) ── */}
        {from && (
          <a
            href={ORIGIN_HREF[from]}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            {ORIGIN_LABEL[from]}
          </a>
        )}

        {/* ── Item Overview (top, prominent) ──────────────── */}
        <section className="mb-10">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Item for Sale
          </p>
          <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-card">
            <div className="grid gap-0 md:grid-cols-2">
              {/* Photo */}
              <div className="relative aspect-square bg-black/30 md:aspect-auto md:min-h-[400px] md:max-h-[520px]">
                {listing.photoUrl ? (
                  <img
                    src={listing.photoUrl}
                    alt={listing.title ?? ""}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full min-h-[300px] items-center justify-center text-slate-600">
                    <svg
                      width="64"
                      height="64"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1"
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
                  <h1 className="text-2xl font-bold text-white md:text-3xl">
                    {listing.title}
                  </h1>

                  <p className="mt-3 text-3xl font-bold text-emerald-400 md:text-4xl">
                    {formatPrice(listing.targetPrice)}
                  </p>

                  {hfmiData && (
                    <p className="mt-1 text-sm text-slate-400">
                      Fair Market Price:{" "}
                      <span className="font-medium text-slate-300">
                        {formatPrice(hfmiData.median.toString())}
                      </span>{" "}
                      <span className="text-xs text-slate-500">(HFMI, {hfmiData.sample_count} obs)</span>
                    </p>
                  )}

                  {/* Tags */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {listing.condition && (
                      <span className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-xs font-medium text-slate-300">
                        {listing.condition}
                      </span>
                    )}
                    {listing.category && (
                      <span className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-xs font-medium text-slate-300">
                        {listing.category}
                      </span>
                    )}
                    {listing.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-xs font-medium text-slate-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Description */}
                  {listing.description && (
                    <p className="mt-5 text-sm leading-relaxed text-slate-400">
                      {listing.description}
                    </p>
                  )}
                </div>

                {/* Seller Agent + Deadline */}
                <div className="mt-6 space-y-3">
                  {deadline && (
                    <div className="flex items-center gap-2 text-sm text-amber-400">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {deadline}
                    </div>
                  )}
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/20 text-xs">
                        🤖
                      </span>
                      <div>
                        <p className="text-sm font-medium text-emerald-400">
                          Seller&apos;s AI Agent is ready
                        </p>
                        <p className="text-xs text-slate-500">
                          {getSellerAgentName(listing.sellerAgentPreset)} is
                          handling negotiations for this seller.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Choose Your Buyer Agent ─────────────────────── */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Choose Your Buyer Agent
          </p>
          <p className="mb-6 text-sm text-slate-400">
            Pick an AI negotiator to represent you. It will negotiate with the
            seller&apos;s agent to get you the best price.
          </p>

          <div className="grid gap-6">
            <AgentBuilder
              role="buyer"
              embedded
              value={agentValue}
              onChange={setAgentValue}
              chatSlot={
                <StrategyChat
                  agent={selectedAgent}
                  listingPublicId={listing.publicId}
                  listingTitle={listing.title}
                  listingCategory={listing.category}
                  listingPrice={listing.targetPrice}
                />
              }
            />

            {/* CTA below the builder */}
            <div>
              <div className="flex items-center gap-2 text-[12px] mb-3" style={{ color: "#64748b" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                No account needed. Create an account to save your agent and track negotiation history.
              </div>

              {isOwner ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-[14px] font-medium text-slate-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  You own this listing
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!selectedAgent || negotiationState === "loading"}
                    onClick={() => {
                      if (!selectedAgent) return;

                      setNegotiationState("loading");
                      setNegotiationMessage("Briefing your agent…");
                      // Frontend-only entry: navigate straight into the playback view.
                      // Session id encodes listing + agent so the mock picks a stable scenario.
                      const sessionId = `${listing.publicId}-${selectedAgent.id}`;
                      setTimeout(() => {
                        window.location.href = `/buy/negotiations/${sessionId}`;
                      }, 600);
                    }}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold text-white transition-colors ${negotiationState === "loading"
                        ? "cursor-wait bg-emerald-500 opacity-90"
                        : !selectedAgent
                          ? "cursor-not-allowed bg-emerald-500 opacity-40"
                          : "cursor-pointer bg-emerald-500 hover:bg-emerald-600"
                      }`}
                    aria-busy={negotiationState === "loading"}
                  >
                    {negotiationState === "loading" ? (
                      <>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          className="animate-spin"
                          aria-hidden="true"
                        >
                          <path d="M21 12a9 9 0 1 1-6.22-8.56" opacity="0.9" />
                        </svg>
                        Briefing your agent…
                      </>
                    ) : (
                      <>
                        Start Negotiation
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                  {negotiationState === "error" && (
                    <div className="text-center text-sm text-red-400 mt-3">{negotiationMessage}</div>
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
