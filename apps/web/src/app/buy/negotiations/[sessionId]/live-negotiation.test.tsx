import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { SessionResponse } from "./negotiation-session-data";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/hooks/use-negotiation-ws", () => ({
  useNegotiationWs: () => ({ connectionMode: "polling" }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, api: { get: mocks.get, post: mocks.post } };
});

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
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockReturnValue(new Promise(() => undefined));
  });

  it("shows the opening and the persisted seller response in order", () => {
    render(<LiveNegotiation initialPayload={payload()} />);

    expect(
      screen.getByText("Hi, I'm interested in this listing. I'd like to offer $100."),
    ).toBeInTheDocument();
    expect(screen.getByText("I can meet you at $110.")).toBeInTheDocument();
    expect(screen.getByText("Live updates")).toBeInTheDocument();
  });

  it("requests and displays one committed round at a time", async () => {
    window.sessionStorage.setItem(
      "haggle:negotiation-run-token:11111111-1111-4111-8111-111111111111",
      "test-run-token",
    );
    mocks.get
      .mockReset()
      .mockResolvedValueOnce(payload("CREATED", 0))
      .mockResolvedValueOnce(payload("ACCEPTED", 1));
    mocks.post.mockResolvedValue({
      complete: true,
      session_status: "ACCEPTED",
      current_round: 1,
    });
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(screen.getByText("Live updates")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        "/negotiations/sessions/11111111-1111-4111-8111-111111111111/auto-play/next",
        { run_token: "test-run-token" },
      );
    });

    expect(await screen.findByText("I can meet you at $110.")).toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
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

  it("shows a recoverable error and retries from saved progress", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
    mocks.post.mockRejectedValueOnce(new ApiError(502, "AUTO_PLAY_ROUND_FAILED"));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(
      await screen.findByText(
        "The next round could not be generated. Your completed rounds are saved.",
      ),
    ).toBeInTheDocument();

    mocks.get
      .mockReset()
      .mockResolvedValueOnce(payload("CREATED", 0))
      .mockResolvedValueOnce(payload("ACCEPTED", 1));
    mocks.post.mockResolvedValueOnce({
      complete: true,
      session_status: "ACCEPTED",
      current_round: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Negotiation complete")).toBeInTheDocument();
  });
});
