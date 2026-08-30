/**
 * The phone's inbox switcher.
 *
 * One tab in the bottom bar covers messages and notifications, so this is the
 * only way between them on a phone — and each side needs its own unread mark
 * for the choice to mean anything.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboxTabs } from "./inbox-tabs";

let pathname = "/messages";
let messagesUnread = 0;
let notificationsUnread = 0;

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/hooks/use-messages-unread", () => ({
  useMessagesUnreadCount: () => messagesUnread,
}));
vi.mock("./notification-provider", () => ({
  useNotificationContext: () => ({ unreadCount: notificationsUnread }),
}));

beforeEach(() => {
  pathname = "/messages";
  messagesUnread = 0;
  notificationsUnread = 0;
});

describe("InboxTabs", () => {
  it("offers both halves", () => {
    render(<InboxTabs />);

    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("href", "/messages");
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "href",
      "/notifications",
    );
  });

  it("marks the side you are on", () => {
    pathname = "/notifications";
    render(<InboxTabs />);

    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Messages" })).not.toHaveAttribute("aria-current");
  });

  it("dots each side separately, so the unread one is visible from the other", () => {
    pathname = "/messages";
    notificationsUnread = 3;
    render(<InboxTabs />);

    const notifications = screen.getByRole("link", { name: "Notifications" });
    const messages = screen.getByRole("link", { name: "Messages" });
    expect(notifications.querySelector(".bg-error")).not.toBeNull();
    expect(messages.querySelector(".bg-error")).toBeNull();
  });

  it("shows no dots when everything is read", () => {
    const { container } = render(<InboxTabs />);

    expect(container.querySelector(".bg-error")).toBeNull();
  });
});
