"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────
interface QualifyCase {
  id: number;
  case_id: string;
  item: string;
  amount: string;
  reason: string;
  buyer_claim: string;
  seller_defense: string;
  evidence: string[];
}

interface QualifyResponse {
  passed: boolean;
  conditional: boolean;
  match_rate: number;
  matches: number;
  total: number;
  required_rate: number;
  case_results: CaseResult[];
}

interface CaseResult {
  case_id: string;
  item: string;
  reason: string;
  your_vote: number;
  actual_outcome: number;
  diff: number;
  in_zone: boolean;
}

// ─── Static test cases (fallback if API doesn't serve them) ──
const DEFAULT_CASES: QualifyCase[] = [
  {
    id: 1, case_id: "#DSP-1892", item: "iPhone 13 Pro", amount: "$420",
    reason: "Battery health discrepancy",
    buyer_claim: "Listing said 91% battery, received at 78%. 13% gap in 3 days of ownership.",
    seller_defense: "Battery was 91% at listing. Buyer used phone heavily for 5 days before measuring.",
    evidence: ["Battery screenshot 78%", "Listing screenshot 91%", "EXIF dates match"],
  },
  {
    id: 2, case_id: "#DSP-2103", item: "iPhone 14 Pro Max", amount: "$680",
    reason: "Battery health discrepancy",
    buyer_claim: "Listed at 96%, measured at 89%. 7% gap.",
    seller_defense: "7% is within normal usage variance over 10 days. Apple states 1% per week under heavy use.",
    evidence: ["Battery screenshot 89%", "Listing 96%", "Apple support article on degradation"],
  },
  {
    id: 3, case_id: "#DSP-2201", item: "Louis Vuitton Neverfull MM", amount: "$1,200",
    reason: "Authenticity dispute",
    buyer_claim: "Stitching pattern inconsistent with authentic LV. Suspected counterfeit.",
    seller_defense: "Purchased from LV store directly. Have receipt and dust bag.",
    evidence: ["Close-up photos of stitching", "Original receipt photo", "LegitApp: 94% authentic"],
  },
  {
    id: 4, case_id: "#DSP-2245", item: "Nike Air Jordan 1 Retro High", amount: "$220",
    reason: "Item not as described",
    buyer_claim: "Listed as 'DS' (deadstock/new), but sole has visible yellowing and wear marks.",
    seller_defense: "Yellowing is natural oxidation from storage, not wear. Shoes were never worn.",
    evidence: ["Sole photos showing yellowing", "Listing stated 'DS condition'", "Zoom on wear marks"],
  },
  {
    id: 5, case_id: "#DSP-2310", item: "MacBook Pro M2 14\"", amount: "$1,800",
    reason: "Functionality issue",
    buyer_claim: "Screen has 3 dead pixels. Not mentioned in listing.",
    seller_defense: "Tested before shipping, no dead pixels. May have occurred during transit.",
    evidence: ["Photo of dead pixels on white screen", "Original listing 'excellent condition'", "Shipping insurance claim"],
  },
  {
    id: 6, case_id: "#DSP-2388", item: "Sony WH-1000XM5", amount: "$230",
    reason: "Item damaged in transit",
    buyer_claim: "Left ear cup cracked when received. Box was damaged too.",
    seller_defense: "Packed with bubble wrap + original box. Carrier mishandled. Filed shipping claim.",
    evidence: ["Unboxing video showing damage", "Damaged box photo", "Carrier damage report"],
  },
  {
    id: 7, case_id: "#DSP-2412", item: "Rolex Datejust 36", amount: "$5,800",
    reason: "Authenticity + condition",
    buyer_claim: "Serial number doesn't match Rolex registry. Possible franken-watch (mixed parts).",
    seller_defense: "Purchased from reputable dealer. Serial is from 2019 batch, may not be in public registry.",
    evidence: ["Serial number close-up", "LegitApp: 62% authentic (inconclusive)", "Dealer receipt"],
  },
  {
    id: 8, case_id: "#DSP-2445", item: "Galaxy S23 Ultra", amount: "$600",
    reason: "Battery health discrepancy",
    buyer_claim: "Listed 94%, received 85%. 9% gap.",
    seller_defense: "Samsung doesn't show battery health natively. Buyer used third-party app which is unreliable.",
    evidence: ["AccuBattery screenshot 85%", "Listing stated 94%", "Samsung support: no native health metric"],
  },
  {
    id: 9, case_id: "#DSP-2501", item: "iPad Air M1", amount: "$420",
    reason: "Item not received",
    buyer_claim: "Tracking says delivered but I never received it. Package theft suspected.",
    seller_defense: "Tracking confirms delivery to correct address. Signed by 'Front Door'.",
    evidence: ["Tracking screenshot: delivered", "Buyer's address confirmation", "No signature required"],
  },
  {
    id: 10, case_id: "#DSP-2555", item: "Canon EOS R6 II", amount: "$1,900",
    reason: "Shutter count misrepresented",
    buyer_claim: "Listed as 'low shutter count ~5,000', actual shutter count is 42,000.",
    seller_defense: "I estimated based on usage. Never claimed exact count. Listing said 'approximately'.",
    evidence: ["Shutter count tool: 42,187", "Listing: '~5,000 shutter count'", "Camera EXIF data"],
  },
];

type Phase = "intro" | "test" | "submitting" | "result";

// ─── Main Page ───────────────────────────────────────────────
export default function ReviewerQualifyPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [cases] = useState<QualifyCase[]>(DEFAULT_CASES);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [votes, setVotes] = useState<number[]>([]);
  const [currentVote, setCurrentVote] = useState(50);
  const [result, setResult] = useState<QualifyResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const currentCase = cases[currentIdx];
  const totalCases = cases.length;

  function startTest() {
    setPhase("test");
    setCurrentIdx(0);
    setVotes([]);
    setCurrentVote(50);
    setResult(null);
    setSubmitError(null);
  }

  const submitAllVotes = useCallback(async (allVotes: number[]) => {
    setPhase("submitting");
    setSubmitError(null);
    try {
      const response = await api.post<QualifyResponse>("/reviewer/qualify", {
        votes: allVotes.map((v, i) => ({
          case_id: cases[i].case_id,
          vote_pct: v,
        })),
      });
      setResult(response);
      setPhase("result");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit qualification");
      setPhase("result");
    }
  }, [cases]);

  function submitVote() {
    const newVotes = [...votes, currentVote];
    setVotes(newVotes);

    if (currentIdx < totalCases - 1) {
      setCurrentIdx(currentIdx + 1);
      setCurrentVote(50);
    } else {
      // All done, submit to API
      submitAllVotes(newVotes);
    }
  }

  const amt = parseFloat(currentCase?.amount.replace(/[$,]/g, "") || "0");
  const buyerAmt = (amt * currentVote / 100).toFixed(0);
  const sellerAmt = (amt * (100 - currentVote) / 100).toFixed(0);

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 font-mono text-xs text-slate-500">
        <Link href="/reviewer" className="hover:text-white transition-colors">Reviewer Dashboard</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-400">Qualification Test</span>
      </div>

      {/* ── INTRO ── */}
      {phase === "intro" && (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
            <div className="text-5xl mb-4">&#x2696;&#xFE0F;</div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Reviewer Qualification Test</h1>
            <p className="mt-3 text-sm text-slate-400 max-w-lg mx-auto leading-relaxed">
              Prove your judgment by reviewing 10 past dispute cases. Your votes are compared against actual community decisions.
            </p>

            <div className="mt-8 grid grid-cols-3 gap-4 max-w-sm mx-auto">
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="font-mono text-2xl font-bold text-white">10</div>
                <div className="text-[11px] text-slate-500 mt-1">Cases</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="font-mono text-2xl font-bold text-emerald-400">70%</div>
                <div className="text-[11px] text-slate-500 mt-1">To pass</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="font-mono text-2xl font-bold text-white">&plusmn;15</div>
                <div className="text-[11px] text-slate-500 mt-1">Tolerance</div>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900/50 p-5 text-left max-w-lg mx-auto">
              <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 mb-3">How it works</div>
              <div className="space-y-2.5 text-sm text-slate-400">
                <div className="flex gap-3">
                  <span className="font-mono text-cyan-400 font-bold">1.</span>
                  Read the dispute summary: buyer claim vs seller defense
                </div>
                <div className="flex gap-3">
                  <span className="font-mono text-cyan-400 font-bold">2.</span>
                  Review the evidence presented by both sides
                </div>
                <div className="flex gap-3">
                  <span className="font-mono text-cyan-400 font-bold">3.</span>
                  Use the slider to vote: 0% = seller wins, 100% = buyer wins
                </div>
                <div className="flex gap-3">
                  <span className="font-mono text-cyan-400 font-bold">4.</span>
                  Your vote is compared to the actual community result (&plusmn;15% tolerance)
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left max-w-lg mx-auto">
              <div className="text-sm text-amber-300/80">
                <strong className="text-amber-400">This is a learning experience.</strong>{" "}
                Even if you don&apos;t pass on the first try, you&apos;ll learn how the community typically decides disputes.
              </div>
            </div>

            <button
              onClick={startTest}
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-600 transition-colors"
            >
              Start Qualification Test
            </button>
          </section>
        </div>
      )}

      {/* ── TEST ── */}
      {phase === "test" && currentCase && (
        <div className="space-y-5">
          {/* Progress */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-500">Case {currentIdx + 1} of {totalCases}</span>
            <div className="flex gap-1.5">
              {cases.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 w-6 rounded-full transition-colors ${
                    i < votes.length ? "bg-emerald-500" : i === currentIdx ? "bg-white" : "bg-slate-700"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Case card */}
          <section className="rounded-xl border border-slate-700 bg-slate-800/50">
            {/* Header */}
            <div className="border-b border-slate-700 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">{currentCase.item}</h2>
                  <span className="font-mono text-xs text-slate-500">{currentCase.case_id} · {currentCase.amount}</span>
                </div>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-amber-400">
                  {currentCase.reason}
                </span>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Buyer vs Seller */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-cyan-500/20 border-l-[3px] border-l-cyan-500 bg-cyan-500/5 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-2">
                    Buyer&apos;s Claim
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{currentCase.buyer_claim}</p>
                </div>
                <div className="rounded-xl border border-violet-500/20 border-l-[3px] border-l-violet-500 bg-violet-500/5 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-violet-400 font-semibold mb-2">
                    Seller&apos;s Defense
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{currentCase.seller_defense}</p>
                </div>
              </div>

              {/* Evidence */}
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Evidence</div>
                <div className="flex flex-wrap gap-2">
                  {currentCase.evidence.map((e, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-400"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>

              {/* Vote slider */}
              <div className="rounded-xl border-2 border-slate-600 bg-slate-800/50 p-5">
                <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">Your Vote</div>
                <div className="text-sm text-slate-400 mb-4">What percentage should go to the buyer?</div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={currentVote}
                  onChange={(e) => setCurrentVote(Number(e.target.value))}
                  className="w-full accent-cyan-500"
                  aria-label="Refund percentage to buyer"
                />
                <div className="flex justify-between mt-1 font-mono text-[10px] text-slate-600">
                  <span>0% Seller wins</span>
                  <span>100% Buyer wins</span>
                </div>

                {/* Quick buttons */}
                <div className="flex gap-2 mt-4 mb-4 flex-wrap">
                  {[0, 25, 50, 75, 100].map((v) => (
                    <button
                      key={v}
                      onClick={() => setCurrentVote(v)}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-all ${
                        currentVote === v
                          ? "border-cyan-500 bg-cyan-500 text-white"
                          : "border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600 hover:text-white"
                      }`}
                    >
                      {v}%
                    </button>
                  ))}
                </div>

                {/* Live calculation */}
                <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/50 p-3">
                  <span className="text-sm text-slate-400">
                    Your vote: <strong className="font-mono text-white">{currentVote}%</strong> to buyer
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    Buyer ${buyerAmt} &middot; Seller ${sellerAmt}
                  </span>
                </div>

                <button
                  onClick={submitVote}
                  className="mt-4 w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-600 transition-colors"
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

      {/* ── SUBMITTING ── */}
      {phase === "submitting" && (
        <div className="flex items-center justify-center py-20">
          <div className="text-slate-400 text-sm animate-pulse">Evaluating your responses...</div>
        </div>
      )}

      {/* ── RESULT ── */}
      {phase === "result" && (
        <div className="space-y-5">
          {submitError && !result && (
            <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
              <div className="text-5xl mb-3">&#x26A0;&#xFE0F;</div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Submission Failed</h1>
              <p className="mt-2 text-sm text-red-400">{submitError}</p>
              <button
                onClick={startTest}
                className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-sm font-medium text-white hover:border-slate-600 transition-colors"
              >
                Try Again
              </button>
            </section>
          )}

          {result && (
            <>
              {/* Score card */}
              <section className={`rounded-xl border-2 bg-slate-800/50 p-8 text-center ${
                result.passed
                  ? "border-emerald-500/50"
                  : result.conditional
                    ? "border-amber-500/50"
                    : "border-red-500/50"
              }`}>
                <div className="text-5xl mb-3">
                  {result.passed ? "&#x1F389;" : result.conditional ? "&#x1F4D8;" : "&#x1F504;"}
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  {result.passed ? "Qualified!" : result.conditional ? "Conditional Pass" : "Not Yet"}
                </h1>
                <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
                  {result.passed && "You demonstrated strong alignment with community decisions. Welcome to the reviewer panel!"}
                  {result.conditional && "You're close! Complete the training module to earn your qualification."}
                  {!result.passed && !result.conditional && "Your votes differed from community consensus. Review the cases below and try again."}
                </p>

                <div className="mt-6 inline-flex items-center gap-6 rounded-xl border border-slate-700 bg-slate-900/50 px-8 py-4">
                  <div>
                    <div className={`font-mono text-3xl font-bold ${
                      result.passed ? "text-emerald-400" : result.conditional ? "text-amber-400" : "text-red-400"
                    }`}>
                      {result.match_rate}%
                    </div>
                    <div className="text-xs text-slate-500">Match rate</div>
                  </div>
                  <div className="h-10 w-px bg-slate-700" />
                  <div>
                    <div className="font-mono text-3xl font-bold text-white">{result.matches}/{result.total}</div>
                    <div className="text-xs text-slate-500">Within zone</div>
                  </div>
                  <div className="h-10 w-px bg-slate-700" />
                  <div>
                    <div className="font-mono text-3xl font-bold text-white">{result.required_rate}%</div>
                    <div className="text-xs text-slate-500">Required</div>
                  </div>
                </div>
              </section>

              {/* Case-by-case breakdown */}
              <section className="rounded-xl border border-slate-700 bg-slate-800/50">
                <div className="border-b border-slate-700 px-6 py-4">
                  <h2 className="text-sm font-semibold text-white">Case-by-Case Breakdown</h2>
                </div>
                <div className="divide-y divide-slate-700">
                  {result.case_results.map((cr) => (
                    <div key={cr.case_id} className="flex items-center gap-4 px-6 py-4">
                      <div className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${
                        cr.in_zone
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-red-500/20 text-red-400 border border-red-500/30"
                      }`}>
                        {cr.in_zone ? "&#10003;" : "&#10007;"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white truncate">{cr.item}</span>
                          <span className="font-mono text-[11px] text-slate-600">{cr.case_id}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{cr.reason}</div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0 text-right">
                        <div>
                          <div className="font-mono text-sm text-slate-300">You: <strong>{cr.your_vote}%</strong></div>
                          <div className="font-mono text-[11px] text-slate-500">Actual: <strong>{cr.actual_outcome}%</strong></div>
                        </div>
                        <div className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          cr.in_zone
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-red-500/20 text-red-400 border border-red-500/30"
                        }`}>
                          &plusmn;{cr.diff}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Actions */}
              <div className="flex items-center justify-center gap-3">
                {result.passed && (
                  <Link
                    href="/reviewer"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors"
                  >
                    Go to Dashboard
                  </Link>
                )}
                <button
                  onClick={startTest}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-sm font-medium text-white hover:border-slate-600 transition-colors"
                >
                  {result.passed ? "Retake for practice" : "Try Again"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
