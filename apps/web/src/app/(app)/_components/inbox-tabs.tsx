"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessagesUnreadCount } from "@/hooks/use-messages-unread";
import { cn } from "@/lib/cn";
import { useNotificationContext } from "./notification-provider";

/**
 * Switches between the two halves of the inbox on a phone.
 *
 * The bottom bar has one Inbox tab, so the choice between messages and
 * notifications has to live inside. Desktop has its own entries for both — a
 * nav tab and the bell — so this is hidden there rather than duplicated.
 */
export function InboxTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const messagesUnread = useMessagesUnreadCount();
  const { unreadCount: notificationsUnread } = useNotificationContext();

  const tabs = [
    { href: "/messages", label: "Messages", unread: messagesUnread > 0 },
    { href: "/notifications", label: "Notifications", unread: notificationsUnread > 0 },
  ];

  return (
    // Half the width each, on one rail, above a divider. Two left-aligned pills
    // read as filter chips — something you might apply to a list. Splitting the
    // bar says what is true: these are two places, and you are in one of them.
    // The underline is the same active mark the desktop tabs use.
    <nav
      aria-label="Inbox"
      className={cn("grid shrink-0 grid-cols-2 border-line border-b", className)}
    >
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-14 items-center justify-center font-semibold text-sm transition-colors",
              active ? "text-ink" : "text-ink-muted",
            )}
          >
            <span className="relative">
              {tab.label}
              {tab.unread && (
                <span
                  className="-top-0.5 -right-2 absolute size-[5px] rounded-full bg-error"
                  aria-hidden="true"
                />
              )}
            </span>
            {active && (
              // Edge to edge, sitting on the divider rather than above it: the
              // active half's line turns gold instead of a short bar floating
              // over a hairline. Halving the bar is the point, so the mark
              // should be the half.
              <span className="-bottom-px absolute inset-x-0 h-0.5 bg-action-primary" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
