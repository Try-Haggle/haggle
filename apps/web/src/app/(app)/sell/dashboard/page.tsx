import { redirect } from "next/navigation";
import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "./dashboard-content";

export interface ListingSummary {
  id: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  status: string;
  negotiationAgentSnapshot: Record<string, unknown> | null;
  createdAt: string;
  publicId: string;
  negotiationCount: number;
}

export interface DraftSummary {
  id: string;
  draftName: string | null;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  currentStep: number;
  updatedAt: string;
}

export interface SellerNegotiation {
  id: string;
  listing_id: string;
  status: string;
  current_round: number;
  last_offer_price_minor: number | null;
  created_at: string;
  updated_at: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated → redirect to claim/login page
  if (!user) {
    const params = await searchParams;
    const claimParam = params.claim ? `?token=${params.claim}` : "";
    redirect(`/sign-up${claimParam}`);
  }

  // Process claim if token is present
  const params = await searchParams;
  let claimResult: { ok: boolean; error?: string } | null = null;

  if (params.claim) {
    try {
      claimResult = await serverApi.post<{ ok: boolean; error?: string }>(`/api/claim`, {
        claimToken: params.claim,
        userId: user.id,
      });
    } catch {
      claimResult = { ok: false, error: "network_error" };
    }
  }

  // Fetch user's listings and drafts in parallel
  let listings: ListingSummary[] = [];
  let drafts: DraftSummary[] = [];
  try {
    const [listingsData, draftsData] = await Promise.all([
      serverApi.get<{ ok: boolean; listings: ListingSummary[] }>(`/api/listings?userId=${user.id}`),
      serverApi.get<{ ok: boolean; drafts: DraftSummary[] }>(`/api/drafts`),
    ]);
    if (listingsData.ok) listings = listingsData.listings;
    if (draftsData.ok) drafts = draftsData.drafts;
  } catch {
    // Listings/drafts will be empty — dashboard still renders
  }

  // The seller had no way into their own negotiations before this — the detail
  // page existed but nothing linked to it.
  let negotiations: SellerNegotiation[] = [];
  try {
    const data = await serverApi.get<{ sessions: SellerNegotiation[] }>(
      `/negotiations/sessions?user_id=${user.id}&role=SELLER`,
    );
    negotiations = data.sessions ?? [];
  } catch {
    // API down — the dashboard still renders without this section.
  }

  return (
    <DashboardContent
      claimResult={claimResult}
      listings={listings}
      drafts={drafts}
      negotiations={negotiations}
    />
  );
}
