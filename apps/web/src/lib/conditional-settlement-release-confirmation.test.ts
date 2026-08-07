import { describe, expect, it, vi } from "vitest";
import { confirmConditionalSettlementRelease } from "./conditional-settlement-release-confirmation";

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected operation to reject");
}

describe("confirmConditionalSettlementRelease", () => {
  it("polls the submitted transaction until release finality is confirmed", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        conditional_settlement: { status: "RELEASE_CONFIRMATIONS_PENDING" },
        retry: { after_seconds: 2 },
      })
      .mockResolvedValueOnce({ conditional_settlement: { status: "RELEASE_CONFIRMED" } });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await confirmConditionalSettlementRelease("release-id", `0x${"ab".repeat(32)}`, {
      request,
      sleep,
    });

    expect(result.conditional_settlement?.status).toBe("RELEASE_CONFIRMED");
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("fails closed on a mismatched release event", async () => {
    const request = vi.fn().mockResolvedValue({
      conditional_settlement: { status: "RELEASE_EVENT_MISMATCH" },
    });

    const error = await captureError(() =>
      confirmConditionalSettlementRelease("release-id", `0x${"ab".repeat(32)}`, { request }),
    );
    expect(error.message).toContain("unexpected status: RELEASE_EVENT_MISMATCH");
  });

  it("does not ask for another transaction when finality remains pending", async () => {
    const request = vi.fn().mockResolvedValue({
      conditional_settlement: { status: "RELEASE_PENDING" },
      retry: { after_seconds: 30 },
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await captureError(() =>
      confirmConditionalSettlementRelease("release-id", `0x${"ab".repeat(32)}`, {
        request,
        sleep,
        maxAttempts: 2,
      }),
    );
    expect(error.message).toContain("do not submit another release");
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });
});
