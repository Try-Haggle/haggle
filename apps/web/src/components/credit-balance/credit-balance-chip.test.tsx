import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreditBalanceChip } from "./credit-balance-chip";

describe("CreditBalanceChip", () => {
  it("shows compact Haggle credits balance beside profile chrome", () => {
    render(
      <CreditBalanceChip
        state={{ source: "api", balance: 200, unlimited: false, accountId: "a" }}
      />,
    );
    expect(screen.getByTestId("credit-balance-chip")).toHaveAttribute("data-source", "api");
    expect(screen.getByTestId("credit-balance-chip")).toHaveAttribute(
      "aria-label",
      "Haggle credits: 200",
    );
    expect(screen.getByTestId("credit-balance-chip-value")).toHaveTextContent("200");
    expect(screen.getByText("Haggle credits")).toBeInTheDocument();
  });

  it("shows stub dash without inventing a balance number", () => {
    render(
      <CreditBalanceChip
        state={{
          source: "stub",
          balance: null,
          unlimited: false,
          accountId: null,
          reason: "CREDIT_BALANCE_API_UNAVAILABLE",
        }}
      />,
    );
    expect(screen.getByTestId("credit-balance-chip-value")).toHaveTextContent("—");
  });

  it("shows unlimited marker when server says so", () => {
    render(
      <CreditBalanceChip
        state={{ source: "api", balance: 200, unlimited: true, accountId: "a" }}
      />,
    );
    expect(screen.getByTestId("credit-balance-chip-value")).toHaveTextContent("∞");
  });
});
