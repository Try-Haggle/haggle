import { describe, expect, it } from "vitest";
import {
  isDogfoodAuthBffEnabled,
  isDogfoodAuthProductionClosed,
  isDogfoodAuthWebSurfaceEnabled,
  isDogfoodPersona,
  normalizeHaggleEnv,
  readDogfoodAuthSecret,
} from "./dogfood-auth-gate";

const LONG_SECRET = "s".repeat(32);

describe("dogfood-auth-gate", () => {
  it("normalizes HAGGLE_ENV", () => {
    expect(normalizeHaggleEnv(undefined)).toBe("local");
    expect(normalizeHaggleEnv("")).toBe("local");
    expect(normalizeHaggleEnv("STAGING")).toBe("staging");
    expect(normalizeHaggleEnv("production")).toBe("production");
  });

  it("fail-closes production host/build", () => {
    expect(isDogfoodAuthProductionClosed({ HAGGLE_ENV: "production" })).toBe(true);
    expect(isDogfoodAuthProductionClosed({ VERCEL_ENV: "production" })).toBe(true);
    expect(isDogfoodAuthProductionClosed({ HAGGLE_ENV: "staging" })).toBe(false);
    expect(isDogfoodAuthProductionClosed({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isDogfoodAuthProductionClosed({})).toBe(false);
  });

  it("enables web surface only for staging/local (not prod)", () => {
    expect(isDogfoodAuthWebSurfaceEnabled({ HAGGLE_ENV: "staging" })).toBe(true);
    expect(isDogfoodAuthWebSurfaceEnabled({})).toBe(true);
    expect(isDogfoodAuthWebSurfaceEnabled({ HAGGLE_ENV: "staging", VERCEL_ENV: "preview" })).toBe(
      true,
    );
    expect(isDogfoodAuthWebSurfaceEnabled({ HAGGLE_ENV: "production" })).toBe(false);
    expect(isDogfoodAuthWebSurfaceEnabled({ VERCEL_ENV: "production" })).toBe(false);
    expect(isDogfoodAuthWebSurfaceEnabled({ HAGGLE_ENV: "local", VERCEL_ENV: "production" })).toBe(
      false,
    );
  });

  it("requires ≥32-byte secret for BFF", () => {
    expect(readDogfoodAuthSecret({})).toBeNull();
    expect(readDogfoodAuthSecret({ HAGGLE_DOGFOOD_AUTH_SECRET: "short" })).toBeNull();
    expect(readDogfoodAuthSecret({ HAGGLE_DOGFOOD_AUTH_SECRET: LONG_SECRET })).toBe(LONG_SECRET);

    expect(isDogfoodAuthBffEnabled({ HAGGLE_ENV: "staging" })).toBe(false);
    expect(
      isDogfoodAuthBffEnabled({
        HAGGLE_ENV: "staging",
        HAGGLE_DOGFOOD_AUTH_SECRET: LONG_SECRET,
      }),
    ).toBe(true);
    expect(
      isDogfoodAuthBffEnabled({
        HAGGLE_ENV: "production",
        HAGGLE_DOGFOOD_AUTH_SECRET: LONG_SECRET,
      }),
    ).toBe(false);
  });

  it("allowlists personas only", () => {
    expect(isDogfoodPersona("buyer")).toBe(true);
    expect(isDogfoodPersona("seller")).toBe(true);
    expect(isDogfoodPersona("admin")).toBe(false);
    expect(isDogfoodPersona(null)).toBe(false);
  });
});
