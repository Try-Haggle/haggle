import { describe, expect, it, vi } from "vitest";
import { confirmConditionalSettlementFunding } from "./conditional-settlement-confirmation";

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("Expected operation to reject");
}

describe("confirmConditionalSettlementFunding", () => {
  it("retries the same funding transaction until it is confirmed", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        conditional_settlement: { status: "FUNDING_CONFIRMATIONS_PENDING" },
        retry: { after_seconds: 2, reuse_transaction_hash: true },
      })
      .mockResolvedValueOnce({
        conditional_settlement: { status: "FUNDING_CONFIRMED" },
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await confirmConditionalSettlementFunding("payment-id", { request, sleep });

    expect(result.conditional_settlement?.status).toBe("FUNDING_CONFIRMED");
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("returns immediately when the payment is already settled", async () => {
    const request = vi.fn().mockResolvedValue({
      conditional_settlement: { status: "ALREADY_SETTLED" },
    });
    const sleep = vi.fn();

    await expect(
      confirmConditionalSettlementFunding("payment-id", { request, sleep }),
    ).resolves.toMatchObject({ conditional_settlement: { status: "ALREADY_SETTLED" } });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails without resubmitting payment when confirmation stays pending", async () => {
    const request = vi.fn().mockResolvedValue({
      conditional_settlement: { status: "FUNDING_PENDING" },
      retry: { after_seconds: 30 },
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await captureError(() =>
      confirmConditionalSettlementFunding("payment-id", { request, sleep, maxAttempts: 2 }),
    );

    expect(error.message).toBe(
      "Funding is still waiting for network confirmation. Retry confirmation from the order page; do not submit another payment.",
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it("fails closed on an unexpected funding result", async () => {
    const request = vi.fn().mockResolvedValue({
      conditional_settlement: { status: "FUNDING_EVENT_MISMATCH" },
    });

    const error = await captureError(() =>
      confirmConditionalSettlementFunding("payment-id", { request }),
    );

    expect(error.message).toBe(
      "Funding confirmation returned an unexpected status: FUNDING_EVENT_MISMATCH",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
