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
  submitted_at?: string;
  created_at?: string;
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

interface OrderInfo {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount_minor: number;
  order_snapshot: Record<string, unknown>;
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
  let order: OrderInfo | null = null;
  try {
    const data = await serverApi.get<{ dispute: Dispute }>(`/disputes/${id}`);
    dispute = data.dispute;
  } catch {
    redirect("/buy/dashboard");
  }

  if (!dispute) {
    redirect("/buy/dashboard");
  }

  // Fetch order to determine user role
  try {
    const orderData = await serverApi.get<{ order: OrderInfo }>(`/orders/${dispute.order_id}`);
    order = orderData.order;
  } catch {
    // Order fetch may fail — continue without role info
  }

  const userRole: "buyer" | "seller" =
    order && user.id === order.buyer_id ? "buyer" : "seller";
  const amountMinor = order?.amount_minor ?? null;

  return (
    <DisputeDetail
      dispute={dispute}
      userId={user.id}
      userRole={userRole}
      amountMinor={amountMinor}
    />
  );
}
