"use client";

import { useState, useCallback } from "react";
import {
  calculateAll,
  negotiationZone,
  savingsAnalogy,
  CATEGORIES,
  WEIGHT_TIERS,
  type PlatformResult,
} from "@/components/fee-data";
import { WaitlistForm } from "@/components/waitlist-form";

function fmt(n: number): string { return `$${n.toFixed(2)}`; }
function fmtR(n: number): string { return `$${Math.round(n)}`; }

/* ── Platform Row ────────────────────────────── */

function PlatformRow({ p, best }: { p: PlatformResult; best: { sellerNet: number; buyerCost: number } }) {
  const isHaggle = p.platformName === "Haggle";
  const isBestSeller = Math.abs(p.sellerNet - best.sellerNet) < 0.01;
  const isBestBuyer = Math.abs(p.buyerTotalCost - best.buyerCost) < 0.01;

  return (
    <tr className={isHaggle ? "bg-cyan-500/5" : ""}>
      {/* Platform */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className={`text-sm font-medium ${isHaggle ? "text-cyan-300" : "text-slate-200"}`}>
            {p.platformName}
          </span>
          {p.negotiable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">Negotiable</span>}
        </div>
      </td>
      {/* Fees */}
      <td className="py-3 px-3 text-right">
        <span className={`text-sm ${isHaggle ? "text-cyan-400" : "text-red-400"}`}>{fmt(p.totalFee)}</span>
        <span className="text-[10px] text-slate-600 ml-1">({p.feePercent.toFixed(1)}%)</span>
      </td>
      {/* Shipping */}
      <td className="py-3 px-3 text-right">
        <span className="text-xs text-slate-400">{fmt(p.sellerShippingCost + p.buyerShippingCost)}</span>
        <p className="text-[10px] text-slate-600 leading-tight">{p.shippingModel.split("(")[0].trim()}</p>
      </td>
      {/* Seller gets */}
      <td className="py-3 px-3 text-right">
        <span className={`text-sm font-semibold ${isBestSeller ? "text-emerald-400" : "text-slate-300"}`}>
          {fmtR(p.sellerNet)}
        </span>
        {isBestSeller && !isHaggle && <span className="text-[10px] text-emerald-500 ml-1">best</span>}
        {isHaggle && <span className="text-[10px] text-cyan-500 ml-1">best</span>}
      </td>
      {/* Buyer pays */}
      <td className="py-3 px-3 text-right">
        <span className={`text-sm font-semibold ${isBestBuyer ? "text-emerald-400" : "text-slate-300"}`}>
          {fmtR(p.buyerTotalCost)}
        </span>
        {p.buyerProtectionFee > 0 && (
          <p className="text-[10px] text-slate-600">incl. {fmt(p.buyerProtectionFee)} protection</p>
        )}
        {p.buyerShippingCost > 0 && (
          <p className="text-[10px] text-slate-600">incl. {fmt(p.buyerShippingCost)} shipping</p>
        )}
      </td>
    </tr>
  );
}

/* ── Negotiation Zone Visual ─────────────────── */

function NegotiationZoneViz({ listPrice, weightLbs }: { listPrice: number; weightLbs: number }) {
  const zone = negotiationZone(listPrice, weightLbs);
  const range = zone.sellerAsk - zone.buyerIdeal;
  const midPct = ((zone.midpoint - zone.buyerIdeal) / range) * 100;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-bg-card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Haggle Negotiation Zone</h3>
      <p className="text-xs text-slate-500 mb-5">On Haggle, buyer and seller AI agents negotiate within this range. Everyone wins vs eBay.</p>

      {/* Visual bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Buyer ideal: {fmtR(zone.buyerIdeal)}</span>
          <span>Seller ask: {fmtR(zone.sellerAsk)}</span>
        </div>
        <div className="relative h-10 rounded-lg bg-slate-800 overflow-hidden">
          {/* Full zone gradient */}
          <div className="absolute inset-0 rounded-lg" style={{ background: "linear-gradient(to right, #3b82f6, #06b6d4, #f97316)" }} />
          {/* Midpoint marker */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-white/80" style={{ left: `${midPct}%` }} />
          <div className="absolute -top-5 text-[10px] text-white font-medium" style={{ left: `${midPct}%`, transform: "translateX(-50%)" }}>
            AI likely: {fmtR(zone.midpoint)}
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-600 mt-1">
          <span>Buyer-friendly</span>
          <span>Seller-friendly</span>
        </div>
      </div>

      {/* Comparison table */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
          <p className="text-[10px] text-blue-400 mb-1">Buyer&apos;s best</p>
          <p className="text-lg font-bold text-white">{fmtR(zone.buyerIdeal)}</p>
          <p className="text-[10px] text-slate-500">Seller still gets {fmtR(zone.sellerNetAtBuyerIdeal)}</p>
          <p className="text-[10px] text-emerald-500">vs {fmtR(zone.ebaySellerNet)} on eBay</p>
        </div>
        <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-3">
          <p className="text-[10px] text-cyan-400 mb-1">AI likely price</p>
          <p className="text-lg font-bold text-cyan-300">{fmtR(zone.midpoint)}</p>
          <p className="text-[10px] text-slate-500">Seller keeps {fmtR(zone.sellerNetAtMid)}</p>
          <p className="text-[10px] text-emerald-500">+{fmtR(zone.sellerNetAtMid - zone.ebaySellerNet)} vs eBay</p>
        </div>
        <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3">
          <p className="text-[10px] text-orange-400 mb-1">Seller&apos;s ask</p>
          <p className="text-lg font-bold text-white">{fmtR(zone.sellerAsk)}</p>
          <p className="text-[10px] text-slate-500">Seller keeps {fmtR(zone.sellerNetAtAsk)}</p>
          <p className="text-[10px] text-emerald-500">+{fmtR(zone.sellerNetAtAsk - zone.ebaySellerNet)} vs eBay</p>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-4 text-center">
        At every price in this range, the seller keeps more than on eBay ({fmtR(zone.ebaySellerNet)}), and the buyer pays less than list price ({fmtR(zone.sellerAsk)}).
        Shipping cost ({fmt(zone.shippingCost)}) is also negotiable.
      </p>
    </div>
  );
}

/* ── Main Calculator ─────────────────────────── */

export function Calculator() {
  const [price, setPrice] = useState(500);
  const [category, setCategory] = useState("electronics");
  const [weightIdx, setWeightIdx] = useState(1); // default: 1-3 lbs
  const weightLbs = WEIGHT_TIERS[weightIdx].lbs;

  const results = calculateAll(price, category, weightLbs);

  // Find best for seller & buyer
  const bestSellerNet = Math.max(...results.map(r => r.sellerNet));
  const bestBuyerCost = Math.min(...results.map(r => r.buyerTotalCost));

  const haggle = results.find(r => r.platformName === "Haggle");
  const ebay = results.find(r => r.platformName === "eBay");
  const sellerSavings = haggle && ebay ? haggle.sellerNet - ebay.sellerNet : 0;

  const handleShare = useCallback(() => {
    if (!haggle || !ebay) return;
    const text = `Selling for $${price}:\n\neBay: I keep $${Math.round(ebay.sellerNet)}\nHaggle: I keep $${Math.round(haggle.sellerNet)}\n\nThat's $${Math.round(sellerSavings)} more with @tryhaggle.\n\nCalculate yours:`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://tryhaggle.ai/calculator")}`, "_blank");
  }, [haggle, ebay, price, sellerSavings]);

  return (
    <div className="min-h-screen">
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-14 pb-20">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Marketplace Fee &amp; Shipping Calculator</h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Compare fees, shipping, seller payouts, and buyer costs across 6 platforms. See the full picture — not just fees.
          </p>
        </div>

        {/* Inputs */}
        <div className="max-w-2xl mx-auto mb-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">$</span>
            <input type="number" value={price} onChange={e => setPrice(Math.max(0, Number(e.target.value)))}
              className="w-full rounded-xl border border-slate-700 bg-bg-input pl-8 pr-4 py-3 text-lg text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" placeholder="Sale price" min={0} />
          </div>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="rounded-xl border border-slate-700 bg-bg-input px-4 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={weightIdx} onChange={e => setWeightIdx(Number(e.target.value))}
            className="rounded-xl border border-slate-700 bg-bg-input px-4 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500">
            {WEIGHT_TIERS.map((w, i) => <option key={i} value={i}>{w.label}</option>)}
          </select>
        </div>

        {price > 0 && (
          <>
            {/* Comparison Table */}
            <div className="rounded-2xl border border-slate-800 bg-bg-card overflow-hidden mb-8">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left text-xs text-slate-500 font-medium py-3 px-3">Platform</th>
                      <th className="text-right text-xs text-slate-500 font-medium py-3 px-3">Fees</th>
                      <th className="text-right text-xs text-slate-500 font-medium py-3 px-3">Shipping</th>
                      <th className="text-right text-xs text-slate-500 font-medium py-3 px-3">Seller Gets</th>
                      <th className="text-right text-xs text-slate-500 font-medium py-3 px-3">Buyer Pays</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {results.map(p => (
                      <PlatformRow key={p.platformName} p={p} best={{ sellerNet: bestSellerNet, buyerCost: bestBuyerCost }} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Seller vs Buyer visual comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {/* Seller Payout Chart */}
              <div className="rounded-2xl border border-slate-800 bg-bg-card p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Seller Keeps (after fees + shipping)</h3>
                <div className="space-y-2.5">
                  {results.sort((a, b) => b.sellerNet - a.sellerNet).map(p => {
                    const pct = (p.sellerNet / price) * 100;
                    const isHaggle = p.platformName === "Haggle";
                    return (
                      <div key={p.platformName}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`text-xs ${isHaggle ? "text-cyan-400 font-medium" : "text-slate-400"}`}>{p.platformName}</span>
                          <span className={`text-xs font-mono ${isHaggle ? "text-cyan-300" : "text-slate-300"}`}>{fmtR(p.sellerNet)}</span>
                        </div>
                        <div className="h-5 rounded bg-slate-800 overflow-hidden">
                          <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: p.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Buyer Cost Chart */}
              <div className="rounded-2xl border border-slate-800 bg-bg-card p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Buyer Total Cost (item + shipping + fees)</h3>
                <div className="space-y-2.5">
                  {results.sort((a, b) => a.buyerTotalCost - b.buyerTotalCost).map(p => {
                    const maxCost = Math.max(...results.map(r => r.buyerTotalCost));
                    const pct = (p.buyerTotalCost / maxCost) * 100;
                    const isHaggle = p.platformName === "Haggle";
                    return (
                      <div key={p.platformName}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`text-xs ${isHaggle ? "text-cyan-400 font-medium" : "text-slate-400"}`}>{p.platformName}</span>
                          <span className={`text-xs font-mono ${isHaggle ? "text-cyan-300" : "text-slate-300"}`}>{fmtR(p.buyerTotalCost)}</span>
                        </div>
                        <div className="h-5 rounded bg-slate-800 overflow-hidden">
                          <div className="h-full rounded transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: p.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Savings Banner */}
            {sellerSavings > 0 && (
              <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-6 text-center mb-8">
                <p className="text-sm text-cyan-400 mb-1">On Haggle, seller keeps</p>
                <p className="text-4xl font-bold text-white mb-1">{fmtR(sellerSavings)} more</p>
                <p className="text-slate-400 mb-4">vs eBay — that&apos;s {savingsAnalogy(sellerSavings)}</p>
                <button onClick={handleShare} className="rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors">
                  Share on Twitter
                </button>
              </div>
            )}

            {/* Negotiation Zone */}
            <div className="mb-8">
              <NegotiationZoneViz listPrice={price} weightLbs={weightLbs} />
            </div>
          </>
        )}

        {/* Waitlist */}
        <div className="max-w-md mx-auto mt-10">
          <p className="text-center text-slate-400 mb-4">Want to sell with 1.5% fees + negotiable shipping?</p>
          <WaitlistForm source="calculator" />
        </div>

        {/* SEO FAQ */}
        <div className="mt-16 max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold text-white mb-6">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              { q: "How much are eBay fees in 2026?", a: "eBay charges a Final Value Fee of 13.25% for most categories, plus 2.35% + $0.30 payment processing. Total: approximately 15.6% + $0.30 per transaction. Sellers also typically pay for shipping labels (eBay offers ~30% discount off USPS retail rates)." },
              { q: "What does Poshmark charge for shipping?", a: "Poshmark provides a flat-rate $8.27 USPS Priority Mail label for packages up to 5 lbs. The buyer pays this fee. Sellers ship for free using the prepaid label. Items over 5 lbs incur a surcharge." },
              { q: "How does Haggle's shipping work?", a: "Haggle uses EasyPost to offer commercial shipping rates (40-60% off USPS retail). The unique part: shipping cost is negotiable between buyer and seller. You can split it any way — 100% buyer, 100% seller, or anything in between." },
              { q: "What can you negotiate on Haggle?", a: "Three things: (1) the item price, (2) who pays for shipping and how much, and (3) which carrier to use (USPS, UPS, FedEx). Your AI agent handles all of this automatically." },
              { q: "Why is Haggle so much cheaper than eBay?", a: "Haggle uses USDC on the Base blockchain for payments, eliminating credit card processing fees (2.35%). The non-custodial smart contract approach also reduces operational costs. Plus, EasyPost commercial rates give better shipping prices than eBay's labels." },
              { q: "Does Mercari charge the buyer?", a: "Yes. In addition to the 10% seller fee, Mercari charges buyers a 3.6% 'buyer protection fee' on each purchase. This is separate from shipping costs." },
            ].map(faq => (
              <details key={faq.q} className="group rounded-xl border border-slate-800 bg-bg-card">
                <summary className="flex items-center justify-between px-5 py-4 text-sm font-medium text-slate-200 cursor-pointer list-none">
                  {faq.q}
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
                    className="text-slate-500 group-open:rotate-180 transition-transform shrink-0 ml-2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <p className="px-5 pb-4 text-sm text-slate-400 leading-relaxed">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
