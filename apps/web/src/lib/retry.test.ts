import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { retryTransient } from "./retry";

describe("retryTransient", () => {
  it("retries a 429 and returns the eventual result", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(429, "TOO_MANY_REQUESTS"))
      .mockResolvedValueOnce(["agent"]);
    await expect(retryTransient(load, { baseDelayMs: 1 })).resolves.toEqual(["agent"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401", async () => {
    const load = vi.fn().mockRejectedValue(new ApiError(401, "UNAUTHORIZED"));
    await expect(retryTransient(load, { baseDelayMs: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last attempt and rethrows", async () => {
    const load = vi.fn().mockRejectedValue(new ApiError(503, "UNAVAILABLE"));
    await expect(retryTransient(load, { attempts: 3, baseDelayMs: 1 })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(load).toHaveBeenCalledTimes(3);
  });
});
