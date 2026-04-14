import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { serverApi } from "@/lib/api-server";
import { DetailContent } from "./detail-content";

export interface ListingDetail {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  condition: string | null;
  photoUrl: string | null;
  targetPrice: string | null;
  floorPrice: string | null;
  tags: string[] | null;
  status: string;
  strategyConfig: Record<string, unknown> | null;
  sellingDeadline: string | null;
  createdAt: string;
  publicId: string;
}

export default async function ListingDetailPage({
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

  let listing: ListingDetail | null = null;
  try {
    const data = await serverApi.get<{ ok: boolean; listing: ListingDetail }>(
      `/api/listings/${id}?userId=${user.id}`,
    );
    if (data.ok) {
      listing = data.listing;
    }
  } catch {
    // Falls through to not-found handling
  }

  if (!listing) {
    redirect("/sell/dashboard");
  }

  return <DetailContent listing={listing} sellerId={user.id} />;
}
