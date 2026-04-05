import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";
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

export default async function BuyerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
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

  return <BuyerDashboardContent viewedListings={viewedListings} />;
}
