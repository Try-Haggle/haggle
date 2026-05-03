import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";
import { NegotiationChat } from "@/app/(app)/buy/negotiations/[sessionId]/negotiation-chat";
import type { SessionDetailData } from "@/app/(app)/buy/negotiations/[sessionId]/negotiation-chat";

export default async function SellerNegotiationPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
  }

  const { sessionId } = await params;

  let data: SessionDetailData | null = null;
  try {
    data = await serverApi.get<SessionDetailData>(
      `/negotiations/sessions/${sessionId}`,
    );
  } catch {
    redirect("/sell/dashboard");
  }

  if (!data) {
    redirect("/sell/dashboard");
  }

  // Note: Ownership verification is handled server-side by the API
  // (requireAuth + session query filtered by user). If the API returns
  // data, the user has access to this session.

  return (
    <NegotiationChat
      initialSession={data.session}
      initialRounds={data.rounds}
      userId={user.id}
      role="SELLER"
    />
  );
}
