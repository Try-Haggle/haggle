import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResponse } from "./negotiation-session-data";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  get: vi.fn(),
  triggerUpdate: undefined as (() => void) | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/hooks/use-negotiation-ws", () => ({
  useNegotiationWs: ({ onUpdate }: { onUpdate: () => void }) => {
    mocks.triggerUpdate = onUpdate;
    return { connectionMode: "polling" };
  },
}));

vi.mock("@/lib/api-client", () => ({ api: { get: mocks.get } }));

import { LiveNegotiation } from "./live-negotiation";

function payload(status = "ACTIVE", rounds = 1): SessionResponse {
  return {
    session: {
      id: "11111111-1111-4111-8111-111111111111",
      status,
      current_round: rounds,
      last_offer_price_minor: rounds ? 110_00 : null,
      buyer_negotiation_agent_preset_id: "steady-buyer",
      listing: {
        public_id: "listing-1",
        title: "Test phone",
        photo_url: null,
        target_price: "150",
        category: "phone",
        seller_agent_preset: "gatekeeper",
      },
    },
    rounds: rounds
      ? [
          {
            id: "22222222-2222-4222-8222-222222222222",
            round_no: 1,
            sender_role: "BUYER",
            message_type: "COUNTER",
            price_minor: 100_00,
            counter_price_minor: 110_00,
            utility: null,
            decision: "COUNTER",
            message: "I can meet you at $110.",
            phase_at_round: null,
            tactic_used: null,
            concession_rate: null,
            created_at: "2026-07-16T00:00:00.000Z",
          },
        ]
      : [],
  };
}

describe("LiveNegotiation", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.triggerUpdate = undefined;
  });

  it("shows the opening and the persisted seller response in order", () => {
    render(<LiveNegotiation initialPayload={payload()} />);

    expect(
      screen.getByText("Hi, I'm interested in this listing. I'd like to offer $100."),
    ).toBeInTheDocument();
    expect(screen.getByText("I can meet you at $110.")).toBeInTheDocument();
    expect(screen.getByText("Live updates")).toBeInTheDocument();
  });

  it("reloads the full transcript when a live update arrives", async () => {
    mocks.get.mockResolvedValue(payload("ACTIVE", 1));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(screen.getByText("Buyer Agent is thinking")).toBeInTheDocument();
    await act(async () => {
      await mocks.triggerUpdate?.();
    });

    expect(mocks.get).toHaveBeenCalledWith(
      "/negotiations/sessions/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByText("I can meet you at $110.")).toBeInTheDocument();
  });

  it("keeps the transcript visible and appends the final actions", () => {
    render(
      <LiveNegotiation
        initialPayload={payload("ACCEPTED", 1)}
        checkoutHref="/buy/negotiations/11111111-1111-4111-8111-111111111111/checkout"
        checkoutLabel="Continue to checkout"
      />,
    );

    expect(screen.getByText("I can meet you at $110.")).toBeInTheDocument();
    expect(screen.getByText("ACCEPTED")).toBeInTheDocument();
    expect(screen.getByText("Continue to checkout")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Watch replay" })).toHaveAttribute("href", "?replay=1");
  });
});
