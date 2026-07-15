import { describe, expect, it } from "vitest";
import { API_CORS_ALLOWED_HEADERS } from "../server.js";

describe("API CORS commerce headers", () => {
  it("allows the standard payment idempotency header used by browser clients", () => {
    expect(API_CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase())).toContain(
      "idempotency-key",
    );
  });
});
