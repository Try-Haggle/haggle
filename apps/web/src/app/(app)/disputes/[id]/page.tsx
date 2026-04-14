import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";
import { DisputeDetail } from "./dispute-detail";

export interface DisputeEvidence {
  id: string;
  submitted_by: "buyer" | "seller" | "system";
  type: "text" | "image" | "tracking_snapshot" | "payment_proof" | "other";
  uri?: string;
  text?: string;
  submitted_at: string;
}

export interface Dispute {
  id: string;
  order_id: string;
  reason_code: string;
  status: string;
  opened_by: "buyer" | "seller" | "system";
  evidence: DisputeEvidence[];
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
  refundAmountMinor?: number | null;
}

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
  }

  const { id } = await params;

  let dispute: Dispute | null = null;
  try {
    const data = await serverApi.get<{ dispute: Dispute }>(`/disputes/${id}`);
    dispute = data.dispute;
  } catch {
    redirect("/buy/dashboard");
  }

  if (!dispute) {
    redirect("/buy/dashboard");
  }

  return <DisputeDetail dispute={dispute} userId={user.id} />;
}
