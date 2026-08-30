/**
 * The pinned negotiation result. Its job is to be readable without opening
 * anything, so these check what it says and where its link goes.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationOutcome } from "@/lib/messaging-api";
import { OutcomeStrip } from "./outcome-strip";

const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function outcome(overrides: Partial<ConversationOutcome> = {}): ConversationOutcome {
  return {
    status: "DEAL",
    priceMinor: 890000,
    rounds: 6,
    settledAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("OutcomeStrip", () => {
  it("leads with the result and the settled price", () => {
    render(<OutcomeStrip outcome={outcome()} side="buying" sessionId={SESSION_ID} />);
    expect(screen.getByText("Deal")).toBeInTheDocument();
    expect(screen.getByText("$8,900")).toBeInTheDocument();
  });

  it("calls a non-deal price the last offer, not a price paid", () => {
    render(
      <OutcomeStrip
        outcome={outcome({ status: "NO_DEAL", priceMinor: 810000 })}
        side="buying"
        sessionId={SESSION_ID}
      />,
    );
    expect(screen.getByText("No deal")).toBeInTheDocument();
    expect(screen.getByText(/last offer/).parentElement).toHaveTextContent("last offer $8,100");
  });

  it("links each side to its own negotiation view", () => {
    const { rerender } = render(
      <OutcomeStrip outcome={outcome()} side="buying" sessionId={SESSION_ID} />,
    );
    expect(screen.getByRole("link", { name: /view negotiation/i })).toHaveAttribute(
      "href",
      `/buy/negotiations/${SESSION_ID}`,
    );

    rerender(<OutcomeStrip outcome={outcome()} side="selling" sessionId={SESSION_ID} />);
    expect(screen.getByRole("link", { name: /view negotiation/i })).toHaveAttribute(
      "href",
      `/sell/negotiations/${SESSION_ID}`,
    );
  });

  it("drops the link rather than guessing a side", () => {
    render(<OutcomeStrip outcome={outcome()} side={null} sessionId={SESSION_ID} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("carries the result and price only — the listing detail stays in the panel", () => {
    render(<OutcomeStrip outcome={outcome()} side="buying" sessionId={SESSION_ID} />);
    expect(screen.queryByText(/asking/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
