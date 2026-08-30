"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useNotificationContext } from "@/app/(app)/_components/notification-provider";
import { NavTab } from "@/components/ui";

type Mode = "selling" | "buying";

const SELL_TABS = [
  {
    label: "Dashboard",
    href: "/sell/dashboard",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="6" height="18" rx="1" />
        <rect x="9" y="9" width="6" height="12" rx="1" />
        <rect x="15" y="6" width="6" height="15" rx="1" />
      </svg>
    ),
  },
  {
    label: "Agents",
    href: "/sell/agents",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
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
    label: "Inbox",
    href: "/notifications",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/profile",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
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
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
    ),
  },
  {
    label: "Browse",
    href: "/browse",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
  },
  {
    label: "Agents",
    href: "/buy/agents",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
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
    label: "Inbox",
    href: "/notifications",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/profile",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { unreadCount } = useNotificationContext();

  // Derive mode from path
  const pathMode: Mode | null = pathname.startsWith("/buy")
    ? "buying"
    : pathname.startsWith("/sell")
      ? "selling"
      : null;

  // For pages where path doesn't tell us the mode (e.g. /l/), read localStorage
  // — but only on the client to avoid SSR/hydration mismatch.
  const [storedMode, setStoredMode] = useState<Mode>("buying");
  useEffect(() => {
    if (pathMode === null) {
      setStoredMode((localStorage.getItem("haggle_mode") as Mode) ?? "buying");
    }
  }, [pathMode]);

  const mode: Mode = pathMode ?? storedMode;
  const tabs = mode === "buying" ? BUY_TABS : SELL_TABS;

  if (pathname.startsWith("/sell/listings/new")) {
    return null;
  }

  // An open conversation is a full-screen surface on a phone: the composer sits
  // where this bar would be, and a fixed bar over it hides the very control the
  // screen exists for.
  if (pathname === "/messages" && searchParams.get("c")) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-line border-t bg-surface/95 backdrop-blur-md md:hidden">
      <div className="flex h-14 items-center justify-around">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/profile"
              ? pathname.startsWith("/profile") || pathname.startsWith("/settings")
              : pathname.startsWith(tab.href);

          return (
            <NavTab
              key={tab.href}
              href={tab.href}
              label={tab.label}
              variant="stacked"
              icon={tab.icon}
              active={isActive}
              badge={tab.label === "Inbox" && unreadCount > 0}
            />
          );
        })}
      </div>
      {/* Safe area for iPhone home indicator */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
