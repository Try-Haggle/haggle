import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "./dashboard-content";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
    redirect(`/claim${claimParam}`);
  }

  // Process claim if token is present
  const params = await searchParams;
  let claimResult: { ok: boolean; error?: string } | null = null;

  if (params.claim) {
    try {
      const res = await fetch(`${API_URL}/api/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimToken: params.claim,
          userId: user.id,
        }),
      });
      claimResult = await res.json();
    } catch {
      claimResult = { ok: false, error: "network_error" };
    }
  }

  // Fetch user's listings
  let listings: ListingSummary[] = [];
  try {
    const res = await fetch(
      `${API_URL}/api/listings?userId=${user.id}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.ok) {
      listings = data.listings;
    }
  } catch {
    // Listings will be empty — dashboard still renders
  }

  return (
    <DashboardContent
      userEmail={user.email ?? ""}
      claimResult={claimResult}
      listings={listings}
    />
  );
}
