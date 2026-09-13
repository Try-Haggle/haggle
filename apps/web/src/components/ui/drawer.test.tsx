import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "./drawer";

describe("Drawer layer", () => {
  it("opens at the app's overlay layer by default", () => {
    render(
      <Drawer open onClose={vi.fn()} title="Panel">
        body
      </Drawer>,
    );
    expect(screen.getByRole("dialog").parentElement).toHaveClass("z-50");
  });

  it("opens above a surface that already covers the app shell", () => {
    // The listing wizard sits at z-[60]; a z-50 drawer opened invisibly behind it.
    render(
      <Drawer open onClose={vi.fn()} title="Panel" layer="z-[70]">
        body
      </Drawer>,
    );
    const root = screen.getByRole("dialog").parentElement;
    expect(root).toHaveClass("z-[70]");
    expect(root).not.toHaveClass("z-50");
  });
});
