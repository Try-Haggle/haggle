import { describe, expect, it } from "vitest";
import { computeSessionTimePressure } from "../time-pressure.js";
import type { CoreMemory } from "../types.js";

function makeSession(overrides: Partial<CoreMemory["session"]> = {}): CoreMemory["session"] {
  return {
    session_id: "sess-1",
    phase: "BARGAINING",
    round: 5,
    rounds_remaining: 5,
    role: "buyer",
    max_rounds: 10,
    intervention_mode: "FULL_AUTO",
    ...overrides,
  };
}

describe("computeSessionTimePressure", () => {
  it("uses explicit deadline window before round fallback", () => {
    const session = makeSession({
      round: 1,
      rounds_remaining: 9,
      created_at_ms: 1_000,
      deadline_at_ms: 11_000,
    });

    expect(computeSessionTimePressure(session, 6_000)).toBe(0.5);
  });

  it("falls back to round progress when no deadline exists", () => {
    expect(computeSessionTimePressure(makeSession())).toBe(0.5);
  });
});
