"use client";

import { WalletProvider } from "@/lib/wallet-provider";
import { PaymentStep } from "../payment-step";

export function WalletPaymentClient(props: {
  settlementApprovalId: string;
  amountMinor: number;
  currency: string;
  requiresShipping: boolean;
  physicalShippingReadiness: {
    ready: boolean;
    live_label_max_minor: number;
    missing: string[];
  } | null;
}) {
  return (
    <WalletProvider>
      <PaymentStep {...props} />
    </WalletProvider>
  );
}
