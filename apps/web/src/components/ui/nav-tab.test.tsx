/**
 * NavTab unread indication.
 *
 * The text tab has room for a number; the icon tab does not, so the same prop
 * has to render differently in the two variants.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavTab } from "./nav-tab";

describe("NavTab", () => {
  it("puts the unread count on a text tab", () => {
    render(<NavTab href="/messages" label="Messages" badge={3} />);

    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps a large count", () => {
    render(<NavTab href="/messages" label="Messages" badge={42} />);

    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("shows nothing at zero", () => {
    const { container } = render(<NavTab href="/messages" label="Messages" badge={0} />);

    expect(screen.queryByText("0")).toBeNull();
    expect(container.querySelector(".bg-error")).toBeNull();
  });

  it("keeps the icon tab to a dot — a number would not fit", () => {
    const { container } = render(
      <NavTab href="/messages" label="Inbox" variant="stacked" icon={<svg />} badge={3} />,
    );

    expect(screen.queryByText("3")).toBeNull();
    expect(container.querySelector(".bg-error")).not.toBeNull();
  });
});
