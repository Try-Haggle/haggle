import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { canManageSellerShipping, SellerShippingGate } from "./shipping-role";

describe("seller shipping controls", () => {
  it("allows only the seller assigned to the order", () => {
    expect(canManageSellerShipping("seller-id", "seller-id")).toBe(true);
    expect(canManageSellerShipping("buyer-id", "seller-id")).toBe(false);
  });

  it("fails closed while identity or order ownership is unavailable", () => {
    expect(canManageSellerShipping(null, "seller-id")).toBe(false);
    expect(canManageSellerShipping("seller-id", undefined)).toBe(false);
    expect(canManageSellerShipping(null, undefined)).toBe(false);
  });

  it("does not render seller actions for a buyer", () => {
    render(
      <SellerShippingGate
        isSeller={false}
        fallback={<p>Waiting for the seller to prepare carrier rates.</p>}
      >
        <button type="button">Get Carrier Rates</button>
      </SellerShippingGate>,
    );

    expect(screen.queryByRole("button", { name: "Get Carrier Rates" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the seller to prepare carrier rates."),
    ).toBeInTheDocument();
  });

  it("renders seller actions for the assigned seller", () => {
    render(
      <SellerShippingGate isSeller fallback={<p>Waiting for seller.</p>}>
        <button type="button">Get Carrier Rates</button>
      </SellerShippingGate>,
    );

    expect(screen.getByRole("button", { name: "Get Carrier Rates" })).toBeInTheDocument();
  });
});
