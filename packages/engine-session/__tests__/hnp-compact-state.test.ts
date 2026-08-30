import { describe, expect, it } from "vitest";
import type { HnpPublicAct } from "../src/protocol/compact-state.js";
import {
  encodeHnpCompactStateForLlm,
  reduceHnpPublicCompactState,
  sanitizeHnpPublicClaim,
} from "../src/protocol/compact-state.js";

function act(partial: HnpPublicAct): HnpPublicAct {
  return partial;
}

describe("HNP public compact state", () => {
  it("overwrites price slots instead of keeping the transcript", () => {
    const state = reduceHnpPublicCompactState([
      act({
        sequence: 1,
        role: "BUYER",
        type: "OFFER",
        total_price: { currency: "USD", units_minor: 37000 },
        claim: "256GB so I start lower",
      }),
      act({
        sequence: 2,
        role: "SELLER",
        type: "COUNTER",
        total_price: { currency: "USD", units_minor: 48000 },
        claim: "battery is 87%",
      }),
      act({
        sequence: 3,
        role: "BUYER",
        type: "COUNTER",
        total_price: { currency: "USD", units_minor: 42000 },
        claim: "still over my storage target",
      }),
    ]);

    expect(state.price.buyer_minor).toBe(42000);
    expect(state.price.seller_minor).toBe(48000);
    expect(state.price.last_role).toBe("BUYER");
    expect(state.acts).toHaveLength(3);
  });

  it("marks an issue ALIGNED only when both sides stated the same value", () => {
    const state = reduceHnpPublicCompactState([
      act({
        sequence: 1,
        role: "SELLER",
        type: "OFFER",
        issues: [
          {
            issue_id: "hnp.issue.condition.battery_health",
            value: "87%",
            kind: "INFORMATIONAL",
          },
        ],
      }),
      act({
        sequence: 2,
        role: "BUYER",
        type: "COUNTER",
        issues: [{ issue_id: "hnp.issue.condition.battery_health", value: "87%" }],
      }),
    ]);

    expect(state.issues[0]).toMatchObject({
      issue_id: "hnp.issue.condition.battery_health",
      status: "ALIGNED",
      buyer: "87%",
      seller: "87%",
    });
  });

  it("keeps an issue OPEN when sides disagree", () => {
    const state = reduceHnpPublicCompactState([
      act({
        sequence: 1,
        role: "BUYER",
        type: "OFFER",
        issues: [{ issue_id: "hnp.issue.condition.battery_health", value: "90%+" }],
      }),
      act({
        sequence: 2,
        role: "SELLER",
        type: "COUNTER",
        issues: [{ issue_id: "hnp.issue.condition.battery_health", value: "87%" }],
      }),
    ]);

    expect(state.issues[0]?.status).toBe("OPEN");
  });

  it("encodes a legend an LLM can read and omits private fields", () => {
    const state = reduceHnpPublicCompactState([
      act({
        sequence: 1,
        role: "BUYER",
        type: "OFFER",
        total_price: { currency: "USD", units_minor: 37000 },
        claim: "256GB so I start lower",
      }),
    ]);
    const encoded = encodeHnpCompactStateForLlm(state);

    expect(encoded).toContain("HNP:");
    expect(encoded).toContain("public negotiation state only");
    expect(encoded).toContain("PRICE:");
    expect(encoded).toContain("$370.00");
    expect(encoded).toContain("256GB so I start lower");
    expect(encoded).not.toContain("my_floor");
    expect(encoded).not.toContain("my_target");
  });

  it("clips public claims so the act log stays compact", () => {
    const long = "x".repeat(200);
    expect(sanitizeHnpPublicClaim(long)?.length).toBeLessThanOrEqual(80);
  });

  it("is order-stable: shuffling acts with sequences yields the same slots", () => {
    const acts: HnpPublicAct[] = [
      act({
        sequence: 2,
        role: "SELLER",
        type: "COUNTER",
        total_price: { currency: "USD", units_minor: 50000 },
      }),
      act({
        sequence: 1,
        role: "BUYER",
        type: "OFFER",
        total_price: { currency: "USD", units_minor: 40000 },
      }),
    ];
    const state = reduceHnpPublicCompactState(acts);
    expect(state.price.buyer_minor).toBe(40000);
    expect(state.price.seller_minor).toBe(50000);
    expect(state.acts.map((a) => a.sequence)).toEqual([1, 2]);
  });
});
