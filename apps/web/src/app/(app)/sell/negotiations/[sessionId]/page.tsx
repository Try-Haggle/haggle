import { redirect } from "next/navigation";
import type { SessionResponse } from "@/app/buy/negotiations/[sessionId]/negotiation-session-data";
import { serverApi } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import { SellerNegotiation } from "./seller-negotiation";

/**
 * Seller-side negotiation page.
 *
 * Renders the same arena as the buyer's page (one negotiation, one visual
 * language) with the seller's controls instead of the buyer's agent loop.
 */
export default async function SellerNegotiationPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ replay?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/claim");

  const { sessionId } = await params;
  const { replay } = await searchParams;

  let payload: SessionResponse | null = null;
  try {
    payload = await serverApi.get<SessionResponse>(`/negotiations/sessions/${sessionId}`);
  } catch {
    redirect("/sell/dashboard");
  }
  if (!payload) redirect("/sell/dashboard");

  // Participation is enforced server-side by the API; reaching here means access.
  return <SellerNegotiation initialPayload={payload} replay={replay === "1"} />;
}
