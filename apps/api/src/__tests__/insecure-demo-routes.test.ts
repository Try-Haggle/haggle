import { afterEach, describe, expect, it, vi } from "vitest";
import { insecureDemoRoutesEnabled } from "../lib/insecure-demo-routes.js";
import { getTestApp } from "./helpers.js";

describe("insecure demo routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stay closed unless the local flag is on", () => {
    vi.stubEnv("ENABLE_INSECURE_DEMO_ROUTES", "false");
    vi.stubEnv("HAGGLE_ENV", "local");
    expect(insecureDemoRoutesEnabled()).toBe(false);
  });

  it("stay closed on staging even if the flag is on", () => {
    vi.stubEnv("ENABLE_INSECURE_DEMO_ROUTES", "true");
    vi.stubEnv("HAGGLE_ENV", "staging");
    expect(insecureDemoRoutesEnabled()).toBe(false);
  });

  it("are not mounted on the default test server", async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: "POST", url: "/negotiations/demo/init", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
