import { describe, expect, it } from "vitest";
import { isSafeListingPhotoUrl } from "../lib/listing-photo.js";

describe("isSafeListingPhotoUrl", () => {
  it("accepts public https images", () => {
    expect(isSafeListingPhotoUrl("https://images.example.com/airpods.jpg")).toBe(true);
  });

  it("rejects http, loopback, and private hosts", () => {
    expect(isSafeListingPhotoUrl("http://images.example.com/airpods.jpg")).toBe(false);
    expect(isSafeListingPhotoUrl("https://localhost/airpods.jpg")).toBe(false);
    expect(isSafeListingPhotoUrl("https://127.0.0.1/airpods.jpg")).toBe(false);
    expect(isSafeListingPhotoUrl("https://192.168.1.8/airpods.jpg")).toBe(false);
    expect(isSafeListingPhotoUrl("https://user:pass@cdn.example.com/a.jpg")).toBe(false);
  });
});
