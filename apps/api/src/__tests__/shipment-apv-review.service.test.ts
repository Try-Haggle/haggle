import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import {
  decideShipmentApvReview,
  submitShipmentApvSellerReview,
} from "../services/shipment-apv-review.service.js";

const CURRENT = {
  id: "77777777-7777-4777-8777-777777777777",
  shipment_id: "11111111-1111-4111-8111-111111111111",
  order_id: "22222222-2222-4222-8222-222222222222",
  seller_id: "33333333-3333-4333-8333-333333333333",
  buyer_id: "44444444-4444-4444-8444-444444444444",
  status: "REVIEW_REQUIRED",
  review_status: "NONE",
  review_version: 0,
  assessed_seller_liability_minor: "250",
  seller_liability_minor: "250",
  platform_liability_minor: "0",
  buyer_effect_minor: "0",
};

function uniqueViolation() {
  return Object.assign(new Error("duplicate key"), { code: "23505" });
}

describe("shipment APV review request conflicts", () => {
  it("maps a seller request ID reused on another adjustment to a conflict", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([CURRENT])
      .mockRejectedValueOnce(uniqueViolation());
    const result = await submitShipmentApvSellerReview({ execute } as unknown as Database, {
      adjustmentId: CURRENT.id,
      sellerId: CURRENT.seller_id,
      requestId: "88888888-8888-4888-8888-888888888888",
      reason:
        "The carrier correction does not match the address used to purchase this shipping label.",
    });
    expect(result).toEqual({ outcome: "request_conflict" });
  });

  it("maps an admin decision request ID reused on another adjustment to a conflict", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ ...CURRENT, review_status: "PENDING", review_version: 1 }])
      .mockRejectedValueOnce(uniqueViolation());
    const result = await decideShipmentApvReview({ execute } as unknown as Database, {
      adjustmentId: CURRENT.id,
      reviewerId: "99999999-9999-4999-8999-999999999999",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      decision: "WAIVED",
      reason:
        "The available carrier evidence is insufficient to assign this correction to the seller.",
      expectedVersion: 1,
    });
    expect(result).toEqual({ outcome: "request_conflict" });
  });
});
