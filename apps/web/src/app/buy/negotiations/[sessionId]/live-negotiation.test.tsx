import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { LocaleProvider } from "@/providers/locale-provider";
import type { SessionResponse } from "./negotiation-session-data";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  /**
   * `real` uses the production hook (pendingTarget moves with queue/PATCH).
   * `snapshot-gap` drops pendingTarget when local inflight clears, which is the
   * window the post-POST `manualHandoff` snapshot exists to cover.
   */
  controlMode: "real" as "real" | "snapshot-gap",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/components/control-mode/control-mode-panel", () => ({
  ControlModePanel: (props: {
    controller?: {
      requestMode?: (mode: "auto" | "manual") => void;
      ownMode?: string;
      pendingTarget?: string | null;
    };
  }) => (
    <div data-testid="control-mode-panel">
      <span data-testid="control-own-mode">{props.controller?.ownMode}</span>
      <span data-testid="control-pending">{props.controller?.pendingTarget ?? "none"}</span>
      <button type="button" onClick={() => props.controller?.requestMode?.("manual")}>
        Switch to Manual
      </button>
      <button type="button" onClick={() => props.controller?.requestMode?.("auto")}>
        Switch to Auto
      </button>
    </div>
  ),
}));

vi.mock("@/hooks/use-session-control-mode", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("@/hooks/use-session-control-mode")>();

  function useSnapshotGap(opts: {
    localInflight: boolean;
    serverSession?: { buyer_control_mode?: string | null } | null;
  }) {
    const pendingRef = React.useRef<"manual" | "auto" | null>(null);
    const prevInflight = React.useRef(opts.localInflight);
    const [, setVersion] = React.useState(0);
    // Same render that publishes localInflight=false drops the queued target,
    // so the post-POST check can no longer see it on the live ref.
    if (prevInflight.current && !opts.localInflight) {
      pendingRef.current = null;
    }
    prevInflight.current = opts.localInflight;
    const isManual = opts.serverSession?.buyer_control_mode === "manual";
    const requestMode = (next: "auto" | "manual") => {
      pendingRef.current = next;
      setVersion((version) => version + 1);
    };
    return {
      enabled: true,
      party: "buyer" as const,
      ownMode: isManual ? ("manual" as const) : ("auto" as const),
      peerMode: "auto" as const,
      pendingTarget: pendingRef.current,
      inflight: opts.localInflight,
      syncState: "idle" as const,
      error: null,
      insufficientCredits: null,
      isManual,
      isAuto: !isManual,
      failedTarget: null,
      manualSwitchFailed: false,
      requestMode,
      toggle: () => requestMode(isManual ? "auto" : "manual"),
      clearFailure: () => undefined,
      retry: () => undefined,
    };
  }

  return {
    useSessionControlMode: (opts: Parameters<typeof actual.useSessionControlMode>[0]) => {
      const real = actual.useSessionControlMode({
        ...opts,
        enabled: mocks.controlMode === "snapshot-gap" ? false : opts.enabled,
      });
      const gap = useSnapshotGap(opts);
      return mocks.controlMode === "snapshot-gap" ? gap : real;
    },
  };
});

vi.mock("@/hooks/use-negotiation-ws", () => ({
  useNegotiationWs: () => ({ connectionMode: "polling" }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, api: { get: mocks.get, post: mocks.post, patch: mocks.patch } };
});

import { LiveNegotiation } from "./live-negotiation";

beforeEach(() => {
  mocks.controlMode = "real";
  mocks.patch.mockReset();
  mocks.patch.mockResolvedValue({ buyer_control_mode: "manual", seller_control_mode: "auto" });
});

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

const ROUND_FAILED = "The next round could not be generated. Your completed rounds are saved.";

function manualPayload(status = "ACTIVE", rounds = 0): SessionResponse {
  const base = payload(status, rounds);
  return {
    ...base,
    session: { ...base.session, buyer_control_mode: "manual" },
  };
}

/**
 * Turning Auto off while a round request is in flight used to surface
 * "could not be generated" — the PATCH wins, and the next auto-play POST
 * comes back 409 SOFT_MANUAL_WAITING. That is a handoff, not a failed round.
 */
describe("LiveNegotiation — switching Auto off during a round", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockReturnValue(new Promise(() => undefined));
  });

  it("stops without a round error when auto-play returns SOFT_MANUAL_WAITING", async () => {
    const running = payload("CREATED", 0);
    mocks.get
      .mockReset()
      .mockResolvedValueOnce(running)
      .mockResolvedValue(manualPayload("ACTIVE", 0));
    mocks.post.mockRejectedValueOnce(new ApiError(409, "SOFT_MANUAL_WAITING"));
    render(<LiveNegotiation initialPayload={running} />);

    await waitFor(() => {
      expect(screen.getByTestId("buyer-manual-action-bar")).toBeInTheDocument();
    });
    expect(screen.queryByText(ROUND_FAILED)).not.toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("stops without a round error when SOFT_MANUAL_WAITING follows a concurrent retry", async () => {
    const running = payload("CREATED", 0);
    mocks.get
      .mockReset()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue(manualPayload("ACTIVE", 0));
    mocks.post
      .mockRejectedValueOnce(new ApiError(409, "CONCURRENT_MODIFICATION"))
      .mockRejectedValueOnce(new ApiError(409, "SOFT_MANUAL_WAITING"));
    render(<LiveNegotiation initialPayload={running} />);

    await waitFor(
      () => {
        expect(screen.getByTestId("buyer-manual-action-bar")).toBeInTheDocument();
      },
      { timeout: 4_000 },
    );
    expect(screen.queryByText(ROUND_FAILED)).not.toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(2);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("does not send another auto-play round when Manual is queued during an in-flight POST", async () => {
    // pendingTarget is manual only while the POST is in flight. The render that
    // clears local inflight drops it, so the live ref is false at the post-POST
    // check. Stopping depends on the manualHandoff snapshot taken before that.
    mocks.controlMode = "snapshot-gap";
    const running = payload("ACTIVE", 1);
    let resolvePost: ((value: unknown) => void) | undefined;
    let releaseReload: ((value: SessionResponse) => void) | undefined;
    let gets = 0;
    mocks.get.mockReset().mockImplementation(() => {
      gets += 1;
      if (gets === 1) return Promise.resolve(running);
      return new Promise<SessionResponse>((resolve) => {
        releaseReload = resolve;
      });
    });
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("control-pending")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual" }));
    expect(screen.getByTestId("control-pending")).toHaveTextContent("manual");

    await act(async () => {
      resolvePost?.({
        complete: false,
        session_status: "ACTIVE",
        current_round: 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("control-pending")).toHaveTextContent("none"));
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseReload?.(running);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("control-pending")).not.toHaveTextContent("manual");
    expect(screen.queryByText(ROUND_FAILED)).not.toBeInTheDocument();
  });

  it("does not POST auto-play again when Manual is pressed during a concurrent-modification retry", async () => {
    const running = payload("CREATED", 0);
    let rejectPost: ((reason: unknown) => void) | undefined;
    let resolvePatch: ((value: unknown) => void) | undefined;
    mocks.get.mockReset().mockResolvedValue(running);
    mocks.post.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        }),
    );
    mocks.patch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    render(<LiveNegotiation initialPayload={running} />);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual" }));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(screen.getByTestId("control-pending")).toHaveTextContent("manual");

    await act(async () => {
      rejectPost?.(new ApiError(409, "CONCURRENT_MODIFICATION"));
    });
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("control-pending")).toHaveTextContent("manual");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ROUND_FAILED)).not.toBeInTheDocument();

    await act(async () => {
      resolvePatch?.({ buyer_control_mode: "manual", seller_control_mode: "auto" });
    });
  });

  it("still shows the round error for an internal auto-play failure", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
    mocks.post.mockRejectedValueOnce(new ApiError(500, "INTERNAL"));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(await screen.findByText(ROUND_FAILED)).toBeInTheDocument();
    expect(screen.queryByTestId("buyer-manual-action-bar")).not.toBeInTheDocument();
  });

  it("still shows the round error for a generic auto-play failure", async () => {
    mocks.get.mockReset().mockResolvedValue(payload("CREATED", 0));
    mocks.post.mockRejectedValueOnce(new Error("socket hang up"));
    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    expect(await screen.findByText(ROUND_FAILED)).toBeInTheDocument();
    expect(screen.queryByTestId("buyer-manual-action-bar")).not.toBeInTheDocument();
  });
});

function renderLive(ui: SessionResponse) {
  return render(
    <LocaleProvider>
      <LiveNegotiation initialPayload={ui} />
    </LocaleProvider>,
  );
}

/**
 * Manual PATCH rejected while a concurrent-modification retry is waiting.
 * Auto-play must stay stopped (no automatic runner restart) until the buyer chooses.
 */
describe("LiveNegotiation — Manual PATCH failure", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
    mocks.get.mockResolvedValue(payload("ACTIVE", 0));
  });

  async function failManualDuringRetry() {
    let rejectPost: ((reason: unknown) => void) | undefined;
    mocks.post.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        }),
    );
    mocks.patch.mockRejectedValue(new Error("network down"));
    renderLive(payload("CREATED", 0));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual" }));
    await act(async () => {
      rejectPost?.(new ApiError(409, "CONCURRENT_MODIFICATION"));
    });

    const notice = await screen.findByTestId("manual-switch-failed");
    expect(within(notice).getByText("Manual switch failed")).toBeInTheDocument();
    expect(within(notice).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(notice).getByRole("button", { name: "Continue Auto" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("control-own-mode")).toHaveTextContent(/^auto$/);
    return notice;
  }

  it("stops auto-play and shows Retry and Continue Auto after the Manual PATCH rejects", async () => {
    await failManualDuringRetry();
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("resumes auto-play only after Continue Auto", async () => {
    const notice = await failManualDuringRetry();
    mocks.get
      .mockReset()
      .mockResolvedValueOnce(payload("ACTIVE", 0))
      .mockResolvedValue(payload("ACCEPTED", 1));
    mocks.post.mockResolvedValue({
      complete: true,
      session_status: "ACCEPTED",
      current_round: 1,
    });

    fireEvent.click(within(notice).getByRole("button", { name: "Continue Auto" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("manual-switch-failed")).not.toBeInTheDocument();
    expect(screen.getByTestId("control-own-mode")).toHaveTextContent(/^auto$/);
  });

  it("re-sends the Manual PATCH when Retry is clicked", async () => {
    const notice = await failManualDuringRetry();
    let resolvePatch: ((value: unknown) => void) | undefined;
    mocks.patch.mockReset();
    mocks.patch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );

    fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch).toHaveBeenCalledWith(
      "/negotiations/sessions/11111111-1111-4111-8111-111111111111/control-mode",
      { control_mode: "manual" },
    );
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePatch?.({ buyer_control_mode: "manual", seller_control_mode: "auto" });
    });
  });
});

describe("LiveNegotiation — auto rounds keep running", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    window.sessionStorage.clear();
  });

  it("runs three consecutive auto rounds without stopping", async () => {
    let posts = 0;
    mocks.get.mockImplementation(async () =>
      posts >= 3 ? payload("ACCEPTED", 3) : payload("ACTIVE", posts),
    );
    mocks.post.mockImplementation(async () => {
      posts += 1;
      return {
        complete: posts >= 3,
        session_status: posts >= 3 ? "ACCEPTED" : "ACTIVE",
        current_round: posts,
      };
    });

    render(<LiveNegotiation initialPayload={payload("CREATED", 0)} />);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(3));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.post).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("manual-switch-failed")).not.toBeInTheDocument();
  });

  it("resumes auto-play after Manual is switched to Auto", async () => {
    // GETs stay pending until after the optimistic Auto render. The drive loop's
    // first loadSession then returns auto before that setPayload commits, which
    // is the window a render-only serverManual ref would still say Manual.
    const activeAuto = {
      ...payload("ACTIVE", 0),
      session: { ...payload("ACTIVE", 0).session, buyer_control_mode: "auto" as const },
    };
    const acceptedAuto = {
      ...payload("ACCEPTED", 1),
      session: { ...payload("ACCEPTED", 1).session, buyer_control_mode: "auto" as const },
    };
    let posts = 0;
    let released = false;
    const waiters: Array<(value: SessionResponse) => void> = [];
    const sessionForGet = () => (posts > 0 ? acceptedAuto : activeAuto);
    mocks.get.mockImplementation(
      () =>
        new Promise<SessionResponse>((resolve) => {
          if (released) {
            resolve(sessionForGet());
            return;
          }
          waiters.push(resolve);
        }),
    );
    mocks.patch.mockResolvedValue({
      buyer_control_mode: "auto",
      seller_control_mode: "auto",
    });
    mocks.post.mockImplementation(async () => {
      posts += 1;
      return { complete: true, session_status: "ACCEPTED", current_round: 1 };
    });

    render(<LiveNegotiation initialPayload={manualPayload("ACTIVE", 0)} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByTestId("control-own-mode")).toHaveTextContent(/^manual$/);

    fireEvent.click(screen.getByRole("button", { name: "Switch to Auto" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(waiters.length).toBeGreaterThan(0);

    released = true;
    const pending = waiters.splice(0);
    await act(async () => {
      for (const resolve of pending) resolve(sessionForGet());
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("control-own-mode")).toHaveTextContent(/^auto$/);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
