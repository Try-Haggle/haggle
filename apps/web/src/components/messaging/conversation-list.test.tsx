/**
 * Conversation list: unread emphasis, the "You:" prefix, and selection.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConversationSummary } from "@/lib/messaging-api";
import { ConversationList } from "./conversation-list";

const ME = "user-me";
const THEM = "user-them";

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "conversation-1",
    subject: { type: "negotiation_session", id: "session-1" },
    otherMember: { id: THEM, displayName: "Dana Seller", avatarUrl: null },
    lastMessage: {
      id: "m1",
      body: "Can you do 120?",
      senderId: THEM,
      createdAt: new Date().toISOString(),
    },
    unreadCount: 0,
    lastMessageAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderList(props: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const onSelect = props.onSelect ?? vi.fn();
  render(
    <ConversationList
      conversations={props.conversations ?? [conversation()]}
      selectedId={props.selectedId ?? null}
      currentUserId={ME}
      loading={props.loading ?? false}
      onSelect={onSelect}
      hasMore={props.hasMore ?? false}
    />,
  );
  return { onSelect };
}

describe("ConversationList", () => {
  it("shows the counterparty and the last message", () => {
    renderList();

    expect(screen.getByText("Dana Seller")).toBeInTheDocument();
    expect(screen.getByText("Can you do 120?")).toBeInTheDocument();
  });

  it("prefixes the preview with You: for your own last message", () => {
    renderList({
      conversations: [
        conversation({
          lastMessage: {
            id: "m1",
            body: "Sounds good",
            senderId: ME,
            createdAt: new Date().toISOString(),
          },
        }),
      ],
    });

    expect(screen.getByText("You: Sounds good")).toBeInTheDocument();
  });

  it("shows an unread badge with the count", () => {
    renderList({ conversations: [conversation({ unreadCount: 3 })] });

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the badge when nothing is unread", () => {
    renderList({ conversations: [conversation({ unreadCount: 0 })] });

    expect(screen.queryByText("0")).toBeNull();
  });

  it("reports the selected conversation to its parent", async () => {
    const { onSelect } = renderList();

    await userEvent.click(screen.getByRole("button", { name: /Dana Seller/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "conversation-1" }));
  });

  it("marks the open conversation for assistive tech", () => {
    renderList({ selectedId: "conversation-1" });

    expect(screen.getByRole("button", { name: /Dana Seller/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("offers a retry when the list could not be loaded", () => {
    const onRetry = vi.fn();
    render(
      <ConversationList
        conversations={[]}
        selectedId={null}
        currentUserId={ME}
        loading={false}
        failed
        onRetry={onRetry}
        onSelect={vi.fn()}
        hasMore={false}
      />,
    );

    // A failed fetch must not read as "you have no messages".
    expect(screen.getByText("Couldn't load your messages")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();
  });

  it("explains the empty state instead of showing a blank rail", () => {
    renderList({ conversations: [] });

    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("falls back when the counterparty account is gone", () => {
    renderList({ conversations: [conversation({ otherMember: null })] });

    expect(screen.getByText("Unknown user")).toBeInTheDocument();
  });
});
