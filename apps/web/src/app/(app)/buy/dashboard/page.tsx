import { redirect } from "next/navigation";
import { serverApi } from "@/lib/api-server";
import { BROWSED_MARKETPLACE_KEY, BUYER_GET_STARTED_DISMISSED_KEY } from "@/lib/buyer-onboarding";
import { retryTransient } from "@/lib/retry";
import { createClient } from "@/lib/supabase/server";
import { getUserDisplayName } from "@/lib/user-display-name";
import { BuyerDashboardContent } from "./dashboard-content";

export interface ViewedListing {
  id: string;
  status: string;
  firstViewedAt: string;
  lastViewedAt: string;
  negotiationStartedAt: string | null;
  publicId: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
}

import type { NegotiationListItem } from "@/components/negotiations/negotiation-roster-row";

export type ActiveNegotiation = NegotiationListItem;

export default async function BuyerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  let viewedListings: ViewedListing[] = [];
  try {
    const data = await serverApi.get<{ ok: boolean; listings: ViewedListing[] }>(
      `/api/viewed?userId=${user.id}`,
    );
    if (data.ok) {
      viewedListings = data.listings;
    }
  } catch {
    // API down — dashboard still renders with empty state
  }

  let activeNegotiations: ActiveNegotiation[] = [];
  try {
    const data = await serverApi.get<{ sessions: ActiveNegotiation[] }>(
      `/negotiations/sessions?user_id=${user.id}&role=BUYER`,
    );
    activeNegotiations = data.sessions ?? [];
  } catch {
    // API down — dashboard still renders with empty state
  }

  // "Get started" progress is read from real data rather than stored, so it
  // can never disagree with what the buyer has actually done.
  let hasAgent = false;
  let hasAddress = false;
  // False when progress could not be read. The card then stays hidden rather
  // than showing finished steps as undone (a 429 used to flip 2/3 to 1/3).
  let progressKnown = true;
  try {
    const [agentsRes, addressesRes] = await Promise.all([
      retryTransient(() =>
        serverApi.get<{ agents: Array<{ isSystem: boolean }> }>("/negotiations/agents?role=buyer"),
      ),
      retryTransient(() => serverApi.get<{ addresses: unknown[] }>("/users/me/addresses")),
    ]);
    hasAgent = agentsRes.agents.some((agent) => !agent.isSystem);
    hasAddress = addressesRes.addresses.length > 0;
  } catch {
    progressKnown = false;
  }

  return (
    <BuyerDashboardContent
      getStarted={{
        progress: {
          browsed:
            Boolean(user.user_metadata?.[BROWSED_MARKETPLACE_KEY]) ||
            viewedListings.length > 0 ||
            activeNegotiations.length > 0,
          hasAgent,
          hasAddress,
        },
        initiallyDismissed: Boolean(user.user_metadata?.[BUYER_GET_STARTED_DISMISSED_KEY]),
        progressKnown,
        defaultRecipientName: getUserDisplayName(user),
        renderedAt: Date.now(),
      }}
      userId={user.id}
      // First word only: "Welcome back, Mina", not "Welcome back, Mina Park".
      firstName={getUserDisplayName(user)?.split(/\s+/)[0] ?? null}
      viewedListings={viewedListings}
      activeNegotiations={activeNegotiations}
    />
  );
}
