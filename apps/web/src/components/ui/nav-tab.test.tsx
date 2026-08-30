/**
 * NavTab unread indication.
 *
 * One language on both variants: a dot. A count next to a word reads as "items
 * in this view", and in red it reads as an error — neither is what an unread
 * message means.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavTab } from "./nav-tab";

describe("NavTab", () => {
  it("marks a text tab with a dot, not a number", () => {
    const { container } = render(<NavTab href="/messages" label="Messages" badge />);

    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(container.querySelector(".bg-error")).not.toBeNull();
    expect(container.textContent).toBe("Messages");
  });

  it("shows nothing when there is nothing waiting", () => {
    const { container } = render(<NavTab href="/messages" label="Messages" badge={false} />);

    expect(container.querySelector(".bg-error")).toBeNull();
  });

  it("marks the icon tab the same way", () => {
    const { container } = render(
      <NavTab href="/notifications" label="Inbox" variant="stacked" icon={<svg />} badge />,
    );

    expect(container.querySelector(".bg-error")).not.toBeNull();
  });
});
