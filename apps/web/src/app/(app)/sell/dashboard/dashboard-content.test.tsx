import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardContent } from "./dashboard-content";

vi.mock("@/providers/amplitude-provider", () => ({
  useAmplitude: () => ({ track: vi.fn() }),
}));

describe("Seller Dashboard order navigation", () => {
  it("provides a direct entry to fulfillment orders", () => {
    render(<DashboardContent claimResult={null} listings={[]} />);

    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/orders");
  });
});
