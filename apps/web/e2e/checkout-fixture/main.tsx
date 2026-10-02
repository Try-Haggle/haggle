import { createRoot } from "react-dom/client";
import { CheckoutHeader } from "../../src/app/buy/negotiations/[sessionId]/checkout/checkout-chrome";
import { CheckoutPayment } from "../../src/app/buy/negotiations/[sessionId]/checkout/checkout-payment";
import { LocaleProvider } from "../../src/providers/locale-provider";
import "@rainbow-me/rainbowkit/styles.css";
import "../../src/app/globals.css";
const incomplete = new URLSearchParams(location.search).has("incomplete");
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <LocaleProvider>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <CheckoutHeader sessionId="checkout-test" />
        <CheckoutPayment
          settlementApprovalId="checkout-visibility-test"
          amountMinor={5000}
          currency="USD"
          requiresShipping={true}
          physicalShippingReadiness={{ ready: true, live_label_max_minor: 5000, missing: [] }}
          leaveHref="/back"
          agreement={{
            price_minor: 5000,
            currency: "USD",
            fulfillment_type: "physical_shipping",
            fulfillment_summary: "Carrier shipping",
            address: {
              kind: "delivery",
              lines: incomplete
                ? ["Address missing from Soft agreement"]
                : ["Test Buyer", "123 Test Street", "Denver, CO 80202"],
            },
            shipping_cost_minor: 0,
            fees: {
              haggle_fee_bps: 150,
              card_buyer_total_bps: 300,
              item_minor: 5000,
              shipping_minor: 0,
              haggle_fee_minor: 75,
              card_fee_minor: 150,
              buyer_pays_wallet_minor: 5075,
              buyer_pays_card_minor: 5150,
            },
            criteria: [
              {
                check_id: "imei_clean",
                label: "IMEI",
                seller_value: "Clean",
                buyer_stance: "Must be clean",
              },
            ],
            terms_hash: "sha256:checkout-visibility-fixture",
          }}
        />
      </main>
    </LocaleProvider>,
  );
