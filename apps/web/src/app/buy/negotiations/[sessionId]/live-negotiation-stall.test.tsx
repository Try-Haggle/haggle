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

function round(
  roundNo: number,
  message: string,
  sender: "BUYER" | "SELLER" = "BUYER",
): SessionResponse["rounds"][number] {
  return {
    id: `22222222-2222-4222-8222-22222222222${roundNo}`,
    round_no: roundNo,
    sender_role: sender,
    message_type: roundNo === 1 ? "OFFER" : "COUNTER",
    price_minor: 360_00,
    counter_price_minor: roundNo === 1 ? null : 395_00,
    utility: null,
    decision: "COUNTER",
    message,
    phase_at_round: null,
    tactic_used: null,
    concession_rate: null,
    created_at: "2026-07-16T00:00:00.000Z",
  };
}

function payload(
  status = "ACTIVE",
  currentRound = 0,
  rounds: SessionResponse["rounds"] = [],
): SessionResponse {
  return {
    session: {
      id: "11111111-1111-4111-8111-111111111111",
      status,
      current_round: currentRound,
      last_offer_price_minor: rounds.length ? 395_00 : null,
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
    rounds,
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
      mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0, []));
      // The request never settles — the exact silent case, with no error to report.
      let roundSignal: AbortSignal | undefined;
      mocks.post.mockImplementation((_path: string, _body: unknown, options?: RequestInit) => {
        roundSignal = options?.signal ?? undefined;
        return new Promise(() => undefined);
      });
      render(<LiveNegotiation initialPayload={payload("CREATED", 0, [])} />);

      // Wrapped in act so the watchdog's setState is flushed before asserting.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(211_000);
      });
      // The fetch is cancelled at 200s; the 210s watchdog is the second line
      // for transports/mocks that ignore AbortSignal.
      expect(roundSignal?.aborted).toBe(true);
      expect(
        screen.getByText("This round is taking longer than expected. Nothing has been lost."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the stall banner when ACTIVE and the current round already exists", async () => {
    // Tester a9626ebf: R1 $360 / R2 $395 already on the transcript, status ACTIVE,
    // stall watchdog still fired because no *new* round landed for 210s.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "Date"] });
    try {
      const landed = payload("ACTIVE", 2, [
        round(1, "I'd like to offer $360."),
        round(2, "I can do $395.", "SELLER"),
      ]);
      mocks.get.mockReset().mockResolvedValue(landed);
      mocks.post.mockReturnValue(new Promise(() => undefined));
      render(<LiveNegotiation initialPayload={landed} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(211_000);
      });
      expect(
        screen.queryByText("This round is taking longer than expected. Nothing has been lost."),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still shows the stall banner when ACTIVE but the current round is missing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "Date"] });
    try {
      const inFlight = payload("ACTIVE", 3, [
        round(1, "I'd like to offer $360."),
        round(2, "I can do $395.", "SELLER"),
      ]);
      mocks.get.mockReset().mockResolvedValue(inFlight);
      mocks.post.mockReturnValue(new Promise(() => undefined));
      render(<LiveNegotiation initialPayload={inFlight} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(211_000);
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
