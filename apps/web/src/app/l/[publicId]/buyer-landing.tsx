"use client";

import { useState, useEffect, useRef } from "react";
import {
  BUYER_AGENT_PRESETS,
  BUYER_STAT_META,
  BUYER_RADAR_LABELS,
  type BuyerAgentPreset,
  type BuyerAgentStats,
  DEFAULT_BUYER_STATS,
} from "@/lib/buyer-agents";
import { Nav } from "@/components/nav";
import { useAmplitude } from "@/providers/amplitude-provider";
import { createBuyerIntent, triggerMatch, getBuyerSessions } from "./negotiation-api";

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

/* ─── Radar Chart (SVG) ───────────────────────────────────── */

function RadarChart({ stats }: { stats: BuyerAgentStats }) {
  const SIZE = 250;
  const CENTER = SIZE / 2;
  const RADIUS = 85;
  const LABEL_OFFSET = 24;
  const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];
  const STAT_KEYS: (keyof BuyerAgentStats)[] = ["priceAggression", "patienceLevel", "riskTolerance", "speedBias", "detailFocus"];

  const [display, setDisplay] = useState<number[]>(STAT_KEYS.map((k) => stats[k]));
  const currentRef = useRef<number[]>(STAT_KEYS.map((k) => stats[k]));
  const animRef = useRef<number>(0);

  useEffect(() => {
    const target = STAT_KEYS.map((k) => stats[k]);
    const from = [...currentRef.current];
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / 600, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const next = from.map((f, i) => f + (target[i] - f) * ease);
      currentRef.current = next;
      setDisplay(next);
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [stats]);

  function vertex(i: number, r: number): [number, number] {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
  }

  function polygonPoints(values: number[]): string {
    return values.map((v, i) => { const [x, y] = vertex(i, (v / 100) * RADIUS); return `${x},${y}`; }).join(" ");
  }

  function gridPolygon(level: number): string {
    return Array.from({ length: 5 }, (_, i) => { const [x, y] = vertex(i, level * RADIUS); return `${x},${y}`; }).join(" ");
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[240px]">
      {GRID_LEVELS.map((level) => (
        <polygon key={level} points={gridPolygon(level)} fill="none" stroke="rgba(148,163,184,0.3)" strokeWidth="1" />
      ))}
      {Array.from({ length: 5 }, (_, i) => {
        const [x, y] = vertex(i, RADIUS);
        return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="rgba(148,163,184,0.2)" strokeWidth="1" />;
      })}
      <polygon points={polygonPoints(display)} fill="rgba(6,182,212,0.12)" stroke="rgba(6,182,212,0.7)" strokeWidth="2" strokeLinejoin="round" />
      {display.map((v, i) => { const [x, y] = vertex(i, (v / 100) * RADIUS); return <circle key={i} cx={x} cy={y} r="3.5" fill="#06b6d4" />; })}
      {BUYER_RADAR_LABELS.map((label, i) => {
        const [x, y] = vertex(i, RADIUS + LABEL_OFFSET);
        return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="11" style={{ fontFamily: "inherit" }}>{label}</text>;
      })}
    </svg>
  );
}

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
  const [selectedAgent, setSelectedAgent] = useState<BuyerAgentPreset | null>(
    null,
  );
  const [negotiationState, setNegotiationState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [negotiationMessage, setNegotiationMessage] = useState("");
  const [hfmiData, setHfmiData] = useState<HfmiData | null>(null);

  const currentStats: BuyerAgentStats = selectedAgent?.stats ?? DEFAULT_BUYER_STATS;
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
              <div className="relative aspect-square bg-black/30 md:aspect-auto md:min-h-[400px]">
                {listing.photoUrl ? (
                  <img
                    src={listing.photoUrl}
                    alt={listing.title ?? ""}
                    className="h-full w-full object-cover"
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

          <div className="grid gap-6 md:gap-7 md:grid-cols-[1fr_300px]">
            {/* Left: Agent cards (2x2 on desktop, stacked on mobile) */}
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {BUYER_AGENT_PRESETS.map((agent) => {
                  const isSelected = selectedAgent?.id === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgent(agent)}
                      className="flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all"
                      style={{
                        background: "#111827",
                        borderColor: isSelected ? "#06b6d4" : "#1e293b",
                        boxShadow: isSelected ? "0 0 0 1px #06b6d4, 0 0 20px rgba(6,182,212,0.08)" : "none",
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#334155"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#1e293b"; }}
                    >
                      <div className="flex items-start gap-[10px] mb-[10px] h-[52px]">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${agent.accentColor}22`, color: agent.accentColor }}>
                          {agent.id === "price-hunter" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                            </svg>
                          )}
                          {agent.id === "smart-trader" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2a7 7 0 0 1 7 7c0 2.6-1.4 4.8-3.5 6H8.5C6.4 13.8 5 11.6 5 9a7 7 0 0 1 7-7Z" /><path d="M9.5 15v2a2.5 2.5 0 0 0 5 0v-2" /><path d="M12 2v-0" />
                            </svg>
                          )}
                          {agent.id === "fast-closer" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                            </svg>
                          )}
                          {agent.id === "spec-analyst" && (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                            </svg>
                          )}
                        </span>
                        <div>
                          <p className="text-[14px] font-semibold" style={{ color: "#f1f5f9", lineHeight: 1.2 }}>{agent.name}</p>
                          <p className="text-[12px] font-medium mt-[2px]" style={{ color: "#06b6d4", lineHeight: 1.3 }}>{agent.tagline}</p>
                        </div>
                      </div>
                      <p className="text-[12px] leading-[1.5]" style={{ color: "#94a3b8" }}>{agent.description}</p>
                    </button>
                  );
                })}
              </div>

              {/* Chat Placeholder — matches widget */}
              <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: "#1e293b", background: "#0f172a" }}>
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #1e293b" }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="10" x="3" y="11" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
                  </svg>
                  <span className="text-[13px] font-semibold" style={{ color: "#06b6d4" }}>
                    {selectedAgent ? selectedAgent.name : "Buying Agent"}
                  </span>
                </div>
                <div className="px-4 py-4 text-[13px] leading-relaxed" style={{ color: "#f1f5f9" }}>
                  <p>
                    Hi! I&apos;m your buying agent. I&apos;ll negotiate the best price on your behalf — so you don&apos;t have to. Let me know how you&apos;d like me to approach this.
                  </p>
                  <p className="mt-3 italic text-[12px]" style={{ color: "#64748b" }}>
                    You can customize my approach below, or just pick a style and I&apos;ll run with it.
                  </p>
                </div>
                <div className="px-4 py-3 text-center text-[12px]" style={{ borderTop: "1px solid #1e293b", color: "#94a3b8", background: "#0d1321" }}>
                  Chat with your AI agent to fine-tune its negotiation strategy. Coming soon.
                </div>
              </div>
            </div>

            {/* Right: Agent Profile (below cards on mobile, sticky side panel on desktop) */}
            <div>
              <div className="md:sticky md:top-6">
                {/* Profile Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[12px] font-bold tracking-[0.06em]" style={{ color: "#f1f5f9" }}>AGENT PROFILE</h3>
                  <span
                    className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium"
                    style={{
                      border: `1px solid ${selectedAgent ? "#06b6d4" : "#1e293b"}`,
                      color: selectedAgent ? "#06b6d4" : "#94a3b8",
                    }}
                  >
                    {!selectedAgent ? "No Agent" : "Default"}
                  </span>
                </div>

                {/* Selected Agent Display */}
                {selectedAgent ? (
                  <div className="flex items-center gap-3 rounded-xl mb-5" style={{ padding: "14px 16px", background: "#111827", border: "1px solid #1e293b" }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${selectedAgent.accentColor}22`, color: selectedAgent.accentColor }}>
                      {selectedAgent.id === "price-hunter" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                        </svg>
                      )}
                      {selectedAgent.id === "smart-trader" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a7 7 0 0 1 7 7c0 2.6-1.4 4.8-3.5 6H8.5C6.4 13.8 5 11.6 5 9a7 7 0 0 1 7-7Z" /><path d="M9.5 15v2a2.5 2.5 0 0 0 5 0v-2" /><path d="M12 2v-0" />
                        </svg>
                      )}
                      {selectedAgent.id === "fast-closer" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      )}
                      {selectedAgent.id === "spec-analyst" && (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                        </svg>
                      )}
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: "#f1f5f9" }}>{selectedAgent.name}</p>
                      <p className="text-[11px] mt-[1px]" style={{ color: "#94a3b8" }}>{selectedAgent.tagline}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl mb-5" style={{ padding: "28px 16px", background: "#111827", border: "1px dashed #1e293b", color: "#94a3b8", fontSize: "13px" }}>
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                      <rect width="18" height="10" x="3" y="11" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
                    </svg>
                    <p>Select an agent above</p>
                  </div>
                )}

                {/* Stat Bars */}
                <div className="flex flex-col gap-[14px] mb-6">
                  {BUYER_STAT_META.map((stat) => {
                    const value = currentStats[stat.key];
                    return (
                      <div key={stat.key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12px] font-medium" style={{ color: "#cbd5e1" }}>{stat.label}</span>
                          <span className="text-[12px] font-semibold" style={{ color: "#f1f5f9" }}>{value}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-sm" style={{ background: "#0d1321" }}>
                          <div className="h-full rounded-sm" style={{ width: `${value}%`, background: stat.gradient, transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Radar Chart */}
                <div className="rounded-xl mb-6" style={{ background: "#111827", border: "1px solid #1e293b", padding: "20px 16px" }}>
                  <p className="text-center text-[11px] font-bold tracking-[0.06em] mb-2" style={{ color: "#cbd5e1" }}>STRATEGY MATRIX</p>
                  <RadarChart stats={currentStats} />
                </div>

                {/* CTA — inside right panel like seller wizard */}
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
                    onClick={async () => {
                      if (!selectedAgent) return;
                      setNegotiationState("loading");
                      setNegotiationMessage("");

                      try {
                        if (!user) {
                          sessionStorage.setItem("pendingIntent", JSON.stringify({
                            listingId: listing.id,
                            publicId: listing.publicId,
                            category: listing.category,
                            agentPreset: selectedAgent.id,
                          }));
                          window.location.href = `/claim?redirect=/l/${listing.publicId}`;
                          return;
                        }

                        await createBuyerIntent({
                          userId: user.id,
                          category: listing.category || "general",
                          keywords: listing.tags || [],
                          listingId: listing.id,
                          agentPreset: selectedAgent.id,
                          targetPrice: listing.targetPrice ? parseFloat(listing.targetPrice) : undefined,
                        });

                        setNegotiationState("success");
                        setNegotiationMessage("Your negotiation agent is set up! Matching you with the seller...");

                        try {
                          await triggerMatch(listing.category || "general", listing.id);
                          setNegotiationMessage("Match found! Redirecting to negotiation...");
                          // Try to find the newly created session and redirect
                          try {
                            const sessions = await getBuyerSessions(user.id, listing.id);
                            if (sessions.length > 0) {
                              window.location.href = `/buy/negotiations/${sessions[0].id}`;
                              return;
                            }
                          } catch {
                            // Fall through to dashboard redirect
                          }
                          setNegotiationMessage("Negotiation started! Check your dashboard.");
                          setTimeout(() => {
                            window.location.href = "/buy/dashboard";
                          }, 1500);
                        } catch {
                          setNegotiationMessage("Intent registered! Check your dashboard for updates.");
                          setTimeout(() => {
                            window.location.href = "/buy/dashboard";
                          }, 1500);
                        }
                      } catch (err) {
                        setNegotiationState("error");
                        setNegotiationMessage("Something went wrong. Please try again.");
                        console.warn("Failed to create intent:", err);
                      }
                    }}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {negotiationState === "loading" ? "Setting up agent..." : "Start Negotiation"}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                  {negotiationState === "loading" && (
                    <div className="text-center text-sm text-slate-400 mt-3">Setting up your agent...</div>
                  )}
                  {negotiationState === "success" && (
                    <div className="text-center text-sm text-emerald-400 mt-3">{negotiationMessage}</div>
                  )}
                  {negotiationState === "error" && (
                    <div className="text-center text-sm text-red-400 mt-3">{negotiationMessage}</div>
                  )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
