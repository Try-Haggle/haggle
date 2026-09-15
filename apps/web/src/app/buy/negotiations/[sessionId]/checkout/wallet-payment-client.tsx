"use client";

import type { createSoftAgreementAck } from "@/lib/soft-agreement-ack";
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
  softAgreementAck: ReturnType<typeof createSoftAgreementAck>;
}) {
  return (
    <WalletProvider>
      <PaymentStep {...props} />
    </WalletProvider>
  );
}
