"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/demo/dispute", label: "Overview", exact: true },
  { href: "/demo/dispute/buyer", label: "Buyer", color: "cyan" },
  { href: "/demo/dispute/seller", label: "Seller", color: "violet" },
  { href: "/demo/dispute/panel", label: "Panel (T2)", color: "amber" },
  { href: "/demo/dispute/reviewer", label: "Reviewer", color: "emerald" },
] as const;

export function DisputeNav() {
  const pathname = usePathname();

  function isActive(tab: (typeof tabs)[number]) {
    if ("exact" in tab && tab.exact) return pathname === tab.href;
    return pathname.startsWith(tab.href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[#eae7df] bg-[#faf9f6]/[0.88] backdrop-blur-[12px] backdrop-saturate-[1.2]">
      <div className="mx-auto flex max-w-[1280px] items-center gap-5 px-7 py-3">
        <Link href="/demo/dispute" className="flex items-center gap-[9px] font-bold text-[15px] tracking-[-0.02em]">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-[#111113] font-mono text-[13px] font-bold text-white">H</span>
          Haggle
          <span className="ml-0.5 border-l border-[#eae7df] pl-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b6b75]">Resolution Center</span>
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
                    ? "border border-[#eae7df] bg-white text-[#111113] shadow-sm"
                    : "text-[#6b6b75] hover:text-[#111113] hover:bg-[#fbfaf7]"
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
