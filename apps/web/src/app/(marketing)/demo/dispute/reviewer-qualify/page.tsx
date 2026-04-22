"use client";

import { useState } from "react";
import Link from "next/link";
import { DisputeNav } from "../_components/dispute-nav";

/* ── Test Cases (10 past disputes) ──────── */

interface TestCase {
  id: number;
  caseId: string;
  item: string;
  emoji: string;
  amount: string;
  reason: string;
  buyerClaim: string;
  sellerDefense: string;
  evidence: string[];
  actualOutcome: number; // 0-100 (% to buyer)
  outcomeLabel: string;
}

const testCases: TestCase[] = [
  {
    id: 1, caseId: "#DSP-1892", item: "iPhone 13 Pro", emoji: "📱", amount: "$420",
    reason: "Battery health discrepancy",
    buyerClaim: "Listing said 91% battery, received at 78%. 13% gap in 3 days of ownership.",
    sellerDefense: "Battery was 91% at listing. Buyer used phone heavily for 5 days before measuring.",
    evidence: ["Battery screenshot 78%", "Listing screenshot 91%", "EXIF dates match"],
    actualOutcome: 80, outcomeLabel: "80% to buyer · Strong consensus",
  },
  {
    id: 2, caseId: "#DSP-2103", item: "iPhone 14 Pro Max", emoji: "📱", amount: "$680",
    reason: "Battery health discrepancy",
    buyerClaim: "Listed at 96%, measured at 89%. 7% gap.",
    sellerDefense: "7% is within normal usage variance over 10 days. Apple states 1% per week under heavy use.",
    evidence: ["Battery screenshot 89%", "Listing 96%", "Apple support article on degradation"],
    actualOutcome: 30, outcomeLabel: "30% to buyer · Moderate consensus",
  },
  {
    id: 3, caseId: "#DSP-2201", item: "Louis Vuitton Neverfull MM", emoji: "👜", amount: "$1,200",
    reason: "Authenticity dispute",
    buyerClaim: "Stitching pattern inconsistent with authentic LV. Suspected counterfeit.",
    sellerDefense: "Purchased from LV store directly. Have receipt and dust bag.",
    evidence: ["Close-up photos of stitching", "Original receipt photo", "LegitApp: 94% authentic"],
    actualOutcome: 10, outcomeLabel: "10% to buyer · Strong consensus (seller wins)",
  },
  {
    id: 4, caseId: "#DSP-2245", item: "Nike Air Jordan 1 Retro High", emoji: "👟", amount: "$220",
    reason: "Item not as described",
    buyerClaim: "Listed as 'DS' (deadstock/new), but sole has visible yellowing and wear marks.",
    sellerDefense: "Yellowing is natural oxidation from storage, not wear. Shoes were never worn.",
    evidence: ["Sole photos showing yellowing", "Listing stated 'DS condition'", "Zoom on wear marks"],
    actualOutcome: 65, outcomeLabel: "65% to buyer · Weak consensus",
  },
  {
    id: 5, caseId: "#DSP-2310", item: "MacBook Pro M2 14\"", emoji: "💻", amount: "$1,800",
    reason: "Functionality issue",
    buyerClaim: "Screen has 3 dead pixels. Not mentioned in listing.",
    sellerDefense: "Tested before shipping, no dead pixels. May have occurred during transit.",
    evidence: ["Photo of dead pixels on white screen", "Original listing 'excellent condition'", "Shipping insurance claim"],
    actualOutcome: 75, outcomeLabel: "75% to buyer · Moderate consensus",
  },
  {
    id: 6, caseId: "#DSP-2388", item: "Sony WH-1000XM5", emoji: "🎧", amount: "$230",
    reason: "Item damaged in transit",
    buyerClaim: "Left ear cup cracked when received. Box was damaged too.",
    sellerDefense: "Packed with bubble wrap + original box. Carrier mishandled. Filed shipping claim.",
    evidence: ["Unboxing video showing damage", "Damaged box photo", "Carrier damage report"],
    actualOutcome: 90, outcomeLabel: "90% to buyer · Strong consensus",
  },
  {
    id: 7, caseId: "#DSP-2412", item: "Rolex Datejust 36", emoji: "⌚", amount: "$5,800",
    reason: "Authenticity + condition",
    buyerClaim: "Serial number doesn't match Rolex registry. Possible franken-watch (mixed parts).",
    sellerDefense: "Purchased from reputable dealer. Serial is from 2019 batch, may not be in public registry.",
    evidence: ["Serial number close-up", "LegitApp: 62% authentic (inconclusive)", "Dealer receipt"],
    actualOutcome: 55, outcomeLabel: "55% to buyer · Weak consensus",
  },
  {
    id: 8, caseId: "#DSP-2445", item: "Galaxy S23 Ultra", emoji: "📱", amount: "$600",
    reason: "Battery health discrepancy",
    buyerClaim: "Listed 94%, received 85%. 9% gap.",
    sellerDefense: "Samsung doesn't show battery health natively. Buyer used third-party app which is unreliable.",
    evidence: ["AccuBattery screenshot 85%", "Listing stated 94%", "Samsung support: no native health metric"],
    actualOutcome: 45, outcomeLabel: "45% to buyer · Weak consensus",
  },
  {
    id: 9, caseId: "#DSP-2501", item: "iPad Air M1", emoji: "📱", amount: "$420",
    reason: "Item not received",
    buyerClaim: "Tracking says delivered but I never received it. Package theft suspected.",
    sellerDefense: "Tracking confirms delivery to correct address. Signed by 'Front Door'.",
    evidence: ["Tracking screenshot: delivered", "Buyer's address confirmation", "No signature required"],
    actualOutcome: 70, outcomeLabel: "70% to buyer · Moderate consensus",
  },
  {
    id: 10, caseId: "#DSP-2555", item: "Canon EOS R6 II", emoji: "📷", amount: "$1,900",
    reason: "Shutter count misrepresented",
    buyerClaim: "Listed as 'low shutter count ~5,000', actual shutter count is 42,000.",
    sellerDefense: "I estimated based on usage. Never claimed exact count. Listing said 'approximately'.",
    evidence: ["Shutter count tool: 42,187", "Listing: '~5,000 shutter count'", "Camera EXIF data"],
    actualOutcome: 85, outcomeLabel: "85% to buyer · Strong consensus",
  },
];

/* ── Component ────────────────────────── */

type Phase = "intro" | "test" | "result";

export default function ReviewerQualifyPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [votes, setVotes] = useState<number[]>([]);
  const [currentVote, setCurrentVote] = useState(50);

  const currentCase = testCases[currentIdx];
  const totalCases = testCases.length;

  function startTest() {
    setPhase("test");
    setCurrentIdx(0);
    setVotes([]);
    setCurrentVote(50);
  }

  function submitVote() {
    const newVotes = [...votes, currentVote];
    setVotes(newVotes);

    if (currentIdx < totalCases - 1) {
      setCurrentIdx(currentIdx + 1);
      setCurrentVote(50);
    } else {
      setPhase("result");
    }
  }

  // Calculate results
  const matches = votes.filter((v, i) => {
    const actual = testCases[i].actualOutcome;
    return Math.abs(v - actual) <= 15; // within agreement zone (±15)
  }).length;
  const matchRate = votes.length > 0 ? Math.round((matches / votes.length) * 100) : 0;
  const passed = matchRate >= 70;
  const conditional = matchRate >= 60 && matchRate < 70;

  const buyerAmt = (parseFloat(currentCase?.amount.replace(/[$,]/g, "") || "0") * currentVote / 100).toFixed(0);
  const sellerAmt = (parseFloat(currentCase?.amount.replace(/[$,]/g, "") || "0") * (100 - currentVote) / 100).toFixed(0);

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#111113]">
      <DisputeNav />

      <main className="mx-auto max-w-[760px] px-7 py-7">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2 font-mono text-[12px] text-[#6b6b75]">
          <Link href="/demo/dispute/reviewer-dashboard" className="hover:text-[#111113]">Reviewer Dashboard</Link>
          <span className="text-[#9a9aa3]">/</span>
          <span>Qualification Test</span>
        </div>

        {/* ── INTRO ── */}
        {phase === "intro" && (
          <div className="space-y-5">
            <section className="rounded-[14px] border border-[#eae7df] bg-white p-8 shadow-sm text-center">
              <div className="text-[48px] mb-4">⚖️</div>
              <h1 className="text-[26px] font-bold tracking-[-0.02em]">Reviewer Qualification Test</h1>
              <p className="mt-3 text-[15px] text-[#3d3d45] max-w-lg mx-auto leading-relaxed">
                Prove your judgment by reviewing 10 past dispute cases. Your votes are compared against the actual community decisions.
              </p>

              <div className="mt-8 grid grid-cols-3 gap-4 max-w-md mx-auto">
                <div className="rounded-xl border border-[#eae7df] bg-[#fbfaf7] p-4">
                  <div className="font-mono text-[24px] font-bold">10</div>
                  <div className="text-[11px] text-[#6b6b75] mt-1">Cases</div>
                </div>
                <div className="rounded-xl border border-[#eae7df] bg-[#fbfaf7] p-4">
                  <div className="font-mono text-[24px] font-bold text-[#059669]">70%</div>
                  <div className="text-[11px] text-[#6b6b75] mt-1">To pass</div>
                </div>
                <div className="rounded-xl border border-[#eae7df] bg-[#fbfaf7] p-4">
                  <div className="font-mono text-[24px] font-bold">±15</div>
                  <div className="text-[11px] text-[#6b6b75] mt-1">Zone tolerance</div>
                </div>
              </div>

              <div className="mt-8 rounded-xl border border-[#eae7df] bg-[#fbfaf7] p-5 text-left max-w-lg mx-auto">
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75] mb-3">How it works</div>
                <div className="space-y-2.5 text-[13px] text-[#3d3d45]">
                  <div className="flex gap-3"><span className="font-mono text-[#0891b2] font-bold">1.</span> Read the dispute summary — buyer&apos;s claim vs seller&apos;s defense</div>
                  <div className="flex gap-3"><span className="font-mono text-[#0891b2] font-bold">2.</span> Review the evidence presented by both sides</div>
                  <div className="flex gap-3"><span className="font-mono text-[#0891b2] font-bold">3.</span> Use the slider to vote: 0% = full seller win, 100% = full buyer win</div>
                  <div className="flex gap-3"><span className="font-mono text-[#0891b2] font-bold">4.</span> Your vote is compared to the actual community result (±15% tolerance)</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-[#fde68a] bg-[#fef3c7]/50 p-4 text-left max-w-lg mx-auto">
                <div className="text-[13px] text-[#92400e]">
                  <strong>This is a learning experience.</strong> Even if you don&apos;t pass on the first try, you&apos;ll learn how the community typically decides disputes — making you a better reviewer.
                </div>
              </div>

              <button
                onClick={startTest}
                className="mt-8 inline-flex items-center gap-2 rounded-[10px] bg-[#111113] px-6 py-3 text-[15px] font-semibold text-white hover:bg-black transition-colors"
              >
                Start Qualification Test →
              </button>
            </section>
          </div>
        )}

        {/* ── TEST ── */}
        {phase === "test" && currentCase && (
          <div className="space-y-5">
            {/* Progress */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] text-[#6b6b75]">Case {currentIdx + 1} of {totalCases}</span>
              <div className="flex gap-1.5">
                {testCases.map((_, i) => (
                  <div key={i} className={`h-2 w-6 rounded-full transition-colors ${
                    i < votes.length ? "bg-[#059669]" : i === currentIdx ? "bg-[#111113]" : "bg-[#eae7df]"
                  }`} />
                ))}
              </div>
            </div>

            {/* Case card */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              {/* Header */}
              <div className="border-b border-[#f0ede5] px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[24px]">{currentCase.emoji}</span>
                    <div>
                      <h2 className="text-[16px] font-semibold">{currentCase.item}</h2>
                      <span className="font-mono text-[12px] text-[#6b6b75]">{currentCase.caseId} · {currentCase.amount}</span>
                    </div>
                  </div>
                  <span className="rounded-full border border-[#fde68a] bg-[#fef3c7] px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#b45309]">
                    {currentCase.reason}
                  </span>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Buyer vs Seller */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border-l-[3px] border-[#0891b2] border-r border-t border-b border-r-[#eae7df] border-t-[#eae7df] border-b-[#eae7df] bg-gradient-to-r from-[#ecfeff] to-[#fbfaf7] p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#0891b2] font-semibold mb-2">Buyer&apos;s Claim</div>
                    <p className="text-[13px] text-[#3d3d45] leading-relaxed">{currentCase.buyerClaim}</p>
                  </div>
                  <div className="rounded-xl border-l-[3px] border-[#7c3aed] border-r border-t border-b border-r-[#eae7df] border-t-[#eae7df] border-b-[#eae7df] bg-gradient-to-r from-[#f5f3ff] to-[#fbfaf7] p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#7c3aed] font-semibold mb-2">Seller&apos;s Defense</div>
                    <p className="text-[13px] text-[#3d3d45] leading-relaxed">{currentCase.sellerDefense}</p>
                  </div>
                </div>

                {/* Evidence */}
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6b6b75] font-semibold mb-2">Evidence</div>
                  <div className="flex flex-wrap gap-2">
                    {currentCase.evidence.map((e, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-[#eae7df] bg-[#fbfaf7] px-3 py-1.5 text-[12px] text-[#3d3d45]">
                        <span className="text-[#6b6b75]">{i === 0 ? "📸" : i === 1 ? "📸" : "📝"}</span>
                        {e}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Vote slider */}
                <div className="rounded-xl border border-[#111113] bg-white p-5">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75] font-semibold mb-1">Your Vote</div>
                  <div className="text-[13px] text-[#3d3d45] mb-4">What percentage should go to the buyer?</div>

                  <div className="relative mb-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={currentVote}
                      onChange={(e) => setCurrentVote(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #f5f3ff ${currentVote}%, #ecfeff ${currentVote}%)`,
                        accentColor: "#111113",
                      }}
                    />
                    <div className="flex justify-between mt-1 font-mono text-[10px] text-[#9a9aa3]">
                      <span>0% Seller wins</span>
                      <span>100% Buyer wins</span>
                    </div>
                  </div>

                  {/* Quick buttons */}
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {[0, 25, 50, 75, 100].map((v) => (
                      <button
                        key={v}
                        onClick={() => setCurrentVote(v)}
                        className={`rounded-lg border px-3 py-1.5 font-mono text-[12px] font-semibold transition-all ${
                          currentVote === v
                            ? "border-[#111113] bg-[#111113] text-white"
                            : "border-[#eae7df] bg-white text-[#6b6b75] hover:border-[#111113] hover:text-[#111113]"
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>

                  {/* Live calculation */}
                  <div className="flex items-center justify-between rounded-lg border border-[#eae7df] bg-[#fbfaf7] p-3">
                    <span className="text-[13px]">
                      Your vote: <strong className="font-mono">{currentVote}%</strong> to buyer
                    </span>
                    <span className="font-mono text-[12px] text-[#6b6b75]">
                      Buyer ${buyerAmt} · Seller ${sellerAmt}
                    </span>
                  </div>

                  <button
                    onClick={submitVote}
                    className="mt-4 w-full rounded-[10px] bg-[#111113] px-4 py-3 text-[14px] font-semibold text-white hover:bg-black transition-colors"
                  >
                    {currentIdx < totalCases - 1 ? `Submit & Next (${currentIdx + 2}/${totalCases})` : "Submit & See Results"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ── RESULT ── */}
        {phase === "result" && (
          <div className="space-y-5">
            {/* Score card */}
            <section className={`rounded-[14px] border-2 bg-white p-8 shadow-sm text-center ${
              passed ? "border-[#059669]" : conditional ? "border-[#b45309]" : "border-[#dc2626]"
            }`}>
              <div className="text-[48px] mb-3">
                {passed ? "🎉" : conditional ? "📘" : "🔄"}
              </div>
              <h1 className="text-[26px] font-bold tracking-[-0.02em]">
                {passed ? "Qualified!" : conditional ? "Conditional Pass" : "Not Yet — Try Again"}
              </h1>
              <p className="mt-2 text-[15px] text-[#3d3d45]">
                {passed && "You demonstrated strong alignment with community decisions. Welcome to the reviewer panel!"}
                {conditional && "You're close! Complete the training module below to earn your qualification."}
                {!passed && !conditional && "Your votes differed significantly from community consensus. Review the cases below and try again in 24 hours."}
              </p>

              <div className="mt-6 inline-flex items-center gap-6 rounded-xl border border-[#eae7df] bg-[#fbfaf7] px-8 py-4">
                <div>
                  <div className={`font-mono text-[36px] font-bold ${passed ? "text-[#059669]" : conditional ? "text-[#b45309]" : "text-[#dc2626]"}`}>
                    {matchRate}%
                  </div>
                  <div className="text-[12px] text-[#6b6b75]">Match rate</div>
                </div>
                <div className="h-10 w-px bg-[#eae7df]" />
                <div>
                  <div className="font-mono text-[36px] font-bold">{matches}/{totalCases}</div>
                  <div className="text-[12px] text-[#6b6b75]">Within zone</div>
                </div>
                <div className="h-10 w-px bg-[#eae7df]" />
                <div>
                  <div className="font-mono text-[36px] font-bold">70%</div>
                  <div className="text-[12px] text-[#6b6b75]">Required</div>
                </div>
              </div>
            </section>

            {/* Case-by-case breakdown */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="border-b border-[#f0ede5] px-6 py-4">
                <h2 className="text-[14px] font-semibold">Case-by-Case Breakdown</h2>
              </div>
              <div className="divide-y divide-[#f0ede5]">
                {testCases.map((tc, i) => {
                  const yourVote = votes[i] ?? 0;
                  const diff = Math.abs(yourVote - tc.actualOutcome);
                  const inZone = diff <= 15;

                  return (
                    <div key={tc.id} className="flex items-center gap-4 px-6 py-4">
                      <div className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                        inZone ? "bg-[#ecfdf5] text-[#059669] border border-[#bbf7d0]" : "bg-[#fef2f2] text-[#dc2626] border border-[#fecaca]"
                      }`}>
                        {inZone ? "✓" : "✗"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold truncate">{tc.item}</span>
                          <span className="font-mono text-[11px] text-[#9a9aa3]">{tc.caseId}</span>
                        </div>
                        <div className="text-[11px] text-[#6b6b75] mt-0.5">{tc.reason}</div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0 text-right">
                        <div>
                          <div className="font-mono text-[13px]">You: <strong>{yourVote}%</strong></div>
                          <div className="font-mono text-[11px] text-[#6b6b75]">Actual: <strong>{tc.actualOutcome}%</strong></div>
                        </div>
                        <div className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          inZone ? "bg-[#ecfdf5] text-[#059669] border border-[#bbf7d0]" : "bg-[#fef2f2] text-[#dc2626] border border-[#fecaca]"
                        }`}>
                          {inZone ? `±${diff}` : `±${diff}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Actions */}
            <div className="flex items-center justify-center gap-3">
              {passed && (
                <Link
                  href="/demo/dispute/reviewer-dashboard"
                  className="inline-flex items-center gap-2 rounded-[10px] bg-[#059669] px-6 py-3 text-[14px] font-semibold text-white hover:bg-[#047857] transition-colors"
                >
                  Go to Reviewer Dashboard →
                </Link>
              )}
              <button
                onClick={startTest}
                className="inline-flex items-center gap-2 rounded-[10px] border border-[#eae7df] bg-white px-6 py-3 text-[14px] font-medium hover:border-[#111113] transition-colors"
              >
                {passed ? "Retake for practice" : "Try Again"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-10 pt-5 border-t border-[#eae7df] flex justify-between text-[12px] text-[#6b6b75] font-mono">
          <span>Haggle · Reviewer Qualification</span>
          <Link href="/demo/dispute/reviewer-dashboard" className="hover:text-[#111113] transition-colors">&larr; Back to dashboard</Link>
        </footer>
      </main>
    </div>
  );
}
