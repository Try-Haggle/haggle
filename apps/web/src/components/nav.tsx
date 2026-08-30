"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNotificationContext } from "@/app/(app)/_components/notification-provider";
import { Avatar, Logo, NavTab, NotificationItem, Spinner } from "@/components/ui";
import { useMessagesUnreadCount } from "@/hooks/use-messages-unread";
import { useTheme } from "@/hooks/use-theme";
import { type Notification, notificationApi } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

type Mode = "selling" | "buying";

interface NavProps {
  userEmail: string;
  userName?: string | null;
  userAvatarUrl?: string | null;
  modeOverride?: Mode;
}

/**
 * Tabs, per side of the deal — dashboard deliberately absent from both.
 *
 * The logo already goes to the current side's dashboard, which is the
 * convention everywhere else (GitHub, Linear, Vercel): the wordmark is home.
 * A "Dashboard" tab sitting next to it was a second door to the same room,
 * and the pair asked the reader to work out whether they differed. They did
 * not. The tabs are now the places that are NOT home.
 *
 * The consequence is that standing on the dashboard highlights nothing —
 * also the convention, and the honest reading: you are at the root, not in
 * a section.
 */
const SELL_TABS = [
  { label: "Orders", href: "/orders" },
  { label: "Agents", href: "/sell/agents" },
  // Last because it is the one tab that is not mode-specific: the two before it
  // are the selling journey, this one is the account's.
  { label: "Messages", href: "/messages" },
  // Hidden from the nav — an internal test hub, not a place to offer people.
  // The route itself still answers at /staging for anyone who knows it.
  // { label: "Staging", href: "/staging" },
];

const BUY_TABS = [
  // "Marketplace" on desktop only. The mobile tab bar keeps "Browse": it is a
  // verb next to other verbs on a 375px row, where the noun would both crowd
  // the row and stop matching its neighbours.
  { label: "Marketplace", href: "/browse" },
  { label: "Agents", href: "/buy/agents" },
  { label: "Messages", href: "/messages" }, // see SELL_TABS
  // { label: "Staging", href: "/staging" }, — see SELL_TABS
];

export function Nav({ userEmail, userName, userAvatarUrl, modeOverride }: NavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [storedMode, setStoredMode] = useState<Mode | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // On /l/ pages, `?from=` indicates the origin surface so we can keep the
  // originating tab highlighted and preserve buyer/seller mode.
  const from = pathname.startsWith("/l/") ? searchParams.get("from") : null;

  // Read localStorage only after mount to avoid SSR/client hydration mismatch.
  useEffect(() => {
    const value = localStorage.getItem("haggle_mode") as Mode | null;
    if (value === "buying" || value === "selling") setStoredMode(value);
  }, []);

  // Derive mode from URL path, origin param, override prop, or localStorage.
  const deriveMode = (): Mode => {
    if (modeOverride) return modeOverride;
    if (pathname.startsWith("/buy")) return "buying";
    if (pathname.startsWith("/sell")) return "selling";
    // Browse is a buyer-side discovery surface
    if (pathname.startsWith("/browse")) return "buying";
    // /l/ pages: use from param to infer the originating mode
    if (from === "browse" || from === "buy-dashboard") return "buying";
    if (from === "sell-dashboard") return "selling";
    // /l/ pages w/o origin: preserve previous mode from post-mount localStorage read
    return storedMode ?? "buying";
  };
  const mode: Mode = deriveMode();
  const tabs = mode === "buying" ? BUY_TABS : SELL_TABS;

  // For /l/ pages, resolve which tab href should be highlighted based on origin.
  // Only browse maps to a tab now: arriving from either dashboard means you
  // came from home, which has no tab to light up. `from` still carries those
  // values — they decide buyer/seller mode above.
  const activeHrefFromOrigin: string | null = from === "browse" ? "/browse" : null;

  // Keep localStorage in sync — only write when path gives us a definitive mode
  // (avoid overwriting stored mode on ambiguous paths like /profile, /settings)
  useEffect(() => {
    const isDefinitive =
      pathname.startsWith("/buy") || pathname.startsWith("/sell") || pathname.startsWith("/browse");
    if (isDefinitive) {
      localStorage.setItem("haggle_mode", mode);
    }
  }, [mode, pathname]);

  const handleModeSwitch = () => {
    if (mode === "selling") {
      router.push("/buy/dashboard");
    } else {
      router.push("/sell/dashboard");
    }
  };

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  const messagesUnreadCount = useMessagesUnreadCount();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  // Home for the side you are on — and the only way to it from the nav.
  const logoHref = mode === "buying" ? "/buy/dashboard" : "/sell/dashboard";
  const switchLabel = mode === "selling" ? "Switch to buying" : "Switch to selling";

  return (
    <nav className="fixed inset-x-0 top-0 z-50 hidden border-line border-b bg-surface/80 backdrop-blur-md md:block">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Left: Logo + Tabs */}
        <div className="flex h-full items-center gap-6">
          <Link
            href={logoHref}
            aria-label="Haggle — home"
            className="flex items-center text-ink transition-opacity hover:opacity-75"
          >
            {/* 24px: the wordmark's cap height then lands about twice the 14px tab
                text, which reads as the primary mark without shouting. At 28px it
                dominated the bar; below 20px the gold ligature between the two g's
                muddies and the lockup stops being legible as two tones.

                Lifted 1.5px because the artboard includes the descenders of the
                two g's — its baseline sits at 113.55 of 127, so centring the BOX
                drops the baseline 1.5px below the tabs' at this size. Type is
                aligned on baselines, not bounding boxes. */}
            <Logo className="-translate-y-[1.5px] h-6" />
          </Link>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const isActive = activeHrefFromOrigin
                ? tab.href === activeHrefFromOrigin
                : pathname.startsWith(tab.href);
              return (
                <NavTab
                  key={tab.href}
                  href={tab.href}
                  label={tab.label}
                  active={isActive}
                  badge={tab.href === "/messages" ? messagesUnreadCount : undefined}
                />
              );
            })}
          </div>
        </div>

        {/* Right: Mode switch + User menu */}
        <div className="flex items-center gap-5">
          {/* Mode switch — text only */}
          <button
            type="button"
            onClick={handleModeSwitch}
            className="cursor-pointer text-ink-muted text-sm transition-colors hover:text-ink"
          >
            {switchLabel}
          </button>

          {/* Notification bell */}
          <NotificationBell />

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex cursor-pointer items-center gap-2 text-ink-secondary text-sm transition-colors hover:text-ink"
            >
              <Avatar src={userAvatarUrl} name={userName || userEmail} size="sm" />
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-line bg-surface-raised py-1 shadow-card">
                <div className="border-line border-b px-4 py-2.5">
                  <p className="text-ink-muted text-xs">Signed in as</p>
                  <p className="truncate text-ink-secondary text-sm">{userEmail}</p>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-ink-secondary text-sm transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Account Settings
                </Link>
                {/* TODO(notification-prefs): hidden until prefs check implemented in bus.ts
                <Link href="/settings/notifications">Notification Settings</Link>
                */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDark}
                  onClick={toggleTheme}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-ink-secondary text-sm transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <span className="flex items-center gap-2">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    Dark mode
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      isDark ? "bg-action-primary" : "bg-surface-sunken"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-on-accent shadow-sm transition-transform ${
                        isDark ? "translate-x-4.5" : "translate-x-0.5"
                      }`}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full cursor-pointer items-center gap-2 border-line border-t px-4 py-2.5 text-ink-secondary text-sm transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

// ─── Notification Bell ────────────────────────────────────────────────────────

function NotificationBell() {
  const { unreadCount, decrementCount, resetCount } = useNotificationContext();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications: items } = await notificationApi.list();
      setNotifications(items.slice(0, 5));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleMarkAllRead() {
    await notificationApi.markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    resetCount();
  }

  async function handleClickNotification(n: Notification) {
    if (!n.readAt) {
      await notificationApi.markRead(n.id).catch(() => {});
      decrementCount();
    }
    setOpen(false);
    if (n.payload.displayLink) router.push(n.payload.displayLink as string);
  }

  return (
    <div className="relative" ref={bellRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative cursor-pointer p-1.5 text-ink-secondary transition-colors hover:text-ink"
        aria-label="Notifications"
      >
        {/* Bell icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="-top-0.5 -right-0.5 absolute flex h-4 w-4 items-center justify-center rounded-full bg-error font-bold text-[10px] text-on-accent">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-line bg-surface-raised shadow-card">
          {/* Header */}
          <div className="flex items-center justify-between border-line border-b px-4 py-3">
            <span className="font-semibold text-ink text-sm">Notifications</span>
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="cursor-pointer text-action-primary text-xs transition-colors hover:text-action-primary-hover"
            >
              Mark all read
            </button>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-action-primary">
                <Spinner size="sm" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="py-8 text-center text-ink-muted text-sm">No notifications yet</p>
            ) : (
              <div className="space-y-1">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    read={!!n.readAt}
                    title={n.payload.displayTitle ?? n.eventType}
                    time={new Date(n.createdAt).toLocaleDateString()}
                    onClick={() => handleClickNotification(n)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-line border-t px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-action-primary text-xs transition-colors hover:text-action-primary-hover"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
