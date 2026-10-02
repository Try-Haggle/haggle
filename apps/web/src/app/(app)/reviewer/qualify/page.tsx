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

type Phase = "intro" | "test" | "submitting" | "result";

// ─── Main Page ───────────────────────────────────────────────
export default function ReviewerQualifyPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [cases, setCases] = useState<QualifyCase[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [votes, setVotes] = useState<number[]>([]);
  const [currentVote, setCurrentVote] = useState(50);
  const [result, setResult] = useState<QualifyResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const currentCase = cases[currentIdx];
  const totalCases = cases.length;

  async function startTest() {
    try {
      const response = await api.get<{ cases: { case_index: number; description: string }[] }>(
        "/reviewer/qualification-cases",
      );
      setCases(
        response.cases.map((item) => ({
          id: item.case_index + 1,
          case_id: String(item.case_index),
          item: `Practice case ${item.case_index + 1}`,
          amount: "—",
          reason: item.description,
          buyer_claim: "Review the case summary above.",
          seller_defense: "Use only the stated case facts.",
          evidence: [],
        })),
      );
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Unable to load qualification cases");
      return;
    }
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
        const response = await api.post<{
          result: string;
          match_rate: number;
          matches: number;
          total: number;
          case_results: {
            case_index: number;
            your_vote: number;
            correct_vote: number;
            difference: number;
            match: boolean;
          }[];
        }>("/reviewer/qualify", {
          votes: allVotes.map((v, i) => ({
            case_index: Number(cases[i].case_id),
            vote: v,
          })),
        });
        setResult({
          ...response,
          passed: response.result === "pass",
          conditional: response.result === "conditional",
          required_rate: 0.7,
          case_results: response.case_results.map((r) => ({
            case_id: String(r.case_index),
            item: `Practice case ${r.case_index + 1}`,
            reason: cases[r.case_index].reason,
            your_vote: r.your_vote,
            actual_outcome: r.correct_vote,
            diff: r.difference,
            in_zone: r.match,
          })),
        });
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
    <main className="min-h-[calc(100vh-var(--spacing-header))] px-4 py-6 sm:p-6 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 font-mono text-xs text-ink-muted">
        <Link href="/reviewer" className="hover:text-ink transition-colors">
          Reviewer Dashboard
        </Link>
        <span className="text-ink-muted">/</span>
        <span className="text-ink-secondary">Qualification Test</span>
      </div>

      {submitError && phase === "intro" && (
        <p role="alert" className="text-error">
          {submitError}
        </p>
      )}
      {/* ── INTRO ── */}
      {phase === "intro" && (
        <div className="space-y-5">
          <section className="rounded-xl border border-line bg-surface-sunken/50 p-8 text-center">
            <div className="text-5xl mb-4">&#x2696;&#xFE0F;</div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">
              Reviewer Qualification Test
            </h1>
            <p className="mt-3 text-sm text-ink-secondary max-w-lg mx-auto leading-relaxed">
              Prove your judgment by reviewing 10 practice dispute cases. Your votes are compared
              against practice reference decisions.
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
                  Your vote is compared to the practice reference result (&plusmn;15% tolerance)
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
                    "Your votes differed from practice reference. Review the cases below and try again."}
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
