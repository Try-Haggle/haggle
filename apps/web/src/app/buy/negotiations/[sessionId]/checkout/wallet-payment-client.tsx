"use client";

import { WalletProvider } from "@/lib/wallet-provider";
import { PaymentStep } from "../payment-step";

export function WalletPaymentClient(props: {
  settlementApprovalId: string;
  amountMinor: number;
  currency: string;
}) {
  return (
    <WalletProvider>
      <PaymentStep {...props} />
    </WalletProvider>
  );
}
