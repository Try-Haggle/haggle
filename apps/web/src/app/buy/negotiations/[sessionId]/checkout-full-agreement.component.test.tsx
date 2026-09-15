import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/providers/locale-provider";
import type { CheckoutAgreementDisplay } from "./checkout-full-agreement-panel";
import { CheckoutFullAgreement } from "./checkout-full-agreement-panel";

const agreement: CheckoutAgreementDisplay = {
  price_minor: 50_000,
  currency: "USD",
  fulfillment_type: "physical_shipping",
  fulfillment_summary: "Carrier shipping",
  address: { kind: "delivery", lines: ["Ada", "1 Main", "Denver, CO 80202"] },
  shipping_cost_minor: 0,
  fees: {
    haggle_fee_bps: 150,
    card_buyer_total_bps: 300,
    item_minor: 50_000,
    shipping_minor: 0,
    haggle_fee_minor: 750,
    card_fee_minor: 1500,
    buyer_pays_wallet_minor: 50_750,
    buyer_pays_card_minor: 51_500,
  },
  criteria: [
    { check_id: "imei_clean", label: "IMEI", seller_value: "Clean", buyer_stance: "Must be clean" },
  ],
  terms_hash: "sha256:abc",
};

describe("CheckoutFullAgreement", () => {
  it("shows full Soft blocks and fires CTA", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <LocaleProvider>
        <CheckoutFullAgreement agreement={agreement} leaveHref="/back" onConfirm={onConfirm} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("checkout-full-agreement")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Carrier shipping")).toBeInTheDocument();
    expect(screen.getByText("IMEI")).toBeInTheDocument();
    expect(screen.getByText(/Clean/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Leave checkout|결제 나가기/i })).toHaveAttribute(
      "href",
      "/back",
    );
    await user.click(screen.getByTestId("checkout-pay-as-agreed"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
