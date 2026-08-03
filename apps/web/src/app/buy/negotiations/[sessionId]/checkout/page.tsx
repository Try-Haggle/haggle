import { formatMoney } from "@haggle/shared";
import { LockKeyhole, PackageCheck, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import {
  type CheckoutApprovalSummary,
  isCheckoutReady,
  toPositiveMinor,
} from "../checkout-contract";
import { CheckoutPayment } from "./checkout-payment";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete payment for an accepted Haggle negotiation.",
};

interface CheckoutSessionResponse {
  session: {
    id: string;
    status: string;
    last_offer_price_minor: string | number | null;
    listing: {
      public_id: string;
      title: string;
      photo_url: string | null;
      category: string | null;
    } | null;
  };
}

interface SettlementApprovalResponse {
  approval: CheckoutApprovalSummary & {
    currency: string;
    fulfillment_type?: string;
  };
}

interface ShippingReadinessResponse {
  physical_live: {
    ready: boolean;
    live_label_max_minor: number;
    missing: string[];
  };
}

export default async function NegotiationCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const returnPath = `/buy/negotiations/${sessionId}/checkout`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(returnPath)}`);
  }

  let sessionResponse: CheckoutSessionResponse;
  let approvalResponse: SettlementApprovalResponse;
  try {
    [sessionResponse, approvalResponse] = await Promise.all([
      serverApi.get<CheckoutSessionResponse>(`/negotiations/sessions/${sessionId}`),
      serverApi.get<SettlementApprovalResponse>(`/settlement-approvals/${sessionId}`),
    ]);
  } catch {
    redirect(`/buy/negotiations/${sessionId}`);
  }

  const { session } = sessionResponse;
  const { approval } = approvalResponse;
  const amountMinor = toPositiveMinor(approval.final_amount_minor);
  const checkoutReady = isCheckoutReady({
    sessionId: session.id,
    sessionStatus: session.status,
    negotiatedAmountMinor: session.last_offer_price_minor,
    hasListing: session.listing !== null,
    userId: user.id,
    approval,
  });

  if (!checkoutReady || amountMinor === null || !session.listing) {
    redirect(`/buy/negotiations/${sessionId}`);
  }

  const money = { currency: approval.currency, amount_minor: amountMinor };
  let physicalShippingReadiness: ShippingReadinessResponse["physical_live"] | null = null;
  try {
    const readiness = await serverApi.get<ShippingReadinessResponse>(
      "/shipments/test-modes/readiness",
    );
    physicalShippingReadiness = readiness.physical_live;
  } catch {
    // The payment API remains the final fail-closed readiness check.
  }
  const requiresShipping =
    !approval.fulfillment_type ||
    approval.fulfillment_type === "physical_shipping" ||
    approval.fulfillment_type === "shipped";

  return (
    <main className="min-h-screen bg-surface px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          icon={<LockKeyhole className="size-6" />}
          title="Secure checkout"
          subtitle="Review the accepted deal before authorizing payment."
          backHref={`/buy/negotiations/${sessionId}`}
          backLabel="Back to negotiation"
          actions={
            <Badge tone="success" dot>
              Deal accepted
            </Badge>
          }
        />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card padding="lg" radius="lg">
            <CheckoutPayment
              settlementApprovalId={approval.id}
              amountMinor={amountMinor}
              currency={approval.currency}
              requiresShipping={requiresShipping}
              physicalShippingReadiness={physicalShippingReadiness}
            />
          </Card>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <Card padding="sm" radius="lg">
              <div className="flex gap-4">
                <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                  {session.listing.photo_url ? (
                    // biome-ignore lint/performance/noImgElement: remote listing photo
                    <img
                      src={session.listing.photo_url}
                      alt={session.listing.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-muted">
                      <PackageCheck className="size-7" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {session.listing.category && (
                    <p className="mb-1 text-ink-muted text-xs capitalize">
                      {session.listing.category}
                    </p>
                  )}
                  <h2 className="line-clamp-2 font-semibold text-ink text-sm">
                    {session.listing.title}
                  </h2>
                  <p className="mt-2 font-bold text-action-primary text-xl tabular-nums">
                    {formatMoney(money)}
                  </p>
                  <p className="mt-1 text-ink-muted text-xs">Negotiated price</p>
                </div>
              </div>
            </Card>

            <div className="space-y-3 border-line border-t pt-4 text-ink-secondary text-xs">
              <div className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <p>Funds follow the accepted agreement and remain subject to release rules.</p>
              </div>
              <div className="flex gap-2.5">
                <LockKeyhole className="mt-0.5 size-4 shrink-0 text-action-primary" />
                <p>Payment preparation is restricted to the buyer on this negotiation.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
