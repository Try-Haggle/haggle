import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message?: string) {
      super(message || code);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    api: { get: (...args: unknown[]) => get(...args) },
  };
});

import { ApiError } from "@/lib/api-client";
import { CreditBalanceSettings } from "./credit-balance-settings";

describe("CreditBalanceSettings", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("renders Soft AI credits section and cites stub when C1 missing", async () => {
    get.mockRejectedValue(new ApiError(404, "NOT_FOUND"));
    render(<CreditBalanceSettings />);
    expect(screen.getByTestId("credit-balance-settings")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("credit-balance-settings-stub")).toHaveTextContent(
        /credit-ledger-sot\.md §6/i,
      );
    });
    expect(screen.getByTestId("credit-balance-settings-badge")).toHaveTextContent("—");
  });

  it("shows server balance when C1 API returns SoT shape", async () => {
    get.mockResolvedValue({ balance: 200, unlimited: true });
    render(<CreditBalanceSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("credit-balance-settings-badge")).toHaveTextContent("200");
    });
    expect(screen.getByTestId("credit-balance-settings")).toHaveAttribute("data-source", "api");
  });
});
