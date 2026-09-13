import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaybackArena } from "./playback-arena";
import type { FinalStatus, PlaybackResponse, PlaybackRound } from "./types";

function round(roundIndex: number, sender: "BUYER" | "SELLER"): PlaybackRound {
  return {
    roundIndex,
    sender,
    decision: roundIndex === 1 ? "OPENING" : "COUNTER",
    offerPrice: 900 - roundIndex * 10,
    message: `round ${roundIndex}`,
    factors: {},
  };
}

function data(rounds: PlaybackRound[], finalStatus: FinalStatus = "IN_PROGRESS"): PlaybackResponse {
  return {
    session: {
      id: "s1",
      listing: {
        id: "pub-1",
        title: "Camera",
        imageUrl: null,
        askingPrice: 900,
        currency: "USD",
        category: null,
      },
      buyerAgent: {
        presetId: "hunter",
        name: "Buyer bot",
        tagline: "",
        accentColor: "#ef4444",
        emoji: "fox",
      },
      sellerAgent: {
        presetId: "verifier",
        name: "Seller bot",
        tagline: "",
        accentColor: "#3b82f6",
        emoji: "owl",
      },
      finalStatus,
      finalPrice: null,
      roundsTotal: rounds.length,
    },
    rounds,
  };
}

const stateOf = (name: string) =>
  screen.getByRole("img", { name: new RegExp(`^${name} — `) }).getAttribute("data-state");

describe("PlaybackArena agent presence (live)", () => {
  it("shows the side that just offered, and the side now working on a reply", () => {
    render(<PlaybackArena data={data([round(1, "BUYER")])} mode="live" />);
    expect(stateOf("Buyer bot")).toBe("offer");
    expect(stateOf("Seller bot")).toBe("thinking");
  });

  it("puts the question on the buyer when the loop pauses for them", () => {
    render(
      <PlaybackArena
        data={data([round(1, "BUYER"), round(2, "SELLER")])}
        mode="live"
        pauseChecks={[{ checkId: "imei", ask: "Clean IMEI?", options: [] }]}
        onPauseAnswer={async () => {}}
      />,
    );
    expect(stateOf("Buyer bot")).toBe("question");
    expect(stateOf("Seller bot")).toBe("waiting");
  });

  it("shows the pause on a screen that cannot answer it, without the answer form", () => {
    render(
      <PlaybackArena
        data={data([round(1, "BUYER"), round(2, "SELLER")])}
        mode="live"
        pausedForBuyer
      />,
    );
    expect(stateOf("Buyer bot")).toBe("question");
    expect(stateOf("Seller bot")).toBe("waiting");
    expect(screen.queryByRole("button", { name: /submit|answer/i })).toBeNull();
  });

  it("shows both agents the deal once the negotiation settles", () => {
    render(
      <PlaybackArena
        data={data([round(1, "BUYER"), round(2, "SELLER")], "ACCEPTED")}
        mode="live"
        liveTerminal
      />,
    );
    expect(stateOf("Buyer bot")).toBe("deal");
    expect(stateOf("Seller bot")).toBe("deal");
  });

  it("does not claim anyone is thinking after a round fails", () => {
    render(<PlaybackArena data={data([round(1, "BUYER")])} mode="live" liveError="Round failed" />);
    expect(stateOf("Seller bot")).toBe("idle");
  });
});
