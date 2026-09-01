import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("does not drive auto-play when the session driver is MCP", async () => {
    render(
      <LiveNegotiation
        initialPayload={{
          ...payload("CREATED", 0),
          session: { ...payload("CREATED", 0).session, driver: "mcp" },
        }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByText("Watching MCP")).toBeInTheDocument();
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
        { signal: expect.any(AbortSignal) },
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

/**
 * "Never silently stuck." Reported from e2e: after Start Negotiation the first round
 * sometimes never arrived and the UI sat on animated thinking dots forever, with no
 * error and no way to retry.
 */
describe("LiveNegotiation — failures must be visible", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockReturnValue(new Promise(() => undefined));
  });

  it("shows waiting dots while a live round is genuinely in flight", async () => {
    // Positive control for the test below: without it, asserting the dots are GONE
    // would pass even if the query never matched anything.
    mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
    mocks.post.mockReturnValue(new Promise(() => undefined));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(await screen.findByLabelText("Waiting for the next round")).toBeInTheDocument();
  });

  it("stops the waiting dots once a round fails", async () => {
    // The dots keyed off "live and not terminal" only, so they kept spinning next to
    // the error banner — which reads as a hang rather than a failure.
    mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
    mocks.post.mockRejectedValueOnce(new ApiError(502, "AUTO_PLAY_ROUND_FAILED"));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    await screen.findByText(
      "The next round could not be generated. Your completed rounds are saved.",
    );
    // AnimatePresence keeps the node mounted for its exit transition, so wait it out
    // rather than asserting on the same tick.
    await waitFor(
      () => expect(screen.queryByLabelText("Waiting for the next round")).not.toBeInTheDocument(),
      { timeout: 3_000 },
    );
  });

  it("does not retry a terminal session response forever", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
    mocks.post.mockRejectedValue(new ApiError(409, "SESSION_TERMINAL"));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(
      await screen.findByText("This negotiation has ended. Refresh to see its final status."),
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("stops driving when the server pauses for the buyer", async () => {
    // A seller-criteria PAUSE answers 200 with no new round and leaves the session
    // WAITING, which is not terminal — so ignoring the body span the loop forever.
    mocks.get.mockReset().mockResolvedValue(payload("WAITING", 0));
    mocks.post.mockResolvedValue({
      paused_for_buyer: true,
      session_status: "WAITING",
      current_round: 0,
      complete: false,
    });
    render(<LiveNegotiation initialPayload={payload("WAITING", 0)} />);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    // Give the old runaway loop every chance to fire again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});

/**
 * Seller-criteria PAUSE (runbook E2/E3).
 *
 * The server has always stopped the rounds and sent the questions, and has always
 * accepted an answer at `/pause/answer` — but no client ever read either, so a paused
 * session showed spinning dots and could not be resumed. That is the safety net which
 * stops someone buying a salvage-title car without knowing, so being unable to answer
 * makes it a trap rather than a protection.
 */
describe("LiveNegotiation — paused for the buyer", () => {
  const PAUSED = {
    paused_for_buyer: true,
    pause_checks: [
      {
        checkId: "title_status",
        ask: "Should the agent require a clean title?",
        options: [
          { label: "Clean title only", stance: "clean title" },
          { label: "Doesn't matter", stance: "any title status" },
        ],
      },
    ],
    session_status: "WAITING",
    current_round: 2,
    complete: false,
  };

  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockReturnValue(new Promise(() => undefined));
  });

  it("shows the question and an input instead of spinning dots", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("WAITING", 1));
    mocks.post.mockResolvedValue(PAUSED);
    render(<LiveNegotiation initialPayload={payload("WAITING", 1)} />);

    expect(await screen.findByText("Should the agent require a clean title?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Answer & resume" })).toBeInTheDocument();
    // Dots claim work is in flight; here we are waiting on a person. AnimatePresence
    // keeps the node mounted through its exit transition, so wait it out.
    await waitFor(
      () => expect(screen.queryByLabelText("Waiting for the next round")).not.toBeInTheDocument(),
      { timeout: 3_000 },
    );
  });

  it("sends the answer and resumes the rounds", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("WAITING", 1));
    mocks.post.mockResolvedValue(PAUSED);
    render(<LiveNegotiation initialPayload={payload("WAITING", 1)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Clean title only" }));

    // From here the pause is resolved: answering, then rounds running on to a deal.
    mocks.post.mockReset().mockResolvedValue({
      ok: true,
      resolved: true,
      remaining_check_ids: [],
    });
    mocks.get.mockReset().mockResolvedValue(payload("ACCEPTED", 1));
    fireEvent.click(screen.getByRole("button", { name: "Answer & resume" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/negotiations/sessions/11111111-1111-4111-8111-111111111111/pause/answer",
        expect.objectContaining({
          stances: [{ checkId: "title_status", stance: "clean title" }],
        }),
      ),
    );
    // The panel goes away and the loop is driving again.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Answer & resume" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the typed answer when submitting fails", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("WAITING", 1));
    mocks.post.mockResolvedValue(PAUSED);
    render(<LiveNegotiation initialPayload={payload("WAITING", 1)} />);

    fireEvent.click(await screen.findByRole("button", { name: "Clean title only" }));

    mocks.post.mockReset().mockRejectedValue(new ApiError(409, "CONCURRENT_MODIFICATION"));
    fireEvent.click(screen.getByRole("button", { name: "Answer & resume" }));

    expect(await screen.findByText("That didn't go through. Try again.")).toBeInTheDocument();
    // Re-answering what you already answered is the thing this panel exists to avoid.
    expect(screen.getByRole("button", { name: "Clean title only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("refuses to submit an empty answer", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("WAITING", 1));
    mocks.post.mockResolvedValue(PAUSED);
    render(<LiveNegotiation initialPayload={payload("WAITING", 1)} />);

    const button = await screen.findByRole("button", { name: "Answer & resume" });
    expect(button).toBeDisabled();
  });
});

describe("LiveNegotiation — a pause naming several requirements", () => {
  const MULTI = {
    paused_for_buyer: true,
    pause_checks: [
      {
        checkId: "bed_bugs",
        ask: "Should the agent require it inspected clear of bed bugs?",
        options: [
          { label: "Required", stance: "inspected clear of bed bugs" },
          { label: "Doesn't matter", stance: "no bed-bug requirement" },
        ],
      },
      {
        checkId: "mold_mildew",
        ask: "Should the agent require no mold/mildew?",
        options: [
          { label: "Required", stance: "no mold or mildew" },
          { label: "Doesn't matter", stance: "no mold preference" },
        ],
      },
    ],
    session_status: "WAITING",
    current_round: 2,
    complete: false,
  };

  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockResolvedValue(payload("WAITING", 1));
    mocks.post.mockResolvedValue(MULTI);
  });

  it("will not submit until every question is answered", async () => {
    render(<LiveNegotiation initialPayload={payload("WAITING", 1)} />);
    const submit = await screen.findByRole("button", { name: "Answer & resume" });
    expect(submit).toBeDisabled();

    // Answering only the first must not be enough — the second would otherwise be
    // recorded with whatever the first said.
    fireEvent.click(screen.getAllByRole("button", { name: "Required" })[0]!);
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Doesn't matter" })[1]!);
    expect(submit).toBeEnabled();
  });

  it("sends the stance chosen for each check, not one shared answer", async () => {
    render(<LiveNegotiation initialPayload={payload("WAITING", 1)} />);
    await screen.findByRole("button", { name: "Answer & resume" });

    fireEvent.click(screen.getAllByRole("button", { name: "Required" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Doesn't matter" })[1]!);

    mocks.post.mockReset().mockResolvedValue({ ok: true, resolved: true });
    fireEvent.click(screen.getByRole("button", { name: "Answer & resume" }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/negotiations/sessions/11111111-1111-4111-8111-111111111111/pause/answer",
        expect.objectContaining({
          stances: [
            { checkId: "bed_bugs", stance: "inspected clear of bed bugs" },
            { checkId: "mold_mildew", stance: "no mold preference" },
          ],
        }),
      ),
    );
  });
});

/**
 * Runbook E3: the answer must be visible in the transcript, under the question it
 * answered. Persisted on the asking round, so it survives a reload — the transcript is
 * where people go to check what they agreed to.
 */
describe("LiveNegotiation — the answer shows under the question", () => {
  function payloadWithAnswer(): SessionResponse {
    const base = payload("ACCEPTED", 1);
    return {
      ...base,
      rounds: [
        {
          ...base.rounds[0]!,
          message: "Should the agent require a clean title?",
          pause_answers: [
            {
              checkId: "title_status",
              ask: "Should the agent require a clean title?",
              stance: "clean title",
              label: "Clean title only",
            },
          ],
        },
      ],
    };
  }

  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockReturnValue(new Promise(() => undefined));
  });

  it("renders the tapped label as a reply", () => {
    render(<LiveNegotiation initialPayload={payloadWithAnswer()} />);
    expect(screen.getByText("You answered")).toBeInTheDocument();
    // The label the buyer tapped, not the stored stance wording.
    expect(screen.getByText("Clean title only")).toBeInTheDocument();
  });

  it("shows nothing extra on rounds that were never paused", () => {
    render(<LiveNegotiation initialPayload={payload("ACCEPTED", 1)} />);
    expect(screen.queryByText("You answered")).not.toBeInTheDocument();
  });
});

describe("LiveNegotiation — the way to the seller", () => {
  it("stays out of the way while the rounds are running", () => {
    render(<LiveNegotiation initialPayload={payload("ACTIVE")} canMessageSeller />);

    expect(screen.queryByRole("button", { name: /Message seller/ })).toBeNull();
  });

  it("appears once the negotiation is over", () => {
    render(<LiveNegotiation initialPayload={payload("REJECTED")} canMessageSeller />);

    expect(screen.getByRole("button", { name: /Message seller/ })).toBeInTheDocument();
  });

  it("never appears for a guest — there is no account to hold the thread", () => {
    render(<LiveNegotiation initialPayload={payload("REJECTED")} />);

    expect(screen.queryByRole("button", { name: /Message seller/ })).toBeNull();
  });
});
