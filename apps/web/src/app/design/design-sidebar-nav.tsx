"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

export function DesignSidebarNav({ overview, groups }: { overview: NavItem; groups: NavGroup[] }) {
  const pathname = usePathname();

  const link = (item: NavItem) => {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "block rounded-lg px-3 py-1.5 text-sm transition",
          active ? "bg-surface-sunken font-medium text-ink" : "text-ink-secondary hover:text-ink",
        )}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="space-y-0.5">{link(overview)}</div>
      {groups.map((group) => (
        <div key={group.label} className="mt-4 space-y-0.5 border-line border-t pt-4">
          <div className="px-3 pb-1 font-semibold text-[11px] text-ink-secondary uppercase tracking-[0.08em]">
            {group.label}
          </div>
          {group.items.map(link)}
        </div>
      ))}
    </nav>
  );
}
