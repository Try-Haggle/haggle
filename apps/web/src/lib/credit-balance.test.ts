import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown>;
    constructor(status: number, code: string, message?: string, details?: Record<string, unknown>) {
      super(message || code);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  return {
    ApiError,
    api: {
      get: (...args: unknown[]) => get(...args),
    },
  };
});

import { ApiError } from "@/lib/api-client";
import {
  CREDIT_BALANCE_PATH,
  creditBalanceShortLabel,
  fetchCreditBalance,
  formatInsufficientCreditsMessage,
  parseCreditBalanceResponse,
  parseInsufficientCredits,
} from "./credit-balance";

describe("credit-balance (SoT §6 shapes)", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("parses non-negative integer balance only", () => {
    expect(parseCreditBalanceResponse({ balance: 200, unlimited: true })).toEqual({
      balance: 200,
      unlimited: true,
      account_id: undefined,
      actor_id: undefined,
      unit: undefined,
    });
    expect(parseCreditBalanceResponse({ balance: -1 })).toBeNull();
    expect(parseCreditBalanceResponse({ balance: 1.5 })).toBeNull();
    expect(parseCreditBalanceResponse({})).toBeNull();
  });

  it("CU-ready short labels never invent a fake stub number", () => {
    expect(
      creditBalanceShortLabel({
        source: "stub",
        balance: null,
        unlimited: false,
        accountId: null,
      }),
    ).toBe("Soft credits: —");
    expect(
      creditBalanceShortLabel({
        source: "api",
        balance: 42,
        unlimited: false,
        accountId: "a",
      }),
    ).toBe("Soft credits: 42");
  });

  it("fetches GET /credits/balance when C1 present", async () => {
    get.mockResolvedValue({ balance: 200, unlimited: true, account_id: "acc" });
    const state = await fetchCreditBalance();
    expect(get).toHaveBeenCalledWith(CREDIT_BALANCE_PATH);
    expect(state).toEqual({
      source: "api",
      balance: 200,
      unlimited: true,
      accountId: "acc",
    });
  });

  it("stubs clearly when C1 API is unavailable (404)", async () => {
    get.mockRejectedValue(new ApiError(404, "NOT_FOUND"));
    const state = await fetchCreditBalance();
    expect(state.source).toBe("stub");
    expect(state.balance).toBeNull();
    expect(state.reason).toBe("CREDIT_BALANCE_API_UNAVAILABLE");
  });

  it("parses INSUFFICIENT_CREDITS from server details only", () => {
    const info = parseInsufficientCredits(
      new ApiError(402, "INSUFFICIENT_CREDITS", "Too low", {
        required: 10,
        balance: 3,
      }),
    );
    expect(info).toEqual({
      code: "INSUFFICIENT_CREDITS",
      message: "Too low",
      required: 10,
      balance: 3,
    });
    expect(formatInsufficientCreditsMessage(info!)).toMatch(/Need 10, have 3/);
    expect(parseInsufficientCredits(new ApiError(400, "OTHER"))).toBeNull();
  });
});
