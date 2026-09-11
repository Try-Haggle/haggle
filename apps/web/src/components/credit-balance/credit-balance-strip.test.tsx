import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreditBalanceStrip } from "./credit-balance-strip";

describe("CreditBalanceStrip", () => {
  it("shows CU-ready API balance", () => {
    render(
      <CreditBalanceStrip
        state={{ source: "api", balance: 200, unlimited: false, accountId: "a" }}
      />,
    );
    expect(screen.getByTestId("credit-balance-value")).toHaveTextContent("Soft credits: 200");
    expect(screen.getByTestId("credit-balance-strip")).toHaveAttribute("data-source", "api");
  });

  it("shows stub tolerance without inventing a balance number", () => {
    render(
      <CreditBalanceStrip
        state={{
          source: "stub",
          balance: null,
          unlimited: false,
          accountId: null,
          reason: "CREDIT_BALANCE_API_UNAVAILABLE",
        }}
      />,
    );
    expect(screen.getByTestId("credit-balance-value")).toHaveTextContent("Soft credits: —");
    expect(screen.getByTestId("credit-balance-stub")).toHaveTextContent(/C1 lands/i);
  });

  it("shows unlimited affordance when server says so", () => {
    render(
      <CreditBalanceStrip
        state={{ source: "api", balance: 200, unlimited: true, accountId: "a" }}
      />,
    );
    expect(screen.getByTestId("credit-balance-unlimited")).toHaveTextContent(/Unlimited/i);
  });
});
