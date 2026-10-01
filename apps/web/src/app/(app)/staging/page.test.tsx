import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StagingPage from "./page";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(() => new Promise(() => {})) },
}));

describe("Staging Hub", () => {
  it("starts buyer flows from real listings and orders", () => {
    render(<StagingPage />);

    const negotiation = screen.getByText("Buyer Negotiation").closest("a");
    const payment = screen.getByText("Payment").closest("a");

    expect(negotiation).toHaveAttribute("href", "/buy/dashboard");
    expect(within(negotiation!).getByText("Needs Data")).toBeInTheDocument();
    expect(payment).toHaveAttribute("href", "/orders");
    expect(within(payment!).getByText("Needs Data")).toBeInTheDocument();
    expect(within(payment!).getByText("hUSDC on Base Sepolia")).toBeInTheDocument();
  });

  it("shows why staging demo pages cannot run for a regular visitor", () => {
    render(<StagingPage />);

    const e2e = screen.getByText("E2E Demo (Quick Start)").closest("a");
    const tryDemo = screen.getByText("Try Demo (User)").closest("a");
    const developer = screen.getByText("Developer Demo").closest("a");

    expect(within(e2e!).getByText("Admin only")).toBeInTheDocument();
    expect(within(e2e!).getByText(/403 for non-admin users/)).toBeInTheDocument();
    expect(within(tryDemo!).getByText("Local only")).toBeInTheDocument();
    expect(within(tryDemo!).getByText(/404 on staging/)).toBeInTheDocument();
    expect(within(developer!).getByText("Local only")).toBeInTheDocument();
    expect(within(developer!).getByText(/404 on staging/)).toBeInTheDocument();
  });
});
