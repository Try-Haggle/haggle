"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, EmptyState, Spinner } from "@/components/ui";
import { api } from "@/lib/api-client";

interface Profile {
  qualified: boolean;
  ds_tier: string;
  ds_score: number;
  vote_weight: number;
  cases_reviewed: number;
  active_slots: number;
  max_slots: number;
  total_earnings_cents: number;
}
interface Assignment {
  assignment_id: string;
  dispute_id: string;
  tier: number;
  status: "active" | "voted" | "decided";
  item_title: string | null;
  amount_minor: number | null;
  vote_value: number | null;
}
export default function ReviewerDashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [tab, setTab] = useState<Assignment["status"]>("active");
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api.get<Profile>("/reviewer/profile"),
        api.get<{ assignments: Assignment[] }>("/reviewer/assignments?status=all"),
      ]);
      setProfile(p);
      setAssignments(a.assignments);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load reviews");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const visible = assignments.filter((a) => a.status === tab);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">Reviewer dashboard</h1>
        <Button variant="secondary" onClick={refresh}>
          Refresh
        </Button>
      </header>
      {error && <Alert tone="error">{error}</Alert>}
      {!profile && !error && <Spinner size="sm" />}
      {profile && (
        <>
          <section className="space-y-3 rounded-xl border border-line bg-surface-raised p-4">
            <Badge tone="info">{profile.ds_tier}</Badge>
            <p className="text-sm text-ink-secondary">
              Score {profile.ds_score} · Vote weight {profile.vote_weight} · {profile.active_slots}{" "}
              / {profile.max_slots} active slots
            </p>
            <p className="text-sm text-ink-secondary">
              {profile.cases_reviewed} reviews recorded · $
              {(profile.total_earnings_cents / 100).toFixed(2)} recorded earnings
            </p>
            {!profile.qualified && (
              <Link href="/reviewer/qualify" className="text-action-primary underline">
                Take the reviewer qualification test
              </Link>
            )}
          </section>
          <fieldset className="flex flex-wrap gap-2" aria-label="Review status">
            {(["active", "voted", "decided"] as const).map((value) => (
              <Button
                key={value}
                variant={tab === value ? "primary" : "secondary"}
                onClick={() => setTab(value)}
                aria-pressed={tab === value}
              >
                {value === "active"
                  ? "Needs your vote"
                  : value === "voted"
                    ? "Vote submitted"
                    : "Completed review"}{" "}
                ({assignments.filter((a) => a.status === value).length})
              </Button>
            ))}
          </fieldset>
          {visible.length === 0 && <EmptyState title="No reviews in this view" />}
          <div className="space-y-3">
            {visible.map((assignment) => (
              <Link
                key={assignment.assignment_id}
                href={`/reviewer/cases/${assignment.dispute_id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised p-4 hover:bg-surface-sunken"
              >
                <div>
                  <p className="font-semibold text-ink">
                    {assignment.item_title ?? "Dispute review"}
                  </p>
                  <p className="mt-1 text-sm text-ink-secondary">
                    {assignment.amount_minor === null
                      ? "Amount unavailable"
                      : `$${(assignment.amount_minor / 100).toFixed(2)}`}
                    {assignment.vote_value !== null
                      ? ` · Your vote ${assignment.vote_value}/100`
                      : ""}
                  </p>
                </div>
                <Badge tone="info">Tier {assignment.tier}</Badge>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
