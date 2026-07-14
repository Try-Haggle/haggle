"use client";

import Link from "next/link";
import { useState } from "react";
import { DisputeNav } from "../_components/dispute-nav";

/* ── Static data ──────────────────────── */

const timelineSteps = [
  { label: "Notified", ts: "Apr 19 · 14:33", status: "done" as const },
  { label: "Your response", ts: "41h 24m left", status: "active" as const },
  { label: "AI Review", ts: "Pending", status: "pending" as const },
  { label: "Decision", ts: "Pending", status: "pending" as const },
  { label: "Settlement", ts: "Pending", status: "pending" as const },
];

const evidenceItems = [
  {
    type: "Photo · battery · EXIF",
    ts: "Apr 19 · 14:47",
    thumb: "[ battery screenshot 95% · EXIF Apr 12 ]",
    isText: false,
  },
  {
    type: "Doc · shipping receipt",
    ts: "Apr 19 · 14:51",
    thumb: "[ shipping confirmation ]",
    isText: false,
  },
  {
    type: "Statement",
    ts: "Apr 19 · 14:58",
    thumb:
      "Listed the device at 95% battery verified by screenshot. Item was shipped sealed within 24h of sale...",
    isText: true,
  },
];

const activityLog = [
  {
    ts: "Apr 19 · 14:58 UTC",
    icon: "active" as const,
    text: (
      <>
        <strong>You</strong> drafted response statement via AI Advocate
      </>
    ),
  },
  {
    ts: "Apr 19 · 14:47 UTC",
    icon: "ok" as const,
    text: (
      <>
        EXIF-dated screenshot uploaded · defense strength rose to <strong>88%</strong>
      </>
    ),
  },
  {
    ts: "Apr 19 · 14:40 UTC",
    icon: "ok" as const,
    text: <>You acknowledged the dispute · AI Advocate assigned</>,
  },
  {
    ts: "Apr 19 · 14:33 UTC",
    icon: "default" as const,
    text: (
      <>
        Dispute notice sent · reason <strong>ITEM_NOT_AS_DESCRIBED</strong>
      </>
    ),
  },
];

/* ── Component ────────────────────────── */

export default function DisputeSellerPage() {
  const [advocateTab, setAdvocateTab] = useState<"conversation" | "strategy">("conversation");

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
          <span>Requires response</span>
          <span className="text-ink-muted">/</span>
          <span>DSP-2847</span>
        </div>

        {/* Deadline banner */}
        <div className="mb-[22px] flex items-center gap-3.5 rounded-[14px] border border-warning/30 bg-surface p-[14px_18px] text-[13px]">
          <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-warning/30 bg-warning-soft font-mono font-bold text-warning">
            &#x23F0;
          </div>
          <div className="flex-1">
            <strong className="block">Response required within 48 hours</strong>
            <span className="font-mono text-[12px] text-ink-muted">
              Failure to respond results in automatic loss and refund to buyer · deadline Apr 21 ·
              14:32 UTC
            </span>
          </div>
          <div className="font-mono text-[20px] font-semibold tracking-[-0.01em] text-warning">
            41:24:08
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* LEFT column */}
          <div className="space-y-5">
            {/* Case Header */}
            <section className="rounded-[14px] border border-line border-t-[3px] border-t-[var(--badge-text)] bg-surface-raised p-6 shadow-sm">
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex gap-2">
                  <StatusPill variant="waiting">Waiting for you</StatusPill>
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
                <span>Dispute opened by</span>
                <span className="flex items-center gap-2">
                  <span
                    className="h-[22px] w-[22px] rounded-full"
                    style={{
                      background: "linear-gradient(135deg, var(--bg-sunken), var(--bg-sunken))",
                    }}
                  />
                  <strong className="text-ink">@jenny_lee</strong>
                </span>
                <span className="rounded-full border border-line bg-surface-sunken px-[7px] py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                  Trust 88
                </span>
                <span className="h-[3px] w-[3px] rounded-full bg-ink-muted" />
                <span>
                  Reason: <strong className="text-ink">Item not as described</strong>
                </span>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-7 border-t border-line pt-4">
                <MetaItem label="Buyer claim" value="Battery 95% → 82%" />
                <MetaItem label="Current tier" value="T1 · AI Review" />
                <MetaItem label="Escrow" value="$500.00 held" mono />
                <MetaItem label="Deposit required" value="None at T1" mono />
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
                    Dispute lifecycle · your side
                  </h2>
                </div>
                <StatusPill variant="waiting">Awaiting response</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                <div className="relative grid grid-cols-5">
                  <div className="absolute left-[12%] right-[12%] top-[13px] h-[2px] bg-line" />
                  <div
                    className="absolute left-[12%] top-[13px] h-[2px] bg-ink"
                    style={{ width: "25%" }}
                  />
                  {timelineSteps.map((s, i) => (
                    <div key={s.label} className="relative flex flex-col items-center gap-2">
                      <div
                        className={`relative z-[1] grid h-[26px] w-[26px] place-items-center rounded-full text-[11px] ${
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

            {/* AI Advocate (violet) */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-badge-text">
                    Your AI Advocate
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Defending your position · Reviewing buyer&apos;s claims
                  </h2>
                </div>
                <div className="inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-sunken p-[3px]">
                  <button
                    type="button"
                    onClick={() => setAdvocateTab("conversation")}
                    className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium transition-all ${advocateTab === "conversation" ? "bg-surface-raised text-ink shadow-sm" : "text-ink-muted"}`}
                  >
                    Conversation
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvocateTab("strategy")}
                    className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium transition-all ${advocateTab === "strategy" ? "bg-surface-raised text-ink shadow-sm" : "text-ink-muted"}`}
                  >
                    Strategy
                  </button>
                </div>
              </div>
              <div className="px-[22px] py-5">
                <div className="flex flex-col gap-3.5">
                  {/* AI message 1 */}
                  <div className="max-w-[88%] self-start rounded-xl border border-line border-l-[3px] border-l-[var(--badge-text)] bg-surface-sunken p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                      <span className="font-semibold text-badge-text">Advocate</span>
                      <span>· Initial analysis</span>
                      <span className="ml-auto">14:40 UTC</span>
                    </div>
                    <div className="space-y-2 text-[14px] leading-[1.55] text-ink">
                      <p>
                        The buyer claims the phone&apos;s battery health is <strong>82%</strong> vs
                        your listed <strong>95%</strong>. Here&apos;s where we stand:
                      </p>
                      <div className="flex gap-3.5">
                        <div className="flex-1 rounded-[10px] border border-line bg-surface-raised p-[12px_14px]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                            Buyer&apos;s claim
                          </div>
                          <div className="text-[13px]">82% measured post-delivery</div>
                        </div>
                        <div className="flex-1 rounded-[10px] border border-line bg-surface-raised p-[12px_14px]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                            Your listing
                          </div>
                          <div className="text-[13px]">95% with listing screenshot</div>
                        </div>
                      </div>
                      <p>
                        <strong>Analysis.</strong> Battery health typically degrades 1-2% over two
                        weeks of normal use. A 13% gap in 5 days is unusual, which favors you. Your
                        listing screenshot is strong primary evidence — but without EXIF-dated
                        capture, the buyer can argue the screenshot was re-used from an earlier
                        device.
                      </p>
                      <div className="flex items-center gap-2.5 py-1">
                        <span className="min-w-[130px] text-left font-mono text-[12px] text-ink-muted">
                          Defense strength
                        </span>
                        <div className="flex-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: "72%",
                              background:
                                "linear-gradient(90deg, var(--badge-text), var(--fb-info-fg))",
                            }}
                          />
                        </div>
                        <span className="min-w-[110px] text-right font-mono text-[12px] font-semibold">
                          <strong>72%</strong> · Moderate
                        </span>
                      </div>
                      <p>
                        <strong>Recommended action.</strong> Upload the original battery screenshot{" "}
                        <em>with EXIF data intact</em> to prove the capture timing. This single
                        piece of evidence will materially strengthen your position.
                      </p>
                    </div>
                  </div>

                  {/* User message */}
                  <div className="max-w-[70%] self-end rounded-xl bg-ink p-[10px_14px] text-[14px] text-on-accent">
                    Here&apos;s the screenshot from when I listed it.
                    <br />
                    <span className="text-[12px] opacity-70">&#x1F4CE; IMG_2418.HEIC · 3.2 MB</span>
                  </div>

                  {/* AI message 2 */}
                  <div className="max-w-[88%] self-start rounded-xl border border-line border-l-[3px] border-l-[var(--badge-text)] bg-surface-sunken p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                      <span className="font-semibold text-badge-text">Advocate</span>
                      <span>· EXIF verified</span>
                      <span className="ml-auto">14:47 UTC</span>
                    </div>
                    <div className="space-y-2 text-[14px] leading-[1.55] text-ink">
                      <p>
                        Excellent. EXIF metadata shows this was captured{" "}
                        <strong>Apr 12 · 09:14 KST</strong> — 7 days before the dispute. Device
                        battery reads <strong>95%</strong>. Hash committed to chain.
                      </p>
                      <div className="rounded-[10px] border border-line bg-surface-raised p-[12px_14px]">
                        <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                          Evidence added · EV-08
                        </div>
                        <div className="text-[13px]">
                          Battery screenshot, EXIF-dated ·{" "}
                          <span className="font-mono text-ink-muted">0xa4f1...2c</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 py-1">
                        <span className="min-w-[130px] text-left font-mono text-[12px] text-ink-muted">
                          Updated strength
                        </span>
                        <div className="flex-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: "88%",
                              background:
                                "linear-gradient(90deg, var(--badge-text), var(--fb-info-fg))",
                            }}
                          />
                        </div>
                        <span className="min-w-[110px] text-right font-mono text-[12px] font-semibold">
                          <strong>88%</strong> · Strong
                        </span>
                      </div>
                      <div className="rounded-[10px] border border-warning/30 border-l-[3px] border-l-[var(--fb-warning-fg)] bg-surface p-[10px_14px] text-[13px] text-warning">
                        <strong className="text-warning">Cost context.</strong> If the buyer
                        escalates to T2 after the T1 decision, you&apos;ll be required to deposit
                        $12.00 within 48 hours to contest. Forfeiting the deposit = automatic loss
                        of the panel review.
                      </div>
                      <p>
                        Shall I draft your written response statement based on your evidence?
                        I&apos;ll keep it factual and neutral.
                      </p>
                    </div>
                  </div>
                </div>

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
                    Your evidence · 3 items
                  </h2>
                </div>
                <span className="font-mono text-[11px] text-ink-muted">
                  Window closes with T1 decision
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
                            ? "items-start justify-start bg-gradient-to-b from-[var(--bg-sunken)] to-[var(--bg-sunken)] p-[10px_14px] text-left leading-[1.5] text-ink"
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

            {/* Response composer */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Required
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">
                    Submit your response
                  </h2>
                </div>
                <StatusPill variant="urgent">Due in 41h 24m</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                <div className="mb-2.5 text-[13px] text-ink-muted">
                  Your AI Advocate drafted this statement from your evidence. Edit freely before
                  submitting.
                </div>
                <textarea
                  className="w-full min-h-[150px] resize-y rounded-xl border border-line bg-surface-sunken px-4 py-3.5 text-[14px] leading-[1.55] outline-none focus:border-ink"
                  defaultValue="Battery was 95% at time of sale, verified by EXIF-dated screenshot from Apr 12. The 13% decrease over 5 days is inconsistent with normal iOS usage patterns (typical 1–2% over 14 days). The device shipped sealed within 24 hours of the order. I listed in good faith with accurate, timestamped documentation and request the buyer's claim be denied."
                  readOnly
                />
                <div className="mt-3.5 flex items-center gap-2.5">
                  <button
                    type="button"
                    className="rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-ink-muted hover:bg-surface-sunken"
                  >
                    Save draft
                  </button>
                  <span className="ml-auto font-mono text-[12px] text-ink-muted">
                    321 chars · 58 words
                  </span>
                  <button
                    type="button"
                    className="rounded-[10px] bg-ink px-3.5 py-2.5 text-[14px] font-medium text-on-accent"
                  >
                    Submit response
                  </button>
                  <button
                    type="button"
                    className="rounded-[10px] border border-error/30 px-3.5 py-2.5 text-[14px] font-medium text-error hover:bg-error-soft"
                  >
                    Accept buyer&apos;s claim
                  </button>
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
                    Dispute cost · your exposure
                  </h2>
                </div>
                <StatusPill variant="closed">Loser pays</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                <div className="flex items-center justify-between rounded-none border-b border-line border-l-[3px] border-l-[var(--fb-info-fg)] bg-gradient-to-r from-info-soft to-transparent -mx-[22px] px-[22px] py-3">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                      T1
                    </span>
                    AI Review · current
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$3.00</span>
                </div>
                <div className="flex items-center justify-between border-b border-line py-3 text-ink-muted">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                      T2
                    </span>
                    Community Panel · deposit required
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$12.00</span>
                </div>
                <div className="flex items-center justify-between border-b border-line py-3 text-ink-muted">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-surface-sunken px-1.5 py-[2px] font-mono text-[10px] font-semibold text-ink-secondary">
                      T3
                    </span>
                    Grand Panel · deposit required
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$30.00</span>
                </div>
                <div className="flex items-center justify-between border-b border-line py-3">
                  <span className="text-[14px] text-ink-muted">Your payout if you win</span>
                  <span className="font-mono text-[14px] font-semibold text-success">$500.00</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-[14px] text-ink-muted">Your payout if you lose (T1)</span>
                  <span className="font-mono text-[14px] font-semibold text-error">
                    $0 (full refund to buyer)
                  </span>
                </div>
                <div className="mt-3.5 flex gap-2.5 rounded-[10px] border border-line bg-surface-sunken p-[12px_14px] text-[13px] text-ink-muted">
                  <span>&#x26A0;&#xFE0F;</span>
                  <span>
                    <strong className="text-ink">Seller deposits.</strong> At T2 and T3, you must
                    post the deposit to contest. The deposit is refunded if you win, forfeited if
                    you lose. This is a fairness mechanism that prevents bad-faith listings — not a
                    fee on honest sellers.
                  </span>
                </div>
              </div>
            </section>

            {/* Activity */}
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex items-center justify-between border-b border-line px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Activity
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">Case activity</h2>
                </div>
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
            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="border-b border-line px-[22px] py-4">
                <h2 className="text-[14px] font-semibold">Case summary</h2>
              </div>
              <div className="px-[22px] pt-1.5 pb-4">
                <SummaryRow k="Case ID" v="#DSP-2847" mono />
                <SummaryRow
                  k="Status"
                  v={<StatusPill variant="waiting">Waiting for you</StatusPill>}
                />
                <SummaryRow k="Tier" v="T1 · AI Review" />
                <SummaryRow k="Item" v="iPhone 14 Pro" />
                <SummaryRow k="Amount" v="$500.00" mono />
                <SummaryRow k="Escrow" v="$500.00 held" mono emerald />
                <SummaryRow k="Your advocate" v="Active" violet />
              </div>
            </section>

            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="px-[18px] py-4">
                <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Respond by
                </div>
                <div className="py-2.5 text-center font-mono text-[22px] font-semibold tracking-[-0.01em] text-warning">
                  41:24:08
                </div>
                <div className="mb-3.5 text-center font-mono text-[11px] text-ink-muted">
                  Apr 21 · 14:32 UTC
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    className="w-full rounded-[10px] bg-ink px-3.5 py-2.5 text-[14px] font-medium text-on-accent"
                  >
                    Submit response
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-[10px] border border-error/30 px-3.5 py-2.5 text-[14px] font-medium text-error hover:bg-error-soft"
                  >
                    Accept buyer&apos;s claim
                  </button>
                </div>
                <div className="my-[18px] h-px bg-line" />
                <div className="text-[11px] leading-[1.5] text-ink-muted">
                  Accepting releases the escrow to the buyer and closes the case. No appeal is
                  possible after acceptance.
                </div>
              </div>
            </section>

            <section className="rounded-[14px] border border-line bg-surface-raised shadow-sm">
              <div className="flex gap-2.5 px-4 py-3.5">
                <span className="text-[18px]">&#x1F6E1;</span>
                <div className="text-[12px] leading-[1.5] text-ink-muted">
                  <strong className="text-ink">
                    Your advocate is neutral in tone, biased for you in strategy.
                  </strong>{" "}
                  It will surface weaknesses in your position privately so you can address them
                  before the arbiter sees them.
                </div>
              </div>
            </section>
          </aside>
        </div>

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
  violet,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  emerald?: boolean;
  violet?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-b-0">
      <span className="text-ink-muted">{k}</span>
      <span
        className={`font-medium ${mono ? "font-mono text-[12px]" : ""} ${emerald ? "text-success" : ""} ${violet ? "text-badge-text" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}
