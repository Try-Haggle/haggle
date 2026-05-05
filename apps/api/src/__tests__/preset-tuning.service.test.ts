import { describe, expect, it } from "vitest";
import { compilePresetTuningDraft } from "../services/preset-tuning.service.js";

const iphoneListing = {
  id: "listing_iphone_15_pro",
  title: "iPhone 15 Pro 256GB Natural Titanium",
  category: "electronics",
  condition: "battery 86%, unlocked, screen mint",
  askPriceMinor: 50000,
  floorPriceMinor: 41000,
  marketMedianMinor: 52000,
  tags: ["iphone", "unlocked", "screen_mint"],
  sellerNote: "Clean phone from live DB.",
};

const macbookListing = {
  id: "listing_macbook_air_m2",
  title: "MacBook Air M2 512GB Midnight",
  category: "electronics",
  condition: "Cycle count 720, keyboard works, screen clean, no AppleCare",
  askPriceMinor: 82000,
  floorPriceMinor: 70000,
  marketMedianMinor: 85000,
  tags: ["macbook", "laptop", "512gb"],
  sellerNote: "Local pickup listing.",
};

describe("compilePresetTuningDraft", () => {
  it("uses user cap as a hard max and builds iPhone term checks", () => {
    const draft = compilePresetTuningDraft({
      listing: iphoneListing,
      presetId: "safe_buyer",
      priceCapMinor: 45000,
      memory: {
        categoryInterest: "iPhone 15 Pro",
        budgetMax: 450,
        mustHave: ["battery >= 90%", "unlocked", "clean IMEI"],
        avoid: ["visible damage"],
        riskStyle: "safe_first",
        source: ["battery >= 90% matters for resale"],
      },
    });

    expect(draft.priceCapMinor).toBe(45000);
    expect(draft.maxAgreementMinor).toBe(45000);
    expect(draft.openingOfferMinor).toBeLessThanOrEqual(45000);
    expect(draft.mustVerify.map((term) => term.termId)).toContain("battery_health");
    expect(draft.mustVerify.map((term) => term.termId)).toContain("find_my_status");
    expect(draft.mustVerify.find((term) => term.termId === "battery_health")?.confirmedValue).toMatchObject({
      value: 86,
      unit: "%",
      source: "listing",
    });
    expect(draft.walkAway.find((rule) => rule.id === "cap_exceeded")?.enabled).toBe(true);
  });

  it("turns product-specific memory into leverage when listing differs", () => {
    const draft = compilePresetTuningDraft({
      listing: iphoneListing,
      presetId: "lowest_price",
      memory: {
        categoryInterest: "iPhone 15 Pro",
        budgetMax: 475,
        mustHave: ["battery >= 90%"],
        riskStyle: "lowest_price",
        negotiationStyle: "aggressive",
      },
    });

    expect(draft.presetId).toBe("lowest_price");
    expect(draft.leverage.some((item) => item.termId === "battery_health" && item.source === "memory")).toBe(true);
    expect(draft.strategyNotes.join(" ")).toContain("max budget");
  });

  it("falls back to memory style when preset is not explicitly selected", () => {
    const draft = compilePresetTuningDraft({
      listing: iphoneListing,
      memory: {
        categoryInterest: "iPhone",
        riskStyle: "safe_first",
      },
    });

    expect(draft.presetId).toBe("safe_buyer");
    expect(draft.riskTolerance).toBe("low");
  });

  it("builds MacBook-specific terms and avoids iPhone-only walk-away rules", () => {
    const draft = compilePresetTuningDraft({
      listing: macbookListing,
      presetId: "balanced_closer",
      priceCapMinor: 78000,
      memory: {
        categoryInterest: "MacBook Air",
        mustHave: ["low cycle count", "keyboard works"],
        avoid: ["screen coating wear"],
      },
    });

    const termIds = draft.mustVerify.map((term) => term.termId);
    expect(termIds).toContain("battery_cycle_count");
    expect(termIds).toContain("keyboard_condition");
    expect(termIds).toContain("applecare_status");
    expect(termIds).toContain("activation_lock");
    expect(termIds).not.toContain("imei_verification");
    expect(draft.leverage.some((item) => item.termId === "battery_cycle_count")).toBe(true);
    expect(draft.mustVerify.find((term) => term.termId === "battery_cycle_count")?.confirmedValue).toMatchObject({
      value: 720,
      unit: "cycles",
      source: "listing",
    });
    expect(draft.walkAway.map((rule) => rule.id)).toContain("activation_lock_not_confirmed");
    expect(draft.walkAway.map((rule) => rule.id)).not.toContain("clean_imei_refused");
  });

  it("blocks payment permission when memory scope conflicts with the current listing", () => {
    const draft = compilePresetTuningDraft({
      listing: iphoneListing,
      presetId: "balanced_closer",
      memory: {
        categoryInterest: "MacBook Air",
        source: ["MacBook only, low cycle count"],
      },
    });

    expect(draft.engineReview.status).toBe("blocked");
    expect(draft.engineReview.blockers.map((blocker) => blocker.id)).toContain("product_scope_conflict");
    expect(draft.engineReview.nextActions.some((action) => action.control === "select")).toBe(true);
    expect(draft.engineReview.nextActions.find((action) => action.label === "Confirm product scope")?.controlConfig?.options)
      .toEqual([
        { value: "apply_current_listing", label: "현재 상품에 적용" },
        { value: "keep_saved_only", label: "저장된 기억으로만 유지" },
      ]);
    expect(draft.negotiationStartPayload.tuning_draft.engine_review.status).toBe("blocked");
  });

  it("surfaces missing hard terms as next controls before negotiation can start", () => {
    const draft = compilePresetTuningDraft({
      listing: {
        ...iphoneListing,
        condition: "iPhone 15 Pro, screen mint",
        tags: ["iphone", "screen_mint"],
      },
      presetId: "safe_buyer",
      memory: {
        categoryInterest: "iPhone 15 Pro",
        structured: {
          pendingSlots: [
            {
              slotId: "battery_health",
              question: "Battery?",
              enforcement: "hard",
              status: "ambiguous",
            },
          ],
        },
      },
    });

    expect(draft.engineReview.status).toBe("needs_user_input");
    expect(draft.engineReview.blockers.some((blocker) => blocker.id === "missing_battery_health")).toBe(true);
    const batteryAction = draft.engineReview.nextActions.find((action) => action.termId === "battery_health");
    expect(batteryAction?.control).toBe("slider");
    expect(batteryAction?.controlConfig).toMatchObject({
      unit: "%",
      min: 70,
      max: 100,
      step: 1,
      defaultValue: 90,
    });
  });
});
