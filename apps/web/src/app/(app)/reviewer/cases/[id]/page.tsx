"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  BackLink,
  Badge,
  Button,
  EvidenceCard,
  Field,
  Spinner,
  Textarea,
  VoteSlider,
} from "@/components/ui";
import { api } from "@/lib/api-client";

export interface ReviewerCase {
  assignment_id: string;
  assignment_tier: number;
  current_tier: number;
  voting_open: boolean;
  dispute: { id: string; reason_code: string; status: string; tier: number };
  order: { item_title: string | null; amount_minor: number | null };
  evidence: {
    id: string;
    submitted_by: string;
    type: string;
    text: string | null;
    uri: string | null;
    created_at: string;
  }[];
  previous_tier_decision: Record<string, unknown> | null;
  my_vote: number | null;
  my_reasoning: string | null;
  voting_deadline: string | null;
  panel: {
    ready: boolean;
    expected_reviewer_count: number | null;
    assigned_count: number;
    voted_count: number;
    outcome?: string;
    refund_amount_minor?: number;
  };
}

export default function ReviewerCasePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReviewerCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vote, setVote] = useState(50);
  const [reasoning, setReasoning] = useState("");
  const [evidenceLinks, setEvidenceLinks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await api.get<ReviewerCase>(`/reviewer/assignments/${id}`);
      setData(result);
      setError(null);
      if (result.my_vote !== null) {
        setVote(result.my_vote);
        setReasoning(result.my_reasoning ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load review");
    }
  }, [id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submit() {
    if (!data || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/reviewer/assignments/${id}/vote`, {
        vote,
        reasoning: reasoning.trim() || undefined,
        expected_tier: data.assignment_tier,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit vote");
    } finally {
      setSubmitting(false);
    }
  }
  async function openEvidence(evidenceId: string) {
    try {
      const result = await api.get<{ view_url: string }>(
        `/reviewer/assignments/${id}/evidence/${evidenceId}/view`,
      );
      setEvidenceLinks((links) => ({ ...links, [evidenceId]: result.view_url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open evidence");
    }
  }
  const canVote = data?.voting_open && data.my_vote === null;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:p-6">
      <BackLink href="/reviewer">Reviewer dashboard</BackLink>
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <Spinner size="sm" />}
      {data && (
        <>
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-ink">
                {data.assignment_tier === 3 ? "Grand panel review" : "Panel review"}
              </h1>
              <p className="mt-1 text-sm text-ink-secondary">
                {data.order.item_title ?? "Dispute review"}
              </p>
            </div>
            <Badge tone="info">Tier {data.assignment_tier}</Badge>
          </header>
          <section className="space-y-3 rounded-xl border border-line bg-surface-raised p-4">
            <h2 className="font-semibold text-ink">Review progress</h2>
            <p className="text-sm text-ink-secondary">
              Tier {data.current_tier}: {data.panel.voted_count} /{" "}
              {data.panel.expected_reviewer_count ?? "—"} votes submitted ·{" "}
              {data.panel.assigned_count} reviewers assigned
            </p>
            {data.panel.ready && (
              <Alert tone="info">
                Panel recommendation: {data.panel.outcome?.replaceAll("_", " ")}. Final settlement
                requires a separate decision.
              </Alert>
            )}
            {data.assignment_tier !== data.current_tier && (
              <Alert tone="info">
                Your Tier {data.assignment_tier} review is complete. A new panel is reviewing the
                appeal.
              </Alert>
            )}
            <Button variant="secondary" onClick={refresh}>
              Refresh progress
            </Button>
          </section>
          <section className="space-y-3">
            <h2 className="font-semibold text-ink">Evidence from both parties</h2>
            <p className="text-sm text-ink-secondary">
              {data.dispute.reason_code.replaceAll("_", " ")}
            </p>
            {data.evidence.length === 0 && (
              <Alert tone="info">No evidence has been submitted.</Alert>
            )}
            {data.evidence.map((item) => (
              <EvidenceCard
                key={item.id}
                type={item.type}
                submittedBy={item.submitted_by}
                side={
                  item.submitted_by === "buyer" || item.submitted_by === "seller"
                    ? item.submitted_by
                    : undefined
                }
              >
                {item.text ?? "Attachment evidence"}
                {item.uri &&
                  (evidenceLinks[item.id] ? (
                    <a
                      href={evidenceLinks[item.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-action-primary underline"
                    >
                      Open evidence file
                    </a>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="ml-2"
                      onClick={() => openEvidence(item.id)}
                    >
                      View attachment
                    </Button>
                  ))}
              </EvidenceCard>
            ))}
          </section>
          {canVote ? (
            <section className="space-y-4 rounded-xl border border-line bg-surface-raised p-4">
              <h2 className="font-semibold text-ink">Your independent review</h2>
              <p className="text-sm text-ink-secondary">
                Score how strongly the evidence favors the buyer. Below 50 favors the seller; 90 or
                above recommends a full refund. Your submitted vote is final.
              </p>
              <fieldset disabled={submitting} className="space-y-4">
                <VoteSlider
                  value={vote}
                  onChange={setVote}
                  buyerLabel="Buyer"
                  sellerLabel="Seller"
                />
                <Field label="Reasoning (optional)" htmlFor="vote-reasoning">
                  <Textarea
                    id="vote-reasoning"
                    value={reasoning}
                    onChange={(e) => setReasoning(e.target.value)}
                    maxLength={2000}
                    rows={4}
                  />
                </Field>
              </fieldset>
              <Button loading={submitting} onClick={submit} fullWidth>
                Submit vote
              </Button>
            </section>
          ) : (
            <Alert tone="info">
              {data.my_vote !== null
                ? `Your vote: ${data.my_vote}/100 toward the buyer. ${data.my_reasoning ?? ""}`
                : "Voting is closed for this review."}
            </Alert>
          )}
        </>
      )}
    </main>
  );
}
