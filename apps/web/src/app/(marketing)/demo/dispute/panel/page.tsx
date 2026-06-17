"use client";

import Link from "next/link";
import { useState } from "react";
import { DisputeNav } from "../_components/dispute-nav";

/* ── Component ────────────────────────── */

export default function DisputePanelPage() {
  const [selectedOption, setSelectedOption] = useState<"full" | "partial" | "none">("partial");
  const [partialPct, setPartialPct] = useState(30);
  const [dossierTab, setDossierTab] = useState<"evidence" | "precedent" | "audit">("evidence");

  return (
    <div className="min-h-screen bg-surface text-ink">
      <DisputeNav />

      <main className="mx-auto max-w-[1280px] px-7 py-7">
        {/* Breadcrumbs */}
        <div className="mb-[18px] flex items-center gap-2 font-mono text-[12px] text-ink-muted">
          <Link href="/demo/dispute" className="hover:text-ink">
            Reviewer panel
          </Link>
          <span className="text-ink-muted">/</span>
          <span>Active reviews</span>
          <span className="text-ink-muted">/</span>
          <span>DSP-2847</span>
        </div>

        {/* Escalation banner */}
        <div
          className="mb-[22px] flex items-center gap-3.5 rounded-[14px] border border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)] p-[14px_18px] text-[13px]"
          style={{ background: "linear-gradient(to right, var(--badge-bg), var(--bg-raised))" }}
        >
          <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)] bg-badge font-mono font-bold text-badge-text">
            &#x26A1;
          </div>
          <div className="flex-1">
            <strong className="block">Escalated to Tier 2 — Community Panel Review</strong>
            <span className="font-mono text-[12px] text-ink-muted">
              5 reviewers assigned · voting closes Apr 22 · 14:32 UTC · decision binding unless
              escalated to T3
            </span>
          </div>
          <div className="flex gap-2">
            <StatusPill variant="waiting">Voting</StatusPill>
            <StatusPill variant="review">T2</StatusPill>
          </div>
        </div>

        {/* Case head compact */}
        <section className="mb-[22px] rounded-[14px] border border-line bg-surface-raised p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h1 className="flex flex-wrap items-baseline gap-3 text-[20px] font-semibold tracking-[-0.02em]">
              iPhone 14 Pro 128GB
              <span className="font-mono font-medium">$500.00</span>
              <span className="font-mono text-[12px] text-ink-muted ml-2">#DSP-2847</span>
            </h1>
            <div className="flex gap-6 font-mono text-[12px] text-ink-muted items-center">
              <div>
                <span className="text-ink-muted">T1 decision</span> ·{" "}
                <strong className="text-ink">Partial refund 30%</strong>
              </div>
              <div>
                <span className="text-ink-muted">Escalated by</span> ·{" "}
                <strong className="text-ink">Buyer</strong>
              </div>
              <div>
                <span className="text-ink-muted">Closes in</span> ·{" "}
                <strong className="text-warning">38:24:15</strong>
              </div>
            </div>
          </div>
        </section>

        {/* Split view */}
        <div className="mb-[22px] grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Buyer side */}
          <section className="rounded-[14px] border border-line border-t-[3px] border-t-info bg-surface-raised shadow-sm">
            <div className="block border-b border-line px-[22px] py-4">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-info mb-1">
                Buyer AI Advocate · summary
              </div>
              <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                Buyer&apos;s position
              </h2>
            </div>
            <div className="px-[22px] py-5">
              <p className="border-l-2 border-line pl-3.5 text-[15px] italic leading-[1.6] text-ink">
                &ldquo;Battery health was advertised at 95% but measured 82% upon receipt. The 13%
                discrepancy represents roughly $65 in value reduction for a device sold in described
                condition. The buyer requests a full refund of $500.&rdquo;
              </p>
              <div className="mt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-2">
                Evidence · 3 items
              </div>
              <ul className="space-y-1.5">
                {[
                  {
                    icon: "\uD83D\uDCF8",
                    text: "Battery screenshot · 82% reading post-delivery",
                    id: "EV-01",
                  },
                  {
                    icon: "\uD83D\uDCF8",
                    text: "Listing screenshot · 95% advertised",
                    id: "EV-02",
                  },
                  {
                    icon: "\uD83D\uDCDD",
                    text: "Buyer statement · measurement conditions",
                    id: "EV-03",
                  },
                ].map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline gap-2.5 rounded-lg border border-line bg-surface-sunken px-2.5 py-2 text-[13px]"
                  >
                    <span className="font-mono text-[10px] text-ink-muted w-4 flex-shrink-0">
                      {e.icon}
                    </span>
                    <span className="flex-1">{e.text}</span>
                    <span className="font-mono text-[11px] text-ink-muted">{e.id}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-2">
                Key argument
              </div>
              <div className="text-[14px] leading-[1.55]">
                A 13% gap exceeds normal battery variance of 1-2% per two weeks of use.
                Haggle&apos;s own listing tolerance is 5% for advertised condition specs.
              </div>
              <div className="mt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-2">
                Strength (advocate self-assessment)
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: "85%",
                      background: "linear-gradient(90deg, var(--fb-info-fg), var(--fb-success-fg))",
                    }}
                  />
                </div>
                <span className="font-mono text-[12px] font-semibold">85% · Strong</span>
              </div>
            </div>
          </section>

          {/* Seller side */}
          <section className="rounded-[14px] border border-line border-t-[3px] border-t-badge-text bg-surface-raised shadow-sm">
            <div className="block border-b border-line px-[22px] py-4">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-badge-text mb-1">
                Seller AI Advocate · summary
              </div>
              <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                Seller&apos;s position
              </h2>
            </div>
            <div className="px-[22px] py-5">
              <p className="border-l-2 border-line pl-3.5 text-[15px] italic leading-[1.6] text-ink">
                &ldquo;Battery was 95% at time of sale, verified by EXIF-dated screenshot from Apr
                12. The 13% decrease over 5 days suggests either heavy usage by the buyer or a
                different measurement condition. The seller acted in good faith with accurate,
                timestamped listing documentation.&rdquo;
              </p>
              <div className="mt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-2">
                Evidence · 3 items
              </div>
              <ul className="space-y-1.5">
                {[
                  {
                    icon: "\uD83D\uDCF8",
                    text: "Battery screenshot · 95%, EXIF Apr 12",
                    id: "EV-08",
                  },
                  {
                    icon: "\uD83D\uDCC4",
                    text: "Shipping confirmation · sealed dispatch",
                    id: "EV-09",
                  },
                  {
                    icon: "\uD83D\uDCDD",
                    text: "Seller statement · listing accuracy",
                    id: "EV-10",
                  },
                ].map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline gap-2.5 rounded-lg border border-line bg-surface-sunken px-2.5 py-2 text-[13px]"
                  >
                    <span className="font-mono text-[10px] text-ink-muted w-4 flex-shrink-0">
                      {e.icon}
                    </span>
                    <span className="flex-1">{e.text}</span>
                    <span className="font-mono text-[11px] text-ink-muted">{e.id}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-2">
                Key argument
              </div>
              <div className="text-[14px] leading-[1.55]">
                EXIF proves 95% battery at listing time. Normal iOS usage cannot produce a 13% drop
                in 5 days — this implies post-delivery factors outside the seller&apos;s control.
              </div>
              <div className="mt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mb-2">
                Strength (advocate self-assessment)
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: "72%",
                      background: "linear-gradient(90deg, var(--badge-text), var(--fb-info-fg))",
                    }}
                  />
                </div>
                <span className="font-mono text-[12px] font-semibold">72% · Moderate</span>
              </div>
            </div>
          </section>
        </div>

        {/* Decision card */}
        <section className="mb-[22px] rounded-[14px] border border-line bg-surface-raised p-[26px] shadow-md">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                Core question · for reviewers
              </div>
              <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.005em]">
                Please cast a decision. Your vote is sealed until the panel closes.
              </h2>
            </div>
            <StatusPill variant="review">Your ballot · R-05</StatusPill>
          </div>

          <div className="my-[18px] rounded-xl border-l-[3px] border-l-ink bg-surface-sunken p-[18px_20px] text-[19px] font-medium leading-[1.45] tracking-[-0.015em]">
            Is a 13% battery health discrepancy (listed 95% → received 82%) grounds for a refund,
            given the seller&apos;s EXIF evidence showing 95% at listing time?
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => setSelectedOption("full")}
              className={`flex w-full items-center gap-3.5 rounded-xl border px-[18px] py-3.5 text-left text-[14px] transition-all ${
                selectedOption === "full"
                  ? "border-ink shadow-[0_0_0_3px_rgba(17,17,19,0.06)]"
                  : "border-line hover:border-info"
              }`}
            >
              <span
                className={`relative h-[18px] w-[18px] flex-shrink-0 rounded-full border-2 ${selectedOption === "full" ? "border-ink" : "border-line"}`}
              >
                {selectedOption === "full" && (
                  <span className="absolute inset-[3px] rounded-full bg-ink" />
                )}
              </span>
              <span className="flex-1 font-medium">Full refund to buyer</span>
              <span className="font-mono text-[12px] text-ink-muted">
                Buyer → $500.00 · Seller → $0
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedOption("partial")}
              className={`flex w-full items-center gap-3.5 rounded-xl border px-[18px] py-3.5 text-left text-[14px] transition-all ${
                selectedOption === "partial"
                  ? "border-ink shadow-[0_0_0_3px_rgba(17,17,19,0.06)]"
                  : "border-line hover:border-ink-secondary"
              }`}
            >
              <span
                className={`relative h-[18px] w-[18px] flex-shrink-0 rounded-full border-2 ${selectedOption === "partial" ? "border-ink" : "border-line"}`}
              >
                {selectedOption === "partial" && (
                  <span className="absolute inset-[3px] rounded-full bg-ink" />
                )}
              </span>
              <span className="flex-1 font-medium">
                Partial refund — buyer receives a proportional amount
              </span>
              <span className="font-mono text-[12px] text-ink-muted">Configure &#x2193;</span>
            </button>

            {selectedOption === "partial" && (
              <div className="flex items-center gap-3.5 rounded-[10px] border border-line bg-surface-sunken p-3.5">
                <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  Refund %
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={partialPct}
                  onChange={(e) => setPartialPct(Number(e.target.value))}
                  className="flex-1 accent-ink"
                />
                <span className="min-w-[60px] text-right font-mono font-semibold">
                  {partialPct}%
                </span>
                <span className="text-[12px] text-ink-muted">
                  ≈ <span className="font-mono">${((500 * partialPct) / 100).toFixed(2)}</span> to
                  buyer
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedOption("none")}
              className={`flex w-full items-center gap-3.5 rounded-xl border px-[18px] py-3.5 text-left text-[14px] transition-all ${
                selectedOption === "none"
                  ? "border-ink shadow-[0_0_0_3px_rgba(17,17,19,0.06)]"
                  : "border-line hover:border-badge-text"
              }`}
            >
              <span
                className={`relative h-[18px] w-[18px] flex-shrink-0 rounded-full border-2 ${selectedOption === "none" ? "border-ink" : "border-line"}`}
              >
                {selectedOption === "none" && (
                  <span className="absolute inset-[3px] rounded-full bg-ink" />
                )}
              </span>
              <span className="flex-1 font-medium">No refund — seller keeps payment</span>
              <span className="font-mono text-[12px] text-ink-muted">
                Buyer → $0 · Seller → $488.00
              </span>
            </button>
          </div>

          <div className="mt-[18px] flex gap-2.5 rounded-[10px] border border-line bg-surface-sunken p-[12px_14px] text-[13px] text-ink-muted">
            <span>&#x1F52C;</span>
            <span>
              <strong className="text-ink">Specialist Verification available.</strong> A LegitApp
              battery analysis has been requested and will be attached to the evidence bundle if it
              returns before panel close.{" "}
              <span className="cursor-pointer font-medium text-info">Request expedited pull</span>.
            </span>
          </div>
        </section>

        {/* Panel status + dossier row */}
        <div className="mb-[22px] grid grid-cols-1 gap-[22px] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Panel vote progress */}
          <section className="rounded-[14px] border border-line bg-surface-raised p-[22px_24px] shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Panel status
                </div>
                <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                  5 community reviewers assigned
                </h2>
              </div>
              <StatusPill variant="waiting">Sealed votes</StatusPill>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className="font-mono text-[26px] font-semibold tracking-[-0.02em]">5</div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mt-0.5">
                  Assigned
                </div>
              </div>
              <div>
                <div className="font-mono text-[26px] font-semibold tracking-[-0.02em] text-info">
                  3
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mt-0.5">
                  Voted
                </div>
              </div>
              <div>
                <div className="font-mono text-[26px] font-semibold tracking-[-0.02em] text-ink-muted">
                  2
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted mt-0.5">
                  Remaining
                </div>
              </div>
            </div>

            <div className="text-[12px] text-ink-muted mt-1.5">
              Vote distribution · anonymized until panel closes
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full"
                style={{
                  width: "60%",
                  background:
                    "repeating-linear-gradient(45deg, var(--fb-info-fg) 0 8px, var(--fb-info-fg) 8px 16px)",
                }}
              />
            </div>

            <div className="mt-[18px] flex flex-wrap gap-1">
              {["R-01", "R-02", "R-03", "R-04", "R-05"].map((slot, i) => (
                <div
                  key={slot}
                  className={`grid h-[22px] w-[22px] place-items-center rounded-full font-mono text-[9px] font-semibold ${
                    i < 3
                      ? "border border-ink bg-ink text-on-accent"
                      : i === 4
                        ? "border border-ink bg-surface-raised text-ink outline outline-2 outline-offset-2 outline-info"
                        : "border border-line bg-surface-sunken text-ink-muted"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
              ))}
            </div>
            <div className="mt-2.5 font-mono text-[11px] text-ink-muted">
              &#x25B2; You are reviewer R-05 · qualification score 94
            </div>

            <div className="my-[18px] h-px bg-line-subtle" />

            <div className="flex items-center justify-between gap-3.5">
              <div>
                <div className="font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted mb-1">
                  Your reward on close
                </div>
                <div className="font-mono text-[18px] font-semibold">
                  $2.80{" "}
                  <span className="text-[12px] font-normal text-ink-muted">
                    · per majority reviewer
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="rounded-[10px] bg-ink px-3.5 py-2.5 text-[14px] font-medium text-on-accent"
              >
                Submit vote
              </button>
            </div>
          </section>

          {/* Dossier */}
          <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
            <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
              <div>
                <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Shared evidence bundle · anonymized
                </div>
                <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                  Case dossier for reviewers
                </h2>
              </div>
              <div className="inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-sunken p-[3px]">
                {(["evidence", "precedent", "audit"] as const).map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    onClick={() => setDossierTab(tab)}
                    className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium capitalize transition-all ${dossierTab === tab ? "bg-surface-raised text-ink shadow-sm" : "text-ink-muted"}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-[22px] py-5">
              {dossierTab === "evidence" && (
                <>
                  <div className="mb-3 flex items-center gap-2 text-[12px] text-ink-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    All items hash-anchored on-chain · party identities are masked during review
                  </div>
                  <ul className="space-y-2">
                    {[
                      {
                        id: "EV-01",
                        color: "var(--fb-info-fg)",
                        title: "Battery screenshot · 82% post-delivery",
                        meta: "Submitted by BUYER · 0x7f2c...a4 · Apr 19 14:35",
                      },
                      {
                        id: "EV-02",
                        color: "var(--fb-info-fg)",
                        title: "Listing page screenshot · 95% advertised",
                        meta: "Submitted by BUYER · 0x3a91...7e · Apr 19 14:36",
                      },
                      {
                        id: "EV-03",
                        color: "var(--fb-info-fg)",
                        title: "Buyer statement · measurement conditions",
                        meta: "Submitted by BUYER · 0xc402...91 · Apr 19 14:32",
                      },
                      {
                        id: "EV-08",
                        color: "var(--badge-text)",
                        title: "Battery screenshot · 95% · EXIF Apr 12",
                        meta: "Submitted by SELLER · 0xa4f1...2c · Apr 19 14:47",
                      },
                      {
                        id: "EV-09",
                        color: "var(--badge-text)",
                        title: "Shipping receipt · sealed dispatch",
                        meta: "Submitted by SELLER · 0xe721...b0 · Apr 19 14:51",
                      },
                      {
                        id: "EV-10",
                        color: "var(--badge-text)",
                        title: "Seller statement · listing accuracy",
                        meta: "Submitted by SELLER · 0x11b6...5d · Apr 19 14:58",
                      },
                    ].map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-sunken px-2.5 py-2 text-[13px]"
                      >
                        <span
                          className="font-mono text-[10px] font-semibold"
                          style={{ color: ev.color }}
                        >
                          {ev.id}
                        </span>
                        <div className="flex-1">
                          <div className="font-medium">{ev.title}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
                            {ev.meta}
                          </div>
                        </div>
                        <span className="cursor-pointer text-[12px] font-medium text-info">
                          View &#x2197;
                        </span>
                      </li>
                    ))}
                    <li className="flex items-start gap-2.5 rounded-lg border border-dashed border-line bg-surface-sunken px-2.5 py-2 text-[13px] opacity-70">
                      <span className="font-mono text-[10px] font-semibold text-warning">
                        SV-01
                      </span>
                      <div className="flex-1">
                        <div className="font-medium">
                          Specialist Verification · LegitApp battery analysis{" "}
                          <StatusPill variant="open">pending</StatusPill>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
                          Auto-requested by platform · ETA ~18h before close
                        </div>
                      </div>
                      <span className="text-[12px] text-ink-muted">Awaiting</span>
                    </li>
                  </ul>
                  <div className="mt-3.5 flex gap-2.5 rounded-[10px] border border-line bg-surface-sunken p-[12px_14px] text-[13px] text-ink-muted">
                    <span>&#x1F512;</span>
                    <span>
                      <strong className="text-ink">What reviewers do NOT see.</strong> Private
                      conversations between either party and their AI Advocate are confidential and
                      are never surfaced to the panel. You rule on the submitted evidence and the
                      advocate summaries in the split view above — nothing else.
                    </span>
                  </div>
                </>
              )}
              {dossierTab === "precedent" && (
                <>
                  <div className="mb-3 text-[12px] text-ink-muted">
                    Historical outcomes in cases the platform&apos;s matching engine flags as
                    similar. Provided for context; not binding.
                  </div>
                  <ul className="space-y-2">
                    {[
                      {
                        count: "24",
                        title: "Battery discrepancy > 10% · similar electronics",
                        meta: "88% favored buyer · avg refund 76%",
                      },
                      {
                        count: "11",
                        title: "EXIF-backed seller evidence present",
                        meta: "55% favored seller · panel split high",
                      },
                      {
                        count: "06",
                        title: "Both conditions met (discrepancy > 10% AND EXIF-backed)",
                        meta: "Most common outcome: partial refund 25-40%",
                      },
                    ].map((p) => (
                      <li
                        key={p.title}
                        className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-sunken px-2.5 py-2 text-[13px]"
                      >
                        <span className="font-mono text-[10px] text-ink-muted w-4">{p.count}</span>
                        <div className="flex-1">
                          <div className="font-medium">{p.title}</div>
                          <div className="mt-0.5 text-[11px] text-ink-muted">{p.meta}</div>
                        </div>
                        <span className="font-mono text-[11px] text-ink-muted">past 180d</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {dossierTab === "audit" && (
                <>
                  <div className="mb-3 text-[12px] text-ink-muted">
                    Tamper-evident case events. Each row corresponds to an on-chain commitment.
                  </div>
                  {[
                    {
                      ts: "Apr 20 · 11:08",
                      icon: "active" as const,
                      text: (
                        <>
                          Reviewer R-02 vote sealed · hash{" "}
                          <span className="font-mono text-ink-muted">0x81ad...ff</span>
                        </>
                      ),
                    },
                    {
                      ts: "Apr 20 · 09:42",
                      icon: "default" as const,
                      text: <>Specialist Verification auto-requested from LegitApp</>,
                    },
                    {
                      ts: "Apr 20 · 08:00",
                      icon: "ok" as const,
                      text: <>Panel of 5 reviewers drafted · qualification-weighted</>,
                    },
                    {
                      ts: "Apr 20 · 07:55",
                      icon: "ok" as const,
                      text: <>Buyer escalated to T2 · deposit posted</>,
                    },
                    {
                      ts: "Apr 20 · 07:48",
                      icon: "ok" as const,
                      text: <>T1 decision posted · partial refund 30%</>,
                    },
                  ].map((a, i) => (
                    <div
                      key={a.ts}
                      className={`grid grid-cols-[130px_20px_1fr] items-baseline gap-4 py-3 ${i < 4 ? "border-b border-line" : ""}`}
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
                        {a.icon === "ok" ? "\u2713" : ""}
                      </div>
                      <div className="text-[13px]">{a.text}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>

        {/* Settlement preview */}
        <section className="mb-[22px] rounded-[14px] border border-line bg-surface-raised shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
            <div>
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                Settlement preview
              </div>
              <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                How funds move under each outcome
              </h2>
            </div>
            <span className="text-[12px] text-ink-muted">
              Numbers are final and auto-executed by escrow contract
            </span>
          </div>
          <div className="px-[22px] py-5">
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {/* Buyer wins */}
              <div className="rounded-xl border border-line p-[18px_20px]">
                <h4 className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-info" />
                  If Buyer wins (full refund)
                </h4>
                <SettleRow k="Buyer receives" v="+$500.00" win />
                <SettleRow k="Seller receives" v="$0.00" lose />
                <SettleRow k="Dispute cost" v="$12.00" divider />
                <SettleRow k="Paid by" v="Seller" violet />
                <SettleRow k="→ Reviewers (70%)" v="$8.40" />
                <SettleRow k="→ Platform (30%)" v="$3.60" />
                <SettleRow k="Seller deposit" v="Forfeited" lose divider />
              </div>
              {/* Seller wins */}
              <div className="rounded-xl border border-line p-[18px_20px]">
                <h4 className="mb-3.5 flex items-center gap-2 text-[13px] font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-badge-text" />
                  If Seller wins (no refund)
                </h4>
                <SettleRow k="Buyer receives" v="$0.00" lose />
                <SettleRow k="Seller receives" v="+$488.00" win />
                <SettleRow k="Dispute cost" v="$12.00" divider />
                <SettleRow k="Paid by" v="Buyer" cyan />
                <SettleRow k="→ Reviewers (70%)" v="$8.40" />
                <SettleRow k="→ Platform (30%)" v="$3.60" />
                <SettleRow k="Seller deposit" v="Refunded" win divider />
              </div>
            </div>

            <div className="mt-4 flex gap-2.5 rounded-[10px] border border-line bg-surface-sunken p-[12px_14px] text-[13px] text-ink-muted">
              <span>&#x26D3;</span>
              <span>
                <strong className="text-ink">Automatic execution.</strong> Once the panel closes and
                the decision is finalized, the escrow contract releases funds without manual
                intervention. Settlement hash is committed on-chain alongside the case record.
              </span>
            </div>
          </div>
        </section>

        <footer className="mt-9 flex justify-between border-t border-line pt-[22px] text-[12px] text-ink-muted">
          <span className="font-mono">Haggle Resolution Center · v2026.4 · Reviewer panel</span>
          <span className="flex gap-2">
            <span>Reviewer code of conduct</span> · <span>Transparency report</span> ·{" "}
            <span>Appeal process</span>
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
  variant: "open" | "review" | "waiting" | "resolved" | "closed";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    open: "bg-warning-soft text-warning border-warning/30",
    review: "bg-info-soft text-info border-info/30",
    waiting:
      "bg-badge text-badge-text border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
    resolved: "bg-success-soft text-success border-success/30",
    closed: "bg-surface-sunken text-ink-secondary border-line",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-[9px] py-[4px] font-mono text-[11px] font-semibold uppercase tracking-[0.04em] ${styles[variant]}`}
    >
      {(variant === "open" || variant === "waiting" || variant === "resolved") && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

function SettleRow({
  k,
  v,
  win,
  lose,
  cyan,
  violet,
  divider,
}: {
  k: string;
  v: string;
  win?: boolean;
  lose?: boolean;
  cyan?: boolean;
  violet?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-[7px] text-[13px] ${divider ? "border-b border-line pt-2.5 pb-2.5" : "border-b border-dashed border-line"} last:border-b-0`}
    >
      <span className="text-ink-muted">{k}</span>
      <span
        className={`font-mono font-semibold ${win ? "text-success" : ""} ${lose ? "text-error" : ""} ${cyan ? "text-info" : ""} ${violet ? "text-badge-text" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}
