import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import { GuestClaimBanner } from "./_guest-claim-banner";
import { type CheckoutApprovalSummary, getCheckoutCta } from "./checkout-contract";
import { LiveNegotiation } from "./live-negotiation";
import {
  isTerminalNegotiationStatus,
  type SessionResponse,
  transformNegotiationPlayback,
} from "./negotiation-session-data";
import { PlaybackArena } from "./playback/playback-arena";

/**
 * Buyer-side live negotiation page. Replay is an explicit secondary view.
 */

export default async function BuyerNegotiationPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ replay?: string }>;
}) {
  const { sessionId } = await params;
  const { replay } = await searchParams;
  const payload = await serverApi.get<SessionResponse>(`/negotiations/sessions/${sessionId}`);
  const data = transformNegotiationPlayback(payload);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isGuest = !user;
  let approval: CheckoutApprovalSummary | undefined;

  if (payload.session.status === "ACCEPTED" && user) {
    try {
      const response = await serverApi.get<{ approval: CheckoutApprovalSummary }>(
        `/settlement-approvals/${sessionId}`,
      );
      approval = response.approval;
    } catch {
      // A missing or inaccessible approval keeps checkout fail-closed.
    }
  }
  const checkoutCta = getCheckoutCta({
    sessionId,
    sessionStatus: payload.session.status,
    userId: user?.id ?? null,
    approval,
  });
  const isTerminal = isTerminalNegotiationStatus(payload.session.status);

  if (replay === "1" && isTerminal) {
    return (
      <PlaybackArena
        data={data}
        checkoutHref={checkoutCta?.href}
        checkoutLabel={checkoutCta?.label}
      />
    );
  }

  return (
    <>
      {isGuest && (
        <GuestClaimBanner
          sessionId={sessionId}
          status={data.session.finalStatus}
          finalPriceMinor={
            data.session.finalPrice === null ? null : Math.round(data.session.finalPrice * 100)
          }
        />
      )}
      <LiveNegotiation
        initialPayload={payload}
        checkoutHref={checkoutCta?.href}
        checkoutLabel={checkoutCta?.label}
      />
    </>
  );
}
