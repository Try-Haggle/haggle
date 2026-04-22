"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Mode = "selling" | "buying";

const SELL_TABS = [
  {
    label: "Dashboard",
    href: "/sell/dashboard",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="6" height="18" rx="1" />
        <rect x="9" y="9" width="6" height="12" rx="1" />
        <rect x="15" y="6" width="6" height="15" rx="1" />
      </svg>
    ),
  },
  {
    label: "Agents",
    href: "/sell/agents",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" />
        <path d="M9 13v2" />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/settings",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

const BUY_TABS = [
  {
    label: "Dashboard",
    href: "/buy/dashboard",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
    ),
  },
  {
    label: "Browse",
    href: "/browse",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
  },
  {
    label: "Agents",
    href: "/buy/agents",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" />
        <path d="M9 13v2" />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/settings",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={active ? "#06b6d4" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  // Derive mode from path, or localStorage for /l/ pages
  const deriveMode = (): Mode => {
    if (pathname.startsWith("/buy")) return "buying";
    if (pathname.startsWith("/sell")) return "selling";
    if (typeof window !== "undefined") {
      return (localStorage.getItem("haggle_mode") as Mode) ?? "buying";
    }
    return "buying";
  };
  const mode: Mode = deriveMode();
  const tabs = mode === "buying" ? BUY_TABS : SELL_TABS;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-slate-800 bg-bg-primary/95 backdrop-blur-md md:hidden">
      <div className="flex h-14 items-center justify-around">
        {tabs.map((tab) => {
          const isActive = tab.href === "/settings"
            ? pathname.startsWith("/settings")
            : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center gap-0.5"
            >
              {tab.icon(isActive)}
              <span className={`text-[10px] font-medium ${isActive ? "text-cyan-400" : "text-slate-500"}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
      {/* Safe area for iPhone home indicator */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
