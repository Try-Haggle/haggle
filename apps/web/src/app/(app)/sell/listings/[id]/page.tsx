import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DetailContent } from "./detail-content";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
    const res = await fetch(
      `${API_URL}/api/listings/${id}?userId=${user.id}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.ok) {
      listing = data.listing;
    }
  } catch {
    // Falls through to not-found handling
  }

  if (!listing) {
    redirect("/sell/dashboard");
  }

  return <DetailContent listing={listing} />;
}
