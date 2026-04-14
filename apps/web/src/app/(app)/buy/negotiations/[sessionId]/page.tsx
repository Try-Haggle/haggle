import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";
import { NegotiationChat } from "./negotiation-chat";

interface Round {
  id: string;
  round_no: number;
  sender_role: "BUYER" | "SELLER";
  message_type: string;
  price_minor: number | null;
  counter_price_minor: number | null;
  utility: number | null;
  decision: string | null;
  created_at: string;
}

export interface NegotiationSession {
  id: string;
  listing_id: string;
  role: "BUYER" | "SELLER";
  status: string;
  current_round: number;
  last_offer_price_minor: number | null;
  last_utility: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface SessionDetailData {
  session: NegotiationSession;
  rounds: Round[];
}

export default async function BuyerNegotiationPage({
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
    redirect("/buy/dashboard");
  }

  if (!data) {
    redirect("/buy/dashboard");
  }

  return (
    <NegotiationChat
      initialSession={data.session}
      initialRounds={data.rounds}
      userId={user.id}
      role="BUYER"
    />
  );
}
