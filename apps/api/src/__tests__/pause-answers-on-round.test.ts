/**
 * The buyer's pause answer is written onto the round that asked for it.
 *
 * Runbook E3: without this the question sits in the transcript with no reply under it,
 * and after a reload there is no trace the buyer ever responded — the transcript is
 * where people check what they agreed to.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@haggle/db", () => ({
  and: (...c: unknown[]) => ({ __op: "and", c }),
  eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
  sql: (strings: TemplateStringsArray) => ({ __sql: strings.join("?") }),
  negotiationRounds: {
    id: { name: "id" },
    metadata: { name: "metadata" },
    sessionId: {},
    roundNo: {},
  },
}));

import { recordPauseAnswersOnRound } from "../services/negotiation-round.service.js";

function makeDb(existingMetadata: Record<string, unknown> | null) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ metadata: existingMetadata }]) }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        writes.push(patch);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  } as never;
  return { db, writes };
}

const ANSWER = {
  checkId: "title_status",
  ask: "Should the agent require a clean title?",
  stance: "clean title",
  label: "Clean title only",
};

describe("recordPauseAnswersOnRound", () => {
  it("stores the answers on the round", async () => {
    const { db, writes } = makeDb(null);
    await recordPauseAnswersOnRound(db, "round-1", [ANSWER]);
    expect(writes).toHaveLength(1);
    expect((writes[0]?.metadata as Record<string, unknown>).buyer_pause_answers).toEqual([ANSWER]);
  });

  it("keeps the metadata the round already carried", async () => {
    // The pause marker lives in `reasoning`; losing it would break the resume gate.
    const { db, writes } = makeDb({ reasoning: "SELLER_CRITERIA_PAUSE: title_status" });
    await recordPauseAnswersOnRound(db, "round-1", [ANSWER]);
    expect((writes[0]?.metadata as Record<string, unknown>).reasoning).toContain(
      "SELLER_CRITERIA_PAUSE",
    );
  });

  it("writes nothing when there is nothing to record", async () => {
    const { db, writes } = makeDb(null);
    await recordPauseAnswersOnRound(db, "round-1", []);
    expect(writes).toHaveLength(0);
  });
});
