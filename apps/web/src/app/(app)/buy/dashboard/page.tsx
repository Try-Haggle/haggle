import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuyerDashboardContent } from "./dashboard-content";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
    const res = await fetch(
      `${API_URL}/api/viewed?userId=${user.id}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.ok) {
      viewedListings = data.listings;
    }
  } catch {
    // API down — dashboard still renders with empty state
  }

  return <BuyerDashboardContent viewedListings={viewedListings} />;
}
