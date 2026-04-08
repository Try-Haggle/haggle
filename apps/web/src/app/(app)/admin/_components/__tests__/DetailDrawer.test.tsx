import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DetailDrawer } from "../DetailDrawer";

describe("<DetailDrawer />", () => {
  it("renders nothing when id is null", () => {
    const { container } = render(
      <DetailDrawer type="tag" id={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows metadata when open and closes via backdrop + Escape", async () => {
    const fetchDetail = vi.fn().mockResolvedValue({
      type: "tag",
      item: {
        id: "tag-1",
        label: "acme",
        normalizedLabel: "acme",
        occurrenceCount: 3,
        firstSeenListingId: null,
        createdAt: new Date().toISOString(),
        autoPromoteEligible: false,
      },
      raw: {},
    });
    const onClose = vi.fn();

    const { rerender } = render(
      <DetailDrawer
        type="tag"
        id="tag-1"
        onClose={onClose}
        fetchDetail={fetchDetail}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("drawer-detail")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("drawer-detail")).toHaveTextContent("acme");
    // ActionButtons renders the per-type actions in place of the old placeholder
    expect(screen.getByTestId("action-tag-approve")).toBeInTheDocument();

    // Click backdrop
    fireEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Closes when id becomes null
    rerender(
      <DetailDrawer
        type="tag"
        id={null}
        onClose={onClose}
        fetchDetail={fetchDetail}
      />,
    );
    expect(screen.queryByTestId("drawer-detail")).not.toBeInTheDocument();
  });
});
