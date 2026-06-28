"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Badge, Button, buttonVariants, PositionPanel, Spinner, VoteSlider } from "@/components/ui";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";

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
    id: 1,
    case_id: "#DSP-1892",
    item: "iPhone 13 Pro",
    amount: "$420",
    reason: "Battery health discrepancy",
    buyer_claim: "Listing said 91% battery, received at 78%. 13% gap in 3 days of ownership.",
    seller_defense:
      "Battery was 91% at listing. Buyer used phone heavily for 5 days before measuring.",
    evidence: ["Battery screenshot 78%", "Listing screenshot 91%", "EXIF dates match"],
  },
  {
    id: 2,
    case_id: "#DSP-2103",
    item: "iPhone 14 Pro Max",
    amount: "$680",
    reason: "Battery health discrepancy",
    buyer_claim: "Listed at 96%, measured at 89%. 7% gap.",
    seller_defense:
      "7% is within normal usage variance over 10 days. Apple states 1% per week under heavy use.",
    evidence: ["Battery screenshot 89%", "Listing 96%", "Apple support article on degradation"],
  },
  {
    id: 3,
    case_id: "#DSP-2201",
    item: "Louis Vuitton Neverfull MM",
    amount: "$1,200",
    reason: "Authenticity dispute",
    buyer_claim: "Stitching pattern inconsistent with authentic LV. Suspected counterfeit.",
    seller_defense: "Purchased from LV store directly. Have receipt and dust bag.",
    evidence: ["Close-up photos of stitching", "Original receipt photo", "LegitApp: 94% authentic"],
  },
  {
    id: 4,
    case_id: "#DSP-2245",
    item: "Nike Air Jordan 1 Retro High",
    amount: "$220",
    reason: "Item not as described",
    buyer_claim: "Listed as 'DS' (deadstock/new), but sole has visible yellowing and wear marks.",
    seller_defense: "Yellowing is natural oxidation from storage, not wear. Shoes were never worn.",
    evidence: [
      "Sole photos showing yellowing",
      "Listing stated 'DS condition'",
      "Zoom on wear marks",
    ],
  },
  {
    id: 5,
    case_id: "#DSP-2310",
    item: 'MacBook Pro M2 14"',
    amount: "$1,800",
    reason: "Functionality issue",
    buyer_claim: "Screen has 3 dead pixels. Not mentioned in listing.",
    seller_defense: "Tested before shipping, no dead pixels. May have occurred during transit.",
    evidence: [
      "Photo of dead pixels on white screen",
      "Original listing 'excellent condition'",
      "Shipping insurance claim",
    ],
  },
  {
    id: 6,
    case_id: "#DSP-2388",
    item: "Sony WH-1000XM5",
    amount: "$230",
    reason: "Item damaged in transit",
    buyer_claim: "Left ear cup cracked when received. Box was damaged too.",
    seller_defense:
      "Packed with bubble wrap + original box. Carrier mishandled. Filed shipping claim.",
    evidence: ["Unboxing video showing damage", "Damaged box photo", "Carrier damage report"],
  },
  {
    id: 7,
    case_id: "#DSP-2412",
    item: "Rolex Datejust 36",
    amount: "$5,800",
    reason: "Authenticity + condition",
    buyer_claim:
      "Serial number doesn't match Rolex registry. Possible franken-watch (mixed parts).",
    seller_defense:
      "Purchased from reputable dealer. Serial is from 2019 batch, may not be in public registry.",
    evidence: [
      "Serial number close-up",
      "LegitApp: 62% authentic (inconclusive)",
      "Dealer receipt",
    ],
  },
  {
    id: 8,
    case_id: "#DSP-2445",
    item: "Galaxy S23 Ultra",
    amount: "$600",
    reason: "Battery health discrepancy",
    buyer_claim: "Listed 94%, received 85%. 9% gap.",
    seller_defense:
      "Samsung doesn't show battery health natively. Buyer used third-party app which is unreliable.",
    evidence: [
      "AccuBattery screenshot 85%",
      "Listing stated 94%",
      "Samsung support: no native health metric",
    ],
  },
  {
    id: 9,
    case_id: "#DSP-2501",
    item: "iPad Air M1",
    amount: "$420",
    reason: "Item not received",
    buyer_claim: "Tracking says delivered but I never received it. Package theft suspected.",
    seller_defense: "Tracking confirms delivery to correct address. Signed by 'Front Door'.",
    evidence: [
      "Tracking screenshot: delivered",
      "Buyer's address confirmation",
      "No signature required",
    ],
  },
  {
    id: 10,
    case_id: "#DSP-2555",
    item: "Canon EOS R6 II",
    amount: "$1,900",
    reason: "Shutter count misrepresented",
    buyer_claim: "Listed as 'low shutter count ~5,000', actual shutter count is 42,000.",
    seller_defense:
      "I estimated based on usage. Never claimed exact count. Listing said 'approximately'.",
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

  const submitAllVotes = useCallback(
    async (allVotes: number[]) => {
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
    },
    [cases],
  );

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

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 font-mono text-xs text-ink-muted">
        <Link href="/reviewer" className="hover:text-ink transition-colors">
          Reviewer Dashboard
        </Link>
        <span className="text-ink-muted">/</span>
        <span className="text-ink-secondary">Qualification Test</span>
      </div>

      {/* ── INTRO ── */}
      {phase === "intro" && (
        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-surface-sunken/50 p-8 text-center">
            <div className="text-5xl mb-4">&#x2696;&#xFE0F;</div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">
              Reviewer Qualification Test
            </h1>
            <p className="mt-3 text-sm text-ink-secondary max-w-lg mx-auto leading-relaxed">
              Prove your judgment by reviewing 10 past dispute cases. Your votes are compared
              against actual community decisions.
            </p>

            <div className="mt-8 grid grid-cols-3 gap-4 max-w-sm mx-auto">
              <div className="rounded-xl border border-line bg-surface-sunken/50 p-4">
                <div className="font-mono text-2xl font-bold text-ink">10</div>
                <div className="text-[11px] text-ink-muted mt-1">Cases</div>
              </div>
              <div className="rounded-xl border border-line bg-surface-sunken/50 p-4">
                <div className="font-mono text-2xl font-bold text-success">70%</div>
                <div className="text-[11px] text-ink-muted mt-1">To pass</div>
              </div>
              <div className="rounded-xl border border-line bg-surface-sunken/50 p-4">
                <div className="font-mono text-2xl font-bold text-ink">&plusmn;15</div>
                <div className="text-[11px] text-ink-muted mt-1">Tolerance</div>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-line bg-surface-sunken/50 p-5 text-left max-w-lg mx-auto">
              <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted mb-3">
                How it works
              </div>
              <div className="space-y-2.5 text-sm text-ink-secondary">
                <div className="flex gap-3">
                  <span className="font-mono text-action-primary font-bold">1.</span>
                  Read the dispute summary: buyer claim vs seller defense
                </div>
                <div className="flex gap-3">
                  <span className="font-mono text-action-primary font-bold">2.</span>
                  Review the evidence presented by both sides
                </div>
                <div className="flex gap-3">
                  <span className="font-mono text-action-primary font-bold">3.</span>
                  Use the slider to vote: 0% = seller wins, 100% = buyer wins
                </div>
                <div className="flex gap-3">
                  <span className="font-mono text-action-primary font-bold">4.</span>
                  Your vote is compared to the actual community result (&plusmn;15% tolerance)
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-warning/30 bg-warning-soft p-4 text-left max-w-lg mx-auto">
              <div className="text-sm text-warning/80">
                <strong className="text-warning">This is a learning experience.</strong> Even if you
                don&apos;t pass on the first try, you&apos;ll learn how the community typically
                decides disputes.
              </div>
            </div>

            <Button size="lg" onClick={startTest} className="mt-8">
              Start Qualification Test
            </Button>
          </section>
        </div>
      )}

      {/* ── TEST ── */}
      {phase === "test" && currentCase && (
        <div className="space-y-5">
          {/* Progress */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-ink-muted">
              Case {currentIdx + 1} of {totalCases}
            </span>
            <div className="flex gap-1.5">
              {cases.map((c, i) => (
                <div
                  key={c.case_id}
                  className={`h-2 w-6 rounded-full transition-colors ${
                    i < votes.length
                      ? "bg-success"
                      : i === currentIdx
                        ? "bg-action-primary"
                        : "bg-line"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Case card */}
          <section className="rounded-xl border border-line bg-surface-sunken/50">
            {/* Header */}
            <div className="border-b border-line px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-ink">{currentCase.item}</h2>
                  <span className="font-mono text-xs text-ink-muted">
                    {currentCase.case_id} · {currentCase.amount}
                  </span>
                </div>
                <Badge tone="warning" size="sm" className="font-mono">
                  {currentCase.reason}
                </Badge>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Buyer vs Seller */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PositionPanel side="buyer" label="Buyer's Claim">
                  {currentCase.buyer_claim}
                </PositionPanel>
                <PositionPanel side="seller" label="Seller's Defense">
                  {currentCase.seller_defense}
                </PositionPanel>
              </div>

              {/* Evidence */}
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink-muted font-semibold mb-2">
                  Evidence
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentCase.evidence.map((e) => (
                    <Badge key={e} tone="neutral" size="md" className="font-normal">
                      {e}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Vote slider */}
              <div className="rounded-xl border-2 border-line-strong bg-surface-sunken/50 p-5">
                <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted font-semibold mb-1">
                  Your Vote
                </div>
                <div className="text-sm text-ink-secondary mb-4">
                  What percentage should go to the buyer?
                </div>

                <VoteSlider
                  value={currentVote}
                  onChange={setCurrentVote}
                  amount={amt}
                  buyerLabel="Buyer"
                  sellerLabel="Seller"
                />

                <Button fullWidth onClick={submitVote} className="mt-4">
                  {currentIdx < totalCases - 1
                    ? `Submit & Next (${currentIdx + 2}/${totalCases})`
                    : "Submit & See Results"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── SUBMITTING ── */}
      {phase === "submitting" && (
        <div className="flex items-center justify-center gap-2 py-20 text-ink-secondary text-sm">
          <Spinner size="sm" />
          Evaluating your responses...
        </div>
      )}

      {/* ── RESULT ── */}
      {phase === "result" && (
        <div className="space-y-5">
          {submitError && !result && (
            <section className="rounded-xl border border-error/30 bg-error-soft p-8 text-center">
              <div className="text-5xl mb-3">&#x26A0;&#xFE0F;</div>
              <h1 className="text-2xl font-bold text-ink tracking-tight">Submission Failed</h1>
              <p className="mt-2 text-sm text-error">{submitError}</p>
              <Button variant="secondary" size="lg" onClick={startTest} className="mt-6">
                Try Again
              </Button>
            </section>
          )}

          {result && (
            <>
              {/* Score card */}
              <section
                className={`rounded-xl border-2 bg-surface-sunken/50 p-8 text-center ${
                  result.passed
                    ? "border-success/50"
                    : result.conditional
                      ? "border-warning/50"
                      : "border-error/50"
                }`}
              >
                <div className="text-5xl mb-3">
                  {result.passed ? "&#x1F389;" : result.conditional ? "&#x1F4D8;" : "&#x1F504;"}
                </div>
                <h1 className="text-2xl font-bold text-ink tracking-tight">
                  {result.passed
                    ? "Qualified!"
                    : result.conditional
                      ? "Conditional Pass"
                      : "Not Yet"}
                </h1>
                <p className="mt-2 text-sm text-ink-secondary max-w-md mx-auto">
                  {result.passed &&
                    "You demonstrated strong alignment with community decisions. Welcome to the reviewer panel!"}
                  {result.conditional &&
                    "You're close! Complete the training module to earn your qualification."}
                  {!result.passed &&
                    !result.conditional &&
                    "Your votes differed from community consensus. Review the cases below and try again."}
                </p>

                <div className="mt-6 inline-flex items-center gap-6 rounded-xl border border-line bg-surface-sunken/50 px-8 py-4">
                  <div>
                    <div
                      className={`font-mono text-3xl font-bold ${
                        result.passed
                          ? "text-success"
                          : result.conditional
                            ? "text-warning"
                            : "text-error"
                      }`}
                    >
                      {result.match_rate}%
                    </div>
                    <div className="text-xs text-ink-muted">Match rate</div>
                  </div>
                  <div className="h-10 w-px bg-line" />
                  <div>
                    <div className="font-mono text-3xl font-bold text-ink">
                      {result.matches}/{result.total}
                    </div>
                    <div className="text-xs text-ink-muted">Within zone</div>
                  </div>
                  <div className="h-10 w-px bg-line" />
                  <div>
                    <div className="font-mono text-3xl font-bold text-ink">
                      {result.required_rate}%
                    </div>
                    <div className="text-xs text-ink-muted">Required</div>
                  </div>
                </div>
              </section>

              {/* Case-by-case breakdown */}
              <section className="rounded-xl border border-line bg-surface-sunken/50">
                <div className="border-b border-line px-6 py-4">
                  <h2 className="text-sm font-semibold text-ink">Case-by-Case Breakdown</h2>
                </div>
                <div className="divide-y divide-line">
                  {result.case_results.map((cr) => (
                    <div key={cr.case_id} className="flex items-center gap-4 px-6 py-4">
                      <div
                        className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${
                          cr.in_zone
                            ? "bg-success-soft text-success border border-success/30"
                            : "bg-error-soft text-error border border-error/30"
                        }`}
                      >
                        {cr.in_zone ? "&#10003;" : "&#10007;"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink truncate">{cr.item}</span>
                          <span className="font-mono text-[11px] text-ink-muted">{cr.case_id}</span>
                        </div>
                        <div className="text-[11px] text-ink-muted mt-0.5">{cr.reason}</div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0 text-right">
                        <div>
                          <div className="font-mono text-sm text-ink-secondary">
                            You: <strong>{cr.your_vote}%</strong>
                          </div>
                          <div className="font-mono text-[11px] text-ink-muted">
                            Actual: <strong>{cr.actual_outcome}%</strong>
                          </div>
                        </div>
                        <div
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            cr.in_zone
                              ? "bg-success-soft text-success border border-success/30"
                              : "bg-error-soft text-error border border-error/30"
                          }`}
                        >
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
                    className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
                  >
                    Go to Dashboard
                  </Link>
                )}
                <Button variant="secondary" size="lg" onClick={startTest}>
                  {result.passed ? "Retake for practice" : "Try Again"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
