import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/providers/locale-provider";
import type { CheckoutAgreementDisplay } from "../checkout-full-agreement";

const MockWalletPaymentClient = vi.hoisted(() =>
  vi.fn((props: { softAgreementAck?: { terms_hash: string } }) => (
    <div data-testid="checkout-payment-rail">
      Mock payment rail
      <span data-testid="soft-ack-hash">{props.softAgreementAck?.terms_hash}</span>
    </div>
  )),
);

vi.mock("./wallet-payment-client", () => ({
  WalletPaymentClient: MockWalletPaymentClient,
}));

vi.mock("next/dynamic", () => ({
  default: () => MockWalletPaymentClient,
}));

import { CheckoutPayment } from "./checkout-payment";

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
  terms_hash: "sha256:soft-before-rail-test",
};

const incompleteAgreement: CheckoutAgreementDisplay = {
  ...agreement,
  address: { kind: "delivery", lines: ["Address missing from Soft agreement"] },
  terms_hash: "sha256:incomplete-soft",
};

const baseProps = {
  settlementApprovalId: "approval-test",
  amountMinor: 50_000,
  currency: "USD",
  requiresShipping: true,
  physicalShippingReadiness: {
    ready: true,
    live_label_max_minor: 5000,
    missing: [] as string[],
  },
  leaveHref: "/buy/negotiations/session-1",
};

describe("CheckoutPayment Soft-before-rail", () => {
  beforeEach(() => {
    MockWalletPaymentClient.mockClear();
  });

  it("shows Soft panel and hides payment rail until Soft CTA", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <CheckoutPayment {...baseProps} agreement={agreement} />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("checkout-full-agreement")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-pay-as-agreed")).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-payment-rail")).not.toBeInTheDocument();
    expect(screen.queryByText(/Direct/i)).not.toBeInTheDocument();
    expect(MockWalletPaymentClient).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("checkout-pay-as-agreed"));

    expect(screen.getByTestId("checkout-payment-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-full-agreement")).not.toBeInTheDocument();
    expect(screen.getByTestId("soft-ack-hash")).toHaveTextContent("sha256:soft-before-rail-test");
    expect(MockWalletPaymentClient).toHaveBeenCalled();
  });

  it("keeps Soft panel without rail when Soft agreement is incomplete", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <CheckoutPayment {...baseProps} agreement={incompleteAgreement} />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("checkout-full-agreement")).toBeInTheDocument();
    const cta = screen.getByTestId("checkout-pay-as-agreed");
    expect(cta).toBeDisabled();
    await user.click(cta);
    expect(screen.queryByTestId("checkout-payment-rail")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkout-full-agreement")).toBeInTheDocument();
    expect(MockWalletPaymentClient).not.toHaveBeenCalled();
  });
});
