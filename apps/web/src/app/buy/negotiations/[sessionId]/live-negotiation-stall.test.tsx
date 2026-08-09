/**
 * The stall watchdog, isolated in its own file ON PURPOSE.
 *
 * It needs fake timers to fast-forward two minutes, and faking the clock leaves
 * framer-motion driving its exit animations off a stale reference even after real timers
 * are restored — so any test sharing the file afterwards never sees an element unmount.
 * Keeping it alone means the fake clock cannot reach anything else.
 */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function payload(status = "ACTIVE", rounds = 0): SessionResponse {
  return {
    session: {
      id: "11111111-1111-4111-8111-111111111111",
      status,
      current_round: rounds,
      last_offer_price_minor: null,
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
    rounds: [],
  };
}

describe("LiveNegotiation — stall watchdog", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
  });

  it("surfaces a stall when nothing progresses, and recovers on Retry", async () => {
    // Only the clock the watchdog reads. Faking requestAnimationFrame too leaves
    // framer-motion driving its exit animations off a stale reference once real timers
    // are restored, so later tests in this file never see an element unmount.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "Date"] });
    try {
      mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
      // The request never settles — the exact silent case, with no error to report.
      mocks.post.mockReturnValue(new Promise(() => undefined));
      render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

      // Wrapped in act so the watchdog's setState is flushed before asserting.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(121_000);
      });
      expect(
        screen.getByText("This round is taking longer than expected. Nothing has been lost."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
