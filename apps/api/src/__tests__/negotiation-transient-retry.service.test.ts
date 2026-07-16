import { describe, expect, it, vi } from "vitest";
import { withNegotiationTransientDbRetry } from "../services/negotiation-transient-retry.service.js";

describe("withNegotiationTransientDbRetry", () => {
  it("retries one transient database connection failure", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("connection lost"), {
          code: "CONNECTION_DESTROYED",
        }),
      )
      .mockResolvedValueOnce("ok");

    await expect(withNegotiationTransientDbRetry(operation, 0)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient failure", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("invalid state"));

    await expect(withNegotiationTransientDbRetry(operation, 0)).rejects.toThrow("invalid state");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("returns the second transient failure after one retry", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(
      Object.assign(new Error("still unavailable"), {
        errno: "CONNECT_TIMEOUT",
      }),
    );

    await expect(withNegotiationTransientDbRetry(operation, 0)).rejects.toThrow(
      "still unavailable",
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
