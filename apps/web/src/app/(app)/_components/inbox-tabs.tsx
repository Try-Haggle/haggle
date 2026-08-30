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
    <nav aria-label="Inbox" className={cn("flex items-center gap-1", className)}>
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-full px-3 py-1.5 font-semibold text-sm transition-colors",
              active ? "bg-surface-sunken text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <span className="relative">
              {tab.label}
              {tab.unread && (
                <span
                  className="-top-0.5 -right-1.5 absolute size-[5px] rounded-full bg-error"
                  aria-hidden="true"
                />
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
