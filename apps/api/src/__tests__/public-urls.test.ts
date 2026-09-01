import { afterEach, describe, expect, it } from "vitest";
import { publicApiBaseUrl } from "../lib/public-urls.js";

describe("publicApiBaseUrl", () => {
  const previous = {
    publicApi: process.env.PUBLIC_API_URL,
    hnp: process.env.HNP_PUBLIC_BASE_URL,
    haggleEnv: process.env.HAGGLE_ENV,
  };

  afterEach(() => {
    if (previous.publicApi === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previous.publicApi;
    if (previous.hnp === undefined) delete process.env.HNP_PUBLIC_BASE_URL;
    else process.env.HNP_PUBLIC_BASE_URL = previous.hnp;
    if (previous.haggleEnv === undefined) delete process.env.HAGGLE_ENV;
    else process.env.HAGGLE_ENV = previous.haggleEnv;
  });

  it("upgrades a public http origin so Grok can complete OAuth", () => {
    delete process.env.PUBLIC_API_URL;
    delete process.env.HNP_PUBLIC_BASE_URL;
    delete process.env.HAGGLE_ENV;
    expect(publicApiBaseUrl({ protocol: "http", hostname: "api.staging.tryhaggle.ai" })).toBe(
      "https://api.staging.tryhaggle.ai",
    );
  });

  it("uses the staging API origin when HAGGLE_ENV is staging", () => {
    delete process.env.PUBLIC_API_URL;
    delete process.env.HNP_PUBLIC_BASE_URL;
    process.env.HAGGLE_ENV = "staging";
    expect(publicApiBaseUrl({ protocol: "http", hostname: "localhost" })).toBe(
      "https://api.staging.tryhaggle.ai",
    );
  });

  it("rewrites a configured http public API URL on a public host", () => {
    delete process.env.HNP_PUBLIC_BASE_URL;
    delete process.env.HAGGLE_ENV;
    process.env.PUBLIC_API_URL = "http://api.staging.tryhaggle.ai/";
    expect(publicApiBaseUrl({ protocol: "http", hostname: "ignored" })).toBe(
      "https://api.staging.tryhaggle.ai",
    );
  });

  it("keeps http on loopback so local clients still work", () => {
    delete process.env.PUBLIC_API_URL;
    delete process.env.HNP_PUBLIC_BASE_URL;
    delete process.env.HAGGLE_ENV;
    expect(publicApiBaseUrl({ protocol: "http", hostname: "localhost" })).toBe("http://localhost");
  });
});
