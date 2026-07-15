import { describe, expect, it } from "vitest";
import { resolveStagingDisputeFixtureParty } from "../services/dispute-evidence-fixture-policy.service.js";

describe("staging dispute evidence fixture policy", () => {
  it("allows an admin to seed a party fixture in an enabled staging environment", () => {
    expect(
      resolveStagingDisputeFixtureParty("admin", "buyer", {
        HAGGLE_ENV: "staging",
        HAGGLE_ENABLE_PAYMENT_TEST_TOOLS: "true",
      }),
    ).toBe("buyer");
  });

  it("rejects the fixture override in production", () => {
    expect(
      resolveStagingDisputeFixtureParty("admin", "seller", {
        HAGGLE_ENV: "production",
        HAGGLE_ENABLE_PAYMENT_TEST_TOOLS: "true",
      }),
    ).toBeNull();
  });

  it("rejects the fixture override for a non-admin", () => {
    expect(
      resolveStagingDisputeFixtureParty("authenticated", "buyer", {
        HAGGLE_ENV: "staging",
        HAGGLE_ENABLE_PAYMENT_TEST_TOOLS: "true",
      }),
    ).toBeNull();
  });
});
