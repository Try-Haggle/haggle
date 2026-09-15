"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Spinner } from "@/components/ui";
import { createSoftAgreementAck } from "@/lib/soft-agreement-ack";
import {
  type CheckoutAgreementDisplay,
  isFullAgreementRenderable,
} from "../checkout-full-agreement";
import { CheckoutFullAgreement } from "../checkout-full-agreement-panel";

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
  requiresShipping: boolean;
  physicalShippingReadiness: {
    ready: boolean;
    live_label_max_minor: number;
    missing: string[];
  } | null;
  agreement: CheckoutAgreementDisplay;
  leaveHref: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [softAgreementAck, setSoftAgreementAck] = useState<ReturnType<
    typeof createSoftAgreementAck
  > | null>(null);

  if (!confirmed || !softAgreementAck) {
    return (
      <CheckoutFullAgreement
        agreement={props.agreement}
        leaveHref={props.leaveHref}
        onConfirm={() => {
          if (!isFullAgreementRenderable(props.agreement)) return;
          // Buyer UI CTA only — never tool/MCP mint.
          setSoftAgreementAck(createSoftAgreementAck(props.agreement.terms_hash));
          setConfirmed(true);
        }}
      />
    );
  }

  return (
    <WalletPaymentClient
      settlementApprovalId={props.settlementApprovalId}
      amountMinor={props.amountMinor}
      currency={props.currency}
      requiresShipping={props.requiresShipping}
      physicalShippingReadiness={props.physicalShippingReadiness}
      softAgreementAck={softAgreementAck}
    />
  );
}
