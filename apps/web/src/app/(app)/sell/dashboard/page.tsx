import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";
import { DashboardContent } from "./dashboard-content";

export interface ListingSummary {
  id: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  status: string;
  strategyConfig: Record<string, unknown> | null;
  createdAt: string;
  publicId: string;
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
      claimResult = await serverApi.post<{ ok: boolean; error?: string }>(
        `/api/claim`,
        { claimToken: params.claim, userId: user.id },
      );
    } catch {
      claimResult = { ok: false, error: "network_error" };
    }
  }

  // Fetch user's listings and drafts in parallel
  let listings: ListingSummary[] = [];
  let drafts: DraftSummary[] = [];
  try {
    const [listingsData, draftsData] = await Promise.all([
      serverApi.get<{ ok: boolean; listings: ListingSummary[] }>(
        `/api/listings?userId=${user.id}`,
      ),
      serverApi.get<{ ok: boolean; drafts: DraftSummary[] }>(`/api/drafts`),
    ]);
    if (listingsData.ok) listings = listingsData.listings;
    if (draftsData.ok) drafts = draftsData.drafts;
  } catch {
    // Listings/drafts will be empty — dashboard still renders
  }

  return (
    <DashboardContent
      userEmail={user.email ?? ""}
      claimResult={claimResult}
      listings={listings}
      drafts={drafts}
    />
  );
}
