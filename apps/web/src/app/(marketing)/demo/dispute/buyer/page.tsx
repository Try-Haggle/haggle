"use client";

import { useState } from "react";
import Link from "next/link";
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
  { type: "Photo · battery status", ts: "Apr 19 · 14:35", thumb: "[ battery screenshot 82% ]", isText: false },
  { type: "Photo · listing page", ts: "Apr 19 · 14:36", thumb: "[ listing screenshot 95% ]", isText: false },
  { type: "Statement", ts: "Apr 19 · 14:32", thumb: "Battery measured 82% at unboxing, well below the 95% condition advertised. Ran Apple's built-in diagnostic twice...", isText: true },
];

const activityLog = [
  { ts: "Apr 19 · 15:01 UTC", icon: "active" as const, text: <><strong>AI Arbiter</strong> reviewing case · estimated 8 min remaining</> },
  { ts: "Apr 19 · 14:58 UTC", icon: "ok" as const, text: <>Seller AI Advocate submitted response with 2 counter-evidence items</> },
  { ts: "Apr 19 · 14:40 UTC", icon: "default" as const, text: <>Seller <strong>@mike_deals</strong> acknowledged the dispute</> },
  { ts: "Apr 19 · 14:36 UTC", icon: "ok" as const, text: <>Evidence uploaded · 2 photos, 1 statement · hash <span className="font-mono text-[#9a9aa3]">0x7f2c...a4</span></> },
  { ts: "Apr 19 · 14:32 UTC", icon: "ok" as const, text: <>Dispute opened · reason <strong>ITEM_NOT_AS_DESCRIBED</strong></> },
];

/* ── Component ────────────────────────── */

export default function DisputeBuyerPage() {
  const [advocateTab, setAdvocateTab] = useState<"conversation" | "analysis">("conversation");

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#111113]">
      <DisputeNav />

      <main className="mx-auto max-w-[1180px] px-7 py-7">
        {/* Breadcrumbs */}
        <div className="mb-[18px] flex items-center gap-2 font-mono text-[12px] text-[#6b6b75]">
          <Link href="/demo/dispute" className="hover:text-[#111113]">Cases</Link>
          <span className="text-[#9a9aa3]">/</span>
          <span>Open</span>
          <span className="text-[#9a9aa3]">/</span>
          <span>DSP-2847</span>
        </div>

        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* LEFT column */}
          <div className="space-y-5">

            {/* Case Header */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white p-6 shadow-sm">
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex gap-2">
                  <StatusPill variant="open">Open</StatusPill>
                  <StatusPill variant="review">T1 · AI Review</StatusPill>
                </div>
                <span className="font-mono text-[12px] text-[#6b6b75]">Case · <strong className="text-[#111113]">#DSP-2847</strong></span>
              </div>
              <h1 className="flex flex-wrap items-baseline gap-3.5 text-[24px] font-semibold tracking-[-0.02em]">
                iPhone 14 Pro 128GB
                <span className="font-mono font-medium">$500.00</span>
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-[#6b6b75]">
                <span className="flex items-center gap-2">
                  <span className="h-[22px] w-[22px] rounded-full" style={{ background: "linear-gradient(135deg, #cfd8e3, #9ba7b8)" }} />
                  Seller <strong className="text-[#111113]">@mike_deals</strong>
                </span>
                <span className="rounded-full border border-[#e2e8f0] bg-[#f1f5f9] px-[7px] py-[2px] font-mono text-[10px] font-semibold text-[#475569]">Trust 72</span>
                <span className="h-[3px] w-[3px] rounded-full bg-[#9a9aa3]" />
                <span>Reason: <strong className="text-[#2a2a30]">Item not as described</strong></span>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-7 border-t border-[#f0ede5] pt-4">
                <MetaItem label="Opened" value="Apr 19, 2026 · 14:32 UTC" mono />
                <MetaItem label="Current tier" value="T1 · AI Review" />
                <MetaItem label="Escrow" value="$500.00 held" mono />
                <MetaItem label="Decision ETA" value="~8 min" mono />
              </div>
            </section>

            {/* Timeline */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0ede5] px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Progress</div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">Dispute lifecycle</h2>
                </div>
                <StatusPill variant="review">Step 3 of 5</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                <div className="relative grid grid-cols-5">
                  {/* Track */}
                  <div className="absolute left-[12%] right-[12%] top-[13px] h-[2px] bg-[#eae7df]" />
                  <div className="absolute left-[12%] top-[13px] h-[2px] bg-[#111113]" style={{ width: "50%" }} />
                  {timelineSteps.map((s, i) => (
                    <div key={i} className="relative flex flex-col items-center gap-2">
                      <div className={`relative z-[1] grid h-[26px] w-[26px] place-items-center rounded-full text-[11px] transition-all ${
                        s.status === "done"
                          ? "border-2 border-[#111113] bg-[#111113] text-white"
                          : s.status === "active"
                            ? "border-2 border-[#111113] bg-white text-[#111113]"
                            : "border-2 border-[#eae7df] bg-white text-[#6b6b75]"
                      }`}>
                        {s.status === "done" ? "\u2713" : i + 1}
                      </div>
                      <div className={`text-[12px] font-medium text-center ${s.status === "pending" ? "text-[#6b6b75]" : "text-[#111113]"}`}>{s.label}</div>
                      <div className="text-center font-mono text-[10px] text-[#6b6b75]">{s.ts}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* AI Advocate */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0ede5] px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#0891b2]">Your AI Advocate</div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">Building your case · Analyzing evidence</h2>
                </div>
                <div className="inline-flex gap-0.5 rounded-[10px] border border-[#eae7df] bg-[#fbfaf7] p-[3px]">
                  <button onClick={() => setAdvocateTab("conversation")} className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium transition-all ${advocateTab === "conversation" ? "bg-white text-[#111113] shadow-sm" : "text-[#6b6b75] hover:text-[#111113]"}`}>Conversation</button>
                  <button onClick={() => setAdvocateTab("analysis")} className={`rounded-[7px] px-3.5 py-[7px] text-[13px] font-medium transition-all ${advocateTab === "analysis" ? "bg-white text-[#111113] shadow-sm" : "text-[#6b6b75] hover:text-[#111113]"}`}>Analysis</button>
                </div>
              </div>
              <div className="px-[22px] py-5">
                <div className="flex flex-col gap-3.5">
                  {/* AI message 1 */}
                  <div className="max-w-[88%] self-start rounded-xl border border-[#eae7df] border-l-[3px] border-l-[#0891b2] bg-[#fbfaf7] p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-[#6b6b75]">
                      <span className="font-semibold text-[#0891b2]">Advocate</span>
                      <span>· Summary drafted</span>
                      <span className="ml-auto">14:34 UTC</span>
                    </div>
                    <div className="space-y-2 text-[14px] leading-[1.55] text-[#2a2a30]">
                      <p>I&apos;ve reviewed your submission. Here&apos;s your case summary:</p>
                      <div className="flex gap-3.5">
                        <div className="flex-1 rounded-[10px] border border-[#eae7df] bg-white p-[12px_14px]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#6b6b75]">Key claim</div>
                          <div className="text-[13px]">Battery health listed at <strong>95%</strong> → measured <strong>82%</strong></div>
                        </div>
                        <div className="flex-1 rounded-[10px] border border-[#eae7df] bg-white p-[12px_14px]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#6b6b75]">Market impact</div>
                          <div className="text-[13px]">13% degradation ≈ <strong className="font-mono">$65</strong> value reduction</div>
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-[#eae7df] bg-white p-[12px_14px]">
                        <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-[#6b6b75]">Evidence bundle</div>
                        <div className="text-[13px]">2 photos · 1 listing screenshot · 1 written statement — all hash-anchored on-chain</div>
                      </div>
                      {/* Strength meter */}
                      <div className="flex items-center gap-2.5 py-1">
                        <span className="min-w-[130px] text-left font-mono text-[12px] text-[#6b6b75]">Strength assessment</span>
                        <div className="flex-1 h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
                          <div className="h-full rounded-full" style={{ width: "85%", background: "linear-gradient(90deg, #0891b2, #059669)" }} />
                        </div>
                        <span className="min-w-[110px] text-right font-mono text-[12px] font-semibold"><strong>85%</strong> · Strong</span>
                      </div>
                      <p>The 13% discrepancy exceeds the platform&apos;s 5% tolerance threshold for listed condition specs. The listing screenshot confirms the original claim. My recommendation: <strong>proceed with the current T1 review</strong> — evidence is likely sufficient without escalation.</p>
                    </div>
                  </div>

                  {/* User message */}
                  <div className="max-w-[70%] self-end rounded-xl bg-[#111113] p-[10px_14px] text-[14px] text-white">
                    What happens next?
                  </div>

                  {/* AI message 2 */}
                  <div className="max-w-[88%] self-start rounded-xl border border-[#eae7df] border-l-[3px] border-l-[#0891b2] bg-[#fbfaf7] p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-[#6b6b75]">
                      <span className="font-semibold text-[#0891b2]">Advocate</span>
                      <span className="ml-auto">14:36 UTC</span>
                    </div>
                    <div className="space-y-2 text-[14px] leading-[1.55] text-[#2a2a30]">
                      <p>Your case is now with the <strong>AI Arbiter</strong> (Tier 1). The Arbiter examines both sides&apos; materials and returns a decision within minutes. You&apos;ll be notified when it&apos;s posted.</p>
                      <p>If you disagree with the T1 outcome, you can escalate to a <strong>Community Panel</strong> (Tier 2, 9 reviewers).</p>
                      <div className="rounded-[10px] border border-[#fde68a] border-l-[3px] border-l-[#b45309] bg-[#fffaf0] p-[10px_14px] text-[13px] text-[#7c4a0c]">
                        <strong className="text-[#b45309]">Heads up.</strong> Escalation adds a $12.00 dispute cost. If you escalate and lose the panel review, that cost is deducted from your refund. If you win, it&apos;s fully refunded.
                      </div>
                    </div>
                  </div>

                  {/* AI message 3 - typing */}
                  <div className="max-w-[88%] self-start rounded-xl border border-[#eae7df] border-l-[3px] border-l-[#0891b2] bg-[#fbfaf7] p-[14px_16px]">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em] text-[#6b6b75]">
                      <span className="font-semibold text-[#0891b2]">Advocate</span>
                      <span>· Reviewing seller response</span>
                      <span className="ml-auto">15:01 UTC</span>
                    </div>
                    <div className="text-[14px] leading-[1.55] text-[#2a2a30]">
                      <p>Seller has submitted a counter-claim including an EXIF-dated screenshot.</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[#9a9aa3]">
                        Cross-referencing
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9a9aa3]" style={{ animationDelay: "0ms" }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9a9aa3]" style={{ animationDelay: "150ms" }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9a9aa3]" style={{ animationDelay: "300ms" }} />
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Chat input */}
                <div className="mt-[18px] flex items-center gap-2 rounded-xl border border-[#eae7df] bg-white px-3.5 py-2 focus-within:border-[#2a2a30]">
                  <input type="text" placeholder="Ask your AI Advocate..." className="flex-1 border-none bg-transparent py-1.5 text-[14px] outline-none placeholder:text-[#9a9aa3]" readOnly />
                  <span className="rounded border border-[#eae7df] bg-[#fbfaf7] px-[5px] py-[2px] font-mono text-[10px] text-[#6b6b75]">&crarr;</span>
                  <button className="rounded-[10px] bg-[#111113] px-3 py-[7px] text-[13px] font-medium text-white">Send</button>
                </div>
              </div>
            </section>

            {/* Evidence */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0ede5] px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Supporting materials</div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">Evidence submitted · 3 items</h2>
                </div>
                <span className="font-mono text-[11px] text-[#6b6b75]">All hashes anchored · block 18,402,117</span>
              </div>
              <div className="px-[22px] py-5">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {evidenceItems.map((ev, i) => (
                    <div key={i} className="cursor-pointer overflow-hidden rounded-xl border border-[#eae7df] bg-white transition-all hover:-translate-y-[1px] hover:shadow-md">
                      <div className={`grid h-[110px] place-items-center border-b border-[#eae7df] font-mono text-[11px] text-[#6b6b75] ${
                        ev.isText
                          ? "items-start justify-start bg-gradient-to-b from-[#fbfaf7] to-[#f4f1ea] p-[10px_14px] text-left leading-[1.5] text-[#2a2a30]"
                          : "bg-[repeating-linear-gradient(45deg,#f0ede5,#f0ede5_8px,#ebe7dd_8px,#ebe7dd_16px)]"
                      }`}>
                        {ev.thumb}
                      </div>
                      <div className="p-[10px_12px]">
                        <div className="text-[13px] font-medium">{ev.type}</div>
                        <div className="font-mono text-[11px] text-[#6b6b75]">{ev.ts}</div>
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-[#ede9fe] bg-[#f5f3ff] px-[7px] py-[2px] font-mono text-[10px] font-semibold text-[#7c3aed]">
                          &#x26D3; Anchored
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Upload card */}
                  <div className="flex min-h-[158px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-[#e2ded3] text-[13px] text-[#6b6b75] transition-all hover:border-[#111113] hover:bg-[#fbfaf7] hover:text-[#111113]">
                    <span className="grid h-7 w-7 place-items-center rounded-full border border-[#eae7df] bg-[#fbfaf7] text-[16px]">+</span>
                    <span>Add more evidence</span>
                    <span className="text-[11px] text-[#9a9aa3]">Photo · doc · text</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Cost breakdown */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0ede5] px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Transparency</div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">Dispute cost breakdown</h2>
                </div>
                <StatusPill variant="closed">Loser pays</StatusPill>
              </div>
              <div className="px-[22px] py-5">
                {/* T1 current */}
                <div className="flex items-center justify-between rounded-none border-b border-[#f0ede5] border-l-[3px] border-l-[#0891b2] bg-gradient-to-r from-[#ecfeff] to-transparent -mx-[22px] px-[22px] py-3">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-[#f1f5f9] px-1.5 py-[2px] font-mono text-[10px] font-semibold text-[#475569]">T1</span>
                    AI Review · current
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$3.00</span>
                </div>
                {/* T2 */}
                <div className="flex items-center justify-between border-b border-[#f0ede5] py-3 text-[#6b6b75]">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-[#f1f5f9] px-1.5 py-[2px] font-mono text-[10px] font-semibold text-[#475569]">T2</span>
                    Community Panel · if escalated
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$12.00</span>
                </div>
                {/* T3 */}
                <div className="flex items-center justify-between border-b border-[#f0ede5] py-3 text-[#6b6b75]">
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="rounded bg-[#f1f5f9] px-1.5 py-[2px] font-mono text-[10px] font-semibold text-[#475569]">T3</span>
                    Grand Panel · if escalated
                  </div>
                  <span className="font-mono text-[14px] font-semibold">$30.00</span>
                </div>
                {/* Escrow */}
                <div className="flex items-center justify-between py-3">
                  <span className="text-[14px] text-[#6b6b75]">Escrow held in smart contract</span>
                  <span className="font-mono text-[14px] font-semibold">$500.00</span>
                </div>
                {/* Note */}
                <div className="mt-3.5 flex gap-2.5 rounded-[10px] border border-[#f0ede5] bg-[#fbfaf7] p-[12px_14px] text-[13px] text-[#6b6b75]">
                  <span>&#x2139;&#xFE0F;</span>
                  <span><strong className="text-[#111113]">You only pay if you lose.</strong> Winner&apos;s costs are fully refunded. 70% of the dispute fee goes to community reviewers, 30% to platform operations.</span>
                </div>
              </div>
            </section>

            {/* Activity log */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-[#f0ede5] px-[22px] py-4">
                <div>
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Activity</div>
                  <h2 className="text-[14px] font-semibold tracking-[-0.005em]">Case status updates</h2>
                </div>
                <button className="rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-[#6b6b75] hover:bg-[#fbfaf7] hover:text-[#111113]">Export log</button>
              </div>
              <div className="px-[22px] py-5">
                {activityLog.map((a, i) => (
                  <div key={i} className={`grid grid-cols-[160px_20px_1fr] items-baseline gap-4 py-3.5 ${i < activityLog.length - 1 ? "border-b border-[#f0ede5]" : ""}`}>
                    <div className="font-mono text-[12px] text-[#6b6b75]">{a.ts}</div>
                    <div className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] ${
                      a.icon === "active" ? "border border-[#111113] bg-[#111113] text-white"
                        : a.icon === "ok" ? "border border-[#bbf7d0] bg-[#ecfdf5] text-[#059669]"
                          : "border border-[#eae7df] bg-[#fbfaf7] text-[#6b6b75]"
                    }`}>
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
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="border-b border-[#f0ede5] px-[22px] py-4">
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
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="px-[18px] py-4">
                <div className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[#6b6b75]">Next actions</div>
                <div className="space-y-2">
                  <button className="w-full rounded-[10px] border border-[#eae7df] bg-white px-3.5 py-2.5 text-[14px] font-medium hover:border-[#2a2a30] hover:bg-[#fbfaf7]">Escalate to T2 · $12</button>
                  <button className="w-full rounded-[10px] border border-[#eae7df] bg-white px-3.5 py-2.5 text-[14px] font-medium hover:border-[#2a2a30] hover:bg-[#fbfaf7]">Accept T1 decision</button>
                  <button className="w-full rounded-[10px] border border-[#fecaca] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#dc2626] hover:border-[#dc2626] hover:bg-[#fef2f2]">Withdraw dispute</button>
                </div>
                <div className="my-[18px] h-px bg-[#eae7df]" />
                <div className="text-[11px] leading-[1.5] text-[#6b6b75]">
                  Escalation is available once the T1 decision is posted. Withdrawing closes the case — the $3 T1 cost is charged to the losing party at settlement.
                </div>
              </div>
            </section>

            {/* On-chain note */}
            <section className="rounded-[14px] border border-[#eae7df] bg-white shadow-sm">
              <div className="flex gap-2.5 px-4 py-3.5">
                <span className="text-[18px]">&#x26D3;</span>
                <div className="text-[12px] leading-[1.5] text-[#6b6b75]">
                  <strong className="text-[#111113]">On-chain anchored.</strong> Every evidence hash and case state change is committed to the Haggle ledger so records stay tamper-proof.
                </div>
              </div>
            </section>
          </aside>
        </div>

        {/* Footer */}
        <footer className="mt-9 flex justify-between border-t border-[#eae7df] pt-[22px] text-[12px] text-[#6b6b75]">
          <span className="font-mono">Haggle Resolution Center · v2026.4</span>
          <span className="flex gap-2">
            <span>Policies</span> · <span>Reviewer guidelines</span> · <span>Transparency report</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

/* ── Sub-components ───────────────────── */

function StatusPill({ variant, children }: { variant: "open" | "review" | "waiting" | "resolved" | "closed" | "urgent"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    open: "bg-[#fef3c7] text-[#b45309] border-[#fde68a]",
    review: "bg-[#ecfeff] text-[#0891b2] border-[#cffafe]",
    waiting: "bg-[#f5f3ff] text-[#7c3aed] border-[#ede9fe]",
    resolved: "bg-[#ecfdf5] text-[#059669] border-[#bbf7d0]",
    closed: "bg-[#f1f5f9] text-[#475569] border-[#e2e8f0]",
    urgent: "bg-[#fef2f2] text-[#dc2626] border-[#fecaca]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-[9px] py-[4px] font-mono text-[11px] font-semibold uppercase tracking-[0.04em] ${styles[variant]}`}>
      {(variant === "open" || variant === "waiting" || variant === "resolved" || variant === "urgent") && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#6b6b75]">{label}</span>
      <span className={`text-[14px] font-medium ${mono ? "font-mono text-[13px]" : ""}`}>{value}</span>
    </div>
  );
}

function SummaryRow({ k, v, mono, emerald, cyan }: { k: string; v: React.ReactNode; mono?: boolean; emerald?: boolean; cyan?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[#f0ede5] py-2.5 text-[13px] last:border-b-0">
      <span className="text-[#6b6b75]">{k}</span>
      <span className={`font-medium ${mono ? "font-mono text-[12px]" : ""} ${emerald ? "text-[#059669]" : ""} ${cyan ? "text-[#0891b2]" : ""}`}>{v}</span>
    </div>
  );
}
