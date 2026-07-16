"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

const WalletPaymentClient = dynamic(
  () => import("./wallet-payment-client").then((module) => module.WalletPaymentClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-ink-secondary">
        <Spinner size="lg" />
        <p className="text-sm">Loading secure payment...</p>
      </div>
    ),
  },
);

export function CheckoutPayment(props: {
  settlementApprovalId: string;
  amountMinor: number;
  currency: string;
}) {
  return <WalletPaymentClient {...props} />;
}
