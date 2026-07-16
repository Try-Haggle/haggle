import { describe, expect, it, vi } from "vitest";
import { waitForNegotiationReady } from "./negotiation-start-progress";

describe("waitForNegotiationReady", () => {
  it("reports round progress and stops at a terminal status", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ session: { status: "CREATED" }, rounds: [] })
      .mockResolvedValueOnce({ session: { status: "ACTIVE" }, rounds: [{}] })
      .mockResolvedValueOnce({ session: { status: "ACCEPTED" }, rounds: [{}, {}] });
    const onProgress = vi.fn();
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await waitForNegotiationReady({
      load,
      onProgress,
      delay,
      intervalMs: 10,
      maxAttempts: 5,
    });

    expect(result).toEqual({ status: "ACCEPTED", rounds: 2, ready: true });
    expect(load).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(result);
  });

  it("returns the latest state when polling reaches its limit", async () => {
    const load = vi.fn().mockResolvedValue({ session: { status: "ACTIVE" }, rounds: [{}] });
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await waitForNegotiationReady({
      load,
      delay,
      intervalMs: 10,
      maxAttempts: 3,
    });

    expect(result).toEqual({ status: "ACTIVE", rounds: 1, ready: false });
    expect(load).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("recovers from a transient progress request failure", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ session: { status: "NEAR_DEAL" }, rounds: [{}] });
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await waitForNegotiationReady({
      load,
      delay,
      intervalMs: 10,
      maxAttempts: 3,
    });

    expect(result).toEqual({ status: "NEAR_DEAL", rounds: 1, ready: true });
    expect(load).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("surfaces the last error when progress never loads", async () => {
    const error = new TypeError("network unavailable");
    const load = vi.fn().mockRejectedValue(error);
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForNegotiationReady({ load, delay, intervalMs: 10, maxAttempts: 2 }),
    ).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
