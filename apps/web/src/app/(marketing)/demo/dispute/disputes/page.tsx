"use client";

import Link from "next/link";
import { useState } from "react";
import { DisputeNav } from "../_components/dispute-nav";

/* ------------------------------------------------------------------ */
/*  Static data from HTML prototype                                    */
/* ------------------------------------------------------------------ */

type RoleTab = "all" | "buyer" | "seller";

type DisputeStatus = "urgent" | "review" | "open" | "resolved";
type Role = "buyer" | "seller";

interface Dispute {
  id: string;
  caseId: string;
  status: DisputeStatus;
  emoji: string;
  name: string;
  tier: string;
  reason: string;
  role: Role;
  counterparty: string;
  counterpartyTrust: number;
  opened: string;
  price: string;
  href: string;
  /** For urgent row */
  urgentLabel?: string;
  /** Status line */
  statusLine: {
    label: string;
    countdown?: { text: string; variant: "urgent" | "warn" | "resolved" };
    decision?: string;
    anchor?: { label: string; hash: string };
  };
  /** Resolved-only fields */
  resolvedPill?: { label: string; color: "cyan" | "amber" | "violet" };
  resolvedDate?: string;
  /** Whether to show respond CTA */
  showRespond?: boolean;
}

const disputes: Dispute[] = [
  {
    id: "1",
    caseId: "#DSP-2847",
    status: "urgent",
    emoji: "📱",
    name: "iPhone 14 Pro 128GB",
    tier: "T1",
    reason: "Item not as described",
    role: "seller",
    counterparty: "@jenny_lee",
    counterpartyTrust: 88,
    opened: "Apr 19, 2026",
    price: "",
    href: "/demo/dispute/seller",
    urgentLabel: "Response required",
    showRespond: true,
    statusLine: {
      label: "Respond by Apr 21 · 14:32 UTC",
      countdown: { text: "36h remaining", variant: "urgent" },
    },
  },
  {
    id: "2",
    caseId: "#DSP-2846",
    status: "review",
    emoji: "💻",
    name: 'MacBook Air M2 13"',
    tier: "T2",
    reason: "Not as described",
    role: "buyer",
    counterparty: "@mike_deals",
    counterpartyTrust: 72,
    opened: "Apr 19, 2026",
    price: "$1,200.00",
    href: "/demo/dispute/panel",
    statusLine: {
      label: "Decision expected in",
      decision: "~8 min",
    },
  },
  {
    id: "3",
    caseId: "#DSP-2845",
    status: "open",
    emoji: "🎧",
    name: "Sony WH-1000XM5 Headphones",
    tier: "T1",
    reason: "Item arrived damaged",
    role: "buyer",
    counterparty: "@sound_house",
    counterpartyTrust: 91,
    opened: "Apr 18, 2026",
    price: "$350.00",
    href: "/demo/dispute/buyer",
    statusLine: {
      label: "Respond by Apr 21 · 09:15 UTC",
      countdown: { text: "27h remaining", variant: "warn" },
    },
  },
  {
    id: "4",
    caseId: "#DSP-2821",
    status: "resolved",
    emoji: "👜",
    name: "Louis Vuitton Neverfull MM",
    tier: "T1",
    reason: "",
    role: "buyer",
    counterparty: "",
    counterpartyTrust: 0,
    opened: "Apr 14, 2026",
    price: "$450.00",
    href: "/demo/dispute/buyer",
    resolvedPill: { label: "Buyer favor", color: "cyan" },
    resolvedDate: "Resolved Apr 22, 2026",
    statusLine: {
      label: "",
      anchor: { label: "Anchored on-chain", hash: "0x8f2a…b7c1" },
    },
  },
  {
    id: "5",
    caseId: "#DSP-2817",
    status: "resolved",
    emoji: "⌚",
    name: "Rolex Datejust 36",
    tier: "T1",
    reason: "",
    role: "seller",
    counterparty: "",
    counterpartyTrust: 0,
    opened: "Apr 10, 2026",
    price: "$850.00",
    href: "/demo/dispute/buyer",
    resolvedPill: { label: "Partial refund", color: "amber" },
    resolvedDate: "Resolved Apr 20, 2026",
    statusLine: {
      label: "",
      anchor: { label: "Anchored on-chain", hash: "0x3c4f…a1d9" },
    },
  },
  {
    id: "6",
    caseId: "#DSP-2790",
    status: "resolved",
    emoji: "👟",
    name: "Nike Air Jordan 1 Retro · size 10",
    tier: "T1",
    reason: "",
    role: "seller",
    counterparty: "",
    counterpartyTrust: 0,
    opened: "Apr 12, 2026",
    price: "$280.00",
    href: "/demo/dispute/buyer",
    resolvedPill: { label: "Seller favor", color: "violet" },
    resolvedDate: "Resolved Apr 18, 2026",
    statusLine: {
      label: "",
      anchor: { label: "Anchored on-chain", hash: "0xe421…9b02" },
    },
  },
  {
    id: "7",
    caseId: "#DSP-2744",
    status: "resolved",
    emoji: "📷",
    name: "Sony A7 IV + 28-70mm kit",
    tier: "T1",
    reason: "",
    role: "buyer",
    counterparty: "",
    counterpartyTrust: 0,
    opened: "Apr 02, 2026",
    price: "$2,100.00",
    href: "/demo/dispute/buyer",
    resolvedPill: { label: "Buyer favor", color: "cyan" },
    resolvedDate: "Resolved Apr 06, 2026",
    statusLine: {
      label: "",
      anchor: { label: "Anchored on-chain", hash: "0x11f0…c3a8" },
    },
  },
];

const statCards = [
  {
    key: "open",
    num: 2,
    label: "Open",
    dotColor: "bg-warning",
    iconBg: "bg-warning-soft",
    iconColor: "text-warning",
  },
  {
    key: "review",
    num: 1,
    label: "Under Review",
    dotColor: "bg-info",
    iconBg: "bg-info-soft",
    iconColor: "text-info",
  },
  {
    key: "waiting",
    num: 1,
    label: "Waiting",
    dotColor: "bg-badge-text",
    iconBg: "bg-badge",
    iconColor: "text-badge-text",
  },
  {
    key: "resolved",
    num: 3,
    label: "Resolved",
    dotColor: "bg-success",
    iconBg: "bg-success-soft",
    iconColor: "text-success",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  SVG Icons                                                          */
/* ------------------------------------------------------------------ */

function ScaleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v18" />
      <path d="M5 21h14" />
      <path d="M5 7h14" />
      <path d="M19 7l-3 7a4 4 0 0 0 6 0z" />
      <path d="M5 7l-3 7a4 4 0 0 0 6 0z" />
    </svg>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function HourglassIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22" />
      <path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2" />
    </svg>
  );
}

function MagnifyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertTriangleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ArrowRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function LinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ChevLeftIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Status pill helper                                                 */
/* ------------------------------------------------------------------ */

const statusPillClasses: Record<DisputeStatus, string> = {
  urgent: "bg-badge text-badge-text border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
  review: "bg-info-soft text-info border-info/30",
  open: "bg-warning-soft text-warning border-warning/30",
  resolved: "bg-success-soft text-success border-success/30",
};

const statusLabels: Record<DisputeStatus, string> = {
  urgent: "Waiting",
  review: "Under review",
  open: "Open",
  resolved: "Resolved",
};

const resolvedPillColors: Record<string, string> = {
  cyan: "bg-info-soft text-info border-info/30",
  amber: "bg-warning-soft text-warning border-warning/30",
  violet: "bg-badge text-badge-text border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
};

/* ------------------------------------------------------------------ */
/*  Stat card icon                                                     */
/* ------------------------------------------------------------------ */

function StatIcon({ statKey }: { statKey: string }) {
  switch (statKey) {
    case "open":
      return <HourglassIcon />;
    case "review":
      return <MagnifyIcon />;
    case "waiting":
      return <ClockIcon />;
    case "resolved":
      return <CheckIcon />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function DisputesPage() {
  const [activeRole, setActiveRole] = useState<RoleTab>("all");
  const [activeStat, setActiveStat] = useState<string | null>(null);

  const activeDisputes = disputes.filter((d) => d.status !== "resolved");
  const resolvedDisputes = disputes.filter((d) => d.status === "resolved");

  return (
    <div className="min-h-screen bg-surface font-sans text-ink antialiased">
      <DisputeNav />

      <main className="mx-auto max-w-[1280px] px-7 pb-[60px] pt-7">
        {/* Breadcrumb */}
        <div className="mb-3.5 flex items-center gap-2 font-mono text-xs text-ink-muted">
          <ChevLeftIcon />
          <Link href="/demo/dispute" className="hover:text-ink">
            Resolution Center
          </Link>
        </div>

        {/* Title + Search */}
        <div className="mb-[22px] grid grid-cols-1 items-start gap-7 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div>
            <h1 className="my-1 flex items-center gap-3.5 text-[30px] font-semibold leading-none tracking-[-0.03em]">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-surface-sunken text-ink">
                <ScaleIcon />
              </span>
              My Disputes
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Track and manage your open and resolved cases.
            </p>
          </div>
          <div>
            <div className="group relative flex items-center rounded-[10px] border border-line bg-surface-raised px-3.5 py-2.5 pl-[38px] text-[13px] text-ink-muted transition-colors focus-within:border-ink focus-within:bg-surface-raised">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                className="flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
                placeholder="Search by case ID, item, or counterparty…"
              />
              <kbd className="rounded-[5px] border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                ⌘K
              </kbd>
            </div>
          </div>
        </div>

        {/* Role tabs + Stat cards */}
        <div className="mb-[18px] grid grid-cols-1 items-start gap-7 md:grid-cols-[minmax(0,auto)_1fr]">
          {/* Role tabs */}
          <div className="inline-flex gap-1.5" role="tablist">
            {(["all", "buyer", "seller"] as const).map((role) => {
              const counts = { all: 7, buyer: 4, seller: 3 };
              const labels = { all: "All", buyer: "Buyer", seller: "Seller" };
              const active = activeRole === role;
              return (
                <button
                  key={role}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveRole(role)}
                  className={`inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-[9px] text-[13px] font-semibold transition-all ${
                    active
                      ? "border-ink bg-ink text-on-accent"
                      : "border-line bg-surface-raised text-ink-muted hover:border-ink hover:text-ink"
                  }`}
                >
                  {labels[role]}
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${
                      active
                        ? "border border-transparent bg-white/[0.14] text-on-accent"
                        : "border border-line bg-surface-sunken text-ink-muted"
                    }`}
                  >
                    {counts[role]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {statCards.map((s) => {
              const isActive = activeStat === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveStat(isActive ? null : s.key)}
                  className={`flex items-center gap-3.5 rounded-xl border bg-surface-raised p-3.5 transition-all ${
                    isActive
                      ? "border-ink shadow-[0_0_0_1px_var(--text-primary)]"
                      : "border-line hover:border-ink"
                  }`}
                >
                  <div
                    className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-[10px] ${s.iconBg} ${s.iconColor}`}
                  >
                    <StatIcon statKey={s.key} />
                  </div>
                  <div className="text-left">
                    <div className="font-mono text-[28px] font-semibold leading-none tracking-[-0.02em]">
                      {s.num}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dotColor}`} />
                      {s.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-surface-raised px-3.5 py-2.5">
          <FilterSelect label="Status:" value="All" />
          <FilterSelect label="Tier:" value="All" />
          <FilterSelect label="Sort:" value="Newest first" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-[5px] text-xs font-medium text-on-accent">
            Needs my action
            <span className="cursor-pointer opacity-70 hover:opacity-100">&#10005;</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-[13px] text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <TrashIcon />
            Clear filters
          </button>
        </div>

        {/* Dispute list */}
        <div className="flex flex-col gap-2.5">
          {/* Active disputes */}
          {activeDisputes.map((d) => (
            <DisputeRow key={d.id} dispute={d} />
          ))}

          {/* Resolved group header */}
          <div className="mx-1 mt-4 mb-1.5 flex items-center gap-2.5 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <CheckIcon className="h-3 w-3" />
            Resolved · past 30 days
            <span className="flex-1 border-b border-line" />
          </div>

          {/* Resolved disputes */}
          {resolvedDisputes.map((d) => (
            <DisputeRow key={d.id} dispute={d} />
          ))}
        </div>

        {/* Pagination */}
        <div className="mt-[22px] flex items-center justify-between text-[13px] text-ink-muted">
          <span>
            Showing <strong className="font-mono text-ink">1–7</strong> of{" "}
            <strong className="font-mono text-ink">23</strong> disputes
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-transparent px-[11px] py-[7px] text-[13px] font-medium text-ink-muted opacity-50"
            >
              ← Previous
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface-raised px-[11px] py-[7px] text-[13px] font-medium text-ink hover:border-ink hover:bg-surface-sunken"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-[42px] flex flex-wrap justify-between border-t border-line pt-[22px] text-xs text-ink-muted">
          <span className="font-mono">Haggle Resolution Center · v2026.4</span>
          <span className="flex gap-1">
            <span className="cursor-pointer text-ink-muted hover:text-ink">Dispute policy</span> ·{" "}
            <span className="cursor-pointer text-ink-muted hover:text-ink">Loser-pays rules</span> ·{" "}
            <span className="cursor-pointer text-ink-muted hover:text-ink">Help</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter select (visual only)                                        */
/* ------------------------------------------------------------------ */

function FilterSelect({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-[7px] text-[13px] text-ink-secondary transition-colors hover:border-ink"
    >
      <span className="text-xs text-ink-muted">{label}</span>
      <span>{value}</span>
      <span className="ml-0.5 text-[10px] text-ink-muted">▾</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Dispute Row                                                        */
/* ------------------------------------------------------------------ */

function DisputeRow({ dispute: d }: { dispute: Dispute }) {
  /* Row accent & background classes */
  const rowAccent: Record<DisputeStatus, string> = {
    urgent: "before:bg-badge-text",
    review: "before:bg-info",
    open: "before:bg-warning",
    resolved: "before:bg-success",
  };

  const rowBg: Record<DisputeStatus, string> = {
    urgent:
      "bg-gradient-to-r from-[color-mix(in_srgb,var(--badge-bg)_80%,transparent)] to-surface-raised border-[color-mix(in_srgb,var(--badge-text)_30%,transparent)]",
    review: "border-line",
    open: "border-line",
    resolved: "border-line",
  };

  return (
    <Link
      href={d.href}
      className={`
        group relative grid cursor-pointer items-center gap-5 overflow-hidden rounded-[14px] border bg-surface-raised
        py-[18px] pr-5 pl-6
        transition-all hover:-translate-y-px hover:border-ink hover:shadow-[0_4px_12px_-2px_rgba(17,17,19,0.06),0_2px_4px_rgba(17,17,19,0.04)]
        before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r-sm
        ${rowAccent[d.status]} ${rowBg[d.status]}
        grid-cols-[72px_minmax(220px,1.3fr)_minmax(140px,1fr)_minmax(180px,1fr)_minmax(110px,auto)]
        max-lg:grid-cols-[56px_1fr_auto]
        lg:grid-cols-[72px_minmax(220px,1.3fr)_minmax(140px,1fr)_minmax(180px,1fr)_minmax(110px,auto)]
        xl:grid-cols-[80px_minmax(240px,1.6fr)_minmax(160px,1fr)_minmax(120px,auto)_minmax(180px,1fr)_minmax(120px,auto)]
      `}
    >
      {/* Thumbnail */}
      <div className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-xl border border-line bg-gradient-to-br from-surface-sunken to-surface-sunken max-lg:h-14 max-lg:w-14">
        <span
          className="text-[30px] max-lg:text-[22px]"
          style={{
            background:
              "repeating-linear-gradient(45deg, var(--bg-sunken), var(--bg-sunken) 10px, var(--bg-sunken) 10px, var(--bg-sunken) 20px)",
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
          }}
        >
          {d.emoji}
        </span>
      </div>

      {/* Item column */}
      <div className="min-w-0">
        {d.urgentLabel && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-badge-text">
            <AlertTriangleIcon />
            {d.urgentLabel}
          </div>
        )}
        <h3 className="truncate text-base font-semibold leading-tight tracking-[-0.01em]">
          {d.name}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs text-ink-muted">
          {/* Status pill */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-[9px] py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.04em] ${statusPillClasses[d.status]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {statusLabels[d.status]}
          </span>
          {/* Resolved outcome pill */}
          {d.resolvedPill && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-[9px] py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.04em] ${resolvedPillColors[d.resolvedPill.color]}`}
            >
              {d.resolvedPill.label}
            </span>
          )}
          {/* Tier chip */}
          <span className="rounded-[5px] border border-line bg-surface-sunken px-[7px] py-0.5 font-mono text-[10px] font-bold text-ink-secondary">
            {d.tier}
          </span>
          {/* Reason / refund text */}
          {d.reason && <span className="text-xs text-ink-muted">Reason: {d.reason}</span>}
          {d.status === "resolved" && d.resolvedPill?.label === "Buyer favor" && (
            <span className="text-xs text-ink-muted">Refund: {d.price}</span>
          )}
          {d.status === "resolved" && d.resolvedPill?.label === "Partial refund" && (
            <span className="text-xs text-ink-muted">Refund: $150.00</span>
          )}
          {d.status === "resolved" && d.resolvedPill?.label === "Seller favor" && (
            <span className="text-xs text-ink-muted">No refund · claim withdrawn</span>
          )}
        </div>
      </div>

      {/* Role column (hidden on small) */}
      <div className="text-xs leading-relaxed max-lg:hidden">
        <span className="mb-[3px] block font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
          Your role
        </span>
        <span
          className={`text-[13px] font-semibold ${d.role === "buyer" ? "text-info" : "text-badge-text"}`}
        >
          {d.role === "buyer" ? "Buyer" : "Seller"}
        </span>
        {d.counterparty ? (
          <div className="mt-[3px] text-xs text-ink-muted">
            {d.role === "buyer" ? "Seller" : "Buyer"}:{" "}
            <span className="font-medium text-ink-secondary">{d.counterparty}</span>
            <span className="ml-1 font-mono text-[10px] text-ink-muted">
              Trust {d.counterpartyTrust}
            </span>
          </div>
        ) : (
          d.resolvedDate && <div className="mt-[3px] text-xs text-ink-muted">{d.resolvedDate}</div>
        )}
      </div>

      {/* Opened column (hidden on lg and below) */}
      <div className="text-xs leading-relaxed max-xl:hidden">
        <span className="mb-[3px] block font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
          Opened
        </span>
        <span className="text-[13px] text-ink-secondary">{d.opened}</span>
      </div>

      {/* Status line column (hidden on small) */}
      <div className="min-w-0 text-xs leading-relaxed max-lg:hidden">
        {d.statusLine.label && (
          <span className="mb-[3px] block font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
            {d.statusLine.label}
          </span>
        )}
        {d.statusLine.countdown && (
          <span
            className={`mt-1 inline-flex items-center gap-1.5 font-mono text-xs ${
              d.statusLine.countdown.variant === "urgent"
                ? "text-badge-text"
                : d.statusLine.countdown.variant === "warn"
                  ? "text-warning"
                  : "text-success"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                d.statusLine.countdown.variant === "urgent"
                  ? "bg-badge-text animate-pulse"
                  : d.statusLine.countdown.variant === "warn"
                    ? "bg-warning"
                    : "bg-success"
              }`}
            />
            {d.statusLine.countdown.text}
          </span>
        )}
        {d.statusLine.decision && (
          <span className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-info">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
            {d.statusLine.decision}
          </span>
        )}
        {d.statusLine.anchor && (
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
              <LinkIcon />
              {d.statusLine.anchor.label}
            </span>
            <span className="mt-0.5 block inline-flex items-center gap-1 font-mono text-xs text-info hover:opacity-80">
              tx {d.statusLine.anchor.hash}
              <CopyIcon className="text-ink-muted" />
            </span>
          </div>
        )}
      </div>

      {/* Right column */}
      <div className="flex min-w-0 flex-col items-end gap-2">
        <span className="font-mono text-[11px] text-ink-muted">{d.caseId}</span>
        {d.showRespond ? (
          <span className="inline-flex items-center gap-2 rounded-[10px] border border-badge-text bg-badge-text px-[11px] py-[7px] text-[13px] font-semibold text-on-accent hover:opacity-90">
            Respond <ArrowRightIcon />
          </span>
        ) : (
          <>
            {d.price && (
              <span className="font-mono text-[17px] font-semibold tracking-[-0.01em]">
                {d.price}
              </span>
            )}
            <span className="text-lg leading-none text-ink-muted transition-all group-hover:translate-x-0.5 group-hover:text-ink">
              ›
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
