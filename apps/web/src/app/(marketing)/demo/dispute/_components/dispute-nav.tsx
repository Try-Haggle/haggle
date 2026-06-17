"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/demo/dispute", label: "Overview", exact: true },
  { href: "/demo/dispute/disputes", label: "Disputes" },
  { href: "/demo/dispute/buyer", label: "Buyer (T1)", color: "cyan" },
  { href: "/demo/dispute/seller", label: "Seller (T1)", color: "violet" },
  { href: "/demo/dispute/reviewer-dashboard", label: "Reviewer Dashboard", color: "emerald" },
  { href: "/demo/dispute/reviewer-qualify", label: "Qualify Test", color: "emerald" },
  { href: "/demo/dispute/reviewer", label: "Reviewer Vote", color: "emerald" },
] as const;

export function DisputeNav() {
  const pathname = usePathname();

  function isActive(tab: (typeof tabs)[number]) {
    if ("exact" in tab && tab.exact) return pathname === tab.href;
    return pathname.startsWith(tab.href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--bg-primary)_88%,transparent)] backdrop-blur-[12px] backdrop-saturate-[1.2]">
      <div className="mx-auto flex max-w-[1280px] items-center gap-5 px-7 py-3">
        <Link
          href="/demo/dispute"
          className="flex items-center gap-[9px] font-bold text-[15px] tracking-[-0.02em]"
        >
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-ink font-mono text-[13px] font-bold text-on-accent">
            H
          </span>
          Haggle
          <span className="ml-0.5 border-l border-line pl-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-ink-muted">
            Resolution Center
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          {tabs.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg px-3 py-[7px] text-[13px] font-medium transition-colors ${
                  active
                    ? "border border-line bg-surface-raised text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink hover:bg-surface-sunken"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
