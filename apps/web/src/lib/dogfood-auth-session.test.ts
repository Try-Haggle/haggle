import { describe, expect, it } from "vitest";
import {
  isUpstreamDogfoodStubStatus,
  parseDogfoodSessionTokens,
  T1_API_NOT_LIVE_CODE,
  T1_API_NOT_LIVE_MESSAGE,
} from "./dogfood-auth-session";

describe("dogfood-auth-session", () => {
  it("parses flat and nested token shapes", () => {
    expect(
      parseDogfoodSessionTokens({
        access_token: "at",
        refresh_token: "rt",
        persona: "buyer",
        expires_in: 600,
      }),
    ).toEqual({
      access_token: "at",
      refresh_token: "rt",
      expires_at: undefined,
      expires_in: 600,
      persona: "buyer",
    });

    expect(
      parseDogfoodSessionTokens({
        session: { accessToken: "a2", refreshToken: "r2", expiresAt: 99 },
        persona: "seller",
      }),
    ).toEqual({
      access_token: "a2",
      refresh_token: "r2",
      expires_at: 99,
      expires_in: undefined,
      persona: "seller",
    });
  });

  it("never invents tokens when fields are missing", () => {
    expect(parseDogfoodSessionTokens({})).toBeNull();
    expect(parseDogfoodSessionTokens({ access_token: "only" })).toBeNull();
    expect(parseDogfoodSessionTokens({ token: "fake" })).toBeNull();
    expect(parseDogfoodSessionTokens(null)).toBeNull();
  });

  it("treats 404/501 as T1 stub", () => {
    expect(isUpstreamDogfoodStubStatus(404)).toBe(true);
    expect(isUpstreamDogfoodStubStatus(501)).toBe(true);
    expect(isUpstreamDogfoodStubStatus(401)).toBe(false);
    expect(T1_API_NOT_LIVE_CODE).toBe("T1_API_NOT_LIVE");
    expect(T1_API_NOT_LIVE_MESSAGE).toMatch(/T1 API not live/i);
  });
});
