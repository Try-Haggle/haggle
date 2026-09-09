/**
 * Eng1 T1 — dogfood auth env gate units.
 * SoT: docs/wip/dogfood-auth-sot.md §1
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOGFOOD_BUYER_USER_ID,
  DOGFOOD_PERSONA_USER_IDS,
  DOGFOOD_SELLER_USER_ID,
  isDogfoodAuthRouteEnabled,
  isDogfoodPersona,
  readDogfoodAuthSecret,
} from "../lib/dogfood-auth-gate.js";

describe("dogfood auth gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes distinct stable persona UUIDs", () => {
    expect(DOGFOOD_BUYER_USER_ID).not.toBe(DOGFOOD_SELLER_USER_ID);
    expect(DOGFOOD_PERSONA_USER_IDS.buyer).toBe(DOGFOOD_BUYER_USER_ID);
    expect(DOGFOOD_PERSONA_USER_IDS.seller).toBe(DOGFOOD_SELLER_USER_ID);
    expect(DOGFOOD_BUYER_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(DOGFOOD_SELLER_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("allowlists buyer|seller only", () => {
    expect(isDogfoodPersona("buyer")).toBe(true);
    expect(isDogfoodPersona("seller")).toBe(true);
    expect(isDogfoodPersona("admin")).toBe(false);
    expect(isDogfoodPersona("test_unverified")).toBe(false);
    expect(isDogfoodPersona(null)).toBe(false);
  });

  it("rejects missing or short secrets", () => {
    expect(readDogfoodAuthSecret({})).toBeNull();
    expect(readDogfoodAuthSecret({ HAGGLE_DOGFOOD_AUTH_SECRET: "short" })).toBeNull();
    expect(
      readDogfoodAuthSecret({
        HAGGLE_DOGFOOD_AUTH_SECRET: "x".repeat(31),
      }),
    ).toBeNull();
    const ok = "s".repeat(32);
    expect(readDogfoodAuthSecret({ HAGGLE_DOGFOOD_AUTH_SECRET: ok })).toBe(ok);
  });

  it("fail-closes on production even with a long secret", () => {
    expect(
      isDogfoodAuthRouteEnabled({
        HAGGLE_ENV: "production",
        HAGGLE_DOGFOOD_AUTH_SECRET: "s".repeat(32),
      }),
    ).toBe(false);
  });

  it("fail-closes when secret missing on staging/local", () => {
    expect(isDogfoodAuthRouteEnabled({ HAGGLE_ENV: "staging" })).toBe(false);
    expect(isDogfoodAuthRouteEnabled({ HAGGLE_ENV: "local" })).toBe(false);
  });

  it("activates on staging/local with ≥32-byte secret", () => {
    const secret = "dogfood-secret-for-tests-32bytes!";
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(
      isDogfoodAuthRouteEnabled({
        HAGGLE_ENV: "staging",
        HAGGLE_DOGFOOD_AUTH_SECRET: secret,
      }),
    ).toBe(true);
    expect(
      isDogfoodAuthRouteEnabled({
        HAGGLE_ENV: "local",
        HAGGLE_DOGFOOD_AUTH_SECRET: secret,
      }),
    ).toBe(true);
  });
});
