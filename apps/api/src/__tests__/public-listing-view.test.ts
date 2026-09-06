import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/public-urls.js", () => ({
  publicAppBaseUrl: () => "https://app.staging.tryhaggle.ai",
}));

import { publicListingView } from "../mcp/tools/platform.js";
import {
  buyerVisibleRequiredCriteria,
  toPublicListingView,
} from "../services/public-listing-view.js";

const IMEI_REQUIRED = {
  checkId: "imei_verification",
  questionKo: "IMEI가 깨끗한지 확인 가능한가요?",
  buyerAskKo: "Should the agent require a clean IMEI?",
  enforcement: "hard" as const,
  requirement: "required" as const,
  stance: "clean IMEI, seller confirmed",
};

const snapshot = {
  negotiationAgentBuilderMemory: { categoryCriteria: [IMEI_REQUIRED] },
};

describe("buyerVisibleRequiredCriteria", () => {
  it("returns {checkId, ask} from the listing snapshot", () => {
    expect(buyerVisibleRequiredCriteria(snapshot)).toEqual([
      { checkId: "imei_verification", ask: "Should the agent require a clean IMEI?" },
    ]);
  });

  it("returns [] when the snapshot has no required checks", () => {
    expect(buyerVisibleRequiredCriteria({})).toEqual([]);
    expect(buyerVisibleRequiredCriteria(null)).toEqual([]);
  });
});

describe("GET listing required_criteria (toPublicListingView)", () => {
  it("returns seller required checks as {checkId, ask}", () => {
    const view = toPublicListingView({
      publicId: "jc6r2T3d",
      title: "iPhone",
      sellerId: "seller-1",
      negotiationAgentSnapshot: snapshot,
    });
    expect(view.listing.required_criteria).toEqual([
      { checkId: "imei_verification", ask: "Should the agent require a clean IMEI?" },
    ]);
    expect(view.listing.sellerRequiredCriteria).toEqual(view.listing.required_criteria);
    expect(JSON.stringify(view.listing)).not.toContain("clean IMEI, seller confirmed");
  });

  it("returns empty required_criteria when the listing has no required checks", () => {
    const view = toPublicListingView({
      publicId: "lamp-1",
      title: "Lamp",
      sellerId: "seller-1",
      negotiationAgentSnapshot: {},
    });
    expect(view.listing.required_criteria).toEqual([]);
    expect(view.listing.sellerRequiredCriteria).toEqual([]);
  });
});

describe("sellerAgentEmoji (toPublicListingView)", () => {
  const row = (emoji: unknown) => ({
    publicId: "cam-1",
    title: "Camera",
    sellerId: "seller-1",
    negotiationAgentSnapshot: {
      preset: "verifier",
      ...(emoji === undefined ? {} : { emoji }),
      // Posture that must never reach a buyer, face or no face.
      engineParams: { u_threshold: 0.6, anchor_ratio: 0.7 },
    },
  });

  it("passes the seller's chosen face through", () => {
    const view = toPublicListingView(row("owl"));
    expect(view.listing.sellerAgentEmoji).toBe("owl");
    expect(view.listing.sellerAgentPreset).toBe("verifier");
  });

  it("is null on listings published before faces existed", () => {
    expect(toPublicListingView(row(undefined)).listing.sellerAgentEmoji).toBeNull();
  });

  it("is null for a malformed value rather than leaking whatever was stored", () => {
    expect(toPublicListingView(row({ src: "x" })).listing.sellerAgentEmoji).toBeNull();
  });

  it("adds a face without loosening the redaction", () => {
    const json = JSON.stringify(toPublicListingView(row("owl")).listing);
    expect(json).not.toContain("u_threshold");
    expect(json).not.toContain("anchor_ratio");
    expect(json).not.toContain("engineParams");
  });
});

describe("MCP publicListingView", () => {
  it("puts required_criteria {checkId, ask} on get_listing", () => {
    const view = publicListingView({
      publicId: "jc6r2T3d",
      title: "iPhone",
      description: null,
      category: "electronics",
      condition: "good",
      targetPrice: "400",
      photoUrl: null,
      sellerId: "seller-1",
      negotiationAgentSnapshot: snapshot,
    });
    expect(view.required_criteria).toEqual([
      { checkId: "imei_verification", ask: "Should the agent require a clean IMEI?" },
    ]);
  });

  it("returns empty required_criteria when the listing has no required checks", () => {
    const view = publicListingView({
      publicId: "lamp-1",
      title: "Lamp",
      description: null,
      category: "other",
      condition: "good",
      targetPrice: "20",
      photoUrl: null,
      sellerId: "seller-1",
      negotiationAgentSnapshot: {},
    });
    expect(view.required_criteria).toEqual([]);
  });
});
