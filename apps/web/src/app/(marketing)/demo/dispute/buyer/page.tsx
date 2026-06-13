"use client";

import Link from "next/link";
import { useState } from "react";
import { DisputeNav } from "../_components/dispute-nav";

/* ── Static data ──────────────────────── */

const timelineSteps = [
  { label: "Opened", ts: "Apr 19 · 14:32", status: "done" as const },
  { label: "Evidence", ts: "Apr 19 · 14:36", status: "done" as const },
  { label: "AI Review", ts: "~8 min", status: "active" as const },
  { label: "Decision", ts: "Pending", status: "pending" as const },
  { label: "Settlement", ts: "Pending", status: "pending" as const },
];

const evidenceItems = [
  {
    type: "Photo · battery status",
    ts: "Apr 19 · 14:35",
    thumb: "[ battery screenshot 82% ]",
    isText: false,
  },
  {
    type: "Photo · listing page",
    ts: "Apr 19 · 14:36",
    thumb: "[ listing screenshot 95% ]",
    isText: false,
  },
  {
    type: "Statement",
    ts: "Apr 19 · 14:32",
    thumb:
      "Battery measured 82% at unboxing, well below the 95% condition advertised. Ran Apple's built-in diagnostic twice...",
    isText: true,
  },
];

const activityLog = [
  {
    ts: "Apr 19 · 15:01 UTC",
    icon: "active" as const,
    text: (
      <>
        <strong>AI Arbiter</strong> reviewing case · estimated 8 min remaining
      </>
    ),
  },
  {
    ts: "Apr 19 · 14:58 UTC",
    icon: "ok" as const,
    text: <>Seller AI Advocate submitted response with 2 counter-evidence items</>,
  },
  {
    ts: "Apr 19 · 14:40 UTC",
    icon: "default" as const,
    text: (
      <>
        Seller <strong>@mike_deals</strong> acknowledged the dispute
      </>
    ),
  },
  {
    ts: "Apr 19 · 14:36 UTC",
    icon: "ok" as const,
    text: (
      <>
        Evidence uploaded · 2 photos, 1 statement · hash{" "}
        <span className="font-mono text-ink-muted">0x7f2c...a4</span>
      </>
    ),
  },
  {
    ts: "Apr 19 · 14:32 UTC",
    icon: "ok" as const,
    text: (
      <>
        Dispute opened · reason <strong>ITEM_NOT_AS_DESCRIBED</strong>
      </>
    ),
  },
];

/* ── Component ────────────────────────── */

export default function DisputeBuyerPage() {
  const [advocateTab, setAdvocateTab] = useState<"conversation" | "analysis">("conversation");

  return (
    <div className="min-h-screen bg-surface text-ink">
      <DisputeNav />

      <main className="mx-auto max-w-[1180px] px-7 py-7">
        {/* Breadcrumbs */}
        <div className="mb-[18px] flex items-center gap-2 font-mono text-[12px] text-ink-muted">
          <Link href="/demo/dispute" className="hover:text-ink">
            Cases
          </Link>
          <span className="text-ink-muted">/</span>
          <span>Open</span>
          <span className="text-ink-muted">/</span>
          <span>DSP-2847</span>
        </div>

        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* LEFT column */}
          <div className="space-y-5">
            {/* Case Header */}
            <section className="rounded-[14px] border border-line bg-surface-raised p-6 shadow-sm">
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex gap-2">
                  <StatusPill variant="open">Open</StatusPill>
                  <StatusPill variant="review">T1 · AI Review</StatusPill>
                </div>
                <span className="font-mono text-[12px] text-ink-muted">
                  Case · <strong className="text-ink">#DSP-2847</strong>
                </span>
              </div>
              <h1 className="flex flex-wrap items-baseline gap-3.5 text-[24px] font-semibold tracking-[-0.02em]">
                iPhone 14 Pro 128GB
                <span className="font-mono font-medium">$500.00</span>
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-ink-muted">
                <span className="flex items-center gap-2">
                  <span
                    className="h-[22px] w-[22px] rounded-full"
                    style={{
                      background: "linear-gradient(135deg, var(--bg-sunken), var(--bg-sunken))",
                    }}
                  />
                  Seller <strong className="text-ink">@mike_deals</strong>
                </span>
                <span className="rounded-full border border-line bg-surface-sunken px-[7px] py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                  Trust 72
                </span>
                <span className="h-[3px] w-[3px] rounded-full bg-ink-muted" />
                <span>
                  Reason: <strong className="text-ink">Item not as described</strong>
                </span>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-7 border-t border-line pt-4">
                <MetaItem label="Opened" value="Apr 19, 2026 · 14:32 UTC" mono />
                <MetaItem label="Current tier" value="T1 · AI Review" />
                <MetaItem label="Escrow" value="$500.00 held" mono />
                <MetaItem label="Decision ETA" value="~8 min" mono />
              </div>
            </section>

            {/* Timeline */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Progress
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Dispute lifecycle
                  </h2>
                </div>
                <StatusPill variant="review">Step 3 of 5</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                <div className="relative grid grid-cols-5">
                  {/* Track */}
                  <div className="absolute left-[12%] right-[12%] top-[13px] h-[2px] bg-line-subtle" />
                  <div
                    className="absolute left-[12%] top-[13px] h-[2px] bg-ink"
                    style={{ width: "50%" }}
                  />
                  {timelineSteps.map((s, i) => (
                    <div key={s.label} className="relative flex flex-col items-center gap-2">
                      <div
                        className={`relative z-[1] grid h-[26px] w-[26px] place-items-center rounded-full text-[11px] transition-all ${
                          s.status === "done"
                            ? "border-2 border-ink bg-ink text-on-accent"
                            : s.status === "active"
                              ? "border-2 border-ink bg-surface-raised text-ink"
                              : "border-2 border-line bg-surface-raised text-ink-muted"
                        }`}
                      >
                        {s.status === "done" ? "\u2713" : i + 1}
                      </div>
                      <div
                        className={`text-[12px] font-medium text-center ${s.status === "pending" ? "text-ink-muted" : "text-ink"}`}
                      >
                        {s.label}
                      </div>
                      <div className="text-center font-mono text-[10px] text-ink-muted">{s.ts}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* AI Advocate */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-info">
                    Your AI Advocate
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Building your case · Analyzing evidence
                  </h2>
                </div>
                <div className="inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-sunken p-[3px]">
                  <button
                    type="button"
                    onClick={() => setAdvocateTab("conversation")}
                    className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium transition-all ${advocateTab === "conversation" ? "bg-surface-raised text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                  >
                    Conversation
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvocateTab("analysis")}
                    className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium transition-all ${advocateTab === "analysis" ? "bg-surface-raised text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                  >
                    Analysis
                  </button>
                </div>
              </div>
              <div className="px-[22px] py-5">
                <div className="flex flex-col gap-3.5">
                  {/* AI message 1 */}
                  <div className="max-w-[88%] self-start rounded-xl border border-line border-l-[3px] border-l-info bg-surface-sunken p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                      <span className="font-semibold text-info">Advocate</span>
                      <span>· Summary drafted</span>
                      <span className="ml-auto">14:34 UTC</span>
                    </div>
                    <div className="space-y-2 text-[14px] leading-[1.55] text-ink">
                      <p>I&apos;ve reviewed your submission. Here&apos;s your case summary:</p>
                      <div className="flex gap-3.5">
                        <div className="flex-1 rounded-[10px] border border-line bg-surface-raised p-[12px_14px]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                            Key claim
                          </div>
                          <div className="text-[13px]">
                            Battery health listed at <strong>95%</strong> → measured{" "}
                            <strong>82%</strong>
                          </div>
                        </div>
                        <div className="flex-1 rounded-[10px] border border-line bg-surface-raised p-[12px_14px]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                            Market impact
                          </div>
                          <div className="text-[13px]">
                            13% degradation ≈ <strong className="font-mono">$65</strong> value
                            reduction
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-line bg-surface-raised p-[12px_14px]">
                        <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                          Evidence bundle
                        </div>
                        <div className="text-[13px]">
                          2 photos · 1 listing screenshot · 1 written statement — all hash-anchored
                          on-chain
                        </div>
                      </div>
                      {/* Strength meter */}
                      <div className="flex items-center gap-2.5 py-1">
                        <span className="min-w-[130px] text-left font-mono text-[12px] text-ink-muted">
                          Strength assessment
                        </span>
                        <div className="flex-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: "85%",
                              background:
                                "linear-gradient(90deg, var(--fb-info-fg), var(--fb-success-fg))",
                            }}
                          />
                        </div>
                        <span className="min-w-[110px] text-right font-mono text-[12px] font-semibold">
                          <strong>85%</strong> · Strong
                        </span>
                      </div>
                      <p>
                        The 13% discrepancy exceeds the platform&apos;s 5% tolerance threshold for
                        listed condition specs. The listing screenshot confirms the original claim.
                        My recommendation: <strong>proceed with the current T1 review</strong> —
                        evidence is likely sufficient without escalation.
                      </p>
                    </div>
                  </div>

                  {/* User message */}
                  <div className="max-w-[70%] self-end rounded-xl bg-ink p-[10px_14px] text-[14px] text-on-accent">
                    What happens next?
                  </div>

                  {/* AI message 2 */}
                  <div className="max-w-[88%] self-start rounded-xl border border-line border-l-[3px] border-l-info bg-surface-sunken p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                      <span className="font-semibold text-info">Advocate</span>
                      <span className="ml-auto">14:36 UTC</span>
                    </div>
                    <div className="space-y-2 text-[14px] leading-[1.55] text-ink">
                      <p>
                        Your case is now with the <strong>AI Arbiter</strong> (Tier 1). The Arbiter
                        examines both sides&apos; materials and returns a decision within minutes.
                        You&apos;ll be notified when it&apos;s posted.
                      </p>
                      <p>
                        If you disagree with the T1 outcome, you can escalate to a{" "}
                        <strong>Community Panel</strong> (Tier 2, 9 reviewers).
                      </p>
                      <div className="rounded-[10px] border border-warning/30 border-l-[3px] border-l-warning bg-warning-soft p-[10px_14px] text-[13px] text-warning">
                        <strong className="text-warning">Heads up.</strong> Escalation adds a $12.00
                        dispute cost. If you escalate and lose the panel review, that cost is
                        deducted from your refund. If you win, it&apos;s fully refunded.
                      </div>
                    </div>
                  </div>

                  {/* AI message 3 - typing */}
                  <div className="max-w-[88%] self-start rounded-xl border border-line border-l-[3px] border-l-info bg-surface-sunken p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                      <span className="font-semibold text-info">Advocate</span>
                      <span>· Reviewing seller response</span>
                      <span className="ml-auto">15:01 UTC</span>
                    </div>
                    <div className="text-[14px] leading-[1.55] text-ink">
                      <p>
                        Seller has submitted a counter-claim including an EXIF-dated screenshot.
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-ink-muted">
                        Cross-referencing
                        <span className="inline-flex gap-1">
                          <span
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted"
                            style={{ animationDelay: "300ms" }}
                          />
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Chat input */}
                <div className="mt-[18px] flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-3.5 py-2 focus-within:border-ink">
                  <input
                    type="text"
                    placeholder="Ask your AI Advocate..."
                    className="flex-1 border-none bg-transparent py-1.5 text-[14px] outline-none placeholder:text-ink-muted"
                    readOnly
                  />
                  <span className="rounded border border-line bg-surface-sunken px-[5px] py-[2px] font-mono text-[10px] text-ink-muted">
                    &crarr;
                  </span>
                  <button
                    type="button"
                    className="rounded-[10px] bg-ink px-3 py-[7px] text-[13px] font-medium text-on-accent"
                  >
                    Send
                  </button>
                </div>
              </div>
            </section>

            {/* Evidence */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Supporting materials
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Evidence submitted · 3 items
                  </h2>
                </div>
                <span className="font-mono text-[11px] text-ink-muted">
                  All hashes anchored · block 18,402,117
                </span>
              </div>
              <div className="px-[22px] py-5">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {evidenceItems.map((ev) => (
                    <div
                      key={ev.type}
                      className="cursor-pointer overflow-hidden rounded-xl border border-line bg-surface-raised transition-all hover:-translate-y-[1px] hover:shadow-md"
                    >
                      <div
                        className={`grid h-[110px] place-items-center border-b border-line font-mono text-[11px] text-ink-muted ${
                          ev.isText
                            ? "items-start justify-start bg-gradient-to-b from-surface-sunken to-surface-sunken p-[10px_14px] text-left leading-[1.5] text-ink"
                            : "bg-[repeating-linear-gradient(45deg,var(--bg-sunken),var(--bg-sunken)_8px,var(--bg-sunken)_8px,var(--bg-sunken)_16px)]"
                        }`}
                      >
                        {ev.thumb}
                      </div>
                      <div className="p-[10px_12px]">
                        <div className="text-[13px] font-medium">{ev.type}</div>
                        <div className="font-mono text-[11px] text-ink-muted">{ev.ts}</div>
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)] bg-badge px-[7px] py-[2px] font-mono text-[10px] font-semibold text-badge-text">
                          &#x26D3; Anchored
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Upload card */}
                  <div className="flex min-h-[158px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-line text-[13px] text-ink-muted transition-all hover:border-ink hover:bg-surface-sunken hover:text-ink">
                    <span className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface-sunken text-[16px]">
                      +
                    </span>
                    <span>Add more evidence</span>
                    <span className="text-[11px] text-ink-muted">Photo · doc · text</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Cost breakdown */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Transparency
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Dispute cost breakdown
                  </h2>
                </div>
                <StatusPill variant="closed">Loser pays</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                {/* T1 current */}
                <div className="flex items-center justify-between rounded-none border-b border-line border-l-[3px] border-l-info bg-gradient-to-r from-info-soft to-transparent -mx-[22px] px-[22px] py-3">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                      T1
                    </span>
                    AI Review · current
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$3.00</span>
                </div>
                {/* T2 */}
                <div className="flex items-center justify-between border-b border-line py-3 text-ink-muted">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                      T2
                    </span>
                    Community Panel · if escalated
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$12.00</span>
                </div>
                {/* T3 */}
                <div className="flex items-center justify-between border-b border-line py-3 text-ink-muted">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                      T3
                    </span>
                    Grand Panel · if escalated
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$30.00</span>
                </div>
                {/* Escrow */}
                <div className="flex items-center justify-between py-3">
                  <span className="text-[14px] text-ink-muted">Escrow held in smart contract</span>
                  <span className="font-mono text-[14px] font-semibold">$500.00</span>
                </div>
                {/* Note */}
                <div className="mt-3.5 flex gap-2.5 rounded-[10px] border border-line bg-surface-sunken p-[12px_14px] text-[13px] text-ink-muted">
                  <span>&#x2139;&#xFE0F;</span>
                  <span>
                    <strong className="text-ink">You only pay if you lose.</strong> Winner&apos;s
                    costs are fully refunded. 70% of the dispute fee goes to community reviewers,
                    30% to platform operations.
                  </span>
                </div>
              </div>
            </section>

            {/* Activity log */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Activity
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Case status updates
                  </h2>
                </div>
                <button
                  type="button"
                  className="rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  Export log
                </button>
              </div>
              <div className="px-[22px] py-5">
                {activityLog.map((a, i) => (
                  <div
                    key={a.ts}
                    className={`grid grid-cols-[160px_20px_1fr] items-baseline gap-4 py-3.5 ${i < activityLog.length - 1 ? "border-b border-line" : ""}`}
                  >
                    <div className="font-mono text-[12px] text-ink-muted">{a.ts}</div>
                    <div
                      className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] ${
                        a.icon === "active"
                          ? "border border-ink bg-ink text-on-accent"
                          : a.icon === "ok"
                            ? "border border-success/30 bg-success-soft text-success"
                            : "border border-line bg-surface-sunken text-ink-muted"
                      }`}
                    >
                      {a.icon === "ok" ? "\u2713" : a.icon === "active" ? "" : "\u00B7"}
                    </div>
                    <div className="text-[13px]">{a.text}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* RIGHT sidebar */}
          <aside className="sticky top-[72px] space-y-3.5">
            {/* Case summary */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="border-b border-line px-[22px] py-4">
                <h2 className="text-[14px] font-semibold">Case summary</h2>
              </div>
              <div className="px-[22px] pt-1.5 pb-4">
                <SummaryRow k="Case ID" v="#DSP-2847" mono />
                <SummaryRow k="Status" v={<StatusPill variant="open">Open</StatusPill>} />
                <SummaryRow k="Tier" v="T1 · AI Review" />
                <SummaryRow k="Item" v="iPhone 14 Pro" />
                <SummaryRow k="Amount" v="$500.00" mono />
                <SummaryRow k="Escrow" v="$500.00 held" mono emerald />
                <SummaryRow k="Your advocate" v="Active" cyan />
                <SummaryRow k="Decision in" v="~8 min" mono />
              </div>
            </section>

            {/* Actions */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="px-[18px] py-4">
                <div className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Next actions
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    className="w-full rounded-[10px] border border-line bg-surface-raised px-3.5 py-2.5 text-[14px] font-medium hover:border-ink hover:bg-surface-sunken"
                  >
                    Escalate to T2 · $12
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-[10px] border border-line bg-surface-raised px-3.5 py-2.5 text-[14px] font-medium hover:border-ink hover:bg-surface-sunken"
                  >
                    Accept T1 decision
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-[10px] border border-error/30 bg-surface-raised px-3.5 py-2.5 text-[14px] font-medium text-error hover:border-error hover:bg-error-soft"
                  >
                    Withdraw dispute
                  </button>
                </div>
                <div className="my-[18px] h-px bg-line-subtle" />
                <div className="text-[11px] leading-[1.5] text-ink-muted">
                  Escalation is available once the T1 decision is posted. Withdrawing closes the
                  case — the $3 T1 cost is charged to the losing party at settlement.
                </div>
              </div>
            </section>

            {/* On-chain note */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex gap-2.5 px-4 py-3.5">
                <span className="text-[18px]">&#x26D3;</span>
                <div className="text-[12px] leading-[1.5] text-ink-muted">
                  <strong className="text-ink">On-chain anchored.</strong> Every evidence hash and
                  case state change is committed to the Haggle ledger so records stay tamper-proof.
                </div>
              </div>
            </section>
          </aside>
        </div>

        {/* Footer */}
        <footer className="mt-9 flex justify-between border-t border-line pt-[22px] text-[12px] text-ink-muted">
          <span className="font-mono">Haggle Resolution Center · v2026.4</span>
          <span className="flex gap-2">
            <span>Policies</span> · <span>Reviewer guidelines</span> ·{" "}
            <span>Transparency report</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

/* ── Sub-components ───────────────────── */

function StatusPill({
  variant,
  children,
}: {
  variant: "open" | "review" | "waiting" | "resolved" | "closed" | "urgent";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    open: "bg-warning-soft text-warning border-warning/30",
    review: "bg-info-soft text-info border-info/30",
    waiting:
      "bg-badge text-badge-text border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
    resolved: "bg-success-soft text-success border-success/30",
    closed: "bg-surface-sunken text-ink-secondary border-line",
    urgent: "bg-error-soft text-error border-error/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-[9px] py-[4px] font-mono text-[11px] font-semibold uppercase tracking-[0.04em] ${styles[variant]}`}
    >
      {(variant === "open" ||
        variant === "waiting" ||
        variant === "resolved" ||
        variant === "urgent") && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <span className={`text-[14px] font-medium ${mono ? "font-mono text-[13px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function SummaryRow({
  k,
  v,
  mono,
  emerald,
  cyan,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  emerald?: boolean;
  cyan?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-b-0">
      <span className="text-ink-muted">{k}</span>
      <span
        className={`font-medium ${mono ? "font-mono text-[12px]" : ""} ${emerald ? "text-success" : ""} ${cyan ? "text-info" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}
