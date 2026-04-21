"use client";

import { useState } from "react";
import Link from "next/link";
import { DisputeNav } from "../_components/dispute-nav";

/* ── Component ────────────────────────── */

export default function DisputeReviewerPage() {
  const [viewMode, setViewMode] = useState<"vote" | "post" | "final">("vote");
  const [voteValue, setVoteValue] = useState(72);
  const [profileOpen, setProfileOpen] = useState(false);
  const [precedentOpen, setPrecedentOpen] = useState(false);

  const buyerAmt = (500 * voteValue / 100).toFixed(2);
  const sellerAmt = (500 * (100 - voteValue) / 100).toFixed(2);

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#111113]">
      <DisputeNav />

      <main className="mx-auto max-w-[760px] px-7 py-7">
        {/* Breadcrumbs */}
        <div className="mb-[18px] flex items-center gap-2 font-mono text-[12px] text-[#6b6b75]">
          <Link href="/demo/dispute" className="hover:text-[#111113]">Reviewer panel</Link>
          <span className="text-[#9a9aa3]">/</span>
          <span>Active assignments</span>
          <span className="text-[#9a9aa3]">/</span>
          <span>DSP-2847</span>
        </div>

        {/* Mode tabs */}
        <div className="mb-[18px] inline-flex gap-0.5 rounded-[10px] border border-[#eae7df] bg-[#fbfaf7] p-[3px]">
          {([
            { key: "vote" as const, label: "1. Cast your vote" },
            { key: "post" as const, label: "2. After you submit" },
            { key: "final" as const, label: "3. Decision reached" },
          ]).map((m) => (
            <button key={m.key} onClick={() => setViewMode(m.key)} className={`rounded-[7px] px-3 py-[7px] text-[12px] font-medium transition-all ${viewMode === m.key ? "bg-white text-[#111113] shadow-sm" : "text-[#6b6b75] hover:text-[#111113]"}`}>{m.label}</button>
          ))}
        </div>

        {/* ==================== VIEW 1: CAST VOTE ==================== */}
        {viewMode === "vote" && (
          <div className="space-y-[22px]">
            {/* Assignment header */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white p-[22px_24px] shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex gap-2">
                  <StatusPill variant="review">Review assignment</StatusPill>
                  <StatusPill variant="waiting">T2 · Panel</StatusPill>
                </div>
                <span className="font-mono text-[12px] text-[#6b6b75]">Case · <strong className="text-[#111113]">#DSP-2847</strong></span>
              </div>
              <h1 className="mt-1.5 flex flex-wrap items-baseline gap-3 text-[22px] font-semibold tracking-[-0.02em]">
                iPhone 14 Pro 128GB
                <span className="font-mono font-medium">$500.00</span>
              </h1>
              <div className="mt-1 text-[13px] text-[#6b6b75]">Reason: <strong className="text-[#2a2a30]">ITEM_NOT_AS_DESCRIBED</strong> · Opened Apr 19, 2026 · 14:32 UTC</div>
              <div className="mt-3.5 grid grid-cols-3 gap-3.5 border-t border-[#f0ede5] pt-4">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75]">Voting deadline</span>
                  <span className="font-mono text-[15px] font-semibold text-[#b45309]">36:42:18</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75]">Estimated reward</span>
                  <span className="font-mono text-[15px] font-semibold text-[#059669]">2.80 USDC</span>
                  <span className="text-[11px] text-[#6b6b75]">if you vote with the majority zone</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75]">Slot usage</span>
                  <span className="font-mono text-[15px] font-semibold">1 / 3</span>
                  <span className="text-[11px] text-[#6b6b75]">of your active reviewer slots</span>
                </div>
              </div>
            </section>

            {/* Case briefing */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="border-b border-[#f0ede5] px-[22px] py-4">
                <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Neutral briefing</div>
                <h2 className="mt-1 text-[14px] font-semibold tracking-[-0.005em]">Case dossier · prepared by the Arbiter</h2>
              </div>
              <div className="px-[22px] py-5">
                <div className="text-[14px] leading-[1.6]">
                  <strong>Summary.</strong> The buyer claims the iPhone&apos;s battery health was listed at 95% but measured at 82% upon receipt — a 13% discrepancy. The seller counters with an EXIF-dated screenshot showing 95% at listing time.
                </div>
                <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#eae7df] border-l-[3px] border-l-[#0891b2] bg-gradient-to-r from-[#ecfeff] to-[#fbfaf7] p-[16px_18px] text-[14px] leading-[1.55]" style={{ backgroundSize: "200% 100%" }}>
                    <h4 className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b6b75]">Buyer position <span className="font-sans text-[12px] font-semibold normal-case tracking-normal text-[#111113] ml-1.5">· advocate summary</span></h4>
                    <p>&ldquo;Battery health 95% listed → 82% received. The 13% gap exceeds normal variance of 1-2% per two weeks. Evidence: post-delivery battery screenshot showing 82%.&rdquo;</p>
                  </div>
                  <div className="rounded-xl border border-[#eae7df] border-l-[3px] border-l-[#7c3aed] bg-gradient-to-r from-[#f5f3ff] to-[#fbfaf7] p-[16px_18px] text-[14px] leading-[1.55]" style={{ backgroundSize: "200% 100%" }}>
                    <h4 className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b6b75]">Seller position <span className="font-sans text-[12px] font-semibold normal-case tracking-normal text-[#111113] ml-1.5">· advocate summary</span></h4>
                    <p>&ldquo;Battery was 95% at listing time — EXIF-dated photo proves this. 5 days of buyer usage could reduce battery health. Seller acted in good faith with accurate listing.&rdquo;</p>
                  </div>
                </div>
                <div className="mt-[18px] rounded-xl border-l-[3px] border-l-[#111113] bg-[#f6f4ee] p-[20px_22px] text-[18px] font-medium leading-[1.5] tracking-[-0.015em]">
                  &#x2696;&#xFE0F; Core question · <em>Is a 13% battery discrepancy (95% listed → 82% received) grounds for a refund, given the seller has EXIF evidence showing 95% at listing time?</em>
                </div>
              </div>
            </section>

            {/* Evidence gallery */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0ede5] px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Supporting materials</div>
                  <h2 className="mt-1 text-[14px] font-semibold tracking-[-0.005em]">Evidence gallery · 6 items</h2>
                </div>
                <span className="font-mono text-[11px] text-[#6b6b75]">All hashes anchored on-chain · party identities masked</span>
              </div>
              <div className="px-[22px] py-5">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  {/* Buyer column */}
                  <div>
                    <h4 className="mb-2.5 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b6b75]"><span className="h-1.5 w-1.5 rounded-full bg-[#0891b2]" />Buyer · 3 items</h4>
                    <div className="space-y-2.5">
                      {[
                        { thumb: "[ battery screenshot · 82% ]", type: "Battery reading · post-delivery", ts: "Apr 19 · 14:35", hash: "0x7f2c...a4" },
                        { thumb: "[ listing page · 95% advertised ]", type: "Listing screenshot", ts: "Apr 19 · 14:36", hash: "0x3a91...7e" },
                        { thumb: '"Received the phone and immediately checked the battery via iOS Settings. Ran it twice to confirm."', type: "Buyer statement", ts: "Apr 19 · 14:32", hash: "0xc402...91", isText: true },
                      ].map((ev, i) => (
                        <div key={i} className="cursor-pointer overflow-hidden rounded-xl border border-[#eae7df] bg-white transition-all hover:-translate-y-[1px] hover:shadow-md">
                          <div className={`grid h-[88px] place-items-center border-b border-[#eae7df] p-2 text-center font-mono text-[10px] ${
                            ev.isText
                              ? "items-start bg-gradient-to-b from-[#fbfaf7] to-[#f4f1ea] p-[10px_14px] text-left text-[11px] leading-[1.4] text-[#2a2a30]"
                              : "bg-[repeating-linear-gradient(45deg,#f0ede5,#f0ede5_8px,#ebe7dd_8px,#ebe7dd_16px)] text-[#6b6b75]"
                          }`}>
                            {ev.thumb}
                          </div>
                          <div className="p-[8px_12px]">
                            <div className="text-[13px] font-medium">{ev.type}</div>
                            <div className="font-mono text-[10px] text-[#6b6b75]">{ev.ts}</div>
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#ede9fe] bg-[#f5f3ff] px-1.5 py-[1px] font-mono text-[9px] font-semibold text-[#7c3aed]">
                              &#x26D3; Anchored · {ev.hash}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Seller column */}
                  <div>
                    <h4 className="mb-2.5 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b6b75]"><span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed]" />Seller · 3 items</h4>
                    <div className="space-y-2.5">
                      {[
                        { thumb: "[ battery · 95% · EXIF Apr 12 ]", type: "Battery reading · EXIF-dated", ts: "Apr 19 · 14:47 · EXIF: Apr 12 09:14", hash: "0xa4f1...2c" },
                        { thumb: "[ shipping label · delivered Apr 17 ]", type: "Shipping confirmation", ts: "Apr 19 · 14:51", hash: "0xe721...b0" },
                        { thumb: '"Battery was verified at 95% before shipping. Device was sealed and dispatched within 24 hours."', type: "Seller statement", ts: "Apr 19 · 14:58", hash: "0x11b6...5d", isText: true },
                      ].map((ev, i) => (
                        <div key={i} className="cursor-pointer overflow-hidden rounded-xl border border-[#eae7df] bg-white transition-all hover:-translate-y-[1px] hover:shadow-md">
                          <div className={`grid h-[88px] place-items-center border-b border-[#eae7df] p-2 text-center font-mono text-[10px] ${
                            ev.isText
                              ? "items-start bg-gradient-to-b from-[#fbfaf7] to-[#f4f1ea] p-[10px_14px] text-left text-[11px] leading-[1.4] text-[#2a2a30]"
                              : "bg-[repeating-linear-gradient(45deg,#f0ede5,#f0ede5_8px,#ebe7dd_8px,#ebe7dd_16px)] text-[#6b6b75]"
                          }`}>
                            {ev.thumb}
                          </div>
                          <div className="p-[8px_12px]">
                            <div className="text-[13px] font-medium">{ev.type}</div>
                            <div className="font-mono text-[10px] text-[#6b6b75]">{ev.ts}</div>
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#ede9fe] bg-[#f5f3ff] px-1.5 py-[1px] font-mono text-[9px] font-semibold text-[#7c3aed]">
                              &#x26D3; Anchored · {ev.hash}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Specialist verification */}
            <section className="rounded-xl border border-[#dfe9f5] p-[18px_20px]" style={{ background: "linear-gradient(to right, #f0f7ff, #fbfaf7)" }}>
              <div className="mb-2.5 flex items-center gap-2.5 font-mono text-[13px] uppercase tracking-[0.06em] text-[#6b6b75]">
                <span className="h-[7px] w-[7px] rounded-full bg-[#059669]" />
                Specialist Verification · <strong className="text-[#111113]">LegitApp Battery Analysis</strong> · Complete
              </div>
              <div className="mb-3 text-[14px] leading-[1.55]">
                &ldquo;Battery health degradation from 95% to 82% in 5 days is <strong>inconsistent with normal usage patterns</strong>. Typical degradation is 0.5-1% per week under heavy use. Possible explanations include pre-existing cell damage, temperature stress, or measurement variance.&rdquo;
              </div>
              <div className="flex items-center gap-2.5 text-[13px]">
                <span className="min-w-[82px] font-mono text-[11px] uppercase tracking-[0.06em] text-[#6b6b75]">Confidence</span>
                <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[#dfe9f5]">
                  <div className="h-full rounded-full" style={{ width: "87%", background: "linear-gradient(90deg, #0891b2, #059669)" }} />
                </div>
                <span className="min-w-[56px] text-right font-mono font-semibold">87%</span>
              </div>
              <div className="mt-2.5 text-[12px] leading-[1.5] text-[#6b6b75]">
                This is an automated analysis and may not account for all factors. Treat as supporting evidence, not sole basis for your vote.
              </div>
            </section>

            {/* Vote box */}
            <section className="rounded-[14px] border border-[#111113] bg-white p-[24px_26px] shadow-md">
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Your ballot · R-08</div>
              <h2 className="mt-1.5 text-[19px] font-semibold tracking-[-0.02em]">Cast your vote</h2>
              <div className="mt-1 text-[13px] text-[#6b6b75]">What percentage of the $500 escrow should go to the buyer?</div>

              {/* Slider */}
              <div className="mt-[18px]">
                <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.05em] text-[#6b6b75] mb-1">
                  <span><span className="font-semibold text-[#7c3aed]">0%</span> · Seller wins</span>
                  <span className="font-semibold text-[#111113]">50% · Split</span>
                  <span><span className="font-semibold text-[#0891b2]">100%</span> · Buyer wins</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={voteValue}
                  onChange={(e) => setVoteValue(Number(e.target.value))}
                  className="mt-5 w-full accent-[#111113]"
                  aria-label="Refund percentage"
                />
              </div>

              {/* Quick buttons */}
              <div className="mt-3.5 grid grid-cols-5 gap-1.5">
                {[0, 25, 50, 75, 100].map((q) => (
                  <button
                    key={q}
                    onClick={() => setVoteValue(q)}
                    className={`rounded-lg border px-1.5 py-2 font-mono text-[12px] font-semibold transition-all ${
                      voteValue === q
                        ? "border-[#111113] bg-[#111113] text-white"
                        : "border-[#eae7df] bg-[#fbfaf7] text-[#6b6b75] hover:border-[#2a2a30] hover:text-[#111113]"
                    }`}
                  >
                    {q}%
                  </button>
                ))}
              </div>

              {/* Summary */}
              <div className="mt-[18px] flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[#f6f4ee] p-[14px_16px]">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#6b6b75] mb-0.5">Your vote</div>
                  <div className="font-mono text-[20px] font-semibold tracking-[-0.01em]">{voteValue}% to buyer</div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] text-[#6b6b75] mb-0.5">Buyer receives</div>
                  <div className="font-mono text-[20px] font-semibold tracking-[-0.01em] text-[#0891b2]">${buyerAmt}</div>
                  <div className="mt-1 text-[11px] text-[#6b6b75]">Seller receives ${sellerAmt}</div>
                </div>
              </div>

              {/* Reasoning */}
              <label className="mt-[18px] block font-mono text-[12px] uppercase tracking-[0.06em] text-[#6b6b75]">
                Optional reasoning · anonymized and surfaced after voting closes
              </label>
              <textarea
                className="mt-2 w-full min-h-[80px] resize-y rounded-[10px] border border-[#eae7df] bg-[#fbfaf7] p-[12px_14px] text-[13px] leading-[1.5] outline-none focus:border-[#2a2a30] focus:bg-white"
                defaultValue="13% gap is too large for 5 days of ordinary use, but the seller's EXIF evidence is credible. Split leaning buyer."
              />

              <div className="mt-3.5 flex gap-2.5 rounded-lg border border-[#fde68a] border-l-[3px] border-l-[#b45309] bg-[#fffaf0] p-[10px_14px] text-[12px] text-[#6b6b75]">
                <span>&#x26A0;&#xFE0F;</span>
                <span><strong className="text-[#b45309]">Vote is final and cannot be changed.</strong> Voting within the final agreement zone (typically +/-15% of the median) earns your reward. Votes outside the zone receive 0 USDC and reduce your DS score slightly.</span>
              </div>

              {/* Sticky CTA */}
              <div className="sticky bottom-3.5 mt-[18px] flex items-center gap-3 rounded-xl border border-[#eae7df] bg-white/[0.92] px-3.5 py-3 shadow-lg backdrop-blur-[12px]">
                <div className="flex-1 text-[13px] text-[#6b6b75]">
                  Current vote · <strong className="text-[#111113]">{voteValue}% to buyer</strong> · reward 2.80 USDC if within zone
                </div>
                <button className="rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-[#6b6b75] hover:bg-[#fbfaf7]">Save draft</button>
                <button className="rounded-[10px] bg-[#0891b2] px-3.5 py-[7px] text-[13px] font-medium text-white hover:bg-[#0e7490]">Submit vote</button>
              </div>
            </section>

            {/* DS Profile (collapsible) */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white">
              <button onClick={() => setProfileOpen(!profileOpen)} className="flex w-full items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#fde68a] px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.04em]" style={{ background: "linear-gradient(135deg, #fef3c7, #fde68a)", color: "#8a5a12" }}>
                    &#x2B50;&#x2B50;&#x2B50; GOLD
                  </span>
                  <div>
                    <div className="text-[14px] font-semibold">Your Dispute-Specialist (DS) profile</div>
                    <div className="font-mono text-[12px] text-[#6b6b75]">Score 67/100 · Vote weight 1.10x · 43 cases reviewed</div>
                  </div>
                </div>
                <span className={`text-[11px] text-[#6b6b75] transition-transform ${profileOpen ? "rotate-90" : ""}`}>&#x25B6;</span>
              </button>
              {profileOpen && (
                <div className="border-t border-[#f0ede5]">
                  <div className="grid grid-cols-2 gap-x-7 gap-y-3 px-5 py-4 text-[13px]">
                    {[
                      ["DS score", "67 / 100"],
                      ["Vote weight", "1.10x"],
                      ["Cases reviewed", "43"],
                      ["Zone hit rate", "78%"],
                      ["Active slots", "1 / 3"],
                      ["Earnings · 7d", "18.60 USDC"],
                      ["Earnings · 30d", "62.40 USDC"],
                      ["Member since", "2025-11-04"],
                    ].map(([k, v], i) => (
                      <div key={i} className="flex justify-between border-b border-dashed border-[#f0ede5] py-1.5">
                        <span className="text-[#6b6b75]">{k}</span>
                        <span className={`font-mono font-semibold ${k === "Zone hit rate" ? "text-[#059669]" : ""}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 pb-3.5">
                    <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75]">Specializations</div>
                    <div className="flex flex-wrap gap-1.5">
                      {["Electronics · 89% · 22", "Luxury goods · 71% · 11", "Watches · 80% · 5"].map((s, i) => (
                        <span key={i} className="rounded-full border border-[#eae7df] bg-[#fbfaf7] px-2.5 py-1 font-mono text-[12px]">{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-[#f0ede5] px-5 py-3.5">
                    <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75] mb-1.5">
                      <span>Next tier · PLATINUM</span>
                      <span>67 / 71</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
                      <div className="h-full rounded-full" style={{ width: "94%", background: "linear-gradient(90deg, #cbb26a, #e8d594)" }} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-[#6b6b75]">4 more zone-hits from your next rank-up · vote weight rises to 1.45x</div>
                  </div>
                </div>
              )}
            </section>

            {/* Similar cases (collapsible) */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white">
              <button onClick={() => setPrecedentOpen(!precedentOpen)} className="flex w-full items-center justify-between border-b border-[#f0ede5] px-[22px] py-4 text-left">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Precedent</div>
                  <h2 className="mt-1 text-[14px] font-semibold tracking-[-0.005em]">Similar past cases · 3 of 24 matches</h2>
                </div>
                <span className={`text-[11px] text-[#6b6b75] transition-transform ${precedentOpen ? "rotate-90" : ""}`}>&#x25B6;</span>
              </button>
              {precedentOpen && (
                <div className="px-[22px] py-5">
                  {[
                    { id: "#DSP-1892", desc: "iPhone 13 · battery 91% → 78% (13% gap) · EXIF absent · panel strength strong", outcome: "80% → buyer", color: "#0891b2" },
                    { id: "#DSP-2103", desc: "iPhone 14 · battery 96% → 89% (7% gap) · small discrepancy · panel strength moderate", outcome: "30% → buyer", color: "#475569" },
                    { id: "#DSP-2445", desc: "Galaxy S23 · battery 94% → 85% (9% gap) · EXIF present on seller · panel strength strong", outcome: "60% → buyer", color: "#0891b2" },
                  ].map((c, i) => (
                    <div key={i} className={`grid grid-cols-[120px_1fr_auto] items-center gap-3.5 py-3 text-[13px] ${i < 2 ? "border-b border-dashed border-[#f0ede5]" : ""}`}>
                      <span className="font-mono text-[12px] text-[#6b6b75]">{c.id}</span>
                      <span className="leading-[1.4]">{c.desc}</span>
                      <span className="font-mono text-[13px] font-semibold" style={{ color: c.color }}>{c.outcome}</span>
                    </div>
                  ))}
                  <div className="mt-2.5 flex gap-2.5 rounded-[10px] bg-[#f6f4ee] p-[10px_14px] text-[13px] text-[#2a2a30]">
                    <span>&#x1F4A1;</span>
                    <span><strong>Pattern.</strong> Across 24 matched cases, battery discrepancies above 10% typically favored the buyer (70%+ of outcomes). EXIF-backed seller evidence reduced that share by roughly 15 points.</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ==================== VIEW 2: POST-VOTE ==================== */}
        {viewMode === "post" && (
          <section className="rounded-[14px] border border-[#eae7df] bg-white p-[28px_30px] shadow-sm">
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#059669] mb-2">&#x2713; Vote submitted</div>
            <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Your vote is sealed. Thanks for serving on this panel.</h2>
            <div className="mt-2 text-[14px] leading-[1.6] text-[#6b6b75]">
              Panel results will be revealed once the voting window closes. Your ballot is committed on-chain and cannot be altered.
            </div>
            <div className="mt-[18px] grid grid-cols-3 gap-[18px]">
              <StatCard label="Your vote" value="72%" sub="$360 to buyer" />
              <StatCard label="Submitted" value="Apr 20 · 09:15 UTC" sub="hash 0xbe31...a9" smallValue />
              <StatCard label="Decision ETA" value="Apr 22 · 14:32 UTC" sub="~36 h remaining" smallValue />
            </div>
            <div className="my-[22px] h-px bg-[#eae7df]" />
            <div className="flex items-center justify-between mb-2.5">
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Panel voting progress</div>
              <div className="font-mono text-[13px] text-[#6b6b75]">7 / 9 reviewers voted</div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#f1f5f9]">
              <div className="h-full rounded-full" style={{ width: "78%", background: "repeating-linear-gradient(45deg, #0891b2 0 8px, #0aa3c6 8px 16px)" }} />
            </div>
            <div className="mt-3.5 flex flex-wrap gap-1">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className={`grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[9px] font-semibold ${
                  i < 7
                    ? i === 6
                      ? "border border-[#111113] bg-[#111113] text-white outline outline-2 outline-offset-2 outline-[#0891b2]"
                      : "border border-[#111113] bg-[#111113] text-white"
                    : "border border-[#eae7df] bg-[#f1f5f9] text-[#6b6b75]"
                }`}>
                  {String(i + 1).padStart(2, "0")}
                </div>
              ))}
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#6b6b75]">&#x25B2; You are reviewer R-07 · vote sealed at 09:15 UTC</div>
            <div className="mt-[22px] flex gap-2.5">
              <button className="rounded-[10px] bg-[#111113] px-4 py-2.5 text-[14px] font-medium text-white">View my other active cases &rarr;</button>
              <button className="rounded-[10px] border border-[#eae7df] px-4 py-2.5 text-[14px] font-medium hover:border-[#2a2a30]">Reviewer dashboard</button>
            </div>
          </section>
        )}

        {/* ==================== VIEW 3: POST-DECISION ==================== */}
        {viewMode === "final" && (
          <section className="rounded-[14px] border border-[#eae7df] bg-white p-[28px_30px] shadow-sm">
            <div className="flex items-center gap-2.5 mb-2">
              <StatusPill variant="resolved">Decision reached</StatusPill>
              <span className="font-mono text-[12px] text-[#6b6b75]">#DSP-2847 · Apr 22 · 14:32 UTC</span>
            </div>
            <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Panel ruled · 75% refund to buyer.</h2>
            <div className="mt-2 max-w-[600px] text-[14px] leading-[1.6] text-[#6b6b75]">
              The panel reached strong agreement (82%). Escrow contract auto-executed at 14:33 UTC — settlement hash committed on-chain.
            </div>
            <div className="mt-[18px] grid grid-cols-3 gap-[18px]">
              <StatCard label="Outcome" value="75%" sub="$375 refund · seller keeps $125" valueColor="#0891b2" />
              <StatCard label="Your vote" value="72%" sub="In majority · 3% from median" subColor="#059669" subPrefix="&#x2713; " />
              <StatCard label="Your reward" value="+2.80 USDC" sub="DS impact +0.8" valueColor="#059669" />
            </div>

            <div className="my-[22px] h-px bg-[#eae7df]" />

            {/* Vote distribution */}
            <div className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Vote distribution · 9 reviewers (anonymized)</div>
            <div className="relative mt-3 rounded-xl bg-[#f6f4ee] px-6 pb-3.5 pt-14">
              <div className="relative h-[60px]">
                {/* Agreement zone */}
                <div className="absolute bottom-[18px] top-0 rounded bg-[#059669]/[0.08] border-l border-r border-dashed border-[#059669]" style={{ left: "60%", right: "10%" }} />
                {/* Axis */}
                <div className="absolute bottom-[18px] left-0 right-0 h-[2px] bg-[#e2ded3]" />
                {/* Ticks */}
                {[15, 30, 68, 78, 80, 82, 85].map((pos, i) => (
                  <div key={i} className="absolute bottom-[14px] w-[2px] rounded bg-[#9a9aa3]" style={{ left: `${pos}%`, height: "30px", transform: "translateX(-50%)" }} />
                ))}
                {/* Your vote */}
                <div className="absolute bottom-[14px] z-[2] w-[3px] rounded bg-[#0891b2]" style={{ left: "72%", height: "44px", transform: "translateX(-50%)" }}>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded border border-[#cffafe] bg-white px-1.5 py-[2px] font-mono text-[10px] font-semibold text-[#0891b2]">you · 72%</div>
                </div>
                {/* Median */}
                <div className="absolute bottom-[14px] z-[2] w-[3px] rounded bg-[#111113]" style={{ left: "75%", height: "44px", transform: "translateX(-50%)" }}>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded border border-[#eae7df] bg-white px-1.5 py-[2px] font-mono text-[10px] font-semibold text-[#111113]">median · 75%</div>
                </div>
              </div>
              <div className="flex justify-between font-mono text-[10px] text-[#6b6b75] mt-1">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-[18px] font-mono text-[12px] text-[#6b6b75]">
              <span><span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-[#059669]" />Agreement zone 60-90%</span>
              <span><span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-[#111113]" />Panel median</span>
              <span><span className="mr-1.5 inline-block h-[2px] w-2.5 align-middle bg-[#0891b2]" />Your vote</span>
            </div>

            <div className="my-[22px] h-px bg-[#eae7df]" />

            {/* Peer reasoning */}
            <div className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Peer reasoning · anonymized</div>
            <div className="space-y-2">
              {[
                { pct: "78%", text: "\"13% in 5 days is abnormal for this model. Seller's EXIF shows good faith but doesn't excuse the gap. Leaning buyer.\"" },
                { pct: "75%", text: "\"Partial refund is fair -- specialist analysis makes the buyer's case, but the seller wasn't deceptive, just unlucky.\"" },
                { pct: "80%", text: "\"Very similar to DSP-1892. Battery gaps over 10% consistently favor the buyer regardless of EXIF defense.\"" },
                { pct: "30%", text: "\"EXIF evidence is strong; would lean seller if not for LegitApp confidence level.\"", outside: true },
              ].map((p, i) => (
                <div key={i} className="flex gap-2.5 rounded-[10px] border border-[#f0ede5] bg-[#fbfaf7] p-[10px_14px] text-[13px] leading-[1.5]">
                  <span className="min-w-[44px] font-mono font-semibold text-[#6b6b75]">{p.pct}</span>
                  <span className={p.outside ? "text-[#6b6b75]" : ""}>{p.text}{p.outside && <> · <em>outside zone</em></>}</span>
                </div>
              ))}
            </div>

            <div className="mt-[22px] flex gap-2.5">
              <button className="rounded-[10px] bg-[#111113] px-4 py-2.5 text-[14px] font-medium text-white">View case settlement &#x2197;</button>
              <button className="rounded-[10px] border border-[#eae7df] px-4 py-2.5 text-[14px] font-medium hover:border-[#2a2a30]">Next assignment</button>
              <button className="ml-auto rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-[#6b6b75] hover:bg-[#fbfaf7]">Report a concern</button>
            </div>
          </section>
        )}

        <footer className="mt-9 flex justify-between border-t border-[#eae7df] pt-[22px] text-[12px] text-[#6b6b75]">
          <span className="font-mono">Haggle Resolution Center · v2026.4 · Reviewer</span>
          <span className="flex gap-2">
            <span>Code of conduct</span> · <span>DS score rules</span> · <span>Appeals</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

/* ── Sub-components ───────────────────── */

function StatusPill({ variant, children }: { variant: "review" | "waiting" | "resolved"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    review: "bg-[#ecfeff] text-[#0891b2] border-[#cffafe]",
    waiting: "bg-[#f5f3ff] text-[#7c3aed] border-[#ede9fe]",
    resolved: "bg-[#ecfdf5] text-[#059669] border-[#bbf7d0]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-[9px] py-[4px] font-mono text-[11px] font-semibold uppercase tracking-[0.04em] ${styles[variant]}`}>
      {(variant === "waiting" || variant === "resolved") && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, valueColor, subColor, subPrefix, smallValue }: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  subColor?: string;
  subPrefix?: string;
  smallValue?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#eae7df] bg-[#fbfaf7] p-[14px_16px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75]">{label}</div>
      <div className={`mt-1 font-mono font-semibold tracking-[-0.01em] ${smallValue ? "text-[14px]" : "text-[22px]"}`} style={{ color: valueColor }}>{value}</div>
      <div className="mt-1 text-[12px] text-[#6b6b75]" style={{ color: subColor }}>
        {subPrefix && <span dangerouslySetInnerHTML={{ __html: subPrefix }} />}{sub}
      </div>
    </div>
  );
}
