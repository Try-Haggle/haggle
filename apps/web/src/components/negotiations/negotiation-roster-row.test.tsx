import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type NegotiationListItem, NegotiationRosterRow } from "./negotiation-roster-row";

function item(overrides: Partial<NegotiationListItem> = {}): NegotiationListItem {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    listing_id: "listing-1",
    status: "ACTIVE",
    current_round: 3,
    last_offer_price_minor: "31000000",
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-11T00:00:00.000Z",
    listing: { public_id: "pub-1", title: 'Monitor 27"' },
    agent: { preset_id: "closer", emoji: "rabbit", accent_color: "#ec4899" },
    last_sender_role: "BUYER",
    paused_for_buyer: false,
    ...overrides,
  };
}

const presence = () => screen.getByRole("img", { name: /—/ });

describe("NegotiationRosterRow", () => {
  it("names the listing and shows the viewer's agent with its state", () => {
    render(<NegotiationRosterRow negotiation={item()} side="BUYER" href="/buy/negotiations/x" />);
    expect(screen.getByText('Monitor 27"')).toBeInTheDocument();
    // The buyer moved last: in a list that reads as the other side's turn.
    expect(presence()).toHaveAttribute("data-state", "waiting");
    expect(screen.getByText(/Their turn · Round 3 · Last offer: \$310,000/)).toBeInTheDocument();
  });

  it("flags the negotiation that needs the buyer", () => {
    render(
      <NegotiationRosterRow
        negotiation={item({ paused_for_buyer: true })}
        side="BUYER"
        href="/buy/negotiations/x"
      />,
    );
    expect(presence()).toHaveAttribute("data-state", "question");
    expect(screen.getByText(/Needs your answer/)).toBeInTheDocument();
  });

  it("shows the outcome once settled", () => {
    render(
      <NegotiationRosterRow negotiation={item({ status: "ACCEPTED" })} side="SELLER" href="/x" />,
    );
    expect(presence()).toHaveAttribute("data-state", "deal");
  });

  it("still renders a row from an older response with no listing or agent", () => {
    render(
      <NegotiationRosterRow
        negotiation={item({ listing: undefined, agent: undefined, last_sender_role: undefined })}
        side="SELLER"
        href="/sell/negotiations/x"
      />,
    );
    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
    expect(presence()).toHaveAttribute("data-state", "idle");
  });
});
