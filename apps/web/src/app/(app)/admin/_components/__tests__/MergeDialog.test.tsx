import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MergeDialog } from "../MergeDialog";

describe("<MergeDialog />", () => {
  it("submits targetTagId and closes on success", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<MergeDialog open={true} onClose={onClose} onSubmit={onSubmit} />);

    const input = screen.getByTestId("merge-target-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tag_abc" } });
    fireEvent.click(screen.getByTestId("merge-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("tag_abc"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <MergeDialog open={false} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
