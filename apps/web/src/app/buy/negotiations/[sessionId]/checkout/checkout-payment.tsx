"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import { createSoftAgreementAck } from "@/lib/soft-agreement-ack";
import { useLocale } from "@/providers/locale-provider";
import { checkoutCopy } from "../checkout-copy";
import {
  type CheckoutAgreementDisplay,
  isFullAgreementRenderable,
} from "../checkout-full-agreement";
import { CheckoutFullAgreement } from "../checkout-full-agreement-panel";

function LoadingPayment() {
  const { locale } = useLocale();
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-ink-secondary">
      <Spinner size="lg" />
      <p className="text-sm">{checkoutCopy(locale).loadingPayment}</p>
    </div>
  );
}

const WalletPaymentClient = dynamic(
  () => import("./wallet-payment-client").then((module) => module.WalletPaymentClient),
  {
    ssr: false,
    loading: LoadingPayment,
  },
);

/**
 * Soft → Hard gate (SoT checkout-full-agreement): Soft panel + CTA first;
 * PaymentStep / rail must not mount until buyer_ui_cta Soft ack.
 */
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
  const [softAgreementAck, setSoftAgreementAck] = useState<ReturnType<
    typeof createSoftAgreementAck
  > | null>(null);
  const paymentPanel = useRef<HTMLDivElement>(null);

  const softConfirmed = softAgreementAck !== null && isFullAgreementRenderable(props.agreement);

  useEffect(() => {
    if (!softConfirmed) return;
    paymentPanel.current?.focus({ preventScroll: true });
    paymentPanel.current?.scrollIntoView?.({ block: "start" });
  }, [softConfirmed]);

  // Mandatory Soft-before-rail: never mount WalletPaymentClient / PaymentStep until Soft CTA.
  if (!softConfirmed || !softAgreementAck) {
    return (
      <CheckoutFullAgreement
        agreement={props.agreement}
        leaveHref={props.leaveHref}
        onConfirm={() => {
          if (!isFullAgreementRenderable(props.agreement)) return;
          // Buyer UI CTA only — never tool/MCP mint.
          setSoftAgreementAck(createSoftAgreementAck(props.agreement.terms_hash));
        }}
      />
    );
  }

  return (
    <div ref={paymentPanel} tabIndex={-1} data-testid="checkout-payment-panel">
      <WalletPaymentClient
        settlementApprovalId={props.settlementApprovalId}
        amountMinor={props.amountMinor}
        currency={props.currency}
        requiresShipping={props.requiresShipping}
        physicalShippingReadiness={props.physicalShippingReadiness}
        softAgreementAck={softAgreementAck}
      />
    </div>
  );
}
