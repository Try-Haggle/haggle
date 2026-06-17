import { describe, expect, it } from "vitest";
import { createBuilderState, emptyChatData, priceSemantics } from "../index.js";

describe("priceSemantics", () => {
  it("seller: priceLimit is a floor, direction maximize", () => {
    const s = priceSemantics("seller");
    expect(s.direction).toBe("maximize");
    expect(s.limitLabel).toMatch(/floor/i);
    expect(s.promptHint).toMatch(/floor/i);
    // user-facing strings must be English (no Hangul)
    expect(s.limitLabel).not.toMatch(/[가-힣]/);
    expect(s.targetLabel).not.toMatch(/[가-힣]/);
    expect(s.promptHint).not.toMatch(/[가-힣]/);
  });

  it("buyer: priceLimit is a ceiling/budget, direction minimize", () => {
    const s = priceSemantics("buyer");
    expect(s.direction).toBe("minimize");
    expect(s.limitLabel).toMatch(/budget|ceiling/i);
    expect(s.promptHint).toMatch(/budget|ceiling/i);
    expect(s.limitLabel).not.toMatch(/[가-힣]/);
  });

  it("seller and buyer differ", () => {
    expect(priceSemantics("seller").direction).not.toBe(priceSemantics("buyer").direction);
    expect(priceSemantics("seller").limitLabel).not.toBe(priceSemantics("buyer").limitLabel);
  });
});

describe("createBuilderState", () => {
  it("creates a fresh state with empty chat data", () => {
    const state = createBuilderState({ side: "seller", presetId: "balancer" });
    expect(state.side).toBe("seller");
    expect(state.agent.presetId).toBe("balancer");
    expect(state.item).toBeUndefined();
    expect(state.chatData).toEqual(emptyChatData());
  });

  it("attaches item context when provided", () => {
    const state = createBuilderState({
      side: "buyer",
      presetId: "hunter",
      item: { title: "iPhone 15 Pro", listingPrice: 92000, priceLimit: 80000 },
    });
    expect(state.item?.title).toBe("iPhone 15 Pro");
    expect(state.item?.priceLimit).toBe(80000);
  });
});

describe("emptyChatData", () => {
  it("returns all-empty collections", () => {
    const cd = emptyChatData();
    expect(cd.transcript).toEqual([]);
    expect(cd.statedPreferences).toEqual([]);
    expect(cd.answeredQuestions).toEqual([]);
    expect(cd.openQuestions).toEqual([]);
  });
});
