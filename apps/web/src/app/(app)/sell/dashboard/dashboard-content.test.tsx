import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardContent } from "./dashboard-content";
import type { SellerNegotiation } from "./page";

vi.mock("@/providers/amplitude-provider", () => ({
  useAmplitude: () => ({ track: vi.fn() }),
}));

describe("Seller Dashboard order navigation", () => {
  it("provides a direct entry to fulfillment orders", () => {
    render(<DashboardContent claimResult={null} listings={[]} />);

    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/orders");
  });
});

function negotiation(overrides: Partial<SellerNegotiation> = {}): SellerNegotiation {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    listing_id: "bbbbbbbb-2222-4222-8222-222222222222",
    status: "ACTIVE",
    current_round: 3,
    last_offer_price_minor: 890000,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("Seller Dashboard negotiations", () => {
  it("links each negotiation to the seller's own detail page", () => {
    render(<DashboardContent claimResult={null} listings={[]} negotiations={[negotiation()]} />);

    expect(screen.getByRole("link", { name: /aaaaaaaa/ })).toHaveAttribute(
      "href",
      "/sell/negotiations/aaaaaaaa-1111-4111-8111-111111111111",
    );
  });

  it("shows the round and last offer so a seller can triage without opening it", () => {
    render(<DashboardContent claimResult={null} listings={[]} negotiations={[negotiation()]} />);

    expect(screen.getByText(/Round 3/)).toBeInTheDocument();
    expect(screen.getByText(/\$8,900/)).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("orders by most recent activity, not the order the API returned", () => {
    render(
      <DashboardContent
        claimResult={null}
        listings={[]}
        negotiations={[
          negotiation({
            id: "old-1111-4111-8111-111111111111",
            updated_at: "2026-08-01T00:00:00.000Z",
          }),
          negotiation({
            id: "new-2222-4222-8222-222222222222",
            updated_at: "2026-08-29T00:00:00.000Z",
          }),
        ]}
      />,
    );

    const links = screen.getAllByRole("link", { name: /\.\.\./ });
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("new-2222"));
  });

  it("counts negotiations and closed deals instead of showing hard-coded zeros", () => {
    render(
      <DashboardContent
        claimResult={null}
        listings={[]}
        negotiations={[
          negotiation({ id: "a1111111-1111-4111-8111-111111111111", status: "ACTIVE" }),
          negotiation({ id: "a2222222-2222-4222-8222-222222222222", status: "ACCEPTED" }),
          negotiation({ id: "a3333333-3333-4333-8333-333333333333", status: "ACCEPTED" }),
        ]}
      />,
    );

    // StatTile renders the value as the label's preceding sibling.
    const negotiationValue = screen.getByText("Total Negotiations").previousElementSibling;
    const dealsValue = screen.getByText("Deals Closed").previousElementSibling;
    expect(negotiationValue).toHaveTextContent("3");
    expect(dealsValue).toHaveTextContent("2");
  });

  it("explains the empty state instead of hiding the section", () => {
    render(<DashboardContent claimResult={null} listings={[]} negotiations={[]} />);

    expect(screen.getByText("No negotiations yet")).toBeInTheDocument();
  });
});
