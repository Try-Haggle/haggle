/**
 * Bottom nav visibility.
 *
 * The bar is fixed, so anywhere it should not appear it would sit on top of the
 * screen's own controls. An open conversation is exactly that case: the
 * composer lives where the bar would be.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./bottom-nav";

let pathname = "/messages";
let query = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => query,
}));

let notificationsUnread = 0;
let messagesUnread = 0;

vi.mock("@/app/(app)/_components/notification-provider", () => ({
  useNotificationContext: () => ({ unreadCount: notificationsUnread }),
}));

vi.mock("@/hooks/use-messages-unread", () => ({
  useMessagesUnreadCount: () => messagesUnread,
}));

beforeEach(() => {
  pathname = "/messages";
  query = new URLSearchParams();
  notificationsUnread = 0;
  messagesUnread = 0;
});

describe("BottomNav", () => {
  it("shows on the conversation list", () => {
    render(<BottomNav />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("steps aside while a conversation is open", () => {
    query = new URLSearchParams("c=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    render(<BottomNav />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("still shows on other screens that carry a query string", () => {
    pathname = "/browse";
    query = new URLSearchParams("c=something");
    render(<BottomNav />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("stays hidden in the listing wizard", () => {
    pathname = "/sell/listings/new";
    render(<BottomNav />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("Inbox tab", () => {
  function inboxLink() {
    return screen.getByRole("link", { name: /Inbox/ });
  }

  it("leads to messages — notifications are one tap further", () => {
    pathname = "/browse";
    render(<BottomNav />);

    expect(inboxLink()).toHaveAttribute("href", "/messages");
  });

  it("stays lit on both halves of the inbox", () => {
    for (const path of ["/messages", "/notifications"]) {
      pathname = path;
      const { unmount } = render(<BottomNav />);
      expect(inboxLink().className).toContain("text-action-primary");
      unmount();
    }
  });

  it("marks unread messages, not just notifications", () => {
    pathname = "/browse";
    messagesUnread = 2;
    const { container } = render(<BottomNav />);

    expect(container.querySelector(".bg-error")).not.toBeNull();
  });

  it("marks unread notifications too", () => {
    pathname = "/browse";
    notificationsUnread = 1;
    const { container } = render(<BottomNav />);

    expect(container.querySelector(".bg-error")).not.toBeNull();
  });

  it("shows no dot when both are clear", () => {
    pathname = "/browse";
    const { container } = render(<BottomNav />);

    expect(container.querySelector(".bg-error")).toBeNull();
  });
});
