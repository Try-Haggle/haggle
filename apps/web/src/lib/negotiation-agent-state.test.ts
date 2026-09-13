import { describe, expect, it } from "vitest";
import { negotiationAgentState as state } from "./negotiation-agent-state";

describe("negotiationAgentState", () => {
  it("shows both agents the outcome once it is settled", () => {
    for (const side of ["BUYER", "SELLER"] as const) {
      expect(state({ side, status: "ACCEPTED", lastSender: "SELLER", surface: "arena" })).toBe(
        "deal",
      );
      for (const status of ["REJECTED", "EXPIRED", "SUPERSEDED"]) {
        expect(state({ side, status, lastSender: "BUYER", surface: "list" })).toBe("walked");
      }
    }
  });

  it("gives the question to the buyer when the loop pauses to ask them", () => {
    const base = { status: "ACTIVE", lastSender: "SELLER" as const, pausedForBuyer: true };
    expect(state({ ...base, side: "BUYER", surface: "arena" })).toBe("question");
    expect(state({ ...base, side: "SELLER", surface: "arena" })).toBe("waiting");
  });

  it("gives a near-deal to the seller, whose call it is to close", () => {
    expect(
      state({ side: "SELLER", status: "NEAR_DEAL", lastSender: "BUYER", surface: "list" }),
    ).toBe("question");
    expect(
      state({ side: "BUYER", status: "NEAR_DEAL", lastSender: "BUYER", surface: "list" }),
    ).toBe("waiting");
  });

  it("shows the side that moves next as thinking, by default the one that did not move last", () => {
    expect(state({ side: "SELLER", status: "ACTIVE", lastSender: "BUYER", surface: "arena" })).toBe(
      "thinking",
    );
  });

  it("reads the side that just moved as an offer in the arena, and as their turn in a list", () => {
    const base = { side: "BUYER" as const, status: "ACTIVE", lastSender: "BUYER" as const };
    expect(state({ ...base, surface: "arena" })).toBe("offer");
    expect(state({ ...base, surface: "list" })).toBe("waiting");
  });

  it("shows nobody thinking when nothing is in flight (a failed round)", () => {
    const base = {
      status: "ACTIVE",
      lastSender: "BUYER" as const,
      activeRole: null,
      surface: "arena" as const,
    };
    expect(state({ ...base, side: "SELLER" })).toBe("idle");
    expect(state({ ...base, side: "BUYER" })).toBe("offer");
  });

  it("is idle before the first round, unless that side is already working on it", () => {
    expect(state({ side: "SELLER", status: "CREATED", lastSender: null, surface: "list" })).toBe(
      "idle",
    );
    expect(
      state({
        side: "BUYER",
        status: "ACTIVE",
        lastSender: null,
        activeRole: "BUYER",
        surface: "arena",
      }),
    ).toBe("thinking");
  });
});
