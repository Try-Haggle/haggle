import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardContent } from "./dashboard-content";

// TODO: use env var for production
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

  return (
    <DashboardContent
      userEmail={user.email ?? ""}
      claimResult={claimResult}
    />
  );
}
