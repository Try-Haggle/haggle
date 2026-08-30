/**
 * Message thread rendering: read receipts, date dividers, and the fact that a
 * message body is text, never markup (the original built bubbles with innerHTML
 * plus hand-rolled escaping).
 */

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/messaging-api";
import { MessageThread } from "./message-thread";

beforeAll(() => {
  // jsdom has no IntersectionObserver; the thread uses one to page upwards.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

const ME = "user-me";
const THEM = "user-them";

function at(y: number, mo: number, d: number, h: number, mi: number): string {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

function message(overrides: Partial<Message> & { id: string; createdAt: string }): Message {
  return {
    senderId: ME,
    body: "hello",
    clientMessageId: null,
    ...overrides,
  };
}

function renderThread(props: Partial<React.ComponentProps<typeof MessageThread>> = {}) {
  return render(
    <MessageThread
      messages={props.messages ?? []}
      currentUserId={ME}
      otherMemberName="Counterparty"
      otherReadAt={props.otherReadAt ?? null}
      hasMore={props.hasMore ?? false}
      loadingMore={false}
      onLoadMore={props.onLoadMore ?? (() => {})}
    />,
  );
}

describe("MessageThread", () => {
  it("renders a body containing markup as text", () => {
    renderThread({
      messages: [
        message({
          id: "1",
          senderId: THEM,
          body: "<img src=x onerror=alert(1)>",
          createdAt: at(2026, 8, 29, 10, 0),
        }),
      ],
    });

    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("marks a sent message unread until the other side reads it", () => {
    renderThread({
      messages: [message({ id: "1", createdAt: at(2026, 8, 29, 10, 0) })],
      otherReadAt: at(2026, 8, 29, 9, 0),
    });

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("drops the unread mark once their read position passes the message", () => {
    renderThread({
      messages: [message({ id: "1", createdAt: at(2026, 8, 29, 10, 0) })],
      otherReadAt: at(2026, 8, 29, 11, 0),
    });

    expect(screen.queryByText("1")).toBeNull();
  });

  it("never marks the other side's own messages unread", () => {
    renderThread({
      messages: [message({ id: "1", senderId: THEM, createdAt: at(2026, 8, 29, 10, 0) })],
      otherReadAt: null,
    });

    expect(screen.queryByText("1")).toBeNull();
  });

  it("shows a date divider per day and names the sender once per run", () => {
    renderThread({
      messages: [
        message({ id: "1", senderId: THEM, body: "a", createdAt: at(2026, 8, 28, 23, 50) }),
        message({ id: "2", senderId: THEM, body: "b", createdAt: at(2026, 8, 29, 0, 10) }),
      ],
    });

    // Two days → two dividers; "Yesterday"/"Today" depends on the clock, so
    // assert on the count of dividers rather than their text.
    const dividers = document.querySelectorAll(".text-center");
    expect(dividers.length).toBe(2);
    expect(screen.getAllByText("Counterparty")).toHaveLength(2);
  });
});

describe("arrival animation", () => {
  function bubbleFor(text: string): HTMLElement | null {
    return screen.getByText(text).closest(".flex.flex-col");
  }

  it("does not animate the history that is already there when a thread opens", () => {
    renderThread({
      messages: [
        message({ id: "1", body: "first", createdAt: at(2026, 8, 29, 10, 0) }),
        message({ id: "2", body: "second", createdAt: at(2026, 8, 29, 10, 1) }),
      ],
    });

    expect(bubbleFor("first")).not.toHaveClass("animate-message-in");
    expect(bubbleFor("second")).not.toHaveClass("animate-message-in");
  });

  it("animates a message that arrives while the thread is open", () => {
    const { rerender } = renderThread({
      messages: [message({ id: "1", body: "first", createdAt: at(2026, 8, 29, 10, 0) })],
    });

    rerender(
      <MessageThread
        messages={[
          message({ id: "1", body: "first", createdAt: at(2026, 8, 29, 10, 0) }),
          message({ id: "2", body: "arrived", createdAt: at(2026, 8, 29, 10, 1) }),
        ]}
        currentUserId={ME}
        otherMemberName="Counterparty"
        otherReadAt={null}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
      />,
    );

    expect(bubbleFor("arrived")).toHaveClass("animate-message-in");
    // The one that was already on screen stays put.
    expect(bubbleFor("first")).not.toHaveClass("animate-message-in");
  });

  it("does not animate older messages pulled in above the fold", () => {
    const { rerender } = renderThread({
      messages: [message({ id: "2", body: "newer", createdAt: at(2026, 8, 29, 10, 1) })],
    });

    rerender(
      <MessageThread
        messages={[
          message({ id: "1", body: "older", createdAt: at(2026, 8, 29, 9, 0) }),
          message({ id: "2", body: "newer", createdAt: at(2026, 8, 29, 10, 1) }),
        ]}
        currentUserId={ME}
        otherMemberName="Counterparty"
        otherReadAt={null}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
      />,
    );

    expect(bubbleFor("older")).not.toHaveClass("animate-message-in");
  });

  it("keeps one element when the optimistic bubble becomes the stored message", () => {
    const optimistic = message({
      id: "pending-c1",
      clientMessageId: "c1",
      body: "sending",
      createdAt: at(2026, 8, 29, 10, 0),
    });
    const { rerender } = renderThread({ messages: [optimistic] });
    const before = bubbleFor("sending");

    rerender(
      <MessageThread
        messages={[{ ...optimistic, id: "stored-id" }]}
        currentUserId={ME}
        otherMemberName="Counterparty"
        otherReadAt={null}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
      />,
    );

    // Same DOM node: the id changed but the client id kept the key stable, so
    // the bubble does not unmount and replay its arrival.
    expect(bubbleFor("sending")).toBe(before);
  });
});
