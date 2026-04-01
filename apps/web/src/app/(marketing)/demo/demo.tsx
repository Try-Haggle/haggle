"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import {
  computeUtility,
  makeDecision,
  computeCounterOffer,
  type UtilityResult,
  type UtilityWeights,
} from "../../playground-engine";
import { WaitlistForm } from "@/components/waitlist-form";

/* ── Types ───────────────────────────────────── */

type Perspective = "buyer" | "seller";

interface ItemPreset {
  id: string;
  name: string;
  emoji: string;
  listPrice: number;
  buyerTarget: number;
  buyerLimit: number;
  sellerTarget: number;
  sellerLimit: number;
}

interface Round {
  number: number;
  actor: "seller" | "buyer";
  action: string;
  price: number;
  note: string;
  utility?: UtilityResult;
  decision?: string;
  noConcess?: number;
}

type SimState = "idle" | "running" | "done";

/** Full engine config for one side */
interface AgentConfig {
  // Faratin concession
  beta: number;
  // Decision thresholds
  aspiration: number;
  threshold: number;
  // Utility weights (auto-normalized)
  priceWeight: number;
  timeWeight: number;
  riskWeight: number;
  relWeight: number;
  // Price targets (offsets from item price, in %)
  targetOffset: number;  // % offset from list price for target
  limitOffset: number;   // % offset from list price for walk-away
  // Time
  deadline: number;      // hours
  alpha: number;         // decay exponent
  vtFloor: number;       // minimum time utility
  // Risk
  trustScore: number;    // r_score (counterparty reputation)
  infoCompleteness: number;
  wRep: number;          // reputation weight in V_r
  wInfo: number;         // info weight in V_r
  // Relationship
  pastSuccesses: number;
  pastDisputeLosses: number;
  successThreshold: number;
  vsBase: number;
}

/* ── Presets ─────────────────────────────────── */

const ITEMS: ItemPreset[] = [
  { id: "macbook", name: 'MacBook Pro 14"', emoji: "\uD83D\uDCBB", listPrice: 1800, buyerTarget: 1480, buyerLimit: 1720, sellerTarget: 1780, sellerLimit: 1450 },
  { id: "iphone", name: "iPhone 15 Pro", emoji: "\uD83D\uDCF1", listPrice: 900, buyerTarget: 740, buyerLimit: 860, sellerTarget: 880, sellerLimit: 720 },
  { id: "ps5", name: "PS5 Digital", emoji: "\uD83C\uDFAE", listPrice: 350, buyerTarget: 280, buyerLimit: 335, sellerTarget: 345, sellerLimit: 270 },
];

const DEFAULT_BUYER: AgentConfig = {
  beta: 0.8, aspiration: 0.70, threshold: 0.30,
  priceWeight: 0.50, timeWeight: 0.20, riskWeight: 0.15, relWeight: 0.15,
  targetOffset: -18, limitOffset: -4,
  deadline: 8, alpha: 2.0, vtFloor: 0.05,
  trustScore: 0.75, infoCompleteness: 0.80, wRep: 0.60, wInfo: 0.40,
  pastSuccesses: 1, pastDisputeLosses: 0, successThreshold: 5, vsBase: 0.40,
};

const DEFAULT_SELLER: AgentConfig = {
  beta: 0.7, aspiration: 0.72, threshold: 0.28,
  priceWeight: 0.50, timeWeight: 0.20, riskWeight: 0.15, relWeight: 0.15,
  targetOffset: -1, limitOffset: -19,
  deadline: 8, alpha: 2.0, vtFloor: 0.05,
  trustScore: 0.75, infoCompleteness: 0.80, wRep: 0.60, wInfo: 0.40,
  pastSuccesses: 1, pastDisputeLosses: 0, successThreshold: 5, vsBase: 0.40,
};

const STRATEGY_PRESETS: Record<string, { label: string; desc: string; buyer: Partial<AgentConfig>; seller: Partial<AgentConfig> }> = {
  balanced: {
    label: "Balanced", desc: "Fair negotiation — both sides compromise evenly",
    buyer: { beta: 0.8, aspiration: 0.70, priceWeight: 0.50, timeWeight: 0.20, riskWeight: 0.15, relWeight: 0.15 },
    seller: { beta: 0.7, aspiration: 0.72, priceWeight: 0.50, timeWeight: 0.20, riskWeight: 0.15, relWeight: 0.15 },
  },
  aggressive_buyer: {
    label: "Aggressive Buyer", desc: "Buyer pushes hard, seller is flexible",
    buyer: { beta: 0.5, aspiration: 0.80, priceWeight: 0.65, timeWeight: 0.10, riskWeight: 0.15, relWeight: 0.10, trustScore: 0.5 },
    seller: { beta: 1.3, aspiration: 0.55, priceWeight: 0.40, timeWeight: 0.30, riskWeight: 0.15, relWeight: 0.15, trustScore: 0.8 },
  },
  aggressive_seller: {
    label: "Firm Seller", desc: "Seller barely budges, buyer needs to come up",
    buyer: { beta: 1.2, aspiration: 0.55, priceWeight: 0.40, timeWeight: 0.30, riskWeight: 0.15, relWeight: 0.15 },
    seller: { beta: 0.4, aspiration: 0.82, priceWeight: 0.65, timeWeight: 0.10, riskWeight: 0.15, relWeight: 0.10 },
  },
  rush: {
    label: "Quick Deal", desc: "Both want to close fast — fewer rounds",
    buyer: { beta: 1.5, aspiration: 0.50, priceWeight: 0.30, timeWeight: 0.40, riskWeight: 0.15, relWeight: 0.15, deadline: 4 },
    seller: { beta: 1.5, aspiration: 0.50, priceWeight: 0.30, timeWeight: 0.40, riskWeight: 0.15, relWeight: 0.15, deadline: 4 },
  },
  low_trust: {
    label: "Low Trust", desc: "Both parties are cautious — risk dominates",
    buyer: { trustScore: 0.3, infoCompleteness: 0.4, priceWeight: 0.30, timeWeight: 0.15, riskWeight: 0.40, relWeight: 0.15 },
    seller: { trustScore: 0.3, infoCompleteness: 0.4, priceWeight: 0.30, timeWeight: 0.15, riskWeight: 0.40, relWeight: 0.15 },
  },
  veteran: {
    label: "Veteran Traders", desc: "High trust, lots of past deals — smooth negotiation",
    buyer: { trustScore: 0.95, pastSuccesses: 8, vsBase: 0.7, aspiration: 0.60, beta: 1.1, priceWeight: 0.40, timeWeight: 0.15, riskWeight: 0.15, relWeight: 0.30 },
    seller: { trustScore: 0.95, pastSuccesses: 8, vsBase: 0.7, aspiration: 0.60, beta: 1.0, priceWeight: 0.40, timeWeight: 0.15, riskWeight: 0.15, relWeight: 0.30 },
  },
};

function toWeights(cfg: AgentConfig): UtilityWeights {
  return { w_p: cfg.priceWeight, w_t: cfg.timeWeight, w_r: cfg.riskWeight, w_s: cfg.relWeight };
}

/** Adjust weights so they sum to 1.0. When `changed` is moved to `newVal`,
 *  the remaining three shrink/grow proportionally. Minimum per weight: 0.05. */
function adjustWeights(
  cfg: AgentConfig,
  changed: "priceWeight" | "timeWeight" | "riskWeight" | "relWeight",
  newVal: number,
): Pick<AgentConfig, "priceWeight" | "timeWeight" | "riskWeight" | "relWeight"> {
  const keys: Array<"priceWeight" | "timeWeight" | "riskWeight" | "relWeight"> = ["priceWeight", "timeWeight", "riskWeight", "relWeight"];
  const others = keys.filter(k => k !== changed);
  const MIN = 0.05;

  // Clamp new value: max = 1 - (others * MIN)
  const maxVal = 1 - others.length * MIN;
  const clamped = Math.min(Math.max(newVal, MIN), maxVal);
  const remaining = 1 - clamped;

  // Distribute remaining proportionally among others
  const othersSum = others.reduce((s, k) => s + cfg[k], 0);
  const result = { ...cfg };
  result[changed] = round2(clamped);

  if (othersSum > 0) {
    others.forEach(k => {
      result[k] = round2(Math.max(MIN, (cfg[k] / othersSum) * remaining));
    });
  } else {
    others.forEach(k => { result[k] = round2(remaining / others.length); });
  }

  // Fix rounding drift: adjust last other to make sum exactly 1.0
  const sum = result.priceWeight + result.timeWeight + result.riskWeight + result.relWeight;
  const drift = round2(1 - sum);
  if (Math.abs(drift) > 0.001) {
    const last = others[others.length - 1];
    result[last] = round2(result[last] + drift);
  }

  return { priceWeight: result.priceWeight, timeWeight: result.timeWeight, riskWeight: result.riskWeight, relWeight: result.relWeight };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function computePriceTargets(item: ItemPreset, cfg: AgentConfig, role: "buyer" | "seller") {
  if (role === "buyer") {
    return {
      target: Math.round(item.listPrice * (1 + cfg.targetOffset / 100)),
      limit: Math.round(item.listPrice * (1 + cfg.limitOffset / 100)),
    };
  }
  return {
    target: Math.round(item.listPrice * (1 + cfg.targetOffset / 100)),
    limit: Math.round(item.listPrice * (1 + cfg.limitOffset / 100)),
  };
}

/* ── UI Components ───────────────────────────── */

function Slider({ label, value, onChange, min, max, step, hint, disabled, suffix }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; hint?: string; disabled?: boolean; suffix?: string;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs font-mono text-slate-300">{value.toFixed(step < 1 ? 2 : 0)}{suffix || ""}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} disabled={disabled}
        className="w-full h-1.5 rounded-full appearance-none bg-slate-700 accent-cyan-500 disabled:opacity-40" />
      {hint && <p className="text-[10px] text-slate-600 mt-0.5">{hint}</p>}
    </div>
  );
}

function SectionHeader({ title, collapsed, onToggle }: { title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center justify-between w-full text-left py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors">
      {title}
      <span className="text-[10px]">{collapsed ? "\u25BC" : "\u25B2"}</span>
    </button>
  );
}

function UtilityBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-8 text-right">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${Math.min(value * 100, 100)}%` }} />
      </div>
      <span className="text-[10px] font-mono text-slate-400 w-8">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

/* ── Agent Config Panel ──────────────────────── */

function AgentPanel({ title, color, borderColor, bgColor, cfg, onChange, item, role, disabled }: {
  title: string; color: string; borderColor: string; bgColor: string;
  cfg: AgentConfig; onChange: (c: AgentConfig) => void;
  item: ItemPreset; role: "buyer" | "seller"; disabled: boolean;
}) {
  const [collapsedSections, setCollapsed] = useState<Record<string, boolean>>({ price: false, time: true, risk: true, rel: true });
  const toggle = (key: string) => setCollapsed(p => ({ ...p, [key]: !p[key] }));
  const set = (patch: Partial<AgentConfig>) => onChange({ ...cfg, ...patch });

  const prices = computePriceTargets(item, cfg, role);

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-4`}>
      <h3 className={`text-sm font-semibold ${color} mb-3`}>{title}</h3>

      {/* Faratin Concession */}
      <Slider label="Concession Speed (\u03B2)" value={cfg.beta} onChange={v => set({ beta: v })}
        min={0.2} max={2.5} step={0.1} hint="<1 boulware(slow) | >1 conceder(fast)" disabled={disabled} />

      {/* Decision */}
      <Slider label="Aspiration (accept threshold)" value={cfg.aspiration} onChange={v => set({ aspiration: v })}
        min={0.20} max={0.95} step={0.05} hint="Min utility to accept" disabled={disabled} />
      <Slider label="Continue threshold" value={cfg.threshold} onChange={v => set({ threshold: v })}
        min={0.05} max={0.60} step={0.05} disabled={disabled} />

      {/* Price Section */}
      <div className="border-t border-slate-700/30 mt-3 pt-2">
        <SectionHeader title={`Price (target: $${prices.target}, limit: $${prices.limit})`} collapsed={collapsedSections.price} onToggle={() => toggle("price")} />
        {!collapsedSections.price && (
          <>
            <Slider label={role === "buyer" ? "Target (% below list)" : "Target (% below list)"} value={cfg.targetOffset} onChange={v => set({ targetOffset: v })}
              min={role === "buyer" ? -40 : -10} max={role === "buyer" ? 0 : 5} step={1} suffix="%" disabled={disabled} />
            <Slider label={role === "buyer" ? "Walk-away (% below list)" : "Walk-away (% below list)"} value={cfg.limitOffset} onChange={v => set({ limitOffset: v })}
              min={role === "buyer" ? -10 : -40} max={role === "buyer" ? 10 : 0} step={1} suffix="%" disabled={disabled} />
          </>
        )}
      </div>

      {/* Weights Section — must sum to 1.0 */}
      <div className="border-t border-slate-700/30 mt-2 pt-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Utility Weights</span>
          <span className={`text-xs font-mono ${Math.abs(cfg.priceWeight + cfg.timeWeight + cfg.riskWeight + cfg.relWeight - 1) < 0.02 ? "text-emerald-500" : "text-red-400"}`}>
            sum = {(cfg.priceWeight + cfg.timeWeight + cfg.riskWeight + cfg.relWeight).toFixed(2)}
          </span>
        </div>
        <Slider label="Price (w_p)" value={cfg.priceWeight} onChange={v => set(adjustWeights(cfg, "priceWeight", v))} min={0.05} max={0.85} step={0.05} disabled={disabled} />
        <Slider label="Time (w_t)" value={cfg.timeWeight} onChange={v => set(adjustWeights(cfg, "timeWeight", v))} min={0.05} max={0.85} step={0.05} disabled={disabled} />
        <Slider label="Risk (w_r)" value={cfg.riskWeight} onChange={v => set(adjustWeights(cfg, "riskWeight", v))} min={0.05} max={0.85} step={0.05} disabled={disabled} />
        <Slider label="Relationship (w_s)" value={cfg.relWeight} onChange={v => set(adjustWeights(cfg, "relWeight", v))} min={0.05} max={0.85} step={0.05} disabled={disabled} />
      </div>

      {/* Time Section */}
      <div className="border-t border-slate-700/30 mt-2 pt-2">
        <SectionHeader title="Time Pressure" collapsed={collapsedSections.time} onToggle={() => toggle("time")} />
        {!collapsedSections.time && (
          <>
            <Slider label="Deadline (hours)" value={cfg.deadline} onChange={v => set({ deadline: v })} min={1} max={24} step={1} suffix="h" disabled={disabled} />
            <Slider label="Decay (\u03B1)" value={cfg.alpha} onChange={v => set({ alpha: v })} min={0.5} max={5.0} step={0.5} hint="Higher = steeper pressure near deadline" disabled={disabled} />
            <Slider label="Floor (V_t min)" value={cfg.vtFloor} onChange={v => set({ vtFloor: v })} min={0} max={0.3} step={0.05} hint="Minimum time utility even at deadline" disabled={disabled} />
          </>
        )}
      </div>

      {/* Risk Section */}
      <div className="border-t border-slate-700/30 mt-2 pt-2">
        <SectionHeader title="Risk / Trust" collapsed={collapsedSections.risk} onToggle={() => toggle("risk")} />
        {!collapsedSections.risk && (
          <>
            <Slider label="Counterparty trust (r_score)" value={cfg.trustScore} onChange={v => set({ trustScore: v })} min={0.0} max={1.0} step={0.05} disabled={disabled} />
            <Slider label="Info completeness" value={cfg.infoCompleteness} onChange={v => set({ infoCompleteness: v })} min={0.0} max={1.0} step={0.05} hint="How much you know about the item" disabled={disabled} />
            <Slider label="Reputation weight" value={cfg.wRep} onChange={v => set({ wRep: v, wInfo: +(1 - v).toFixed(2) })} min={0.0} max={1.0} step={0.1} hint={`Info weight: ${(1 - cfg.wRep).toFixed(1)}`} disabled={disabled} />
          </>
        )}
      </div>

      {/* Relationship Section */}
      <div className="border-t border-slate-700/30 mt-2 pt-2">
        <SectionHeader title="Relationship History" collapsed={collapsedSections.rel} onToggle={() => toggle("rel")} />
        {!collapsedSections.rel && (
          <>
            <Slider label="Past successes" value={cfg.pastSuccesses} onChange={v => set({ pastSuccesses: v })} min={0} max={20} step={1} disabled={disabled} />
            <Slider label="Past dispute losses" value={cfg.pastDisputeLosses} onChange={v => set({ pastDisputeLosses: v })} min={0} max={5} step={1} disabled={disabled} />
            <Slider label="Success milestone" value={cfg.successThreshold} onChange={v => set({ successThreshold: v })} min={1} max={20} step={1} hint="n_threshold for V_s calculation" disabled={disabled} />
            <Slider label="Base relationship (V_s base)" value={cfg.vsBase} onChange={v => set({ vsBase: v })} min={0.0} max={1.0} step={0.05} hint="Starting relationship utility" disabled={disabled} />
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────── */

export function Demo() {
  const [perspective, setPerspective] = useState<Perspective>("buyer");
  const [selectedItem, setSelectedItem] = useState<ItemPreset>(ITEMS[0]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [simState, setSimState] = useState<SimState>("idle");
  const [finalPrice, setFinalPrice] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [buyerCfg, setBuyerCfg] = useState<AgentConfig>({ ...DEFAULT_BUYER });
  const [sellerCfg, setSellerCfg] = useState<AgentConfig>({ ...DEFAULT_SELLER });
  const roundsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { roundsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [rounds]);

  const applyPreset = (presetId: string) => {
    const preset = STRATEGY_PRESETS[presetId];
    if (!preset) return;
    setBuyerCfg(p => ({ ...p, ...DEFAULT_BUYER, ...preset.buyer }));
    setSellerCfg(p => ({ ...p, ...DEFAULT_SELLER, ...preset.seller }));
    reset();
  };

  const runSimulation = useCallback(async () => {
    setRounds([]); setFinalPrice(null); setSimState("running");

    const item = selectedItem;
    const buyerPrices = computePriceTargets(item, buyerCfg, "buyer");
    const sellerPrices = computePriceTargets(item, sellerCfg, "seller");

    let sellerPrice = item.listPrice;
    let buyerPrice = Math.round(buyerPrices.target * 0.95);
    const newRounds: Round[] = [];
    const maxRounds = 12;
    let buyerNoConcess = 0;
    let sellerNoConcess = 0;
    let prevBuyerPrice = buyerPrice;
    let prevSellerPrice = sellerPrice;

    // Round 0: Seller lists
    newRounds.push({ number: 0, actor: "seller", action: "OPEN", price: item.listPrice, note: `Lists at $${item.listPrice}` });
    setRounds([...newRounds]); await delay(800);

    // Round 1: Buyer opens
    newRounds.push({ number: 1, actor: "buyer", action: "COUNTER", price: buyerPrice, note: `Opens with $${buyerPrice}` });
    setRounds([...newRounds]); await delay(700);

    for (let r = 2; r <= maxRounds; r++) {
      const isSeller = r % 2 === 0;
      const actor = isSeller ? "seller" : "buyer";
      const cfg = isSeller ? sellerCfg : buyerCfg;
      const elapsed = r * (cfg.deadline / (maxRounds + 2));
      const currentPrice = isSeller ? buyerPrice : sellerPrice;
      const noConcess = isSeller ? sellerNoConcess : buyerNoConcess;

      const weights = toWeights(cfg);
      const prices = isSeller ? sellerPrices : buyerPrices;

      const ctx = {
        weights,
        price: { p_effective: currentPrice, p_target: prices.target, p_limit: prices.limit },
        time: { t_elapsed: elapsed, t_deadline: cfg.deadline, alpha: cfg.alpha, v_t_floor: cfg.vtFloor },
        risk: { r_score: cfg.trustScore, i_completeness: cfg.infoCompleteness, w_rep: cfg.wRep, w_info: cfg.wInfo },
        relationship: { n_success: cfg.pastSuccesses, n_dispute_losses: cfg.pastDisputeLosses, n_threshold: cfg.successThreshold, v_s_base: cfg.vsBase },
      };

      const utility = computeUtility(ctx);
      const decision = makeDecision(utility, { u_threshold: cfg.threshold, u_aspiration: cfg.aspiration }, { rounds_no_concession: noConcess });

      if (decision.action === "ACCEPT" || decision.action === "NEAR_DEAL") {
        const acceptPrice = isSeller ? buyerPrice : sellerPrice;
        newRounds.push({ number: r, actor, action: "ACCEPT", price: acceptPrice, note: `Accepts $${acceptPrice}`, utility, decision: decision.action, noConcess });
        setRounds([...newRounds]); setFinalPrice(acceptPrice); setSimState("done"); return;
      }

      if (decision.action === "REJECT" || decision.action === "ESCALATE") {
        newRounds.push({ number: r, actor, action: decision.action, price: currentPrice, note: decision.action === "REJECT" ? "Walks away" : "Requests escalation", utility, decision: decision.action, noConcess });
        setRounds([...newRounds]); setFinalPrice(null); setSimState("done"); return;
      }

      // Counter offer
      const counter = computeCounterOffer({
        p_start: prices.target, p_limit: prices.limit,
        t: elapsed, T: cfg.deadline, beta: cfg.beta,
      });
      const roundedCounter = Math.round(counter);

      if (isSeller) {
        // Track concession
        if (roundedCounter >= prevSellerPrice) { sellerNoConcess++; } else { sellerNoConcess = 0; }
        prevSellerPrice = roundedCounter;
        sellerPrice = roundedCounter;
        newRounds.push({ number: r, actor: "seller", action: "COUNTER", price: roundedCounter, note: `Counters $${roundedCounter}`, utility, decision: decision.action, noConcess });
      } else {
        if (roundedCounter <= prevBuyerPrice) { buyerNoConcess++; } else { buyerNoConcess = 0; }
        prevBuyerPrice = roundedCounter;
        buyerPrice = roundedCounter;
        newRounds.push({ number: r, actor: "buyer", action: "COUNTER", price: roundedCounter, note: `Offers $${roundedCounter}`, utility, decision: decision.action, noConcess });
      }
      setRounds([...newRounds]);
      await delay(450 + Math.random() * 350);
    }

    // Fallback
    const mid = Math.round((sellerPrice + buyerPrice) / 2);
    newRounds.push({ number: newRounds.length, actor: "buyer", action: "ACCEPT", price: mid, note: `Both agree at $${mid}` });
    setRounds([...newRounds]); setFinalPrice(mid); setSimState("done");
  }, [selectedItem, buyerCfg, sellerCfg]);

  const reset = () => { setRounds([]); setFinalPrice(null); setSimState("idle"); };
  const isRunning = simState === "running";
  const isBuyer = perspective === "buyer";

  /* Result calculations */
  const savings = finalPrice ? selectedItem.listPrice - finalPrice : 0;
  const savingsPercent = finalPrice ? ((savings / selectedItem.listPrice) * 100).toFixed(1) : "0";
  const ebayFee = finalPrice ? finalPrice * 0.156 + 0.3 : 0;
  const haggleFee = finalPrice ? finalPrice * 0.015 : 0;
  const sellerNetEbay = finalPrice ? finalPrice - ebayFee : 0;
  const sellerNetHaggle = finalPrice ? finalPrice - haggleFee : 0;
  const sellerBenefit = sellerNetHaggle - sellerNetEbay;
  const failed = simState === "done" && finalPrice === null;

  const handleShare = useCallback(() => {
    if (!finalPrice) return;
    const text = isBuyer
      ? `AI negotiated ${savingsPercent}% off a ${selectedItem.name} on @tryhaggle!\n$${selectedItem.listPrice} → $${finalPrice}\nTry it:`
      : `Sold ${selectedItem.name} for $${finalPrice} on @tryhaggle. Kept $${sellerNetHaggle.toFixed(0)} vs $${sellerNetEbay.toFixed(0)} on eBay.\nTry it:`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://tryhaggle.ai/demo")}`, "_blank");
  }, [isBuyer, savingsPercent, selectedItem, finalPrice, sellerNetHaggle, sellerNetEbay]);

  return (
    <div className="min-h-screen">
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-14 pb-20">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Watch AI Negotiate in Real Time</h1>
          <p className="text-slate-400">Pick your side, tune both AI engines, and watch them negotiate.</p>
        </div>

        {/* Perspective + Item */}
        <div className="flex flex-col items-center gap-4 mb-6">
          <div className="inline-flex rounded-xl border border-slate-700 bg-bg-card p-1">
            <button onClick={() => { if (!isRunning) { setPerspective("buyer"); reset(); } }} disabled={isRunning}
              className={`rounded-lg px-5 py-2 text-sm font-medium transition-all cursor-pointer disabled:cursor-not-allowed ${perspective === "buyer" ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "text-slate-400 hover:text-slate-200 border border-transparent"}`}
            >I&apos;m Buying</button>
            <button onClick={() => { if (!isRunning) { setPerspective("seller"); reset(); } }} disabled={isRunning}
              className={`rounded-lg px-5 py-2 text-sm font-medium transition-all cursor-pointer disabled:cursor-not-allowed ${perspective === "seller" ? "bg-orange-500/20 text-orange-300 border border-orange-500/30" : "text-slate-400 hover:text-slate-200 border border-transparent"}`}
            >I&apos;m Selling</button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {ITEMS.map(item => (
              <button key={item.id} onClick={() => { if (!isRunning) { setSelectedItem(item); reset(); } }} disabled={isRunning}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all cursor-pointer disabled:cursor-not-allowed ${selectedItem.id === item.id ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-slate-800 bg-bg-card text-slate-400 hover:border-slate-600"}`}>
                <span>{item.emoji}</span><span>{item.name}</span><span className="text-xs text-slate-500">${item.listPrice}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Engine Controls Toggle */}
        <div className="text-center mb-4">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-slate-500 hover:text-cyan-400 transition-colors">
            {showAdvanced ? "Hide" : "Show"} Engine Controls {showAdvanced ? "\u25B2" : "\u25BC"}
          </button>
        </div>

        {/* Engine Controls */}
        {showAdvanced && (
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {Object.entries(STRATEGY_PRESETS).map(([id, p]) => (
                <button key={id} onClick={() => applyPreset(id)} disabled={isRunning}
                  className="rounded-lg border border-slate-700 bg-bg-card px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title={p.desc}>{p.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AgentPanel title="Buyer AI Engine" color="text-blue-300" borderColor="border-blue-500/20" bgColor="bg-blue-500/5"
                cfg={buyerCfg} onChange={c => { setBuyerCfg(c); reset(); }} item={selectedItem} role="buyer" disabled={isRunning} />
              <AgentPanel title="Seller AI Engine" color="text-orange-300" borderColor="border-orange-500/20" bgColor="bg-orange-500/5"
                cfg={sellerCfg} onChange={c => { setSellerCfg(c); reset(); }} item={selectedItem} role="seller" disabled={isRunning} />
            </div>
          </div>
        )}

        {/* Start Button */}
        {simState === "idle" && (
          <div className="text-center mb-8">
            <button onClick={runSimulation} className="rounded-xl bg-cyan-600 px-10 py-4 text-lg font-medium text-white hover:bg-cyan-500 transition-colors">
              Start AI Negotiation
            </button>
          </div>
        )}

        {/* Rounds */}
        {rounds.length > 0 && (
          <div className="max-w-3xl mx-auto mb-8 space-y-3">
            {rounds.map((round, i) => {
              const isYou = (isBuyer && round.actor === "buyer") || (!isBuyer && round.actor === "seller");
              const isAccept = round.action === "ACCEPT";
              const isFail = round.action === "REJECT" || round.action === "ESCALATE";
              return (
                <div key={i} className={`flex ${isYou ? "justify-start" : "justify-end"}`} style={{ animation: "fadeInUp 0.3s ease-out" }}>
                  <div className={`rounded-xl px-5 py-3 ${showAdvanced ? "max-w-md" : "max-w-xs"} ${
                    isAccept ? "bg-emerald-500/20 border border-emerald-500/30"
                    : isFail ? "bg-red-500/20 border border-red-500/30"
                    : isYou ? (isBuyer ? "bg-blue-500/10 border border-blue-500/20" : "bg-orange-500/10 border border-orange-500/20")
                    : "bg-slate-800 border border-slate-700"
                  }`}>
                    <p className="text-xs text-slate-500 mb-1">
                      {isYou ? "Your AI" : "Their AI"} ({round.actor === "buyer" ? "Buyer" : "Seller"})
                      {isAccept && " \u2714"}{isFail && " \u2718"}
                    </p>
                    <p className={`text-sm font-medium ${isAccept ? "text-emerald-300" : isFail ? "text-red-300" : "text-white"}`}>{round.note}</p>
                    {showAdvanced && round.utility && (
                      <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-1">
                        <UtilityBar label="U" value={round.utility.u_total} color="bg-cyan-500" />
                        <UtilityBar label="V_p" value={round.utility.v_p} color="bg-emerald-500" />
                        <UtilityBar label="V_t" value={round.utility.v_t} color="bg-amber-500" />
                        <UtilityBar label="V_r" value={round.utility.v_r} color="bg-violet-500" />
                        <UtilityBar label="V_s" value={round.utility.v_s} color="bg-pink-500" />
                        <p className="text-[10px] text-slate-600">{round.decision}{round.noConcess ? ` (stall: ${round.noConcess})` : ""}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={roundsEndRef} />
          </div>
        )}

        {/* Failed negotiation */}
        {failed && (
          <div className="max-w-lg mx-auto rounded-2xl border border-red-500/30 bg-red-500/5 p-6 sm:p-8 mb-8 text-center">
            <p className="text-red-400 text-sm mb-2">Negotiation Failed</p>
            <p className="text-lg font-semibold text-white mb-2">No deal reached</p>
            <p className="text-sm text-slate-400 mb-4">The AI agents couldn&apos;t agree on a price. Try adjusting the engine parameters.</p>
            <button onClick={reset} className="rounded-xl border border-slate-700 px-6 py-2.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors">Try Again</button>
          </div>
        )}

        {/* Result Card */}
        {simState === "done" && finalPrice && (
          <div className="max-w-lg mx-auto rounded-2xl border border-cyan-500/30 bg-bg-card p-6 sm:p-8 mb-8">
            <div className="text-center mb-6">
              <p className={`text-sm mb-2 ${isBuyer ? "text-blue-400" : "text-orange-400"}`}>{isBuyer ? "Buyer Result" : "Seller Result"}</p>
              {isBuyer ? (
                <><p className="text-3xl font-bold text-white mb-1">${savings} saved</p>
                  <p className="text-slate-400">{selectedItem.name}: ${selectedItem.listPrice} → ${finalPrice} ({savingsPercent}% off) in {rounds.length - 1} rounds</p></>
              ) : (
                <><p className="text-3xl font-bold text-white mb-1">Sold for ${finalPrice}</p>
                  <p className="text-slate-400">{selectedItem.name} — {rounds.length - 1} rounds of negotiation</p></>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-lg bg-slate-800/50 p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">{isBuyer ? "eBay (no negotiation)" : "You'd keep on eBay"}</p>
                <p className="text-sm text-red-400 font-medium">{isBuyer ? `$${selectedItem.listPrice}` : `$${sellerNetEbay.toFixed(0)}`}</p>
              </div>
              <div className="rounded-lg bg-cyan-500/10 p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">{isBuyer ? "Haggle (AI negotiated)" : "You keep on Haggle"}</p>
                <p className="text-sm text-cyan-400 font-medium">{isBuyer ? `$${finalPrice}` : `$${sellerNetHaggle.toFixed(0)}`}</p>
              </div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center mb-6">
              <p className="text-xs text-emerald-400 mb-1">{isBuyer ? "You save vs list price" : "Extra money vs eBay"}</p>
              <p className="text-2xl font-bold text-emerald-300">${isBuyer ? savings : sellerBenefit.toFixed(0)}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={handleShare} className="flex-1 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors">Share on Twitter</button>
              <button onClick={reset} className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors">Try Again</button>
            </div>
          </div>
        )}

        <div className="text-center mt-6 mb-10">
          <Link href="/playground" className="text-sm text-slate-500 hover:text-cyan-400 transition-colors">Want the original playground? &rarr;</Link>
        </div>
        <div className="max-w-md mx-auto">
          <p className="text-center text-slate-400 mb-4">Want AI to negotiate your real deals?</p>
          <WaitlistForm source="demo" />
        </div>
      </section>
      <style jsx global>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
