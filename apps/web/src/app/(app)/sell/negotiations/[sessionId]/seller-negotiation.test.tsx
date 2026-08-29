/**
 * Seller negotiation view.
 *
 * The arena itself is the buyer's component and is covered by its own tests, so
 * it is stubbed here — what matters on this side is that the seller gets the
 * right controls, and that they hit the right endpoints.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResponse } from "@/app/buy/negotiations/[sessionId]/negotiation-session-data";
import { SellerNegotiation } from "./seller-negotiation";

const post = vi.fn();
const patch = vi.fn();
const get = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/use-negotiation-ws", () => ({
  useNegotiationWs: () => ({ connectionMode: "ws" }),
}));

vi.mock("@/app/buy/negotiations/[sessionId]/playback/playback-arena", () => ({
  PlaybackArena: (props: { backHref?: string; backLabel?: string; liveTerminal?: boolean }) => (
    <div data-testid="arena" data-back={props.backHref} data-terminal={String(props.liveTerminal)}>
      {props.backLabel}
    </div>
  ),
}));

const SESSION_ID = "aaaaaaaa-1111-4111-8111-111111111111";

function payload(status: string): SessionResponse {
  return {
    session: {
      id: SESSION_ID,
      status,
      current_round: 2,
      last_offer_price_minor: 890000,
      listing: { id: "listing-1", title: "2019 Honda Civic EX", target_price: "9000.00" },
    },
    rounds: [],
  } as unknown as SessionResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(payload("ACTIVE"));
});

describe("SellerNegotiation", () => {
  it("shows the same arena the buyer sees, pointed back at the seller's dashboard", () => {
    render(<SellerNegotiation initialPayload={payload("ACTIVE")} />);

    const arena = screen.getByTestId("arena");
    expect(arena).toHaveAttribute("data-back", "/sell/dashboard");
    expect(arena).toHaveTextContent("Dashboard");
  });

  it("offers the seller's three moves while the negotiation is live", () => {
    render(<SellerNegotiation initialPayload={payload("ACTIVE")} />);

    expect(screen.getByRole("button", { name: "Send counter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept deal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("keeps the seller's controls at NEAR_DEAL, where only the buyer's loop stops", () => {
    render(<SellerNegotiation initialPayload={payload("NEAR_DEAL")} />);

    // The arena reads the transcript as settled...
    expect(screen.getByTestId("arena")).toHaveAttribute("data-terminal", "true");
    // ...but the seller can still close the deal, as the old seller console allowed.
    expect(screen.getByRole("button", { name: "Accept deal" })).toBeInTheDocument();
  });

  it("keeps the controls at STALLED too", () => {
    render(<SellerNegotiation initialPayload={payload("STALLED")} />);

    expect(screen.getByRole("button", { name: "Send counter" })).toBeInTheDocument();
  });

  it("hides the controls once the negotiation is over", () => {
    render(<SellerNegotiation initialPayload={payload("REJECTED")} />);

    expect(screen.queryByRole("button", { name: "Send counter" })).toBeNull();
    expect(screen.getByTestId("arena")).toHaveAttribute("data-terminal", "true");
  });

  it("sends a counter in minor units", async () => {
    post.mockResolvedValue({});
    render(<SellerNegotiation initialPayload={payload("ACTIVE")} />);

    await userEvent.type(screen.getByLabelText("Counter price"), "8750.50");
    await userEvent.click(screen.getByRole("button", { name: "Send counter" }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      `/negotiations/sessions/${SESSION_ID}/offers`,
      expect.objectContaining({ price_minor: 875050, sender_role: "SELLER" }),
    );
  });

  it("refuses a price that is not a number instead of sending it", async () => {
    render(<SellerNegotiation initialPayload={payload("ACTIVE")} />);

    await userEvent.type(screen.getByLabelText("Counter price"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Send counter" }));

    expect(await screen.findByText("Enter a valid price.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("accepts and rejects through the session endpoints", async () => {
    patch.mockResolvedValue({});
    render(<SellerNegotiation initialPayload={payload("ACTIVE")} />);

    await userEvent.click(screen.getByRole("button", { name: "Accept deal" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`/negotiations/sessions/${SESSION_ID}/accept`),
    );

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`/negotiations/sessions/${SESSION_ID}/reject`),
    );
  });

  it("surfaces a failed action instead of leaving the button spinning", async () => {
    patch.mockRejectedValue(new Error("Session version conflict"));
    render(<SellerNegotiation initialPayload={payload("ACTIVE")} />);

    await userEvent.click(screen.getByRole("button", { name: "Accept deal" }));

    expect(await screen.findByText("Session version conflict")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept deal" })).toBeEnabled();
  });
});
