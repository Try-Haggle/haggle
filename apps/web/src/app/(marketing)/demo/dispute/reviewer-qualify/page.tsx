"use client";

import Link from "next/link";
import { useState } from "react";
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
    id: 1,
    caseId: "#DSP-1892",
    item: "iPhone 13 Pro",
    emoji: "📱",
    amount: "$420",
    reason: "Battery health discrepancy",
    buyerClaim: "Listing said 91% battery, received at 78%. 13% gap in 3 days of ownership.",
    sellerDefense:
      "Battery was 91% at listing. Buyer used phone heavily for 5 days before measuring.",
    evidence: ["Battery screenshot 78%", "Listing screenshot 91%", "EXIF dates match"],
    actualOutcome: 80,
    outcomeLabel: "80% to buyer · Strong consensus",
  },
  {
    id: 2,
    caseId: "#DSP-2103",
    item: "iPhone 14 Pro Max",
    emoji: "📱",
    amount: "$680",
    reason: "Battery health discrepancy",
    buyerClaim: "Listed at 96%, measured at 89%. 7% gap.",
    sellerDefense:
      "7% is within normal usage variance over 10 days. Apple states 1% per week under heavy use.",
    evidence: ["Battery screenshot 89%", "Listing 96%", "Apple support article on degradation"],
    actualOutcome: 30,
    outcomeLabel: "30% to buyer · Moderate consensus",
  },
  {
    id: 3,
    caseId: "#DSP-2201",
    item: "Louis Vuitton Neverfull MM",
    emoji: "👜",
    amount: "$1,200",
    reason: "Authenticity dispute",
    buyerClaim: "Stitching pattern inconsistent with authentic LV. Suspected counterfeit.",
    sellerDefense: "Purchased from LV store directly. Have receipt and dust bag.",
    evidence: ["Close-up photos of stitching", "Original receipt photo", "LegitApp: 94% authentic"],
    actualOutcome: 10,
    outcomeLabel: "10% to buyer · Strong consensus (seller wins)",
  },
  {
    id: 4,
    caseId: "#DSP-2245",
    item: "Nike Air Jordan 1 Retro High",
    emoji: "👟",
    amount: "$220",
    reason: "Item not as described",
    buyerClaim: "Listed as 'DS' (deadstock/new), but sole has visible yellowing and wear marks.",
    sellerDefense: "Yellowing is natural oxidation from storage, not wear. Shoes were never worn.",
    evidence: [
      "Sole photos showing yellowing",
      "Listing stated 'DS condition'",
      "Zoom on wear marks",
    ],
    actualOutcome: 65,
    outcomeLabel: "65% to buyer · Weak consensus",
  },
  {
    id: 5,
    caseId: "#DSP-2310",
    item: 'MacBook Pro M2 14"',
    emoji: "💻",
    amount: "$1,800",
    reason: "Functionality issue",
    buyerClaim: "Screen has 3 dead pixels. Not mentioned in listing.",
    sellerDefense: "Tested before shipping, no dead pixels. May have occurred during transit.",
    evidence: [
      "Photo of dead pixels on white screen",
      "Original listing 'excellent condition'",
      "Shipping insurance claim",
    ],
    actualOutcome: 75,
    outcomeLabel: "75% to buyer · Moderate consensus",
  },
  {
    id: 6,
    caseId: "#DSP-2388",
    item: "Sony WH-1000XM5",
    emoji: "🎧",
    amount: "$230",
    reason: "Item damaged in transit",
    buyerClaim: "Left ear cup cracked when received. Box was damaged too.",
    sellerDefense:
      "Packed with bubble wrap + original box. Carrier mishandled. Filed shipping claim.",
    evidence: ["Unboxing video showing damage", "Damaged box photo", "Carrier damage report"],
    actualOutcome: 90,
    outcomeLabel: "90% to buyer · Strong consensus",
  },
  {
    id: 7,
    caseId: "#DSP-2412",
    item: "Rolex Datejust 36",
    emoji: "⌚",
    amount: "$5,800",
    reason: "Authenticity + condition",
    buyerClaim: "Serial number doesn't match Rolex registry. Possible franken-watch (mixed parts).",
    sellerDefense:
      "Purchased from reputable dealer. Serial is from 2019 batch, may not be in public registry.",
    evidence: [
      "Serial number close-up",
      "LegitApp: 62% authentic (inconclusive)",
      "Dealer receipt",
    ],
    actualOutcome: 55,
    outcomeLabel: "55% to buyer · Weak consensus",
  },
  {
    id: 8,
    caseId: "#DSP-2445",
    item: "Galaxy S23 Ultra",
    emoji: "📱",
    amount: "$600",
    reason: "Battery health discrepancy",
    buyerClaim: "Listed 94%, received 85%. 9% gap.",
    sellerDefense:
      "Samsung doesn't show battery health natively. Buyer used third-party app which is unreliable.",
    evidence: [
      "AccuBattery screenshot 85%",
      "Listing stated 94%",
      "Samsung support: no native health metric",
    ],
    actualOutcome: 45,
    outcomeLabel: "45% to buyer · Weak consensus",
  },
  {
    id: 9,
    caseId: "#DSP-2501",
    item: "iPad Air M1",
    emoji: "📱",
    amount: "$420",
    reason: "Item not received",
    buyerClaim: "Tracking says delivered but I never received it. Package theft suspected.",
    sellerDefense: "Tracking confirms delivery to correct address. Signed by 'Front Door'.",
    evidence: [
      "Tracking screenshot: delivered",
      "Buyer's address confirmation",
      "No signature required",
    ],
    actualOutcome: 70,
    outcomeLabel: "70% to buyer · Moderate consensus",
  },
  {
    id: 10,
    caseId: "#DSP-2555",
    item: "Canon EOS R6 II",
    emoji: "📷",
    amount: "$1,900",
    reason: "Shutter count misrepresented",
    buyerClaim: "Listed as 'low shutter count ~5,000', actual shutter count is 42,000.",
    sellerDefense:
      "I estimated based on usage. Never claimed exact count. Listing said 'approximately'.",
    evidence: ["Shutter count tool: 42,187", "Listing: '~5,000 shutter count'", "Camera EXIF data"],
    actualOutcome: 85,
    outcomeLabel: "85% to buyer · Strong consensus",
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

  const buyerAmt = (
    (parseFloat(currentCase?.amount.replace(/[$,]/g, "") || "0") * currentVote) /
    100
  ).toFixed(0);
  const sellerAmt = (
    (parseFloat(currentCase?.amount.replace(/[$,]/g, "") || "0") * (100 - currentVote)) /
    100
  ).toFixed(0);

  return (
    <div className="min-h-screen bg-surface text-ink">
      <DisputeNav />

      <main className="mx-auto max-w-[760px] px-7 py-7">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2 font-mono text-[12px] text-ink-muted">
          <Link href="/demo/dispute/reviewer-dashboard" className="hover:text-ink">
            Reviewer Dashboard
          </Link>
          <span className="text-ink-muted">/</span>
          <span>Qualification Test</span>
        </div>

        {/* ── INTRO ── */}
        {phase === "intro" && (
          <div className="space-y-5">
            <section className="rounded-[14px] border border-line bg-surface-raised p-8 shadow-sm text-center">
              <div className="text-[48px] mb-4">⚖️</div>
              <h1 className="text-[26px] font-bold tracking-[-0.02em]">
                Reviewer Qualification Test
              </h1>
              <p className="mt-3 text-[15px] text-ink-secondary max-w-lg mx-auto leading-relaxed">
                Prove your judgment by reviewing 10 past dispute cases. Your votes are compared
                against the actual community decisions.
              </p>

              <div className="mt-8 grid grid-cols-3 gap-4 max-w-md mx-auto">
                <div className="rounded-xl border border-line bg-surface-sunken p-4">
                  <div className="font-mono text-[24px] font-bold">10</div>
                  <div className="text-[11px] text-ink-muted mt-1">Cases</div>
                </div>
                <div className="rounded-xl border border-line bg-surface-sunken p-4">
                  <div className="font-mono text-[24px] font-bold text-success">70%</div>
                  <div className="text-[11px] text-ink-muted mt-1">To pass</div>
                </div>
                <div className="rounded-xl border border-line bg-surface-sunken p-4">
                  <div className="font-mono text-[24px] font-bold">±15</div>
                  <div className="text-[11px] text-ink-muted mt-1">Zone tolerance</div>
                </div>
              </div>

              <div className="mt-8 rounded-xl border border-line bg-surface-sunken p-5 text-left max-w-lg mx-auto">
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-3">
                  How it works
                </div>
                <div className="space-y-2.5 text-[13px] text-ink-secondary">
                  <div className="flex gap-3">
                    <span className="font-mono text-info font-bold">1.</span> Read the dispute
                    summary — buyer&apos;s claim vs seller&apos;s defense
                  </div>
                  <div className="flex gap-3">
                    <span className="font-mono text-info font-bold">2.</span> Review the evidence
                    presented by both sides
                  </div>
                  <div className="flex gap-3">
                    <span className="font-mono text-info font-bold">3.</span> Use the slider to
                    vote: 0% = full seller win, 100% = full buyer win
                  </div>
                  <div className="flex gap-3">
                    <span className="font-mono text-info font-bold">4.</span> Your vote is compared
                    to the actual community result (±15% tolerance)
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-warning/30 bg-[color-mix(in_srgb,var(--fb-warning-bg)_50%,transparent)] p-4 text-left max-w-lg mx-auto">
                <div className="text-[13px] text-warning">
                  <strong>This is a learning experience.</strong> Even if you don&apos;t pass on the
                  first try, you&apos;ll learn how the community typically decides disputes — making
                  you a better reviewer.
                </div>
              </div>

              <button
                type="button"
                onClick={startTest}
                className="mt-8 inline-flex items-center gap-2 rounded-[10px] bg-ink px-6 py-3 text-[15px] font-semibold text-on-accent hover:opacity-90 transition-colors"
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
              <span className="font-mono text-[12px] text-ink-muted">
                Case {currentIdx + 1} of {totalCases}
              </span>
              <div className="flex gap-1.5">
                {testCases.map((tc, i) => (
                  <div
                    key={tc.id}
                    className={`h-2 w-6 rounded-full transition-colors ${
                      i < votes.length
                        ? "bg-success"
                        : i === currentIdx
                          ? "bg-ink"
                          : "bg-line-subtle"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Case card */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              {/* Header */}
              <div className="border-b border-line px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[24px]">{currentCase.emoji}</span>
                    <div>
                      <h2 className="text-[16px] font-semibold">{currentCase.item}</h2>
                      <span className="font-mono text-[12px] text-ink-muted">
                        {currentCase.caseId} · {currentCase.amount}
                      </span>
                    </div>
                  </div>
                  <span className="rounded-full border border-warning/30 bg-warning-soft px-2.5 py-0.5 font-mono text-[10px] font-semibold text-warning">
                    {currentCase.reason}
                  </span>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Buyer vs Seller */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border-l-[3px] border-info border-r border-t border-b border-r-line border-t-line border-b-line bg-gradient-to-r from-info-soft to-surface-sunken p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-info font-semibold mb-2">
                      Buyer&apos;s Claim
                    </div>
                    <p className="text-[13px] text-ink-secondary leading-relaxed">
                      {currentCase.buyerClaim}
                    </p>
                  </div>
                  <div className="rounded-xl border-l-[3px] border-badge-text border-r border-t border-b border-r-line border-t-line border-b-line bg-gradient-to-r from-badge to-surface-sunken p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-badge-text font-semibold mb-2">
                      Seller&apos;s Defense
                    </div>
                    <p className="text-[13px] text-ink-secondary leading-relaxed">
                      {currentCase.sellerDefense}
                    </p>
                  </div>
                </div>

                {/* Evidence */}
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-2">
                    Evidence
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {currentCase.evidence.map((e, i) => (
                      <span
                        key={e}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-[12px] text-ink-secondary"
                      >
                        <span className="text-ink-muted">
                          {i === 0 ? "📸" : i === 1 ? "📸" : "📝"}
                        </span>
                        {e}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Vote slider */}
                <div className="rounded-xl border border-ink bg-surface-raised p-5">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted font-semibold mb-1">
                    Your Vote
                  </div>
                  <div className="text-[13px] text-ink-secondary mb-4">
                    What percentage should go to the buyer?
                  </div>

                  <div className="relative mb-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={currentVote}
                      onChange={(e) => setCurrentVote(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, var(--badge-bg) ${currentVote}%, var(--fb-info-bg) ${currentVote}%)`,
                        accentColor: "var(--text-primary)",
                      }}
                    />
                    <div className="flex justify-between mt-1 font-mono text-[10px] text-ink-muted">
                      <span>0% Seller wins</span>
                      <span>100% Buyer wins</span>
                    </div>
                  </div>

                  {/* Quick buttons */}
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {[0, 25, 50, 75, 100].map((v) => (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setCurrentVote(v)}
                        className={`rounded-lg border px-3 py-1.5 font-mono text-[12px] font-semibold transition-all ${
                          currentVote === v
                            ? "border-ink bg-ink text-on-accent"
                            : "border-line bg-surface-raised text-ink-muted hover:border-ink hover:text-ink"
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>

                  {/* Live calculation */}
                  <div className="flex items-center justify-between rounded-lg border border-line bg-surface-sunken p-3">
                    <span className="text-[13px]">
                      Your vote: <strong className="font-mono">{currentVote}%</strong> to buyer
                    </span>
                    <span className="font-mono text-[12px] text-ink-muted">
                      Buyer ${buyerAmt} · Seller ${sellerAmt}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={submitVote}
                    className="mt-4 w-full rounded-[10px] bg-ink px-4 py-3 text-[14px] font-semibold text-on-accent hover:opacity-90 transition-colors"
                  >
                    {currentIdx < totalCases - 1
                      ? `Submit & Next (${currentIdx + 2}/${totalCases})`
                      : "Submit & See Results"}
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
            <section
              className={`rounded-[14px] border-2 bg-surface-raised p-8 shadow-sm text-center ${
                passed ? "border-success" : conditional ? "border-warning" : "border-error"
              }`}
            >
              <div className="text-[48px] mb-3">{passed ? "🎉" : conditional ? "📘" : "🔄"}</div>
              <h1 className="text-[26px] font-bold tracking-[-0.02em]">
                {passed ? "Qualified!" : conditional ? "Conditional Pass" : "Not Yet — Try Again"}
              </h1>
              <p className="mt-2 text-[15px] text-ink-secondary">
                {passed &&
                  "You demonstrated strong alignment with community decisions. Welcome to the reviewer panel!"}
                {conditional &&
                  "You're close! Complete the training module below to earn your qualification."}
                {!passed &&
                  !conditional &&
                  "Your votes differed significantly from community consensus. Review the cases below and try again in 24 hours."}
              </p>

              <div className="mt-6 inline-flex items-center gap-6 rounded-xl border border-line bg-surface-sunken px-8 py-4">
                <div>
                  <div
                    className={`font-mono text-[36px] font-bold ${passed ? "text-success" : conditional ? "text-warning" : "text-error"}`}
                  >
                    {matchRate}%
                  </div>
                  <div className="text-[12px] text-ink-muted">Match rate</div>
                </div>
                <div className="h-10 w-px bg-line" />
                <div>
                  <div className="font-mono text-[36px] font-bold">
                    {matches}/{totalCases}
                  </div>
                  <div className="text-[12px] text-ink-muted">Within zone</div>
                </div>
                <div className="h-10 w-px bg-line" />
                <div>
                  <div className="font-mono text-[36px] font-bold">70%</div>
                  <div className="text-[12px] text-ink-muted">Required</div>
                </div>
              </div>
            </section>

            {/* Case-by-case breakdown */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="border-b border-line px-6 py-4">
                <h2 className="text-[14px] font-semibold">Case-by-Case Breakdown</h2>
              </div>
              <div className="divide-y divide-line">
                {testCases.map((tc, i) => {
                  const yourVote = votes[i] ?? 0;
                  const diff = Math.abs(yourVote - tc.actualOutcome);
                  const inZone = diff <= 15;

                  return (
                    <div key={tc.id} className="flex items-center gap-4 px-6 py-4">
                      <div
                        className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                          inZone
                            ? "bg-success-soft text-success border border-success/30"
                            : "bg-error-soft text-error border border-error/30"
                        }`}
                      >
                        {inZone ? "✓" : "✗"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold truncate">{tc.item}</span>
                          <span className="font-mono text-[11px] text-ink-muted">{tc.caseId}</span>
                        </div>
                        <div className="text-[11px] text-ink-muted mt-0.5">{tc.reason}</div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0 text-right">
                        <div>
                          <div className="font-mono text-[13px]">
                            You: <strong>{yourVote}%</strong>
                          </div>
                          <div className="font-mono text-[11px] text-ink-muted">
                            Actual: <strong>{tc.actualOutcome}%</strong>
                          </div>
                        </div>
                        <div
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            inZone
                              ? "bg-success-soft text-success border border-success/30"
                              : "bg-error-soft text-error border border-error/30"
                          }`}
                        >
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
                  className="inline-flex items-center gap-2 rounded-[10px] bg-success px-6 py-3 text-[14px] font-semibold text-on-accent hover:opacity-90 transition-colors"
                >
                  Go to Reviewer Dashboard →
                </Link>
              )}
              <button
                type="button"
                onClick={startTest}
                className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface-raised px-6 py-3 text-[14px] font-medium hover:border-ink transition-colors"
              >
                {passed ? "Retake for practice" : "Try Again"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-10 pt-5 border-t border-line flex justify-between text-[12px] text-ink-muted font-mono">
          <span>Haggle · Reviewer Qualification</span>
          <Link
            href="/demo/dispute/reviewer-dashboard"
            className="hover:text-ink transition-colors"
          >
            &larr; Back to dashboard
          </Link>
        </footer>
      </main>
    </div>
  );
}
